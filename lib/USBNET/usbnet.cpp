#ifdef FPVGATE_USB_NET
#include "usbnet.h"
#include "usbnet_diagnostics.h"
#include "esp32-hal-tinyusb.h"
#include "device/usbd_pvt.h"
#include "class/net/net_device.h"
#include "esp_netif.h"
#include "esp_netif_defaults.h"
#include "esp_netif_net_stack.h"
#include "lwip/netif.h"
#include "esp_system.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "lwip/ip4_addr.h"
#include <cstdlib>
#include <cstring>
#include <atomic>
#include <Arduino.h>
#include "lwip/priv/tcp_priv.h"

extern "C" {
uint8_t tud_network_mac_address[6] = {0x02, 0, 0, 0, 0, 1};
esp_err_t usbnet_dhcp_start(struct netif *interface);
}

static esp_netif_t *netif;
// Set only once the netif is fully up and lwIP can accept input. The USB
// stack is started by the core in app_main(), so RNDIS can reach
// data_initialized and the host can start sending BEFORE usbnet_begin()
// runs. Handing a packet to esp_netif_receive() before lwIP is ready
// aborts in tcpip_inpkt ("Invalid mbox") - confirmed by core dump.
static std::atomic<bool> netifReady{false};
static esp_err_t startupResult = ESP_FAIL;
static esp_err_t registrationResult = ESP_FAIL;
static QueueHandle_t txQueue;
static SemaphoreHandle_t txDone;
static std::atomic<uint32_t> rxPackets{0}, txQueued{0}, txSent{0}, txDropped{0};
static std::atomic<uint32_t> txCallbacks{0};
static std::atomic<uint32_t> rxArmFailures{0}, rxErrors{0}, lastRxLength{0}, endpointState{0};
// RNDIS control path. The handshake runs over EP0, so the OUT-endpoint
// counters above reveal nothing about it.
static std::atomic<uint32_t> ctrlCalls{0}, reportCalls{0}, rndisMsgs{0};
static std::atomic<uint32_t> lastRndisMsg{0}, rndisState{0};
static std::atomic<uint32_t> inXferFail{0}, inXferDone{0};
// Defers dropped by a full TinyUSB event queue, or USB task stalls.
static std::atomic<uint32_t> txDeferLost{0};

static void sampleOnUsbTask(void *) {
    usbnet_driver_status_t status = {};
    usbnet_driver_status(&status);
    rxArmFailures = status.arm_failures;
    rxErrors = status.rx_errors;
    lastRxLength = status.last_rx_length;
    endpointState = status.endpoint_state;
    ctrlCalls = status.control_calls;
    reportCalls = status.report_calls;
    rndisMsgs = status.rndis_msgs;
    lastRndisMsg = status.last_rndis_msg;
    rndisState = status.rndis_state;
    inXferFail = status.in_xfer_fail;
    inXferDone = status.in_xfer_done;
    xSemaphoreGive(txDone);
}
struct Packet {
    uint16_t length;
    uint8_t bytes[CFG_TUD_NET_MTU];
};
struct SendAttempt {
    Packet *packet;
    bool sent;
};

static uint16_t descriptor(uint8_t *dst, uint8_t *itf) {
    uint8_t notification = tinyusb_get_free_in_endpoint();
    uint8_t data = tinyusb_get_free_duplex_endpoint();
    if (!notification || !data) return 0;
    uint8_t str = tinyusb_add_string_descriptor("FPVGate USB Network");
    const uint8_t desc[] = {
        TUD_RNDIS_DESCRIPTOR(*itf, str, static_cast<uint8_t>(0x80 | notification), 8,
                             data, static_cast<uint8_t>(0x80 | data), 64)
    };
    memcpy(dst, desc, sizeof(desc));
    *itf += 2;
    return sizeof(desc);
}

// Arduino starts USB before setup(). Slot zero makes RNDIS precede CDC;
// USBMSC must not be used alongside this module.
class RegisterUsbNet {
public:
    RegisterUsbNet() {
        uint8_t mac[6];
        if (esp_efuse_mac_get_default(mac) == ESP_OK) {
            memcpy(tud_network_mac_address, mac, 6);
            tud_network_mac_address[0] = (mac[0] | 2) & 0xfe;
        }
        registrationResult = tinyusb_enable_interface(
            USB_INTERFACE_MSC, TUD_RNDIS_DESC_LEN, descriptor);
    }
};
static RegisterUsbNet registration;

