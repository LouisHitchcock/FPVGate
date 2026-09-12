#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Read only on the TinyUSB task.
typedef struct {
    uint32_t arm_failures;
    uint32_t rx_errors;
    uint32_t last_rx_length;
    uint32_t endpoint_state;
    // RNDIS control path. The handshake runs over EP0, so the OUT-endpoint
    // counters above say nothing about it.
    uint32_t control_calls;   // netd_control_xfer_cb invocations
    uint32_t report_calls;    // netd_report - RESPONSE_AVAILABLE notifications
    uint32_t rndis_msgs;      // rndis_class_set_handler invocations
    uint32_t last_rndis_msg;  // last MessageType seen
    uint32_t rndis_state;     // raw rndis_state_t value
    uint32_t in_xfer_fail;    // usbd_edpt_xfer submit failures on the IN endpoint
    uint32_t in_busy, in_stalled, in_submit_len, in_complete_len;
    uint32_t in_ctl, in_int, in_size, in_fifo;
    uint32_t in_fifo_config;
    uint32_t in_xfer_done;    // IN transfer completions (these re-arm can_xmit)
} usbnet_driver_status_t;
void usbnet_driver_status(usbnet_driver_status_t *status);
#ifdef __cplusplus
}
#endif
