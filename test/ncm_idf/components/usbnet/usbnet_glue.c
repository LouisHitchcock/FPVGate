/**
 * TinyUSB <-> application network glue.
 *
 * Vendored from esp_tinyusb's tinyusb_net.c (Apache-2.0, Espressif) because
 * that component only adds the file to its build when
 * CONFIG_TINYUSB_NET_MODE_NCM is selected - selecting ECM/RNDIS link-fails on
 * tinyusb_net_init / tinyusb_net_send_sync / tud_network_recv_cb.
 *
 * Changes from upstream:
 *   - drops the private descriptors_control.h / usb_descriptors.h includes;
 *     the MAC string is baked into our own string descriptor table instead of
 *     being injected at runtime, so tusb_get_mac_string_id() is not needed
 *   - symbols renamed to usbnet_* to avoid clashing with esp_tinyusb should a
 *     future version start exporting them
 *
 * Deliberately kept otherwise faithful to upstream, including calling
 * tud_network_recv_renew() from tud_network_recv_cb(). That pattern is a
 * stack-overflow hazard for NCM (TinyUSB #2711) but is how ECM/RNDIS is used
 * in practice, and this is not the place to diverge from a working reference.
 */

#include "usbnet.h"

#include "device/usbd_pvt.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"

#include <stdlib.h>
#include <string.h>

typedef struct packet {
    void *buffer;
    void *buff_free_arg;
    uint16_t len;
    esp_err_t result;
} packet_t;

struct usbnet_handle {
    bool initialized;
    SemaphoreHandle_t buffer_sema;
    EventGroupHandle_t tx_flags;
    usbnet_rx_cb_t rx_cb;
    usbnet_free_tx_cb_t tx_buff_free_cb;
    usbnet_init_cb_t init_cb;
    void *ctx;
    packet_t *packet_to_send;
};

static const int TX_FINISHED_BIT = BIT0;
static struct usbnet_handle s_net_obj = {};
static const char *TAG = "usbnet";

static void do_send_sync(void *ctx) {
    (void)ctx;
    if (xSemaphoreTake(s_net_obj.buffer_sema, 0) != pdTRUE || s_net_obj.packet_to_send == NULL) {
        return;
    }

    packet_t *packet = s_net_obj.packet_to_send;
    if (tud_network_can_xmit(packet->len)) {
        tud_network_xmit(packet, packet->len);
        packet->result = ESP_OK;
    } else {
        packet->result = ESP_FAIL;
    }
    xSemaphoreGive(s_net_obj.buffer_sema);
    xEventGroupSetBits(s_net_obj.tx_flags, TX_FINISHED_BIT);
}

esp_err_t usbnet_send_sync(void *buffer, uint16_t len, void *buff_free_arg, TickType_t timeout) {
    if (!tud_ready()) {
        return ESP_ERR_INVALID_STATE;
    }

    if (!s_net_obj.tx_flags) {
        s_net_obj.tx_flags = xEventGroupCreate();
        ESP_RETURN_ON_FALSE(s_net_obj.tx_flags, ESP_ERR_NO_MEM, TAG, "no memory for event flags");
    }
    if (!s_net_obj.buffer_sema) {
        s_net_obj.buffer_sema = xSemaphoreCreateBinary();
        ESP_RETURN_ON_FALSE(s_net_obj.buffer_sema, ESP_ERR_NO_MEM, TAG, "no memory for semaphore");
    }

    packet_t packet = {
        .buffer = buffer,
        .len = len,
        .buff_free_arg = buff_free_arg,
    };
    s_net_obj.packet_to_send = &packet;
    xSemaphoreGive(s_net_obj.buffer_sema);

    // Run the actual send on the TinyUSB task.
    usbd_defer_func(do_send_sync, NULL, false);

    EventBits_t bits = xEventGroupWaitBits(s_net_obj.tx_flags, TX_FINISHED_BIT, pdTRUE, pdTRUE, timeout);
    // If TinyUSB already started sending, wait before discarding the packet.
    xSemaphoreTake(s_net_obj.buffer_sema, portMAX_DELAY);
    s_net_obj.packet_to_send = NULL;
    if (bits & TX_FINISHED_BIT) {
        return packet.result;
    }
    return ESP_ERR_TIMEOUT;
}

esp_err_t usbnet_init(const usbnet_config_t *cfg) {
    ESP_RETURN_ON_FALSE(s_net_obj.initialized == false, ESP_ERR_INVALID_STATE, TAG,
                        "usbnet already initialized");

    s_net_obj.rx_cb = cfg->on_recv_callback;
    s_net_obj.init_cb = cfg->on_init_callback;
    s_net_obj.tx_buff_free_cb = cfg->free_tx_buffer;
    s_net_obj.ctx = cfg->user_context;

    // Upstream injects the MAC string descriptor here; ours is already in the
    // static string table built by usbnet_descriptors.c.
    memcpy(tud_network_mac_address, cfg->mac_addr, sizeof(tud_network_mac_address));

    s_net_obj.initialized = true;
    return ESP_OK;
}

//--------------------------------------------------------------------+
// TinyUSB callbacks
//--------------------------------------------------------------------+

bool tud_network_recv_cb(const uint8_t *src, uint16_t size) {
    if (s_net_obj.rx_cb) {
        s_net_obj.rx_cb((void *)src, size, s_net_obj.ctx);
    }
    tud_network_recv_renew();
    return true;
}

uint16_t tud_network_xmit_cb(uint8_t *dst, void *ref, uint16_t arg) {
    packet_t *packet = ref;
    uint16_t len = arg;

    memcpy(dst, packet->buffer, packet->len);
    if (s_net_obj.tx_buff_free_cb) {
        s_net_obj.tx_buff_free_cb(packet->buff_free_arg, s_net_obj.ctx);
    }
    return len;
}

void tud_network_init_cb(void) {
    if (s_net_obj.init_cb) {
        s_net_obj.init_cb(s_net_obj.ctx);
    }
}
