#include "laptimer.h"
#include "trackmanager.h"
#include "webhook.h"

#include "debug.h"

#ifdef ESP32S3
#include "rgbled.h"
extern RgbLed* g_rgbLed;
#endif

// Kalman filtering tuning
// Higher Q = trust measurements less (more smoothing)
// Lower R = assume system changes slower (more smoothing)
// RX5808: heavy smoothing for noisy analog signal
static const float kKalmanQ_RX5808 = 9.0f;    // measurement noise (high = smooth more)
static const float kKalmanR_RX5808 = 0.002f;   // process noise
// Novacore: light smoothing for cleaner digital signal
static const float kKalmanQ_Novacore = 2.0f;   // trust measurements more
static const float kKalmanR_Novacore = 0.002f;  // same process noise

// Race debug output (Serial) — throttled so it doesn't overwhelm.
// Set to 0 to compile out the periodic race debug print.
#ifndef LAPTIMER_RACE_DEBUG
#define LAPTIMER_RACE_DEBUG 1
#endif

static const uint32_t kRaceDebugPeriodMs = 100;  // 10 Hz

// Debounce: require consecutive samples at/above enter before peak tracking
static const uint8_t kEnterHoldSamplesMin = 4;

// Moving average window (must match rssi_window[] size in laptimer.h)
static const uint8_t kMaWindow = 7;

// EMA low-pass tuning:
// alpha closer to 0 = stronger smoothing (slower response)
// alpha closer to 1 = weaker smoothing (faster response)
static const float kEmaAlpha = 0.15f;

// Reject one-sample "teleport" drops/rises with a step limiter.
// This is NOT a low-pass; it only clamps absurd per-sample jumps.
// Lower = stricter (less likely to false-trigger), Higher = more responsive.
static const int kMaxStepPerSample_RX5808 = 12;
static const int kMaxStepPerSample_Novacore = 20;  // More responsive for cleaner signal

// NEW: require N consecutive samples below exit to confirm "exit"
static const uint8_t kExitConfirmSamples = 2;

void LapTimer::init(Config *config, RX5808 *rx5808, Buzzer *buzzer, Led *l, WebhookManager *webhook) {
    conf = config;
    rx = rx5808;
    buz = buzzer;
    led = l;
    webhooks = webhook;

    // Set Kalman tuning based on receiver type
    activeReceiverRadio = conf->getReceiverRadio();
    if (activeReceiverRadio == 1) {
        float novaQ = (float)conf->getNovaKalmanQ() / 100.0f;
        filter.setMeasurementNoise(novaQ);
        filter.setProcessNoise(kKalmanR_Novacore);
        DEBUG("Filter mode: Novacore (Q=%.1f, configurable chain)\n", novaQ);
    } else {
        filter.setMeasurementNoise(kKalmanQ_RX5808);
        filter.setProcessNoise(kKalmanR_RX5808);
        DEBUG("Filter mode: RX5808 (full 5-stage chain)\n");
    }

    selectedTrack = nullptr;
    totalDistanceTravelled = 0.0f;
    distanceRemaining = 0.0f;

    stop();
    memset(rssi, 0, sizeof(rssi));
    memset(rssi_window, 0, sizeof(rssi_window));
    rssi_window_index = 0;

    // Debug/state init
    lastRawRssi = 0;
    lastKalmanRssi = 0;
    lastAvgRssi = 0;
    prevAvgRssi = 0;
    lastRaceDebugPrintMs = 0;
    enteredGate = false;
    gateExited = true;
    enterHoldSamples = 0;
    enterHoldStartMs = 0;

}