extern "C" const usbd_class_driver_t *usbd_app_driver_get_cb(uint8_t *count) {
    static const usbd_class_driver_t driver = {
#if CFG_TUSB_DEBUG >= CFG_TUD_LOG_LEVEL
        "RNDIS",
#endif
        netd_init, netd_reset, netd_open, netd_control_xfer_cb, netd_xfer_cb, nullptr
    };
    *count = 1;
    return &driver;
}

// All TinyUSB transmit operations run on its task. A bounded queue owns
// copies of lwIP buffers so the TCP/IP task never waits for USB progress.
static void sendOnUsbTask(void *arg) {
    ++txCallbacks;
    auto *attempt = static_cast<SendAttempt *>(arg);
    attempt->sent = tud_ready() && tud_network_can_xmit(attempt->packet->length);
    if (attempt->sent) {
        tud_network_xmit(attempt->packet, attempt->packet->length);
        ++txSent;
    }
    xSemaphoreGive(txDone);
}

// One TinyUSB event queue (CFG_TUD_TASK_QUEUE_SZ, 16) carries BOTH our
// usbd_defer_func() requests and DCD events such as XFER_COMPLETE. The
// completion event is what re-arms can_xmit, so flooding the queue with retry
// defers starves the very event we are waiting for - a self-reinforcing
// deadlock. usbd_defer_func() also returns void, so a full queue drops the
// request silently and a portMAX_DELAY wait would block forever.
//
// Hence: few attempts, spaced well apart, and never an unbounded wait. The
// buffers are file-static because a late callback must not write into a stack
// frame that has already been reused.
static Packet txPacket;
static SendAttempt txAttempt;

static void txTask(void *) {
    for (;;) {
        if (xQueueReceive(txQueue, &txPacket, pdMS_TO_TICKS(1000)) != pdTRUE) {
            usbd_defer_func(sampleOnUsbTask, nullptr, false);
            // Bounded: a dropped defer must not wedge the diagnostics path.
            xSemaphoreTake(txDone, pdMS_TO_TICKS(200));
            continue;
        }
        txAttempt.packet = &txPacket;
        txAttempt.sent = false;
        for (int attempt = 0; attempt < 3 && !txAttempt.sent; ++attempt) {
            if (attempt) vTaskDelay(pdMS_TO_TICKS(10));
            usbd_defer_func(sendOnUsbTask, &txAttempt, false);
            if (xSemaphoreTake(txDone, pdMS_TO_TICKS(200)) != pdTRUE) {
                // The defer was dropped or the USB task is stalled. Give up on
                // this packet; TCP will retransmit. Never block indefinitely.
                ++txDeferLost;
                break;
            }
        }
        if (!txAttempt.sent) ++txDropped;
    }
}

static esp_err_t transmit(void *, void *buffer, size_t len) {
    if (!txQueue || len > CFG_TUD_NET_MTU) return ESP_ERR_INVALID_SIZE;
    Packet packet;
    packet.length = len;
    memcpy(packet.bytes, buffer, len);
    if (xQueueSend(txQueue, &packet, 0) == pdTRUE) {
        ++txQueued;
        return ESP_OK;
    }
    ++txDropped;
    return ESP_ERR_NO_MEM;
}

static void freeRx(void *, void *buffer) { free(buffer); }

extern "C" bool tud_network_recv_cb(const uint8_t *src, uint16_t len) {
    ++rxPackets;
    if (netifReady.load(std::memory_order_acquire) && len && len <= CFG_TUD_NET_MTU) {
        void *copy = malloc(len);
        if (copy) {
            memcpy(copy, src, len);
            // Ethernet netstack consumes and frees this driver-owned buffer.
            esp_netif_receive(netif, copy, len, nullptr);
        }
    }
    // RNDIS renews the OUT transfer when false is returned. No recursive renew.
    return false;
}

extern "C" uint16_t tud_network_xmit_cb(uint8_t *dst, void *ref, uint16_t len) {
    memcpy(dst, static_cast<Packet *>(ref)->bytes, len);
    return len;
}
extern "C" void tud_network_init_cb(void) {}

struct NetStatus {
    unsigned flags;
    unsigned listeners;
};

static esp_err_t readNetStatus(void *arg) {
    auto *status = static_cast<NetStatus *>(arg);
    auto *interface = static_cast<struct netif *>(esp_netif_get_netif_impl(netif));
    status->flags = interface->flags;
    for (auto *pcb = tcp_listen_pcbs.listen_pcbs; pcb; pcb = pcb->next) {
        if (pcb->local_port == 80) ++status->listeners;
    }
    return ESP_OK;
}

