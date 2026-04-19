#ifndef POWER_H
#define POWER_H

#include <Arduino.h>

// Optional power switch / button (build flag ENABLE_POWER_SWITCH)
//
// WAVESHARE_ESP32S3_LCD2: PIN_POWER_SWITCH (GPIO16) — board pull-up to 3.3 V; other switch pole to GND.
//   Hold ~2 s for deep sleep; wake via EXT0 when the line goes low.
//
// Other ESP32-S3 boards (when enabled): SPDT slide switch — light sleep while OFF, wake on HIGH.

#ifdef ENABLE_POWER_SWITCH

class PowerManager {
public:
    PowerManager();
    
    // Initialize power management (call in setup() before other initialization)
    // Waveshare soft button: always returns true (wake handling does not skip boot).
    // Legacy SPDT: returns false if switch is OFF at boot (caller may sleep immediately).
    bool init(uint8_t switchPin, uint8_t backlightPin);

    // Optional boot-only line: last deep-sleep wake cause (Waveshare).
    void logBootReason();
    
    // Check if power switch is in ON position
    bool isPowerOn();
    
    // Call from loop(). Waveshare: returns false after 2s continuous press (caller shuts down).
    // Legacy: returns false when SPDT moves to OFF.
    bool monitorSwitch();
    
    // Waveshare: deep sleep (does not return). Legacy: light sleep (returns after wake).
    void enterDeepSleep();
    
private:
    uint8_t _switchPin;
    uint8_t _backlightPin;
    uint32_t _lastCheckMs;
    bool _lastState;
    uint32_t _offDetectedMs;  // Timestamp when OFF was first detected (legacy)
    uint32_t _wakeTime;       // Timestamp of wake from light sleep (legacy)
#if defined(WAVESHARE_ESP32S3_LCD2)
    uint32_t _holdStartMs;    // Soft button: start of LOW window (0 = not tracking)
    bool _needButtonRelease;  // Ignore hold until line high after EXT0 wake
    uint8_t _lastWakeupCause; // esp_sleep_wakeup_cause_t for logBootReason()
#endif
    static const uint32_t CHECK_INTERVAL_MS = 100;    // Check switch every 100ms
    static const uint32_t DEBOUNCE_MS = 200;          // Debounce time (200ms to avoid false triggers)
    static const uint32_t WAKE_COOLDOWN_MS = 3000;    // Don't check switch for 3s after wake (legacy)
};

#endif // ENABLE_POWER_SWITCH

#endif // POWER_H
