/**
 * CDC-NCM glue: TinyUSB class driver <-> lwIP netif, plus a DHCP server.
 *
 * The Arduino core ships TinyUSB 0.16.0 headers for the net class but does not
 * compile the class itself, so ncm_device.c is vendored alongside this file.
 * Two core hooks make that work without patching the core:
 *
 *   - usbd_app_driver_get_cb() is a weak symbol in libarduino_tinyusb.a, so
 *     overriding it here registers netd_* without rebuilding usbd.c.
 *   - tinyusb_enable_interface(USB_INTERFACE_CUSTOM, ...) appends our interface
 *     descriptor to the composite configuration the core assembles.
 */

#include "usb_net.h"

#include "esp32-hal-tinyusb.h"
#include "device/usbd_pvt.h"

#include "lwip/netif.h"
#include "lwip/tcpip.h"
#include "lwip/etharp.h"
#include "lwip/ip4_addr.h"
#include "dhcpserver/dhcpserver.h"
#include "dhcpserver/dhcpserver_options.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_attr.h"
#include "esp_mac.h"
#include "esp_netif.h"

#include <stdio.h>
#include <string.h>

static const char *TAG = "usb_net";

// Placed in RTC noinit so a panic reboot preserves it; see usb_net.h.
RTC_NOINIT_ATTR uint32_t usb_net_progress;

static void mark(uint32_t step) { usb_net_progress = USB_NET_STEP_MAGIC | step; }

const char *usb_net_step_name(uint32_t step) {
    switch (step) {
        case USB_NET_STEP_NONE:        return "none";
        case USB_NET_STEP_ENTER:       return "entered pre_usb";
        case USB_NET_STEP_MAC:         return "esp_read_mac";
        case USB_NET_STEP_EP_NOTIF:    return "alloc notif IN endpoint";
        case USB_NET_STEP_EP_OUT:      return "alloc data OUT endpoint";
        case USB_NET_STEP_EP_IN:       return "alloc data IN endpoint";
        case USB_NET_STEP_EP_CHECKED:  return "endpoints validated";
        case USB_NET_STEP_STR_PRODUCT: return "add product string desc";
        case USB_NET_STEP_STR_MAC:     return "add MAC string desc";
        case USB_NET_STEP_ENABLE_ITF:  return "tinyusb_enable_interface";
        case USB_NET_STEP_DONE:        return "done";
        default:                       return "unknown";
    }
}

// Device end of the USB link. The host is leased .2 from the pool below.
#define USB_NET_IP      "192.168.5.1"
#define USB_NET_MASK    "255.255.255.0"
#define USB_NET_HOST_LO "192.168.5.2"
#define USB_NET_HOST_HI "192.168.5.2"

// How long linkoutput waits for a free NCM transmit slot before dropping the
// frame. Dropping is safe: TCP retransmits, and blocking here would stall the
// whole lwIP tcpip thread.
#define USB_NET_TX_TIMEOUT_MS 50

static struct netif s_netif;
static bool s_netif_added = false;
static volatile bool s_link_up = false;

// Referenced by ncm_device.c. Locally administered (bit 1 of the first octet)
// and not multicast (bit 0 clear). The host side is advertised via the
// iMACAddress string descriptor and must differ from this one.
uint8_t tud_network_mac_address[6] = {0x02, 0x02, 0x84, 0x6A, 0x96, 0x00};

//--------------------------------------------------------------------+
// TinyUSB class driver registration
//--------------------------------------------------------------------+

static const usbd_class_driver_t s_ncm_driver = {
#if CFG_TUSB_DEBUG >= 2
    .name = "NCM",
#endif
    .init             = netd_init,
    .reset            = netd_reset,
    .open             = netd_open,
    .control_xfer_cb  = netd_control_xfer_cb,
    .xfer_cb          = netd_xfer_cb,
    .sof              = NULL,
};

// Overrides the weak definition in libarduino_tinyusb.a.
usbd_class_driver_t const *usbd_app_driver_get_cb(uint8_t *driver_count) {
    *driver_count = 1;
    return &s_ncm_driver;
}

//--------------------------------------------------------------------+
// Configuration descriptor
//--------------------------------------------------------------------+

static uint8_t s_ep_notif = 0;
static uint8_t s_ep_out = 0;
static uint8_t s_ep_in = 0;
static uint8_t s_str_desc = 0;
static uint8_t s_str_mac = 0;

