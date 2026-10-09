#pragma once
// Wired Ethernet on boards with a W5500 (FPVGATE_ETH_W5500), e.g. the Waveshare
// ESP32-S3-ETH. The web UI, API and RotorHazard plugin work over it unchanged:
// the web server listens on every interface.
//
// Addressing: DHCP from the network; if no lease arrives within
// ETHNET_DHCP_TIMEOUT_MS (a cable straight to a laptop), a fixed 192.168.8.1/24,
// distinct from Wi-Fi AP 192.168.4.1 and USB 192.168.7.1.
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif

#define ETHNET_DHCP_TIMEOUT_MS 15000

esp_err_t ethnet_begin(void);
// Call from loop(): applies the fixed-address fallback.
void ethnet_update(unsigned long nowMs);
bool ethnet_link_up(void);
bool ethnet_has_ip(void);
bool ethnet_is_static(void);
void ethnet_ip_string(char *out, size_t len);   // "" without an address

#ifdef __cplusplus
}
#endif