void LapTimer::start() {
    DEBUG("\n=== RACE STARTED ===\n");
    DEBUG("Current Thresholds:\n");
    DEBUG("  Enter RSSI: %u\n", conf->getEnterRssi());
    DEBUG("  Exit RSSI: %u\n", conf->getExitRssi());
    DEBUG("  Min Lap Time: %u ms\n", conf->getMinLapMs());
    DEBUG("\nCurrent RSSI: %u\n", rssi[rssiCount]);
    DEBUG("====================\n\n");

    // Keep the Kalman filter running - resetting it causes a transient ramp
    // that can false-trigger the first lap. The step limiter rate-limits
    // output changes anyway, so a reset provides no benefit.

    raceStartTimeMs = millis();
    startTimeMs = raceStartTimeMs;
    state = RUNNING;

    rssiPeak = 0;
    rssiPeakTimeMs = 0;

    gateExited = true;
    enteredGate = false;
    enterHoldSamples = 0;
    enterHoldStartMs = 0;
    prevAvgRssi = 0;
    lastRaceDebugPrintMs = 0;

    totalDistanceTravelled = 0.0f;
    distanceRemaining = 0.0f;

    buz->playCue(BUZZER_CUE_RACE_START);
    led->on(500);

#ifdef ESP32S3
    if (g_rgbLed) g_rgbLed->flashGreen();
#endif

    if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookRaceStart()) {
        webhooks->triggerRaceStart();
    }
}

void LapTimer::stop() {
    DEBUG("LapTimer stopped\n");
    state = STOPPED;
    lapCountWraparound = false;
    lapCount = 0;
    rssiCount = 0;

    rssiPeak = 0;
    rssiPeakTimeMs = 0;
    startTimeMs = 0;

    gateExited = true;
    enteredGate = false;
    enterHoldSamples = 0;
    enterHoldStartMs = 0;

    totalDistanceTravelled = 0.0f;
    distanceRemaining = 0.0f;

    memset(lapTimes, 0, sizeof(lapTimes));
    buz->playCue(BUZZER_CUE_RACE_STOP);
    led->on(500);

#ifdef ESP32S3
    if (g_rgbLed) g_rgbLed->flashReset();
#endif

    if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookRaceStop()) {
        webhooks->triggerRaceStop();
    }
}

