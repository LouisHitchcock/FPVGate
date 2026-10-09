#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
// Start the USB Ethernet netif after Arduino has initialized the network stack.
esp_err_t usbnet_begin(void);
// Bench diagnostics; call from the application task.
void usbnet_print_status(void);

// Repairs of the lost TX-FIFO-empty interrupt bit (usbnet_txfe.c).
typedef struct {
    bool running;
    bool enabled;               // false: detect and count only
    uint32_t passes;            // checks made, one every 2 ms
    uint32_t detections;        // stalls seen (per endpoint), repaired or not
    uint32_t total;             // repairs, all endpoints
    uint32_t repairs[8];        // repairs per IN endpoint
    uint32_t last_repair_ms;    // uptime of the latest repair
    uint32_t empty_mask;        // DIEPEMPMSK now
    uint32_t stuck_now;         // endpoints in the stuck state at this moment
} usbnet_txfe_status_t;
void usbnet_txfe_start(void);
void usbnet_txfe_set_enabled(bool on);
void usbnet_txfe_status(usbnet_txfe_status_t *status);

// USB controller events (per DCD event id) and a register dump, for
// diagnosing a stalled link from another interface.
typedef struct {
    uint32_t events[10];        // by dcd_eventid_t: 1 reset, 3 SOF, 4 suspend, 5 resume, 6 setup, 7 xfer
    uint32_t xfer_in[8], xfer_out[8];
    uint32_t last_event_ms;
    // Global interrupt flags pending at USB ISR entries (usb_isr_shim).
    uint32_t isr_entries, isr_rst, isr_rstdet, isr_enum, isr_susp, isr_esusp, isr_wkup, isr_disc;
    uint32_t last_rst_ms, last_rstdet_ms, last_enum_ms;
    // DIEPINT bit 15 ("Unknown Condition") per IN endpoint, see usbnet_txfe.c.
    uint32_t unknown15[7], unknown15_total, last_unknown15_ms;
    // Half resets: DAINTMSK cut to endpoint 0 with the address cleared.
    uint32_t collapses, restores, last_collapse_ms, collapse_dcfg, collapse_gintsts;
    uint32_t dcfg;
    uint32_t gintsts, gintmsk, gotgctl, gahbcfg, dctl, dsts, daint, daintmsk, empty_mask, pcgctrl;
    uint32_t in_ctl[7], in_int[7], in_siz[7], in_fifo[7];
    uint32_t out_ctl[7], out_int[7], out_siz[7];
} usbnet_usb_snapshot_t;
void usbnet_usb_snapshot(usbnet_usb_snapshot_t *snapshot);

// Traffic counters, safe to read from any task (no lwIP or USB calls).
typedef struct {
    uint32_t rx, queued, sent, dropped, defer_lost, pool_low, pool_free;
} usbnet_counters_t;
void usbnet_counters(usbnet_counters_t *counters);
#ifdef __cplusplus
}
#endif
