#pragma once
// Wired Ethernet on boards with a W5500 (FPVGATE_ETH_W5500), e.g. the Waveshare
// ESP32-S3-ETH. The web UI, API and RotorHazard plugin work over it unchanged:
// the web server listens on every interface.
//
// Addressing: DHCP from the network; if no lease arrives within
// ETHNET_DHCP_TIMEOUT_MS of the link coming up (a cable straight to a laptop),
// a fixed 192.168.8.1/24, distinct from Wi-Fi AP 192.168.4.1 and USB
// 192.168.7.1. Unplugging and replugging asks for DHCP again. The wait allows
// for switches that hold a new port for ~30 s (spanning tree) before passing
// traffic.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif

#define ETHNET_DHCP_TIMEOUT_MS 45000
// Uptime by which a cable plugged in at boot has its link (auto-negotiation
// takes a few seconds); USB networking waits for it.
#define ETHNET_USB_WAIT_MS 6000

esp_err_t ethnet_begin(void);
// Call from loop(): applies the fixed-address fallback.
void ethnet_update(unsigned long nowMs);
bool ethnet_link_up(void);
bool ethnet_has_ip(void);
bool ethnet_is_static(void);
// The negotiated link: 10 or 100 Mbit/s (0 without a link), and full duplex.
int ethnet_speed_mbps(void);
bool ethnet_full_duplex(void);

// Counters from the W5500 MAC driver (w5500_mac.c, a copy of ESP-IDF's).
typedef struct {
    uint32_t rx_frames;         // passed to the network stack
    uint32_t rx_tcp80;          // of those, IPv4 TCP to port 80 (the web server)
    uint32_t rx_errors;         // read from the chip failed or truncated
    uint32_t rx_nomem;          // no memory for a frame: dropped
    uint32_t rx_missed_edges;   // woken by the 1 s timeout with the interrupt asserted
    uint32_t tx_frames;
    uint32_t tx_full;           // no room in the chip's transmit buffer
    uint32_t tx_timeout;        // send-complete not seen in time
    uint32_t tx_errors;         // any transmit that returned an error
} ethnet_w5500_stats_t;
void ethnet_w5500_stats(ethnet_w5500_stats_t *out);
// The W5500's PHY configuration register and socket 0's receive buffer in
// KB (-1 if unreadable), for diagnostics (w5500_mac.c).
int ethnet_w5500_phycfgr(void);
int ethnet_w5500_rxbuf_kb(void);
// PHYCFGR just after Ethernet started.
int ethnet_boot_phycfgr(void);
void ethnet_ip_string(char *out, size_t len);   // "" without an address

#ifdef __cplusplus
}
#endif
