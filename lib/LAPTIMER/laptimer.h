#ifndef LAPTIMER_H
#define LAPTIMER_H

#include <vector>
#include "RX5808.h"
#include "buzzer.h"
#include "config.h"
#include "kalman.h"
#include "led.h"

// Forward declarations to avoid circular dependency
struct Track;
class WebhookManager;

typedef enum {
    STOPPED,
    WAITING,
    RUNNING,
    CALIBRATION_WIZARD
} laptimer_state_e;

#define LAPTIMER_LAP_HISTORY 10
#define LAPTIMER_RSSI_HISTORY 100
#define LAPTIMER_CALIBRATION_HISTORY 5000  // Increased buffer for longer recordings

class LapTimer {
   public:
    void init(Config *config, RX5808 *rx5808, Buzzer *buzzer, Led *l, WebhookManager *webhook = nullptr);
    void start();
    void stop();
    void handleLapTimerUpdate(uint32_t currentTimeMs);
    uint8_t getRssi();
    uint32_t getLapTime();
    bool isLapAvailable();
    void addManualLap(uint32_t lapTimeMs);  // For web/test lap injection
    
    // Timing methods for LCD display
    bool isRaceRunning();
    uint32_t getRaceTimeMs();
    uint32_t getCurrentLapTimeMs();
    uint32_t getFastestLapMs();
    uint32_t getFastest3ConsecutiveMs();
    uint8_t getLapCount();
    
    // Effective thresholds (returns configured values)
    uint8_t getEffectiveEnterRssi();
    uint8_t getEffectiveExitRssi();
    uint8_t getBaselineRssi();
    uint8_t getNoiseCeiling();
    
    // Calibration wizard methods
    void startCalibrationWizard();
    void stopCalibrationWizard();
    uint16_t getCalibrationRssiCount();
    uint8_t getCalibrationRssi(uint16_t index);
    uint32_t getCalibrationTimestamp(uint16_t index);
    
    // Track/distance methods
    void setTrack(Track* track);
    float getTotalDistance();
    float getDistanceRemaining();
    Track* getSelectedTrack();

    /** Copy lap times (ms) in order for saving; only laps > 0. Call before stop(). */
    void getLapTimesForSave(std::vector<uint32_t>& out) const;
    // Returns the race-elapsed time (ms) at the moment of the last gate crossing.
    // Use this to pass an accurate timestamp to RotorHazard.
    uint32_t getLastCrossingRaceTimeMs();

    // Returns the raw millis() value at the moment of the last gate crossing.
    // Use getLastCrossingAbsoluteMs() + RHManager::clockOffsetMs for an RH-synced timestamp.
    uint32_t getLastCrossingAbsoluteMs();

    // Returns the raw millis() value when the current race was started (0 if not running).
    uint32_t getRaceStartMs();

    // Returns ms elapsed since race start (0 if not running).
    uint32_t getElapsedRaceTimeMs();

   private:
    laptimer_state_e state = STOPPED;
    RX5808 *rx;
    Config *conf;
    Buzzer *buz;
    Led *led;
    WebhookManager *webhooks;
    KalmanFilter filter;
    boolean lapCountWraparound;
    uint32_t raceStartTimeMs;
    uint32_t startTimeMs;
    uint32_t lastCrossingRaceTimeMs;  // ms from race start to last detected crossing
    uint8_t lapCount;
    uint8_t rssiCount;
    uint32_t lapTimes[LAPTIMER_LAP_HISTORY];
    uint8_t rssi[LAPTIMER_RSSI_HISTORY];
    uint8_t rssi_window[7];  // Medium window for moving average (5 is lower latency)
    uint8_t rssi_window_index;
    uint8_t lastLpRssi;

    uint8_t rssiPeak;
    uint32_t rssiPeakTimeMs;

    // Gate state tracking / debounce helpers
    bool gateExited;          // True when we're confidently outside the gate region
    bool enteredGate;         // True once we have crossed the enter threshold
    uint8_t enterHoldSamples; // Number of consecutive samples at/above enter
    uint32_t enterHoldStartMs;


    // Receiver filter mode tracking
    uint8_t activeReceiverRadio;  // Last-seen receiver type (to detect config changes)

    // Debug helpers (last processed RSSI chain)
    uint8_t lastRawRssi;
    uint8_t lastKalmanRssi;
    uint8_t lastAvgRssi;
    uint8_t prevAvgRssi;
    uint32_t lastRaceDebugPrintMs;

    bool lapAvailable = false;
    
    // Calibration wizard data
    uint16_t calibrationRssiCount;
    uint8_t calibrationRssi[LAPTIMER_CALIBRATION_HISTORY];
    uint32_t calibrationTimestamps[LAPTIMER_CALIBRATION_HISTORY];
    uint32_t lastCalibrationSampleMs;  // Track when last sample was taken
    
    // Track/distance tracking
    Track* selectedTrack;
    float totalDistanceTravelled;
    float distanceRemaining;

    void lapPeakCapture();
    bool lapPeakCaptured();
    void lapPeakReset();

    void startLap();
    void finishLap();
};

#endif