void usbnet_print_status(void) {
    if (!netif) return;
    NetStatus status = {};
    esp_netif_tcpip_exec(readNetStatus, &status);
    Serial.printf("[USB] start=%s flags=0x%x http=%u rx=%u queued=%u sent=%u dropped=%u callbacks=%u pending=%u\n",
        esp_err_to_name(startupResult), status.flags, status.listeners,
        rxPackets.load(), txQueued.load(), txSent.load(), txDropped.load(),
        txCallbacks.load(), static_cast<unsigned>(uxQueueMessagesWaiting(txQueue)));
    Serial.printf("[USB EP] state=0x%x arm_fail=%u rx_error=%u last_rx=%u\n",
        endpointState.load(), rxArmFailures.load(), rxErrors.load(), lastRxLength.load());
    Serial.printf("[USB RNDIS] ctrl=%u report=%u msgs=%u last_msg=0x%x state=%u\n",
        ctrlCalls.load(), reportCalls.load(), rndisMsgs.load(),
        lastRndisMsg.load(), rndisState.load());
    Serial.printf("[USB TX] in_fail=%u in_done=%u defer_lost=%u\n",
        inXferFail.load(), inXferDone.load(), txDeferLost.load());
    // Reset reason is repeated every cycle rather than only in the boot
    // banner, because the banner is easy to miss on a board that resets
    // under load. 4=PANIC 5=INT_WDT 6=TASK_WDT 7=WDT 9=BROWNOUT.
    Serial.printf("[USB SYS] reset_reason=%d uptime=%lus heap=%u min=%u\n",
        (int)esp_reset_reason(), (unsigned long)(millis() / 1000),
        (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap());
}

static esp_err_t startDhcp(void *arg) {
    return usbnet_dhcp_start(static_cast<struct netif *>(arg));
}

esp_err_t usbnet_begin(void) {
    if (netif) return startupResult;
    if (registrationResult != ESP_OK) return registrationResult;
    // Idempotent. FPVGate normally gets this via WiFi, but USB must not
    // depend on WiFi having initialised the stack first.
    esp_netif_init();
    txQueue = xQueueCreate(8, sizeof(Packet));
    txDone = xSemaphoreCreateBinary();
    if (!txQueue || !txDone) {
        if (txQueue) vQueueDelete(txQueue);
        if (txDone) vSemaphoreDelete(txDone);
        txQueue = nullptr;
        txDone = nullptr;
        return ESP_ERR_NO_MEM;
    }
    esp_netif_ip_info_t ip = {};
    IP4_ADDR(&ip.ip, 192, 168, 7, 1);
    IP4_ADDR(&ip.gw, 192, 168, 7, 1);
    IP4_ADDR(&ip.netmask, 255, 255, 255, 0);
    esp_netif_inherent_config_t base = {};
    // The built-in DHCP server has global state shared with WiFi AP on IDF 4.4.
    base.flags = ESP_NETIF_FLAG_AUTOUP;
    base.ip_info = &ip;
    base.if_key = "USB_NET";
    base.if_desc = "FPVGate USB";
    base.route_prio = 0;
    // The host adapter and device Ethernet interface need distinct MACs.
    memcpy(base.mac, tud_network_mac_address, 6);
    base.mac[5] ^= 0x80;
    esp_netif_driver_ifconfig_t driver = {};
    driver.handle = &registration;
    driver.transmit = transmit;
    driver.driver_free_rx_buffer = freeRx;
    esp_netif_config_t config = {&base, &driver, ESP_NETIF_NETSTACK_DEFAULT_ETH};
    esp_netif_t *created = esp_netif_new(&config);
    if (!created || xTaskCreate(txTask, "usbnet_tx", 4096, nullptr, 4, nullptr) != pdPASS) {
        if (created) esp_netif_destroy(created);
        vQueueDelete(txQueue);
        vSemaphoreDelete(txDone);
        txQueue = nullptr;
        txDone = nullptr;
        return ESP_ERR_NO_MEM;
    }
    netif = created;
    esp_netif_action_start(netif, nullptr, 0, nullptr);
    if (!esp_netif_is_netif_up(netif)) return ESP_FAIL;
    startupResult = esp_netif_tcpip_exec(startDhcp, esp_netif_get_netif_impl(netif));
    if (startupResult == ESP_OK) netifReady.store(true, std::memory_order_release);
    return startupResult;
}
#endif
