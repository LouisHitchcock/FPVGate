#pragma once

/**
 * USB-C network adapter (CDC-NCM) for ESP32-S3.
 *
 * Presents the device to the host as a USB Ethernet adapter and runs a DHCP
 * server on the link, so plugging in a cable gives the host an IP address with
 * no driver install or port selection. The existing lwIP stack serves every
 * interface, so anything already reachable over WiFi is reachable over USB.
 *
 * Device is 192.168.5.1; the host is leased 192.168.5.2.
 */

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Crash breadcrumbs.
 *
 * The IDF console is UART0 here (CONFIG_ESP_CONSOLE_UART_DEFAULT), so a panic
 * backtrace goes to physical pins, not USB - and a fault inside phase 1 kills
 * enumeration before any USB console exists. Phase 1 therefore records its
 * progress in RTC memory, which survives a panic reboot, so the following boot
 * can skip the offending code and report where it died.
 */
#define USB_NET_STEP_MAGIC   0x4E434D00u  // 'NCM' << 8, step in the low byte
#define USB_NET_STEP_MASK    0x000000FFu

enum {
    USB_NET_STEP_NONE = 0,
    USB_NET_STEP_ENTER,
    USB_NET_STEP_MAC,
    USB_NET_STEP_EP_NOTIF,
    USB_NET_STEP_EP_OUT,
    USB_NET_STEP_EP_IN,
    USB_NET_STEP_EP_CHECKED,
    USB_NET_STEP_STR_PRODUCT,
    USB_NET_STEP_STR_MAC,
    USB_NET_STEP_ENABLE_ITF,
    USB_NET_STEP_DONE,
};

// Survives panic reboots (but not a power cycle).
extern uint32_t usb_net_progress;

// Human-readable name for a step value, for logging.
const char *usb_net_step_name(uint32_t step);

// Phase 1: claim endpoints and register the NCM interface descriptor.
//
// Runs automatically from a global constructor, because the core already calls
// USB.begin() in app_main() whenever ARDUINO_USB_CDC_ON_BOOT is set - by the
// time setup() runs the descriptor is frozen and registration is refused.
// Callers should not invoke this; query usb_net_registered() instead.
bool usb_net_pre_usb(void);

// Whether the constructor above managed to register the NCM interface.
bool usb_net_registered(void);

// Phase 2: create the lwIP netif and start the DHCP server. Call AFTER
// USB.begin(). Returns immediately; the work is posted to the lwIP thread,
// because netif_add/dhcps_start assert unless they run in TCPIP context.
bool usb_net_start(void);

// True once the host has selected the NCM data altsetting (cable up, driver
// bound). DHCP may still be in progress.
bool usb_net_link_up(void);

#ifdef __cplusplus
}
#endif