void LapTimer::handleLapTimerUpdate(uint32_t currentTimeMs) {
    // Check if receiver type changed and update Kalman tuning
    uint8_t currentRadio = conf->getReceiverRadio();
    if (currentRadio != activeReceiverRadio) {
        activeReceiverRadio = currentRadio;
        if (activeReceiverRadio == 1) {
            float novaQ = (float)conf->getNovaKalmanQ() / 100.0f;
            filter.setMeasurementNoise(novaQ);
            filter.setProcessNoise(kKalmanR_Novacore);
            DEBUG("Filter mode switched: Novacore (Q=%.1f, configurable chain)\n", novaQ);
        } else {
            filter.setMeasurementNoise(kKalmanQ_RX5808);
            filter.setProcessNoise(kKalmanR_RX5808);
            DEBUG("Filter mode switched: RX5808 (full 5-stage chain)\n");
        }
    }

    // --- Stage 1: raw RSSI ---
    uint8_t rawRssi = rx->readRssi();

    // --- Stage 2: Kalman filter ---
    uint8_t kalman_filtered = (uint8_t)round(filter.filter(rawRssi, 0));

    // Step limiter state (shared across both paths)
    static bool outInit = false;
    static uint8_t outPrev = 0;
    uint8_t out;

    // Debug intermediate values
    uint8_t median_kal = kalman_filtered;
    uint8_t ma = kalman_filtered;
    uint8_t lp = kalman_filtered;

    if (activeReceiverRadio == 1) {
        // === NOVACORE PATH: config-driven filter chain ===

        // Stage 1: Kalman (already applied above if enabled)
        out = conf->getNovaFilterKalman() ? kalman_filtered : rawRssi;

        // Stage 2: Median-of-3
        if (conf->getNovaFilterMedian()) {
            static uint8_t nMedianHist[3] = {0, 0, 0};
            static uint8_t nMedianIdx = 0;
            nMedianHist[nMedianIdx] = out;
            nMedianIdx = (nMedianIdx + 1) % 3;
            uint8_t a = nMedianHist[0], b = nMedianHist[1], c = nMedianHist[2];
            out = (a > b) ? ((b > c) ? b : ((a > c) ? c : a))
                          : ((a > c) ? a : ((b > c) ? c : b));
            median_kal = out;
        }

        // Stage 3: Moving average (7-sample)
        if (conf->getNovaFilterMA()) {
            static uint8_t nMaWin[7] = {0};
            static uint8_t nMaIdx = 0;
            nMaWin[nMaIdx] = out;
            nMaIdx = (nMaIdx + 1) % 7;
            uint16_t s = 0;
            for (int i = 0; i < 7; i++) s += nMaWin[i];
            out = (uint8_t)(s / 7);
            ma = out;
        }

        // Stage 4: EMA low-pass
        if (conf->getNovaFilterEMA()) {
            static float nEma = NAN;
            float alpha = (float)conf->getNovaEmaAlpha() / 100.0f;
            if (isnan(nEma)) {
                nEma = (float)out;
            } else {
                nEma = (alpha * (float)out) + ((1.0f - alpha) * nEma);
            }
            out = (uint8_t)lroundf(nEma);
            lp = out;
        }

        // Stage 5: Step limiter
        if (conf->getNovaFilterStepLimiter()) {
            int maxStep = (int)conf->getNovaStepMax();
            if (outInit) {
                int delta = (int)out - (int)outPrev;
                if (delta > maxStep) out = (uint8_t)(outPrev + maxStep);
                else if (delta < -maxStep) out = (uint8_t)(outPrev - maxStep);
            } else {
                outInit = true;
            }
        } else if (!outInit) {
            outInit = true;
        }
    } else {
        // === RX5808 PATH: Full 5-stage filter chain ===

        // --- Stage 2.5: Median-of-3 on Kalman (kills single-sample glitches) ---
        static uint8_t kHist[3] = {0, 0, 0};
        static uint8_t kHistIdx = 0;
        kHist[kHistIdx] = kalman_filtered;
        kHistIdx = (kHistIdx + 1) % 3;

        uint8_t a = kHist[0], b = kHist[1], c = kHist[2];
        median_kal =
            (a > b) ? ((b > c) ? b : ((a > c) ? c : a))
                    : ((a > c) ? a : ((b > c) ? c : b));

        // --- Stage 3: Moving average (kills short spikes) ---
        rssi_window[rssi_window_index] = median_kal;
        rssi_window_index = (rssi_window_index + 1) % kMaWindow;

        uint16_t sum = 0;
        for (int i = 0; i < kMaWindow; i++) sum += rssi_window[i];
        ma = (uint8_t)(sum / kMaWindow);

        // --- Stage 4: EMA low-pass ---
        static float ema = NAN;
        if (isnan(ema)) {
            ema = (float)ma;
        } else {
            ema = (kEmaAlpha * (float)ma) + ((1.0f - kEmaAlpha) * ema);
        }
        lp = (uint8_t)lroundf(ema);

        // --- Stage 5: Step limiter ---
        out = lp;

        if (outInit) {
            int delta = (int)lp - (int)outPrev;
            if (delta > kMaxStepPerSample_RX5808) out = (uint8_t)(outPrev + kMaxStepPerSample_RX5808);
            else if (delta < -kMaxStepPerSample_RX5808) out = (uint8_t)(outPrev - kMaxStepPerSample_RX5808);
        } else {
            outInit = true;
        }
    }
    outPrev = out;

    // Store final value used by lap logic
    rssi[rssiCount] = out;

    // Debug/state tracking (raw/kalman/ma)
    lastRawRssi = rawRssi;
    lastKalmanRssi = kalman_filtered;
    lastAvgRssi = ma;

#if LAPTIMER_RACE_DEBUG
    if (state == RUNNING) {
        const uint8_t cur = rssi[rssiCount];
        const uint8_t enter = conf->getEnterRssi();
        const uint8_t exitT = conf->getExitRssi();

        if (prevAvgRssi < enter && cur >= enter) {
            DEBUG("[RACE] ENTER crossed: cur=%u raw=%u kal=%u med=%u ma=%u lp=%u out=%u t=%lu(ms since lap start)\n",
                  cur, rawRssi, kalman_filtered, median_kal, ma, lp, out,
                  (unsigned long)(millis() - startTimeMs));
        }
        if (prevAvgRssi >= exitT && cur < exitT) {
            DEBUG("[RACE] EXIT crossed: cur=%u peak=%u t=%lu(ms since lap start)\n",
                  cur, rssiPeak, (unsigned long)(millis() - startTimeMs));
        }

        const uint32_t now = millis();
        if (lastRaceDebugPrintMs == 0 || (now - lastRaceDebugPrintMs) >= kRaceDebugPeriodMs) {
            lastRaceDebugPrintMs = now;
            const bool validPeak = (rssiPeak > 0) && (rssiPeak >= enter) && (rssiPeak > (exitT + 5));

            // Show whether we've *confirmed* exit (2 samples) below
            uint16_t prevIdx = (rssiCount + LAPTIMER_RSSI_HISTORY - 1) % LAPTIMER_RSSI_HISTORY;
            const bool belowExit2 = (rssi[rssiCount] < exitT) && (rssi[prevIdx] < exitT);

            DEBUG("[RACE] raw=%3u kal=%3u med=%3u ma7=%3u lp=%3u out=%3u | enter=%3u exit=%3u | peak=%3u validPeak=%d belowExit2=%d entered=%d hold=%u\n",
                  rawRssi, kalman_filtered, median_kal, ma, lp, out,
                  enter, exitT, rssiPeak,
                  (int)validPeak, (int)belowExit2, (int)enteredGate, (unsigned)enterHoldSamples);
        }

        prevAvgRssi = cur;
    }
#endif

    switch (state) {
        case STOPPED:
            break;

        case WAITING:
            lapPeakCapture();
            if (lapPeakCaptured()) {
                state = RUNNING;
                startLap();
            }
            break;

        case RUNNING: {
            bool isGate1 = (lapCount == 0 && !lapCountWraparound);
            bool minLapElapsed = (currentTimeMs - startTimeMs) > conf->getMinLapMs();

            if (isGate1 || minLapElapsed) {
                lapPeakCapture();
                bool captured = lapPeakCaptured();
                if (captured) {
                    DEBUG("Lap triggered! Time: %u ms (Gate 1: %s), lapCount=%u\n",
                          currentTimeMs - startTimeMs, isGate1 ? "YES" : "NO", lapCount);
                    finishLap();
                    startLap();
                }
            }
            break;
        }

        case CALIBRATION_WIZARD:
            if (calibrationRssiCount < LAPTIMER_CALIBRATION_HISTORY &&
                (currentTimeMs - lastCalibrationSampleMs) >= 20) {
                calibrationRssi[calibrationRssiCount] = rssi[rssiCount];
                calibrationTimestamps[calibrationRssiCount] = currentTimeMs;
                calibrationRssiCount++;
                lastCalibrationSampleMs = currentTimeMs;
            }
            break;

        default:
            break;
    }

    rssiCount = (rssiCount + 1) % LAPTIMER_RSSI_HISTORY;
}

