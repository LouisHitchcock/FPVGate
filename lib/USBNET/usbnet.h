#pragma once
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
// Start the USB Ethernet netif after Arduino has initialized the network stack.
esp_err_t usbnet_begin(void);
// Bench diagnostics; call from the application task.
void usbnet_print_status(void);
#ifdef __cplusplus
}
#endif
