#ifdef FPVGATE_USB_NET
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "soc/usb_struct.h"
#include "soc/usb_reg.h"
#include "tusb.h"
#include "device/dcd.h"
#include "esp_intr_alloc.h"
#include "esp_timer.h"
#include "soc/periph_defs.h"
#include "usbnet.h"

// Arduino 2.0.17 links TinyUSB 0.16's dcd_esp32sx.c. It feeds an IN endpoint
// from the "TX FIFO empty" interrupt, enabled per endpoint by one shared
// register, DIEPEMPMSK (dtknqr4_fifoemptymsk):
//
//   dcd_edpt_xfer() (task):   fifoemptymsk |= 1 << ep;      start a transfer
//   handle_epin_ints() (ISR): fifoemptymsk &= ~(1 << n);    n fully queued
//
// Neither is atomic. When the ISR runs between the task's read and write, or
// on the other core at the same moment (CDC serial writes come from whichever
// task prints), the task's bit is lost. The endpoint is then enabled with
// bytes to send and an empty FIFO, but the interrupt that would fill it never
// comes: bulk IN stays busy forever. That is the USB TX stall recorded in
// docs/USB_NETWORKING.md (busy=1, submit made, FIFO free, nothing sent).
//
// This task looks for exactly that state and sets the bit again. It cannot
// occur legitimately for long: an empty FIFO with bytes still to send means
// the driver is waiting for this interrupt. The ISR then refills from
// DIEPTSIZ, as it always does, so nothing is sent twice. Requiring the state
// on two passes in a row skips the moment inside dcd_edpt_xfer() between
// enabling the endpoint and setting the bit.
//
// It runs on the USB interrupt's core (usbd is pinned there, usbnet_task.c)
// with interrupts off for the write, so its own update cannot race the ISR.

#define TXFE_PERIOD_MS 2

static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t repairs[USB_IN_EP_NUM];
static volatile uint32_t passes;
static volatile uint32_t detections;   // stuck on two passes, repaired or not
static volatile bool enabled = true;   // off: detect and count only (bench A/B)
static volatile uint32_t last_repair_ms;
static TaskHandle_t task;

static uint32_t fifo_depth_words(uint32_t ctl) {
    uint32_t fifo = (ctl >> USB_D_TXFNUM1_S) & USB_D_TXFNUM1_V;
    uint32_t config = fifo == 0 ? USB0.gnptxfsiz : (fifo <= 4 ? USB0.dieptxf[fifo - 1] : 0);
    return config >> 16;
}

static uint32_t stuck_endpoints(void) {
    uint32_t stuck = 0;
    uint32_t mask = USB0.dtknqr4_fifoemptymsk;
    for (uint32_t n = 0; n < USB_IN_EP_NUM; ++n) {
        volatile usb_in_endpoint_t *ep = &USB0.in_ep_reg[n];
        uint32_t ctl = ep->diepctl;
        if (!(ctl & USB_D_EPENA1_M) || (mask & (1u << n))) continue;
        if (!(ep->dieptsiz & 0x7FFFFu)) continue;
        uint32_t depth = fifo_depth_words(ctl);
        if (!depth || (ep->dtxfsts & 0xFFFFu) < depth) continue;
        stuck |= 1u << n;
    }
    return stuck;
}

// --- USB interrupt shim (-Wl,--wrap=esp_intr_alloc) ------------------------
//
// The driver's ISR is static, so the only way to see which interrupts it is
// asked to handle is to register a shim in its place. The shim counts the
// global interrupt flags pending at each entry, then calls the driver.
//
// Why it matters: the ISR ends with `USB0.gintsts |= <bits it ignores>`.
// GINTSTS is write-1-to-clear, so that read-modify-write clears EVERY pending
// flag, including a reset, end of reset or resume raised while it ran, which
// is then never handled.
esp_err_t __real_esp_intr_alloc(int source, int flags, intr_handler_t handler, void *arg, intr_handle_t *ret);
static intr_handler_t usb_isr;
static volatile uint32_t isr_entries, isr_rst, isr_rstdet, isr_enum, isr_susp, isr_esusp, isr_wkup, isr_disc;
static volatile uint32_t last_rst_ms, last_rstdet_ms, last_enum_ms;