void LapTimer::lapPeakCapture() {
    const uint8_t cur = rssi[rssiCount];
    const uint32_t now = millis();

    bool entryCondition;
    bool noiseBlipExit;

    {
        const uint8_t enter = conf->getEnterRssi();
        const uint8_t exitT = conf->getExitRssi();
        entryCondition = (cur >= enter);
        noiseBlipExit = (cur < exitT && rssiPeak == 0);
    }

    // Debounce: require consecutive samples meeting entry condition
    if (entryCondition) {
        if (!enteredGate) {
            enteredGate = true;
            enterHoldSamples = 1;
            enterHoldStartMs = now;
            gateExited = false;
        } else {
            if (enterHoldSamples < 255) enterHoldSamples++;
            
            // Timeout: if gate stays entered for >3s, something is wrong - reset
            if ((now - enterHoldStartMs) > 3000) {
                DEBUG("[Timeout] Gate entered for >500ms - ceiling drift detected, resetting\n");
                enteredGate = false;
                gateExited = true;
                enterHoldSamples = 0;
                enterHoldStartMs = 0;
                rssiPeak = 0;
                rssiPeakTimeMs = 0;
                return; // Skip peak capture this cycle
            }
        }

        if (enterHoldSamples >= kEnterHoldSamplesMin) {
            if (cur > rssiPeak) {
                rssiPeak = cur;
                rssiPeakTimeMs = now;
                DEBUG("*** PEAK CAPTURED: %u (raw=%u kal=%u ma=%u) at %lu ms ***\n",
                      rssiPeak, lastRawRssi, lastKalmanRssi, lastAvgRssi,
                      (unsigned long)(rssiPeakTimeMs - startTimeMs));
            }
        }
    } else {
        if (enteredGate && noiseBlipExit) {
            // noise blip: dipped below without any peak
            enteredGate = false;
            gateExited = true;
            enterHoldSamples = 0;
            enterHoldStartMs = 0;
        } else {
            enterHoldSamples = 0;
        }
    }
}

