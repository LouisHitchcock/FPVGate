#ifndef LAPTIMER_H
#define LAPTIMER_H

#include "RX5808.h"
#include "buzzer.h"
#include "config.h"
#include "kalman.h"
#include "led.h"

typedef enum {
    STOPPED,
    WAITING,
    RUNNING,
    CALIBRATION_WIZARD
} laptimer_state_e;

#define LAPTIMER_LAP_HISTORY 10
#define LAPTIMER_RSSI_HISTORY 100
#define LAPTIMER_CALIBRATION_HISTORY 1000

class LapTimer {
   public:
    void init(Config *config, RX5808 *rx5808, Buzzer *buzzer, Led *l);
    void start();
    void stop();
    void handleLapTimerUpdate(uint32_t currentTimeMs);
    uint8_t getRssi();
    uint32_t getLapTime();
    bool isLapAvailable();
    
    // Calibration wizard methods
    void startCalibrationWizard();
    void stopCalibrationWizard();
    uint16_t getCalibrationRssiCount();
    uint8_t getCalibrationRssi(uint16_t index);
    uint32_t getCalibrationTimestamp(uint16_t index);

   private:
    laptimer_state_e state = STOPPED;
    RX5808 *rx;
    Config *conf;
    Buzzer *buz;
    Led *led;
    KalmanFilter filter;
    boolean lapCountWraparound;
    uint32_t raceStartTimeMs;
    uint32_t startTimeMs;
    uint8_t lapCount;
    uint8_t rssiCount;
    uint32_t lapTimes[LAPTIMER_LAP_HISTORY];
    uint8_t rssi[LAPTIMER_RSSI_HISTORY];

    uint8_t rssiPeak;
    uint32_t rssiPeakTimeMs;

    bool lapAvailable = false;
    
    // Calibration wizard data
    uint16_t calibrationRssiCount;
    uint8_t calibrationRssi[LAPTIMER_CALIBRATION_HISTORY];
    uint32_t calibrationTimestamps[LAPTIMER_CALIBRATION_HISTORY];

    void lapPeakCapture();
    bool lapPeakCaptured();
    void lapPeakReset();

    void startLap();
    void finishLap();
};

#endif
