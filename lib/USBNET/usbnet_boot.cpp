#ifdef FPVGATE_USB_NET
#include "usbnet_boot.h"

#include <Arduino.h>

#include "esp_attr.h"
#include "esp_system.h"

// RTC noinit: preserved across a panic reboot, lost on power cycle. The magic
// distinguishes "genuinely previous boot" from uninitialised RAM after a cold
// start, so a first boot is not misreported as a crash.
#define USBNET_BOOT_MAGIC 0x42544F42u  // 'BOTB'

static RTC_NOINIT_ATTR uint32_t s_magic;
static RTC_NOINIT_ATTR uint32_t s_boot_count;
static RTC_NOINIT_ATTR uint8_t s_stage;
static RTC_NOINIT_ATTR uint8_t s_prev_stage;

static const char *stageName(uint8_t stage) {
    switch (stage) {
        case USBNET_BOOT_NONE:            return "none (died before setup)";
        case USBNET_BOOT_SETUP_ENTERED:   return "setup entered";
        case USBNET_BOOT_STORAGE_READY:   return "storage ready";
        case USBNET_BOOT_TRANSPORT_READY: return "transport ready";
        case USBNET_BOOT_USBNET_CALLING:  return "calling usbnet_begin";
        case USBNET_BOOT_USBNET_RETURNED: return "usbnet_begin returned";
        case USBNET_BOOT_SETUP_COMPLETE:  return "setup complete";
        case USBNET_BOOT_LOOP_RUNNING:    return "loop running";
        default:                          return "unknown";
    }
}

static const char *resetName(esp_reset_reason_t reason) {
    switch (reason) {
        case ESP_RST_POWERON:  return "power-on";
        case ESP_RST_EXT:      return "external pin";
        case ESP_RST_SW:       return "software restart";
        case ESP_RST_PANIC:    return "PANIC / exception";
        case ESP_RST_INT_WDT:  return "interrupt WATCHDOG";
        case ESP_RST_TASK_WDT: return "task WATCHDOG";
        case ESP_RST_WDT:      return "other WATCHDOG";
        case ESP_RST_DEEPSLEEP:return "deep sleep wake";
        case ESP_RST_BROWNOUT: return "BROWNOUT";
        case ESP_RST_SDIO:     return "sdio";
        default:               return "unknown";
    }
}

void usbnet_boot_mark(uint8_t stage) { s_stage = stage; }

void usbnet_boot_report(void) {
    esp_reset_reason_t reason = esp_reset_reason();
    bool valid = (s_magic == USBNET_BOOT_MAGIC);

    if (valid) {
        s_prev_stage = s_stage;
        ++s_boot_count;
    } else {
        // Cold start: RTC contents are garbage, so nothing to report yet.
        s_magic = USBNET_BOOT_MAGIC;
        s_boot_count = 1;
        s_prev_stage = USBNET_BOOT_NONE;
    }
    s_stage = USBNET_BOOT_NONE;

    // USB.begin() has already run (the core does it in app_main), but the host
    // still needs a moment to enumerate before anything written here is seen.
    delay(1500);

    Serial.println();
    Serial.println("=== USB boot diagnostics ===");
    Serial.printf("boot #%u, reset reason %d (%s)\n", (unsigned)s_boot_count, (int)reason,
                  resetName(reason));
    if (valid) {
        Serial.printf("previous boot reached stage %u (%s)\n", (unsigned)s_prev_stage,
                      stageName(s_prev_stage));
        if (reason == ESP_RST_PANIC || reason == ESP_RST_TASK_WDT ||
            reason == ESP_RST_INT_WDT || reason == ESP_RST_WDT) {
            Serial.println(">>> previous boot did NOT exit cleanly - stage above is where it died");
        }
    } else {
        Serial.println("cold start - no previous boot recorded");
    }
    Serial.println("============================");

    usbnet_boot_mark(USBNET_BOOT_SETUP_ENTERED);
}
#endif  // FPVGATE_USB_NET