bool LapTimer::lapPeakCaptured() {
    bool validPeak;
    bool droppedBelowExit;

    {
        const uint8_t enter = conf->getEnterRssi();
        const uint8_t exitT = conf->getExitRssi();

        validPeak = (rssiPeak > 0) &&
                     (rssiPeak >= enter) &&
                     (rssiPeak > (exitT + 5));

        if (kExitConfirmSamples <= 1) {
            droppedBelowExit = (rssi[rssiCount] < exitT);
        } else {
            uint16_t prevIdx = (rssiCount + LAPTIMER_RSSI_HISTORY - 1) % LAPTIMER_RSSI_HISTORY;
            droppedBelowExit = (rssi[rssiCount] < exitT) && (rssi[prevIdx] < exitT);
        }
    }

    bool captured = enteredGate && validPeak && droppedBelowExit;

    if (captured) {
        DEBUG("\n*** LAP DETECTED! ***\n");
        DEBUG("  Current RSSI: %u\n", rssi[rssiCount]);
        DEBUG("  Peak was: %u\n", rssiPeak);
        DEBUG("  Enter: %u  Exit: %u\n", conf->getEnterRssi(), conf->getExitRssi());
        DEBUG("******************\n\n");
    }

    if (!captured && enteredGate && droppedBelowExit && !validPeak) {
        // enteredGate without a real peak, then fell below exit -> reset
        enteredGate = false;
        gateExited = true;
        enterHoldSamples = 0;
        enterHoldStartMs = 0;
        rssiPeak = 0;
        rssiPeakTimeMs = 0;
    }

    return captured;
}

void LapTimer::startLap() {
    DEBUG("Lap started - Peak was %u, new lap begins\n", rssiPeak);
    startTimeMs = rssiPeakTimeMs;
    rssiPeak = 0;
    rssiPeakTimeMs = 0;

    enteredGate = false;
    gateExited = true;
    enterHoldSamples = 0;
    enterHoldStartMs = 0;

    buz->playCue(BUZZER_CUE_LAP);
    led->on(200);
}

void LapTimer::finishLap() {
    DEBUG(">>> finishLap() CALLED - lapCount BEFORE=%u, wraparound=%d\n", lapCount, lapCountWraparound);
    
    lapTimes[lapCount] = rssiPeakTimeMs - startTimeMs;
    if (lapCount == 0 && lapCountWraparound == false) {
        lapTimes[0] = rssiPeakTimeMs - raceStartTimeMs;
    } else {
        lapTimes[lapCount] = rssiPeakTimeMs - startTimeMs;
    }
    // Record race-elapsed time at this crossing for RotorHazard timestamp
    lastCrossingRaceTimeMs = rssiPeakTimeMs - raceStartTimeMs;
    DEBUG("Lap finished, lap time = %u\n", lapTimes[lapCount]);

    if (selectedTrack && selectedTrack->distance > 0) {
        totalDistanceTravelled += selectedTrack->distance;

        uint8_t maxLaps = conf->getMaxLaps();
        if (maxLaps > 0) {
            int lapsCompleted = lapCount + 1;
            if (lapCountWraparound) {
                lapsCompleted = LAPTIMER_LAP_HISTORY + (lapCount + 1);
            }
            int lapsRemaining = maxLaps - lapsCompleted;
            distanceRemaining = (lapsRemaining > 0) ? (lapsRemaining * selectedTrack->distance) : 0.0f;
        } else {
            distanceRemaining = 0.0f;
        }

        DEBUG("Distance: Travelled = %.2f m, Remaining = %.2f m\n",
              totalDistanceTravelled, distanceRemaining);
    }

    if ((lapCount + 1) % LAPTIMER_LAP_HISTORY == 0) {
        lapCountWraparound = true;
    }
    lapCount = (lapCount + 1) % LAPTIMER_LAP_HISTORY;
    lapAvailable = true;
    
    DEBUG(">>> finishLap() DONE - lapCount AFTER=%u, lapTime stored=%u\n", lapCount, lapTimes[lapCount == 0 ? LAPTIMER_LAP_HISTORY - 1 : lapCount - 1]);

#ifdef ESP32S3
    if (g_rgbLed) g_rgbLed->flashLap();
#endif

    if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookLap()) {
        webhooks->triggerLap();
    }
}

