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
#include "esp_task_wdt.h"
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
static QueueHandle_t txFreePackets;
static SemaphoreHandle_t txDone;
static std::atomic<uint32_t> rxPackets{0}, txQueued{0}, txSent{0}, txDropped{0};
static std::atomic<uint32_t> txCallbacks{0};
static std::atomic<uint32_t> rxArmFailures{0}, rxErrors{0}, lastRxLength{0}, endpointState{0};
// RNDIS control path. The handshake runs over EP0, so the OUT-endpoint
// counters above reveal nothing about it.
static std::atomic<uint32_t> ctrlCalls{0}, reportCalls{0}, rndisMsgs{0};
static std::atomic<uint32_t> lastRndisMsg{0}, rndisState{0};
static std::atomic<uint32_t> inXferFail{0}, inXferDone{0};
// Deferred callbacks that did not signal within the semaphore timeout.
static std::atomic<uint32_t> txDeferLost{0};
// Fewest free frames ever seen in the egress pool. Zero means transmit() ran
// the pool dry and started shedding packets; a figure comfortably above zero
// means the pool is large enough for the offered load.
static std::atomic<uint32_t> txPoolLow{0};

static std::atomic<uint32_t> inBusy{0}, inStalled{0}, inSubmitLen{0}, inCompleteLen{0};
static std::atomic<uint32_t> inCtl{0}, inInt{0}, inSize{0}, inFifo{0}, inFifoConfig{0};

static void sampleDriverStatus() {
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
    inBusy = status.in_busy; inStalled = status.in_stalled;
    inSubmitLen = status.in_submit_len; inCompleteLen = status.in_complete_len;
    inCtl = status.in_ctl; inInt = status.in_int;
    inSize = status.in_size; inFifo = status.in_fifo;
    inFifoConfig = status.in_fifo_config;
}

static void sampleOnUsbTask(void *) {
    sampleDriverStatus();
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
    sampleDriverStatus();
    xSemaphoreGive(txDone);
}

// Defer requests share TinyUSB's event queue with DCD completions. Limit
// retries to reduce traffic while the endpoint is busy. In this FreeRTOS
// build, posting a defer from a task itself waits indefinitely for queue
// space; the semaphore timeout below only bounds the wait AFTER that post.
// The pool owns queued and in-flight frames; only an acknowledged callback
// permits reuse. A stalled callback stops the worker without blocking lwIP.
//
// Sizing this is a throughput-versus-RAM trade. Every frame costs a full MTU
// (~1516 bytes) of static RAM, and the pool is shared by every concurrent TCP
// stream. A browser opening one page makes about six connections at once, and
// each one immediately puts a full initial window on the wire; at nine frames
// the pool emptied constantly and transmit() shed ~9.5% of egress on a
// DevKitC-1, which TCP saw as loss and answered with retransmits and stalled
// page loads. The pool only needs to absorb that opening burst - the drain
// rate is set by the USB IN endpoint, not by this number - so the goal is to
// let TCP's window settle rather than to buffer indefinitely.
//
// Raising this to 24 was tried and measured, and it made things materially
// worse: concurrent page loads went from 6 failures in 8 to 20 in 20, and the
// heap floor fell from 2664 bytes to 1126. The arithmetic is the whole story.
// Fifteen extra frames is 22,744 bytes of *static* RAM, taken from a board
// whose heap floor was already under 3 KB, and the heap is where lwIP finds
// pbufs and the async web server finds its response buffers. Buffering was
// bought with exactly the memory needed to assemble the responses being
// buffered. On a board with PSRAM the trade would likely pay; on this one it
// cannot. Do not raise this again without first making headroom elsewhere.
//
// txPoolLow records how close the pool actually comes to empty, reported on
// the [USB TX] status line.
static constexpr size_t TX_POOL_FRAMES = 9;
static Packet txPackets[TX_POOL_FRAMES];
static SendAttempt txAttempt;

