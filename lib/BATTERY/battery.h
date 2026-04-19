#ifndef BATTERY_H
#define BATTERY_H

#include <stdint.h>

#include "buzzer.h"
#include "led.h"

#define MONITOR_CHECK_TIME_MS 5000
#define MONITOR_BEEP_TIME_MS 500
#define AVERAGING_SIZE 5

typedef enum {
    ALARM_OFF,
    ALARM_IDLE,
    ALARM_BEEPING
} alarm_state_e;

class BatteryMonitor {
   public:
    void init(uint8_t pin, float batScale, uint8_t batAdd, Buzzer *buzzer, Led *l);
    uint16_t getBatteryVoltage();
    void checkBatteryState(uint32_t currentTimeMs, uint8_t alarmThreshold);
    void setDebugEnabled(bool enabled) { enableDebug = enabled; }
    void setVoltageDivider(float ratio) { scale = ratio; }

   private:
    alarm_state_e state = ALARM_OFF;
    uint16_t measurements[AVERAGING_SIZE];
    uint8_t measurementIndex;
    uint32_t lastCheckTimeMs;
    uint8_t vbatPin;
    float scale;
    uint8_t add;
    bool enableDebug;
    uint8_t lastAlarmThreshold;  // Track last alarm threshold for debug control
    bool dmaAverageSeeded = false;
    Buzzer *buz;
    Led *led;
};

#endif  // BATTERY_H
