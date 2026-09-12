#pragma once

/**
 * Boot breadcrumbs for diagnosing USB-networking boot loops.
 *
 * There is no UART adapter on this bench, and under ARDUINO_USB_MODE=0 the
 * hardware USB-Serial-JTAG console is unavailable, so a panic backtrace goes
 * to pins nobody is reading. A boot that dies before USB enumerates therefore
 * produces no output at all.
 *
 * These breadcrumbs live in RTC memory, which survives a panic reboot (but not
 * a power cycle). Each boot records how far it got; the *next* boot reports the
 * previous boot's last stage plus the reset reason. So even a completely silent
 * crash is localised to a stage as soon as any later boot manages to talk.
 *
 * Temporary diagnostic. Remove once the boot loop is understood.
 */

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    USBNET_BOOT_NONE = 0,
    USBNET_BOOT_SETUP_ENTERED,
    USBNET_BOOT_STORAGE_READY,
    USBNET_BOOT_TRANSPORT_READY,
    USBNET_BOOT_USBNET_CALLING,
    USBNET_BOOT_USBNET_RETURNED,
    USBNET_BOOT_SETUP_COMPLETE,
    USBNET_BOOT_LOOP_RUNNING,
};

// Record progress. Cheap; safe to call from anywhere after startup.
void usbnet_boot_mark(uint8_t stage);

// Print this boot's reset reason and the previous boot's last stage.
// Call once, early in setup(). Holds briefly so the host can attach CDC.
void usbnet_boot_report(void);

#ifdef __cplusplus
}
#endif