// Espressif's build of the driver (not upstream 0.16.0) also checks bit 15
// of each IN endpoint's DIEPINT, which the ESP32-S3 manual leaves
// undocumented, and answers it with:
//
//     ESP_EARLY_LOGE("TUSB:DCD", "Unknown Condition");   // to UART0
//     bus_reset();
//
// bus_reset() is the driver's LOCAL reset: it clears the device address,
// cuts DAINTMSK to endpoint 0 and NAKs every OUT endpoint. The host has not
// reset anything, so it keeps talking to our old address, which we no longer
// answer: USB networking and serial die together, for good. Found by
// disassembling libarduino_tinyusb.a (Arduino 2.0.17) and confirmed on the
// bench: address 0, DAINTMSK 0x00010001, no USBRST or RESETDET.
//
// With the repair on, clear the bit before the driver sees it, so it never
// resets itself; the bit is cleared either way, only the reset is skipped.
#define DIEPINT_UNKNOWN_BIT (1u << 15)
static volatile uint32_t unknown15[USB_IN_EP_NUM], last_unknown15_ms;

static void IRAM_ATTR usb_isr_shim(void *arg) {
    const uint32_t pending = USB0.gintsts & USB0.gintmsk;
    const uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
    ++isr_entries;
    if (pending & USB_IEPINT_M) {
        const uint32_t daint = USB0.daint;
        for (uint32_t n = 0; n < USB_IN_EP_NUM; ++n) {
            if (!(daint & (1u << n)) || !(USB0.in_ep_reg[n].diepint & DIEPINT_UNKNOWN_BIT)) continue;
            ++unknown15[n];
            last_unknown15_ms = now;
            if (enabled) USB0.in_ep_reg[n].diepint = DIEPINT_UNKNOWN_BIT;   // write 1 to clear
        }
    }
    if (pending & USB_USBRST_M) { ++isr_rst; last_rst_ms = now; }
    if (pending & USB_RESETDET_M) { ++isr_rstdet; last_rstdet_ms = now; }
    if (pending & USB_ENUMDONE_M) { ++isr_enum; last_enum_ms = now; }
    if (pending & USB_USBSUSP_M) ++isr_susp;
    if (pending & USB_ERLYSUSP_M) ++isr_esusp;
    if (pending & USB_WKUPINT_M) ++isr_wkup;
    if (pending & USB_DISCONNINT_M) ++isr_disc;
    usb_isr(arg);
}

esp_err_t __wrap_esp_intr_alloc(int source, int flags, intr_handler_t handler, void *arg, intr_handle_t *ret) {
    if (source == ETS_USB_INTR_SOURCE && handler && !usb_isr) {
        usb_isr = handler;
        handler = usb_isr_shim;
    }
    return __real_esp_intr_alloc(source, flags, handler, arg, ret);
}

// --- Half-reset watcher ------------------------------------------------------
//
// The driver's bus_reset() clears the device address, cuts DAINTMSK to
// endpoint 0 and NAKs every OUT endpoint. A real host reset raises USBRST
// (or RESETDET), which the ISR shim counts, and ends with ENUMDONE (a
// BUS_RESET event). If neither appears, the reset was the driver's own
// "Unknown Condition" one: the host is still talking to our old address,
// which we no longer answer, and the link is dead for good. Restore the
// address, the endpoint interrupt mask and the OUT endpoints' NAK.
// (SETUP requests are not evidence: one already in flight can land after.)
#define EP0_ONLY (USB_OUTEPMSK0_M | USB_INEPMSK0_M)
#define HALF_RESET_WAIT_PASSES 25   // 50 ms
static volatile uint32_t collapses, restores, last_collapse_ms, collapse_dcfg, collapse_gintsts;
static uint32_t events_at(uint8_t id);

