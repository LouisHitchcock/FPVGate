#pragma once

/**
 * Composite CDC + RNDIS USB networking for ESP32-S3.
 *
 * Supplies custom USB descriptors (esp_tinyusb only generates NCM ones) and
 * a vendored copy of its network glue, so the device presents itself to the
 * host as a USB Ethernet adapter over RNDIS. The esp_netif / DHCP / HTTP side
 * is unchanged and lives in the application.
 */

#include <stdint.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "tusb.h"

#ifdef __cplusplus
extern "C" {
#endif

//--------------------------------------------------------------------+
// Descriptors
//--------------------------------------------------------------------+

const tusb_desc_device_t *usbnet_device_descriptor(void);
const uint8_t *usbnet_fs_config_descriptor(void);
const char **usbnet_string_descriptors(int *count);

// String descriptor index holding the MAC, required by RNDIS/ECM.
uint8_t usbnet_mac_string_id(void);

// The locally administered MAC this device advertises.
void usbnet_get_mac(uint8_t mac_out[6]);

//--------------------------------------------------------------------+
// Network glue (vendored from esp_tinyusb, which only builds it for NCM)
//--------------------------------------------------------------------+

typedef esp_err_t (*usbnet_rx_cb_t)(void *buffer, uint16_t len, void *ctx);
typedef void (*usbnet_free_tx_cb_t)(void *buffer, void *ctx);
typedef void (*usbnet_init_cb_t)(void *ctx);

typedef struct {
    uint8_t mac_addr[6];
    usbnet_rx_cb_t on_recv_callback;
    usbnet_init_cb_t on_init_callback;
    usbnet_free_tx_cb_t free_tx_buffer;
    void *user_context;
} usbnet_config_t;

esp_err_t usbnet_init(const usbnet_config_t *cfg);
esp_err_t usbnet_send_sync(void *buffer, uint16_t len, void *buff_free_arg, TickType_t timeout);

#ifdef __cplusplus
}
#endif