// The core reserves TUD_CDC_NCM_DESC_LEN bytes in the configuration descriptor
// and trusts the callback below to emit exactly that many. If the two disagree
// the whole descriptor is malformed: the host builds the composite parent but
// cannot start any function, so the CDC port enumerates yet never becomes
// usable and the NCM interface never appears at all.
_Static_assert(sizeof((uint8_t[]){TUD_CDC_NCM_DESCRIPTOR(0, 0, 0, 0x81, 64, 0x02, 0x83, 64,
                                                         CFG_TUD_NET_MTU)}) ==
                   TUD_CDC_NCM_DESC_LEN,
               "TUD_CDC_NCM_DESCRIPTOR size does not match TUD_CDC_NCM_DESC_LEN");

static uint16_t ncm_descriptor_cb(uint8_t *dst, uint8_t *itf) {
    uint8_t desc[] = {TUD_CDC_NCM_DESCRIPTOR(*itf, s_str_desc, s_str_mac, 0x80 | s_ep_notif, 64,
                                             s_ep_out, 0x80 | s_ep_in, 64, CFG_TUD_NET_MTU)};
    memcpy(dst, desc, sizeof(desc));
    *itf += 2;  // NCM is a control interface plus a data interface
    return sizeof(desc);
}

//--------------------------------------------------------------------+
// TinyUSB <-> lwIP data path
//--------------------------------------------------------------------+

/**
 * Host -> device receive path.
 *
 * tud_network_recv_renew() must NOT be called from inside this callback: the
 * driver invokes the callback from within renew itself, so calling it back
 * re-enters the whole sequence and blows the stack. That is TinyUSB issue
 * #2711, which esp_tinyusb also shipped.
 *
 * Instead the callback only copies the datagram out and signals the pump task
 * below, which hands the frame to lwIP and then asks for the next datagram
 * from its own stack.
 */
static struct pbuf *volatile s_rx_frame;
static SemaphoreHandle_t s_rx_sem;
static TaskHandle_t s_rx_task;

// Called on the TinyUSB task, from inside tud_network_recv_renew().
bool tud_network_recv_cb(const uint8_t *src, uint16_t size) {
    // The pump is created in usb_net_start(); before that there is no netif to
    // deliver to anyway. Dropping here is safe, and giving a NULL semaphore
    // would fault.
    if (s_rx_sem == NULL) return false;

    // The driver has already consumed this datagram by the time we are called,
    // so there is nothing useful to do but drop it if we cannot take it.
    if (s_rx_frame != NULL) {
        ESP_LOGW(TAG, "rx slot busy, dropping %u byte frame", size);
        return false;
    }

    if (size) {
        struct pbuf *p = pbuf_alloc(PBUF_RAW, size, PBUF_POOL);
        if (p == NULL) {
            ESP_LOGW(TAG, "pbuf_alloc failed, dropping %u byte frame", size);
            return false;
        }
        pbuf_take(p, src, size);
        s_rx_frame = p;
    }

    xSemaphoreGive(s_rx_sem);
    return true;
}

// Owns the renew call, keeping it off the TinyUSB callback stack.
static void usb_net_rx_task(void *arg) {
    (void)arg;
    for (;;) {
        if (xSemaphoreTake(s_rx_sem, portMAX_DELAY) != pdTRUE) continue;

        struct pbuf *p = s_rx_frame;
        s_rx_frame = NULL;

        if (p != NULL) {
            // tcpip_input hands the frame to the lwIP thread; nothing here may
            // touch the stack directly.
            if (!s_netif_added || tcpip_input(p, &s_netif) != ERR_OK) {
                pbuf_free(p);
            }
        }

        // Ask for the next datagram now that this one is dealt with.
        tud_network_recv_renew();
    }
}

// Device -> host. Called by ncm_device.c to fill the transmit buffer.
uint16_t tud_network_xmit_cb(uint8_t *dst, void *ref, uint16_t arg) {
    (void)arg;
    struct pbuf *p = (struct pbuf *)ref;
    return pbuf_copy_partial(p, dst, p->tot_len, 0);
}

void tud_network_init_cb(void) {}