static void watch_half_reset(void) {
    static uint32_t good_addr, good_mask, good_rst, waiting, resets_then, rst_then;
    const uint32_t mask = USB0.daintmsk;
    const uint32_t addr = (USB0.dcfg & USB_DEVADDR_M) >> USB_DEVADDR_S;
    if (mask != EP0_ONLY && addr) {
        good_addr = addr;
        good_mask = mask;
        good_rst = isr_rst + isr_rstdet;
        waiting = 0;
        return;
    }
    if (!good_mask || mask != EP0_ONLY) return;
    if (!waiting) {
        ++collapses;
        last_collapse_ms = (uint32_t)(esp_timer_get_time() / 1000);
        collapse_dcfg = USB0.dcfg;
        collapse_gintsts = USB0.gintsts;
        resets_then = events_at(DCD_EVENT_BUS_RESET);
        // Taken a pass after the collapse; a USBRST that caused it is
        // counted before bus_reset() runs, so compare with the last good pass.
        rst_then = good_rst;
    }
    if (++waiting < HALF_RESET_WAIT_PASSES) return;
    if (events_at(DCD_EVENT_BUS_RESET) != resets_then || isr_rst + isr_rstdet != rst_then) {
        good_mask = 0;   // a real reset: wait for enumeration to set us up again
        waiting = 0;
        return;
    }
    if (!enabled || addr) return;   // repair off: keep the evidence
    portENTER_CRITICAL(&mux);
    USB0.dcfg = (USB0.dcfg & ~USB_DEVADDR_M) | (good_addr << USB_DEVADDR_S);
    for (uint32_t n = 1; n < USB_OUT_EP_NUM; ++n) {
        if (USB0.out_ep_reg[n].doepctl & USB_EPENA0_M) USB0.out_ep_reg[n].doepctl |= USB_CNAK0_M;
    }
    USB0.daintmsk = good_mask;
    portEXIT_CRITICAL(&mux);
    ++restores;
    waiting = 0;
}

static void txfe_task(void *arg) {
    (void)arg;
    uint32_t suspect = 0;
    uint32_t held = 0;   // repair off: endpoints already counted as stuck
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(TXFE_PERIOD_MS));
        ++passes;
        watch_half_reset();
        uint32_t stuck = stuck_endpoints();
        uint32_t repair = stuck & suspect;
        if (!enabled) {
            // Count each endpoint once per stall, however long it lasts.
            uint32_t fresh = repair & ~held;
            for (uint32_t n = 0; n < USB_IN_EP_NUM; ++n) {
                if (fresh & (1u << n)) ++detections;
            }
            if (fresh) last_repair_ms = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
            held = repair;
            suspect = stuck;
            continue;
        }
        held = 0;
        suspect = stuck & ~repair;
        if (!repair) continue;
        portENTER_CRITICAL(&mux);
        USB0.dtknqr4_fifoemptymsk |= repair;
        portEXIT_CRITICAL(&mux);
        for (uint32_t n = 0; n < USB_IN_EP_NUM; ++n) {
            if (repair & (1u << n)) {
                ++repairs[n];
                ++detections;
            }
        }
        last_repair_ms = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS);
    }
}

void usbnet_dcd_vendored(void);   // tinyusb/dcd_esp32sx.c

void usbnet_txfe_start(void) {
    // Pulls the fixed controller driver in ahead of libarduino_tinyusb.a's.
    usbnet_dcd_vendored();
    if (task) return;
    TaskHandle_t usbd = xTaskGetHandle("usbd");
    BaseType_t core = usbd ? xTaskGetAffinity(usbd) : 0;
    if (core == tskNO_AFFINITY) core = 0;
    xTaskCreatePinnedToCore(txfe_task, "usbnet_txfe", 2048, NULL, 10, &task, core);
}

void usbnet_txfe_set_enabled(bool on) { enabled = on; }

// Every event the controller driver reports, counted on its way into the
// USB core (-Wl,--wrap=dcd_event_handler). If these stop while the bus
// frame number still advances, the interrupt has stopped being serviced; if
// the frame number stops too, the host has stopped talking.
void __real_dcd_event_handler(dcd_event_t const *event, bool in_isr);
static volatile uint32_t events[DCD_EVENT_COUNT];
static volatile uint32_t xfer_in[8], xfer_out[8];
static volatile uint32_t last_event_tick;