static void txTask(void *) {
    for (;;) {
        Packet *packet = nullptr;
        if (xQueueReceive(txQueue, &packet, pdMS_TO_TICKS(1000)) != pdTRUE) {
            usbd_defer_func(sampleOnUsbTask, nullptr, false);
            // Bound completion waiting after the defer has been posted.
            if (xSemaphoreTake(txDone, pdMS_TO_TICKS(200)) != pdTRUE) {
                ++txDeferLost;
                // Keep ownership until this callback acknowledges completion.
                while (xSemaphoreTake(txDone, pdMS_TO_TICKS(200)) != pdTRUE) {}
            }
            continue;
        }
        txAttempt.packet = packet;
        txAttempt.sent = false;
        for (int attempt = 0; attempt < 3 && !txAttempt.sent; ++attempt) {
            if (attempt) vTaskDelay(pdMS_TO_TICKS(10));
            usbd_defer_func(sendOnUsbTask, &txAttempt, false);
            if (xSemaphoreTake(txDone, pdMS_TO_TICKS(200)) != pdTRUE) {
                ++txDeferLost;
                // A timeout does not cancel a queued callback. Reusing its
                // packet or semaphore would race a later request.
                while (xSemaphoreTake(txDone, pdMS_TO_TICKS(200)) != pdTRUE) {}
                break;
            }
        }
        if (!txAttempt.sent) ++txDropped;
        xQueueSend(txFreePackets, &packet, 0);
    }
}

static esp_err_t transmit(void *, void *buffer, size_t len) {
    if (!txQueue || len > CFG_TUD_NET_MTU) return ESP_ERR_INVALID_SIZE;
    // Called on lwIP's 2560-byte stack. Never put a 1516-byte frame on it.
    Packet *packet = nullptr;
    if (xQueueReceive(txFreePackets, &packet, 0) != pdTRUE) {
        txPoolLow = 0;
        ++txDropped;
        return ESP_ERR_NO_MEM;
    }
    // Sampled after the take, so this is the depth the next caller would find.
    const uint32_t free_now = uxQueueMessagesWaiting(txFreePackets);
    uint32_t low = txPoolLow.load(std::memory_order_relaxed);
    while (free_now < low &&
           !txPoolLow.compare_exchange_weak(low, free_now, std::memory_order_relaxed)) {
    }
    packet->length = len;
    memcpy(packet->bytes, buffer, len);
    if (xQueueSend(txQueue, &packet, 0) == pdTRUE) {
        ++txQueued;
        return ESP_OK;
    }
    xQueueSend(txFreePackets, &packet, 0);
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
    // Inspect subscriptions instead of assuming startup deinitialised TWDT.
    const char *tasks[] = {"IDLE0", "IDLE1", "loopTask", "tiT", "async_tcp", "usbd", "usbnet_tx"};
    for (const char *name : tasks) {
        TaskHandle_t task = xTaskGetHandle(name);
        if (task) {
            Serial.printf("[USB TASK] %s wdt=%s state=%d core=%d stack=%u\n", name,
                esp_err_to_name(esp_task_wdt_status(task)), (int)eTaskGetState(task), (int)xTaskGetAffinity(task),
                (unsigned)uxTaskGetStackHighWaterMark(task));
        }
    }
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
    Serial.printf("[USB TX] in_fail=%u in_done=%u defer_lost=%u pool=%u/%u low=%u\n",
        inXferFail.load(), inXferDone.load(), txDeferLost.load(),
        static_cast<unsigned>(uxQueueMessagesWaiting(txFreePackets)),
        static_cast<unsigned>(TX_POOL_FRAMES), txPoolLow.load());
    Serial.printf("[USB IN] busy=%u stalled=%u submit=%u complete=%u ctl=%08x int=%08x size=%08x fifo=%u config=%08x\n",
        inBusy.load(), inStalled.load(), inSubmitLen.load(), inCompleteLen.load(),
        inCtl.load(), inInt.load(), inSize.load(), inFifo.load(), inFifoConfig.load());
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
    // One frame short of the pool: txTask holds a packet while it sends, so a
    // full queue plus the in-flight frame is exactly the pool.
    txQueue = xQueueCreate(TX_POOL_FRAMES - 1, sizeof(Packet *));
    txFreePackets = xQueueCreate(TX_POOL_FRAMES, sizeof(Packet *));
    txPoolLow = TX_POOL_FRAMES;
    txDone = xSemaphoreCreateBinary();
    if (!txQueue || !txFreePackets || !txDone) {
        if (txQueue) vQueueDelete(txQueue);
        if (txFreePackets) vQueueDelete(txFreePackets);
        if (txDone) vSemaphoreDelete(txDone);
        txQueue = nullptr;
        txFreePackets = nullptr;
        txDone = nullptr;
        return ESP_ERR_NO_MEM;
    }
    for (auto &packet : txPackets) {
        Packet *entry = &packet;
        xQueueSend(txFreePackets, &entry, 0);
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
        vQueueDelete(txFreePackets);
        vSemaphoreDelete(txDone);
        txQueue = nullptr;
        txFreePackets = nullptr;
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