uint8_t LapTimer::getRssi() {
    return rssi[rssiCount];
}

uint32_t LapTimer::getLapTime() {
    uint32_t lapTime = 0;
    lapAvailable = false;
    if (lapCount == 0) {
        lapTime = lapTimes[LAPTIMER_LAP_HISTORY - 1];
    } else {
        lapTime = lapTimes[lapCount - 1];
    }
    return lapTime;
}

bool LapTimer::isLapAvailable() {
    return lapAvailable;
}

void LapTimer::addManualLap(uint32_t lapTimeMs) {
    DEBUG("addManualLap: Adding manual lap %u ms (lapCount=%u, wraparound=%d)\n", lapTimeMs, lapCount, lapCountWraparound);
    
    // Store the lap time in the circular buffer
    lapTimes[lapCount] = lapTimeMs;
    
    // Update distance tracking if track is set
    if (selectedTrack && selectedTrack->distance > 0) {
        totalDistanceTravelled += selectedTrack->distance;
        
        uint8_t maxLaps = conf->getMaxLaps();
        if (maxLaps > 0) {
            int lapsCompleted = lapCount + 1;
            if (lapCountWraparound) {
                lapsCompleted = LAPTIMER_LAP_HISTORY + (lapCount + 1);
            }
            int lapsRemaining = maxLaps - lapsCompleted;
            distanceRemaining = (lapsRemaining > 0) ? (lapsRemaining * selectedTrack->distance) : 0.0f;
        } else {
            distanceRemaining = 0.0f;
        }
        
        DEBUG("Distance: Travelled = %.2f m, Remaining = %.2f m\n",
              totalDistanceTravelled, distanceRemaining);
    }
    
    // Handle lap count wraparound
    if ((lapCount + 1) % LAPTIMER_LAP_HISTORY == 0) {
        lapCountWraparound = true;
    }
    lapCount = (lapCount + 1) % LAPTIMER_LAP_HISTORY;
    
    // Update current lap start time if race is running
    if (state == RUNNING) {
        startTimeMs = millis();  // Reset current lap timer
    }
    
    DEBUG("addManualLap: lapCount now=%u, wraparound=%d\n", lapCount, lapCountWraparound);
}

bool LapTimer::isRaceRunning() {
    return (state == RUNNING || state == WAITING);
}

uint32_t LapTimer::getRaceTimeMs() {
    if (state == STOPPED) return 0;
    return millis() - raceStartTimeMs;
}

uint32_t LapTimer::getCurrentLapTimeMs() {
    if (state != RUNNING) return 0;
    return millis() - startTimeMs;
}

uint32_t LapTimer::getFastestLapMs() {
    uint32_t fastest = UINT32_MAX;
    for (uint8_t i = 0; i < LAPTIMER_LAP_HISTORY; i++) {
        if (lapTimes[i] > 0 && lapTimes[i] < fastest) {
            fastest = lapTimes[i];
        }
    }
    uint32_t result = (fastest == UINT32_MAX) ? 0 : fastest;
    static uint32_t s_lastLogMs = 0;
    if (millis() - s_lastLogMs >= 1000) {
        DEBUG("getFastestLapMs: lapCount=%u, fastest=%u, returning=%u\n", lapCount, fastest, result);
        s_lastLogMs = millis();
    }
    return result;
}

