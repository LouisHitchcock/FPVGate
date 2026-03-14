#include "buzzer.h"

// LEDC channel for PWM buzzer (use channel 7 to avoid FastLED/RMT conflicts)
#define BUZZER_LEDC_CHANNEL 7
#define BUZZER_LEDC_FREQ 2000  // 2kHz tone frequency
#define BUZZER_LEDC_RESOLUTION 8  // 8-bit resolution (0-255)

void Buzzer::init(uint8_t pin, bool inverted) {
    buzzerPin = pin;
    initialState = inverted ? HIGH : LOW;
    buzzerState = BUZZER_IDLE;
    volume = 100;
    
    // Setup LEDC for PWM buzzer control.
    // Arduino ESP32 3.x unified the setup+attach into a single pin-based call;
    // the old channel-based API was removed.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(buzzerPin, BUZZER_LEDC_FREQ, BUZZER_LEDC_RESOLUTION);
    ledcWrite(buzzerPin, 0);            // Start silent
#else
    ledcSetup(BUZZER_LEDC_CHANNEL, BUZZER_LEDC_FREQ, BUZZER_LEDC_RESOLUTION);
    ledcAttachPin(buzzerPin, BUZZER_LEDC_CHANNEL);
    ledcWrite(BUZZER_LEDC_CHANNEL, 0);  // Start silent
#endif
    usePWM = true;
}

void Buzzer::setVolume(uint8_t vol) {
    if (vol > 100) vol = 100;
    volume = vol;
}

void Buzzer::beep(uint32_t timeMs) {
    if (volume == 0) return;  // Silent mode
    
    beepTimeMs = timeMs;
    buzzerState = BUZZER_BEEPING;
    startTimeMs = millis();
    
    if (usePWM) {
        // Calculate duty cycle based on volume (0-100% -> 0-127 for 50% max duty)
        // Using 50% duty cycle at max volume for a cleaner tone
        uint8_t duty = (volume * 127) / 100;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcWrite(buzzerPin, duty);
#else
        ledcWrite(BUZZER_LEDC_CHANNEL, duty);
#endif
    } else {
        digitalWrite(buzzerPin, !initialState);
    }
}

void Buzzer::handleBuzzer(uint32_t currentTimeMs) {
    switch (buzzerState) {
        case BUZZER_IDLE:
            break;
        case BUZZER_BEEPING:
            if (currentTimeMs < startTimeMs) {
                break;  // updated from different core
            }
            if ((currentTimeMs - startTimeMs) > beepTimeMs) {
                if (usePWM) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
                    ledcWrite(buzzerPin, 0);  // Silent
#else
                    ledcWrite(BUZZER_LEDC_CHANNEL, 0);  // Silent
#endif
                } else {
                    digitalWrite(buzzerPin, initialState);
                }
                buzzerState = BUZZER_IDLE;
            }
            break;
        default:
            break;
    }
}
