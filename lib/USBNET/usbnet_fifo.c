#ifdef FPVGATE_USB_NET
#include "tusb.h"
#include "device/dcd.h"
#include "soc/usb_periph.h"

// Arduino 2.0.17 links dcd_esp32sx.c, which assigns TXFNUM by allocation
// order but programs DIEPTXF[epnum - 1]. Restore the assigned FIFO layout
// after each open, including registers that a later open overwrote.
// EP5 is the S3 dedicated notification endpoint and has no DIEPTXF slot.
// This wrapper is enabled only by the FPVGateAIO linker flags.
bool __real_dcd_edpt_open(uint8_t rhport, tusb_desc_endpoint_t const *desc);
static uint32_t fifo_config[4];
static uint8_t fifo_valid;

bool __wrap_dcd_edpt_open(uint8_t rhport, tusb_desc_endpoint_t const *desc) {
    bool opened = __real_dcd_edpt_open(rhport, desc);
    uint8_t ep = tu_edpt_number(desc->bEndpointAddress);
    if (!opened || tu_edpt_dir(desc->bEndpointAddress) != TUSB_DIR_IN || ep == 0 || ep == 5) {
        return opened;
    }
    uint8_t fifo = (USB0.in_ep_reg[ep].diepctl >> USB_D_TXFNUM1_S) & USB_D_TXFNUM1_V;
    if (ep > 4 || fifo == 0 || fifo > 4) return opened;
    // The original driver restarts FIFO allocation at 1 after a bus reset
    // or close-all. Discard the previous configuration on that first open.
    if (fifo == 1) fifo_valid = 0;
    fifo_config[fifo - 1] = USB0.dieptxf[ep - 1];
    fifo_valid |= 1u << (fifo - 1);
    for (uint8_t i = 0; i < 4; ++i) {
        if (fifo_valid & (1u << i)) USB0.dieptxf[i] = fifo_config[i];
    }
    return opened;
}
#endif
