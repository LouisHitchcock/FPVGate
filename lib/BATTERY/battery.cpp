#include "battery.h"

#include <Arduino.h>

#include "debug.h"
#ifdef USE_ADC_DMA
#include "RX5808.h"
#endif

void BatteryMonitor::init(uint8_t pin, float batScale, uint8_t batAdd, Buzzer *buzzer, Led *l) {
    buz = buzzer;
    led = l;
    vbatPin = pin;
    scale = batScale;
    add = batAdd;
    state = ALARM_OFF;
    memset(measurements, 0, sizeof(measurements));
    measurementIndex = 0;
    lastCheckTimeMs = millis();
    enableDebug = false;  // Start with debug disabled
    dmaAverageSeeded = false;
    pinMode(vbatPin, INPUT);
#ifndef USE_ADC_DMA
    analogReadResolution(12);
#if defined(ADC_11db)
    analogSetPinAttenuation(vbatPin, ADC_11db);
#elif defined(ADC_ATTEN_DB_12)
    analogSetPinAttenuation(vbatPin, ADC_ATTEN_DB_12);
#endif
#endif
#ifdef USE_ADC_DMA
    DEBUG("Battery ADC: pin %d (shared DMA stream)\n", vbatPin);
#endif

#ifndef USE_ADC_DMA
    for (int i = 0; i < AVERAGING_SIZE; i++) {
        getBatteryVoltage();  // kick averaging sum up to speed.
    }
#endif
}

static uint16_t averageSum = 0;

uint16_t BatteryMonitor::getBatteryVoltage() {
    // 0-3.3V maps to 0-4095, battery voltage ranges from 4.2V to 3.0V, but the voltage is divided, so 2.1V - 1.5V
    uint16_t raw = 0;
    bool hasSample = true;
#ifdef USE_ADC_DMA
    hasSample = RX5808::getDmaBatteryRaw(raw);
#else
    raw = analogRead(vbatPin);
#endif
#ifdef USE_ADC_DMA
    // Do not poison the moving average with zeros before DMA has delivered
    // the first battery-channel sample.
    if (!hasSample) {
        uint16_t averaged = round(averageSum / AVERAGING_SIZE);
        uint16_t scaled = map(averaged, 0, 4095, 0, (uint16_t)(33 * scale)) + add;
        return scaled;
    }
    if (!dmaAverageSeeded) {
        // Seed the moving average with first valid sample for instant convergence.
        averageSum = 0;
        for (uint8_t i = 0; i < AVERAGING_SIZE; i++) {
            measurements[i] = raw;
            averageSum += raw;
        }
        measurementIndex = 0;
        dmaAverageSeeded = true;
    }
#endif
    averageSum = averageSum - measurements[measurementIndex];  // substract oldest val
    measurements[measurementIndex] = raw;                      // replace old with new val
    averageSum += raw;                                         // update averageSum
    measurementIndex = (measurementIndex + 1) % AVERAGING_SIZE;
    uint16_t averaged = round(averageSum / AVERAGING_SIZE);
    // Map ADC reading (0-4095) to voltage in tenths of volt (0-330 for 3.3V ref, multiplied by divider ratio)
    uint16_t scaled = map(averaged, 0, 4095, 0, (uint16_t)(33 * scale)) + add;
    if (enableDebug) {
        DEBUG("Battery raw:%u, avg:%u, scaled:%u (%.1fV)\n", raw, averaged, scaled, scaled / 10.0f);
    }
    return scaled;
}

void BatteryMonitor::checkBatteryState(uint32_t currentTimeMs, uint8_t alarmThreshold) {
    // Update debug flag based on whether monitoring is enabled
    // This persists across all getBatteryVoltage() calls
    enableDebug = (alarmThreshold > 0);
    
    switch (state) {
        case ALARM_OFF:
            if ((alarmThreshold > 0) && ((currentTimeMs - lastCheckTimeMs) > MONITOR_CHECK_TIME_MS)) {
                lastCheckTimeMs = currentTimeMs;
                if (getBatteryVoltage() <= alarmThreshold) {
                    state = ALARM_BEEPING;
                    buz->playCue(BUZZER_CUE_LOW_BATTERY);
                    led->blink(MONITOR_BEEP_TIME_MS);
                }
            }
            break;
        case ALARM_BEEPING:
            if ((currentTimeMs - lastCheckTimeMs) > MONITOR_BEEP_TIME_MS) {
                lastCheckTimeMs = currentTimeMs;
                state = ALARM_IDLE;
            }
            break;
        case ALARM_IDLE:
            if ((currentTimeMs - lastCheckTimeMs) > MONITOR_BEEP_TIME_MS) {
                lastCheckTimeMs = currentTimeMs;
                if (getBatteryVoltage() <= alarmThreshold + 1) {  // add 0.1V of histeresis
                    state = ALARM_BEEPING;
                    buz->playCue(BUZZER_CUE_LOW_BATTERY);
                } else {
                    led->off();
                    state = ALARM_OFF;
                }
            }
            break;
        default:
            break;
    }
}
