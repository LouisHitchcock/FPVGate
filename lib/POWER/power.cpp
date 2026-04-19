#include "power.h"

#ifdef ENABLE_POWER_SWITCH

#if defined(WAVESHARE_ESP32S3_LCD2)

#include "esp_sleep.h"
#include <WiFi.h>

static const uint32_t BTN_HOLD_MS = 2000;

PowerManager::PowerManager()
    : _switchPin(0),
      _backlightPin(0),
      _lastCheckMs(0),
      _lastState(true),
      _offDetectedMs(0),
      _wakeTime(0),
      _holdStartMs(0),
      _needButtonRelease(false),
      _lastWakeupCause(0) {}

bool PowerManager::init(uint8_t switchPin, uint8_t backlightPin) {
    _switchPin = switchPin;
    _backlightPin = backlightPin;

    esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
    _lastWakeupCause = (uint8_t)cause;
    if (cause == ESP_SLEEP_WAKEUP_EXT0) {
        _needButtonRelease = true;
    }

    // Schematic pull-up on GPIO16; INPUT only avoids parallel internal pull-up.
    pinMode(_switchPin, INPUT);
    delay(10);

    _lastCheckMs = millis();
    _holdStartMs = 0;
    return true;
}

void PowerManager::logBootReason() {
    esp_sleep_wakeup_cause_t c = (esp_sleep_wakeup_cause_t)_lastWakeupCause;
    if (c == ESP_SLEEP_WAKEUP_EXT0) {
        Serial.println("[Power] Wake: deep sleep (button)");
    } else if (c != ESP_SLEEP_WAKEUP_UNDEFINED) {
        Serial.printf("[Power] Wake cause %u\n", (unsigned)c);
    }
}

bool PowerManager::isPowerOn() {
    return true;
}

bool PowerManager::monitorSwitch() {
    if (_needButtonRelease) {
        if (digitalRead(_switchPin) == HIGH) {
            _needButtonRelease = false;
            _holdStartMs = 0;
        }
        return true;
    }

    if (digitalRead(_switchPin) == LOW) {
        uint32_t now = millis();
        if (_holdStartMs == 0) {
            _holdStartMs = now;
        } else if (now - _holdStartMs >= BTN_HOLD_MS) {
            return false;
        }
    } else {
        _holdStartMs = 0;
    }
    return true;
}

void PowerManager::enterDeepSleep() {
    if (_backlightPin > 0) {
        pinMode(_backlightPin, OUTPUT);
        digitalWrite(_backlightPin, LOW);
    }
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(100);

    // Must not enter deep sleep with wake-on-LOW while the button is still held.
    while (digitalRead(_switchPin) == LOW) {
        delay(10);
    }
    delay(50);

    Serial.flush();
    delay(50);

    esp_sleep_enable_ext0_wakeup((gpio_num_t)_switchPin, 0);
    esp_deep_sleep_start();
}

#elif defined(ESP32S3) || defined(LILYGO_TENERGY_S3) || defined(ESP32S3_SUPERMINI)

#include "esp_sleep.h"
#include "driver/rtc_io.h"
#include <WiFi.h>

PowerManager::PowerManager()
    : _switchPin(0), _backlightPin(0), _lastCheckMs(0), _lastState(true), _offDetectedMs(0), _wakeTime(0) {}

void PowerManager::logBootReason() {}

bool PowerManager::init(uint8_t switchPin, uint8_t backlightPin) {
    _switchPin = switchPin;
    _backlightPin = backlightPin;

    Serial.println("\n[PowerManager] ========================================");
    Serial.println("[PowerManager] Initialization starting...");
    Serial.println("[PowerManager] ========================================");
    Serial.println("[PowerManager] Using LIGHT SLEEP mode (peripherals stay powered)");

    Serial.printf("[PowerManager] Configuring GPIO%d as INPUT_PULLUP...\n", _switchPin);
    pinMode(_switchPin, INPUT_PULLUP);
    delay(10);

    _lastState = digitalRead(_switchPin);
    _lastCheckMs = millis();
    _offDetectedMs = 0;

    Serial.printf("[PowerManager] GPIO%d configured successfully\n", _switchPin);
    Serial.printf("[PowerManager] Backlight pin: GPIO%d\n", _backlightPin);
    Serial.printf("[PowerManager] Current switch state: %s (raw: %d)\n", _lastState ? "ON" : "OFF",
                  _lastState);
    Serial.printf("[PowerManager] millis() = %lu\n", _lastCheckMs);

    if (!_lastState) {
        Serial.println("[PowerManager] Switch is OFF - will enter deep sleep immediately");
        Serial.println("[PowerManager] Returning false from init()");
        return false;
    }

    Serial.println("[PowerManager] Switch is ON - normal boot will continue");
    Serial.println("[PowerManager] Returning true from init()");
    Serial.println("[PowerManager] ========================================\n");
    return true;
}

bool PowerManager::isPowerOn() {
    return digitalRead(_switchPin) == HIGH;
}