static uint32_t events_at(uint8_t id) { return id < DCD_EVENT_COUNT ? events[id] : 0; }

void __wrap_dcd_event_handler(dcd_event_t const *event, bool in_isr) {
    if (event->event_id < DCD_EVENT_COUNT) ++events[event->event_id];
    if (event->event_id == DCD_EVENT_XFER_COMPLETE) {
        uint8_t ep = event->xfer_complete.ep_addr;
        if (ep & 0x80) ++xfer_in[ep & 7];
        else ++xfer_out[ep & 7];
    }
    last_event_tick = in_isr ? xTaskGetTickCountFromISR() : xTaskGetTickCount();
    __real_dcd_event_handler(event, in_isr);
}

void usbnet_usb_snapshot(usbnet_usb_snapshot_t *s) {
    for (uint32_t i = 0; i < DCD_EVENT_COUNT && i < 10; ++i) s->events[i] = events[i];
    for (uint32_t i = 0; i < 8; ++i) {
        s->xfer_in[i] = xfer_in[i];
        s->xfer_out[i] = xfer_out[i];
    }
    s->last_event_ms = last_event_tick * portTICK_PERIOD_MS;
    s->isr_entries = isr_entries;
    s->isr_rst = isr_rst;
    s->isr_rstdet = isr_rstdet;
    s->isr_enum = isr_enum;
    s->isr_susp = isr_susp;
    s->isr_esusp = isr_esusp;
    s->isr_wkup = isr_wkup;
    s->isr_disc = isr_disc;
    s->last_rst_ms = last_rst_ms;
    s->last_rstdet_ms = last_rstdet_ms;
    s->last_enum_ms = last_enum_ms;
    s->unknown15_total = 0;
    for (uint32_t n = 0; n < USB_IN_EP_NUM && n < 7; ++n) {
        s->unknown15[n] = unknown15[n];
        s->unknown15_total += unknown15[n];
    }
    s->last_unknown15_ms = last_unknown15_ms;
    s->collapses = collapses;
    s->restores = restores;
    s->last_collapse_ms = last_collapse_ms;
    s->collapse_dcfg = collapse_dcfg;
    s->collapse_gintsts = collapse_gintsts;
    s->dcfg = USB0.dcfg;
    s->gintsts = USB0.gintsts;
    s->gintmsk = USB0.gintmsk;
    s->gotgctl = USB0.gotgctl;
    s->gahbcfg = USB0.gahbcfg;
    s->dctl = USB0.dctl;
    s->dsts = USB0.dsts;
    s->daint = USB0.daint;
    s->daintmsk = USB0.daintmsk;
    s->empty_mask = USB0.dtknqr4_fifoemptymsk;
    s->pcgctrl = USB0.pcgctrl;
    for (uint32_t n = 0; n < USB_IN_EP_NUM && n < 7; ++n) {
        s->in_ctl[n] = USB0.in_ep_reg[n].diepctl;
        s->in_int[n] = USB0.in_ep_reg[n].diepint;
        s->in_siz[n] = USB0.in_ep_reg[n].dieptsiz;
        s->in_fifo[n] = USB0.in_ep_reg[n].dtxfsts;
        s->out_ctl[n] = USB0.out_ep_reg[n].doepctl;
        s->out_int[n] = USB0.out_ep_reg[n].doepint;
        s->out_siz[n] = USB0.out_ep_reg[n].doeptsiz;
    }
}

void usbnet_txfe_status(usbnet_txfe_status_t *status) {
    status->running = task != NULL;
    status->enabled = enabled;
    status->detections = detections;
    status->passes = passes;
    status->last_repair_ms = last_repair_ms;
    status->total = 0;
    for (uint32_t n = 0; n < USB_IN_EP_NUM && n < 8; ++n) {
        status->repairs[n] = repairs[n];
        status->total += repairs[n];
    }
    status->empty_mask = USB0.dtknqr4_fifoemptymsk;
    status->stuck_now = stuck_endpoints();
}
#endif