uint32_t LapTimer::getFastest3ConsecutiveMs() {
    static uint32_t s_lastLog3Ms = 0;
    bool doLog = (millis() - s_lastLog3Ms >= 1000);
    if (doLog) s_lastLog3Ms = millis();

    if (doLog) DEBUG("getFastest3ConsecutiveMs: lapCount=%u, wraparound=%d\n", lapCount, lapCountWraparound);

    if (lapCount < 3 && !lapCountWraparound) {
        if (doLog) DEBUG("  Not enough laps yet (need 3)\n");
        return 0;
    }

    uint32_t fastestSum = UINT32_MAX;
    for (uint8_t i = 0; i < LAPTIMER_LAP_HISTORY - 2; i++) {
        if (lapTimes[i] > 0 && lapTimes[i+1] > 0 && lapTimes[i+2] > 0) {
            uint32_t sum = lapTimes[i] + lapTimes[i+1] + lapTimes[i+2];
            if (doLog) DEBUG("  Window[%u]: %u + %u + %u = %u\n", i, lapTimes[i], lapTimes[i+1], lapTimes[i+2], sum);
            if (sum < fastestSum) {
                fastestSum = sum;
            }
        }
    }
    uint32_t result = (fastestSum == UINT32_MAX) ? 0 : fastestSum;
    if (doLog) DEBUG("  Returning: %u\n", result);
    return result;
}

uint8_t LapTimer::getLapCount() {
    if (lapCountWraparound) {
        return LAPTIMER_LAP_HISTORY + lapCount;
    }
    return lapCount;
}

void LapTimer::getLapTimesForSave(std::vector<uint32_t>& out) const {
    out.clear();
    uint8_t n = lapCountWraparound ? LAPTIMER_LAP_HISTORY : lapCount;
    for (uint8_t i = 0; i < n; i++) {
        if (lapTimes[i] > 0) {
            out.push_back(lapTimes[i]);
        }
    }
}

void LapTimer::startCalibrationWizard() {
    DEBUG("Calibration wizard started\n");
    state = CALIBRATION_WIZARD;
    calibrationRssiCount = 0;
    lastCalibrationSampleMs = 0;  // Reset sample timing
    memset(calibrationRssi, 0, sizeof(calibrationRssi));
    memset(calibrationTimestamps, 0, sizeof(calibrationTimestamps));
    buz->playCue(BUZZER_CUE_CALIB_START);
    led->on(300);
#ifdef ESP32S3
    if (g_rgbLed) g_rgbLed->flashGreen();
#endif
}

void LapTimer::stopCalibrationWizard() {
    DEBUG("Calibration wizard stopped, recorded %u samples\n", calibrationRssiCount);
    state = STOPPED;
    buz->playCue(BUZZER_CUE_CALIB_STOP);
    led->on(300);
#ifdef ESP32S3
    if (g_rgbLed) g_rgbLed->flashReset();
#endif
}

uint16_t LapTimer::getCalibrationRssiCount() {
    return calibrationRssiCount;
}

uint8_t LapTimer::getCalibrationRssi(uint16_t index) {
    if (index < calibrationRssiCount) {
        return calibrationRssi[index];
    }
    return 0;
}

uint32_t LapTimer::getCalibrationTimestamp(uint16_t index) {
    if (index < calibrationRssiCount) {
        return calibrationTimestamps[index];
    }
    return 0;
}

void LapTimer::setTrack(Track* track) {
    selectedTrack = track;
    totalDistanceTravelled = 0.0f;
    distanceRemaining = 0.0f;
    if (track) {
        DEBUG("Track selected: %s (%.2f m)\n", track->name.c_str(), track->distance);
    } else {
        DEBUG("Track deselected\n");
    }
}

uint32_t LapTimer::getLastCrossingRaceTimeMs() {
    return lastCrossingRaceTimeMs;
}

uint32_t LapTimer::getLastCrossingAbsoluteMs() {
    return raceStartTimeMs + lastCrossingRaceTimeMs;
}

uint32_t LapTimer::getRaceStartMs() {
    return raceStartTimeMs;
}

uint32_t LapTimer::getElapsedRaceTimeMs() {
    if (state != RUNNING) return 0;
    return millis() - raceStartTimeMs;
}

float LapTimer::getTotalDistance() {
    return totalDistanceTravelled;
}

float LapTimer::getDistanceRemaining() {
    return distanceRemaining;
}

Track* LapTimer::getSelectedTrack() {
    return selectedTrack;
}

uint8_t LapTimer::getEffectiveEnterRssi() {
    return conf->getEnterRssi();
}

uint8_t LapTimer::getEffectiveExitRssi() {
    return conf->getExitRssi();
}

uint8_t LapTimer::getBaselineRssi() {
    return 0;
}

uint8_t LapTimer::getNoiseCeiling() {
    return 0;
}