bool PowerManager::monitorSwitch() {
    uint32_t now = millis();

    if (_wakeTime > 0 && (now - _wakeTime) < WAKE_COOLDOWN_MS) {
        return true;
    }

    if (now - _lastCheckMs < CHECK_INTERVAL_MS) {
        return true;
    }

    _lastCheckMs = now;
    bool currentState = digitalRead(_switchPin);

    if (_lastState && !currentState) {
        if (_offDetectedMs == 0) {
            _offDetectedMs = now;
            Serial.println("\n[PowerManager] *** SWITCH OFF DETECTED ***");
            Serial.printf("[PowerManager] GPIO%d = LOW, starting debounce (need %lums stable)\n", _switchPin,
                          DEBOUNCE_MS);
        } else {
            uint32_t elapsed = now - _offDetectedMs;
            Serial.printf("[PowerManager] Debouncing... elapsed: %lums / %lums\n", elapsed, DEBOUNCE_MS);

            if (elapsed >= DEBOUNCE_MS) {
                Serial.println("[PowerManager] *** SWITCH OFF CONFIRMED ***");
                Serial.println("[PowerManager] Initiating graceful shutdown...");
                _lastState = false;
                return false;
            }
        }
    } else if (!_lastState && currentState) {
        if (_offDetectedMs != 0) {
            Serial.println("[PowerManager] *** SWITCH BOUNCED BACK TO ON ***");
            Serial.println("[PowerManager] Shutdown cancelled");
            _offDetectedMs = 0;
        }
        _lastState = true;
    } else if (currentState) {
        if (_offDetectedMs != 0) {
            _offDetectedMs = 0;
        }
        _lastState = true;
    }

    return true;
}

void PowerManager::enterDeepSleep() {
    Serial.println("\n\n[PowerManager] ==========================================");
    Serial.println("[PowerManager]     ENTERING LIGHT SLEEP MODE");
    Serial.println("[PowerManager] ==========================================");
    Serial.printf("[PowerManager] Current time: %lu ms\n", millis());
    Serial.printf("[PowerManager] Switch pin: GPIO%d\n", _switchPin);
    Serial.printf("[PowerManager] Switch state: %d\n", digitalRead(_switchPin));

    if (_backlightPin > 0) {
        Serial.printf("[PowerManager] Turning OFF backlight (GPIO%d)...\n", _backlightPin);
        pinMode(_backlightPin, OUTPUT);
        digitalWrite(_backlightPin, LOW);
        Serial.println("[PowerManager] Backlight is now OFF");
    } else {
        Serial.println("[PowerManager] No backlight pin configured");
    }

    Serial.println("[PowerManager] Disconnecting WiFi...");
    WiFi.disconnect(true);
    Serial.println("[PowerManager] Setting WiFi mode to OFF...");
    WiFi.mode(WIFI_OFF);
    delay(100);
    Serial.println("[PowerManager] WiFi disabled");

    Serial.println("[PowerManager] Flushing serial buffer...");
    Serial.flush();
    delay(50);

    Serial.printf("[PowerManager] Configuring wake source: GPIO%d going HIGH\n", _switchPin);
    esp_err_t err = esp_sleep_enable_ext0_wakeup((gpio_num_t)_switchPin, 1);
    if (err == ESP_OK) {
        Serial.println("[PowerManager] Wake source configured successfully");
    } else {
        Serial.printf("[PowerManager] ERROR: Wake source config failed with code %d\n", err);
    }

    Serial.println("[PowerManager] ------------------------------------------");
    Serial.println("[PowerManager] System will now enter light sleep");
    Serial.println("[PowerManager] Flip switch to ON to wake");
    Serial.println("[PowerManager] Expected power draw: ~5-10mA");
    Serial.println("[PowerManager] Peripherals stay powered (instant wake)");
    Serial.println("[PowerManager] ==========================================");
    Serial.flush();
    delay(50);

    Serial.println("[PowerManager] Calling esp_light_sleep_start()...");
    Serial.flush();
    delay(10);

    esp_light_sleep_start();

    Serial.println("\n\n[PowerManager] ==========================================");
    Serial.println("[PowerManager]     WOKE FROM LIGHT SLEEP");
    Serial.println("[PowerManager] ==========================================");

    esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
    Serial.printf("[PowerManager] Wake reason: %d\n", wakeup_reason);

    int switchState = digitalRead(_switchPin);
    Serial.printf("[PowerManager] Switch state after wake: %d (%s)\n", switchState, switchState ? "ON" : "OFF");

    if (switchState == HIGH) {
        Serial.println("[PowerManager] Switch is ON - resuming normal operation");

        if (_backlightPin > 0) {
            digitalWrite(_backlightPin, HIGH);
            Serial.println("[PowerManager] Backlight turned ON");
        }

        Serial.println("[PowerManager] Re-enabling WiFi...");
        WiFi.mode(WIFI_STA);

        Serial.println("[PowerManager] Wake complete - execution continues normally");
        Serial.println("[PowerManager] ==========================================");

        _lastState = true;
        _offDetectedMs = 0;
        _lastCheckMs = millis();

        _wakeTime = millis();

        Serial.printf("[PowerManager] Wake cooldown active for %lu ms\n", WAKE_COOLDOWN_MS);
        Serial.println("[PowerManager] Switch monitoring will resume after cooldown");
    } else {
        Serial.println("[PowerManager] WARNING: Switch is still OFF after wake");
        Serial.println("[PowerManager] This may be a spurious wake - re-entering sleep");
    }
}

#else

PowerManager::PowerManager()
    : _switchPin(0), _backlightPin(0), _lastCheckMs(0), _lastState(true), _offDetectedMs(0), _wakeTime(0) {}

void PowerManager::logBootReason() {}

bool PowerManager::init(uint8_t switchPin, uint8_t backlightPin) {
    Serial.println("[PowerManager] WARNING: Deep sleep power switch not supported on this platform");
    return true;
}

bool PowerManager::isPowerOn() {
    return true;
}

bool PowerManager::monitorSwitch() {
    return true;
}

void PowerManager::enterDeepSleep() {
    Serial.println("[PowerManager] ERROR: Deep sleep not supported on this platform");
}
#endif

#endif  // ENABLE_POWER_SWITCH