static void usb_net_apply_link_state(void *arg) {
    // Runs on the lwIP thread.
    if (!s_netif_added) return;
    if ((bool)(uintptr_t)arg) {
        netif_set_link_up(&s_netif);
    } else {
        netif_set_link_down(&s_netif);
    }
}

void tud_network_link_state_cb(bool state) {
    s_link_up = state;
    if (!s_netif_added) return;
    // Called on the TinyUSB task; hand the netif change to the lwIP thread.
    tcpip_callback(usb_net_apply_link_state, (void *)(uintptr_t)state);
}

//--------------------------------------------------------------------+
// lwIP netif
//--------------------------------------------------------------------+

static err_t usb_net_linkoutput(struct netif *netif, struct pbuf *p) {
    (void)netif;

    // Wait briefly for the previous NTB to drain rather than dropping on the
    // first busy poll. Runs on the lwIP thread, so the wait has to be bounded.
    for (int waited = 0; waited < USB_NET_TX_TIMEOUT_MS; waited++) {
        if (!s_link_up) return ERR_IF;
        if (tud_network_can_xmit(p->tot_len)) {
            tud_network_xmit(p, 0);
            return ERR_OK;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }

    ESP_LOGW(TAG, "tx timeout, dropping %u byte frame", p->tot_len);
    return ERR_TIMEOUT;
}

static err_t usb_net_netif_init(struct netif *netif) {
    netif->name[0] = 'u';
    netif->name[1] = 's';
    netif->linkoutput = usb_net_linkoutput;
    netif->output = etharp_output;
    netif->mtu = 1500;
    netif->hwaddr_len = ETH_HWADDR_LEN;
    memcpy(netif->hwaddr, tud_network_mac_address, ETH_HWADDR_LEN);
    netif->flags = NETIF_FLAG_BROADCAST | NETIF_FLAG_ETHARP | NETIF_FLAG_IGMP;
    return ERR_OK;
}

static void usb_net_start_dhcps(void) {
    // Never advertise ourselves as a router or DNS server. Windows would
    // otherwise be free to prefer the USB link as its default route and black
    // hole the machine's internet access.
    dhcps_offer_t offer = 0;
    dhcps_set_option_info(ROUTER_SOLICITATION_ADDRESS, &offer, sizeof(offer));
    dhcps_set_option_info(DOMAIN_NAME_SERVER, &offer, sizeof(offer));

    dhcps_lease_t lease;
    lease.enable = true;
    ip4addr_aton(USB_NET_HOST_LO, &lease.start_ip);
    ip4addr_aton(USB_NET_HOST_HI, &lease.end_ip);
    dhcps_set_option_info(REQUESTED_IP_ADDRESS, &lease, sizeof(lease));

    ip4_addr_t server_ip;
    ip4addr_aton(USB_NET_IP, &server_ip);
    if (dhcps_start(&s_netif, server_ip) != ERR_OK) {
        ESP_LOGE(TAG, "dhcps_start failed");
    } else {
        ESP_LOGI(TAG, "DHCP server up, leasing %s", USB_NET_HOST_LO);
    }
}

//--------------------------------------------------------------------+
// Public API
//--------------------------------------------------------------------+

bool usb_net_pre_usb(void) {
    mark(USB_NET_STEP_ENTER);

    // Deliberately no esp_read_mac() here: this runs as a global constructor,
    // before the scheduler starts, so it is restricted to plain static-memory
    // work. The fixed locally-administered MAC above is sufficient; deriving a
    // per-board one can happen later if two boards ever share a host.
    mark(USB_NET_STEP_MAC);

    s_ep_notif = tinyusb_get_free_in_endpoint();
    mark(USB_NET_STEP_EP_NOTIF);
    s_ep_out = tinyusb_get_free_out_endpoint();
    mark(USB_NET_STEP_EP_OUT);
    s_ep_in = tinyusb_get_free_in_endpoint();
    mark(USB_NET_STEP_EP_IN);
    if (!s_ep_notif || !s_ep_out || !s_ep_in) {
        // The S3 has a limited number of IN FIFOs; a composite build can run out.
        ESP_LOGE(TAG, "no free endpoints (notif=%u out=%u in=%u)", s_ep_notif, s_ep_out, s_ep_in);
        return false;
    }

    mark(USB_NET_STEP_EP_CHECKED);

    s_str_desc = tinyusb_add_string_descriptor("FPVGate USB Network");
    mark(USB_NET_STEP_STR_PRODUCT);

    // NCM requires the host-side MAC as a 12-digit uppercase hex string. It
    // must not equal the device MAC, so the low octet is offset by one.
    //
    // Must be static: tinyusb_add_string_descriptor() stores the pointer, it
    // does not copy. A stack buffer would dangle by the time the host requests
    // the string during enumeration, which leaves the composite device unable
    // to start any of its functions.
    static char mac_str[13];
    snprintf(mac_str, sizeof(mac_str), "%02X%02X%02X%02X%02X%02X", tud_network_mac_address[0],
             tud_network_mac_address[1], tud_network_mac_address[2], tud_network_mac_address[3],
             tud_network_mac_address[4], (uint8_t)(tud_network_mac_address[5] + 1));
    s_str_mac = tinyusb_add_string_descriptor(mac_str);
    mark(USB_NET_STEP_STR_MAC);

    if (tinyusb_enable_interface(USB_INTERFACE_CUSTOM, TUD_CDC_NCM_DESC_LEN, ncm_descriptor_cb) != ESP_OK) {
        ESP_LOGE(TAG, "tinyusb_enable_interface failed");
        return false;
    }

    mark(USB_NET_STEP_ENABLE_ITF);

    ESP_LOGI(TAG, "NCM interface registered (ep notif=%u out=%u in=%u)", s_ep_notif, s_ep_out,
             s_ep_in);
    mark(USB_NET_STEP_DONE);
    return true;
}

static bool s_registered = false;

/**
 * Registration must happen before app_main() calls USB.begin().
 *
 * ARDUINO_USB_ON_BOOT is derived from ARDUINO_USB_CDC_ON_BOOT (USB.h), so with
 * CDC on boot the core already ran USB.begin() by the time setup() executes.
 * tinyusb_enable_interface() then refuses with "TinyUSB has already started",
 * and the descriptor is frozen as CDC-only - which is exactly what the host was
 * seeing. USBCDC registers itself from its own constructor for this reason, so
 * do the same: global constructors run before app_main().
 */
__attribute__((constructor)) static void usb_net_early_register(void) {
    s_registered = usb_net_pre_usb();
}

bool usb_net_registered(void) { return s_registered; }

// Runs on the lwIP thread via tcpip_callback.
static void usb_net_netif_setup(void *arg) {
    (void)arg;

    ip4_addr_t ipaddr, netmask, gw;
    ip4addr_aton(USB_NET_IP, &ipaddr);
    ip4addr_aton(USB_NET_MASK, &netmask);
    ip4_addr_set_zero(&gw);

    if (netif_add(&s_netif, &ipaddr, &netmask, &gw, NULL, usb_net_netif_init, tcpip_input) == NULL) {
        ESP_LOGE(TAG, "netif_add failed");
        return;
    }
    s_netif_added = true;

    netif_set_up(&s_netif);
    if (s_link_up) netif_set_link_up(&s_netif);

    usb_net_start_dhcps();

    ESP_LOGI(TAG, "USB network ready at %s", USB_NET_IP);
}

bool usb_net_start(void) {
    // Starts the lwIP tcpip thread. Without WiFi nothing else would have done
    // it, and netif_add/tcpip_input both depend on it. Idempotent.
    esp_netif_init();

    // Created here rather than in the constructor: the scheduler is running by
    // now. Until it exists tud_network_recv_cb() drops frames, which is fine
    // because there is no netif to deliver them to yet.
    if (s_rx_sem == NULL) {
        s_rx_sem = xSemaphoreCreateBinary();
        if (s_rx_sem == NULL ||
            xTaskCreate(usb_net_rx_task, "usbnet_rx", 4096, NULL, 5, &s_rx_task) != pdPASS) {
            ESP_LOGE(TAG, "failed to start rx pump");
            return false;
        }
        // Prime the pipeline: frames dropped before the pump existed left no
        // outstanding renew, so kick one off.
        tud_network_recv_renew();
    }

    // netif_add and dhcps_start assert unless they run in TCPIP context, and
    // lwIP here is built without core locking, so post the work to that thread
    // rather than calling it from the Arduino loop task.
    return tcpip_callback(usb_net_netif_setup, NULL) == ERR_OK;
}

bool usb_net_link_up(void) { return s_link_up; }
