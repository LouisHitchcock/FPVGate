#pragma once

#include <Arduino.h>
#include "c5link.h"

// One lap of one C5 slot. lap 0 is Gate 1 (race start to the first pass).
struct C5LapEvent {
    uint8_t pilot;
    uint8_t lap;
    uint32_t lapTimeMs;
    bool racer;   // the slot races (its laps count in the race result)
};

// One pass of one slot through the gate, unfiltered (no Gate 1 or minimum
// lap rules), for the RotorHazard plugin: RotorHazard applies its own.
struct C5Pass {
    uint8_t pilot;
    uint32_t crossingUs;   // micros() at the pass's RSSI peak
    uint16_t peak;         // filtered peak, 0..1023
};

class C5MultiPilot {
public:
    static constexpr uint8_t MAX_RACE_LAPS = 64;
    // A pass ends once the RSSI has stayed below Exit this long. Climbing
    // back above Enter sooner (multipath dips as a quad flies through)
    // continues the same pass, so one fly-through is one pass.
    static constexpr uint32_t PASS_MERGE_MS = 300;

    void begin(Config *config, C5Link *link);
    // raceStartMs: millis() when the race started (LapTimer::getRaceStartMs).
    void start(uint32_t raceStartMs);
    void stop();
    void update(uint32_t nowMs);
    bool running() const { return running_; }
    uint16_t rssi(uint8_t pilot) const { return pilot < C5Link::C5_MAX_PILOTS ? filtered_[pilot] : 0; }
    // Above the enter threshold and not yet below exit (only while a race runs).
    bool inside(uint8_t pilot) const { return pilot < C5Link::C5_MAX_PILOTS && inside_[pilot]; }
    bool takeLap(C5LapEvent &event);
    // Detect passes outside races too (RotorHazard owns the race and wants
    // every pass), and queue each one for takePass().
    void setPassStream(bool on) { passStream_ = on; }
    bool takePass(C5Pass &pass);
    // Highest filtered value since the last call (0..1023), for the RSSI
    // debug popout: at 25 frames a second a pass's peak would otherwise fall
    // between frames.
    uint16_t takePeakHold(uint8_t pilot);
    // The same for the RotorHazard RSSI stream, held separately so the two
    // readers don't take each other's peaks.
    uint16_t takeRhPeak(uint8_t pilot);
    void takeCaptureFrame(uint8_t* values);

    // Slots that have a frequency and race (Calibration tab "Race" switch).
    uint8_t racerMask() const { return racerMask_; }
    // Two or more racers: a multi-pilot race. One racer: a single-pilot race
    // through LapTimer, as with the RX5808.
    bool multiRace() const { return racerCount_ >= 2; }
    // The only racer, or -1 when there are none or several.
    int8_t racePilot() const { return racerCount_ == 1 ? (int8_t)__builtin_ctz(racerMask_) : -1; }
    // The race pilot's next gate crossing (micros(), at the RSSI peak of the
    // pass), for LapTimer::recordCrossing(). Single-racer races only.
    bool takeRaceCrossing(uint32_t &crossingUs);
    // This race's laps so far (ms; [0] is Gate 1). Copies up to max; returns
    // the count. Safe from another task.
    uint8_t copyLaps(uint8_t pilot, uint32_t *out, uint8_t max);
    // A manual lap for a racing slot, timed when update() next runs and
    // exempt from the minimum lap. False if no race runs or the slot doesn't
    // race. Safe from another task.
    bool requestManualLap(uint8_t pilot);

private:
    Config *config_ = nullptr;
    C5Link *link_ = nullptr;
    volatile bool running_ = false;
    uint32_t raceStartUs_ = 0;
    bool inside_[C5Link::C5_MAX_PILOTS] = {};
    uint16_t filtered_[C5Link::C5_MAX_PILOTS] = {};
    volatile uint16_t peakHold_[C5Link::C5_MAX_PILOTS] = {};
    volatile uint16_t rhPeak_[C5Link::C5_MAX_PILOTS] = {};
    uint16_t capturePeak_[C5Link::C5_MAX_PILOTS] = {};
    // Highest filtered value inside the gate and when it was first reached.
    uint16_t peak_[C5Link::C5_MAX_PILOTS] = {};
    uint32_t peakUs_[C5Link::C5_MAX_PILOTS] = {};
    // While a pass waits to end: when the RSSI went below Exit (0 = above it).
    uint32_t belowUs_[C5Link::C5_MAX_PILOTS] = {};
    uint32_t lastCrossingUs_[C5Link::C5_MAX_PILOTS] = {};
    uint32_t laps_[C5Link::C5_MAX_PILOTS][MAX_RACE_LAPS] = {};
    uint8_t lapCount_[C5Link::C5_MAX_PILOTS] = {};
    volatile uint8_t racerMask_ = 0;
    volatile uint8_t racerCount_ = 0;
    static constexpr uint8_t CROSSING_QUEUE = 8;
    uint32_t crossings_[CROSSING_QUEUE] = {};
    uint8_t crossingCount_ = 0;
    // Filled by update() in c5Task; drained by takeLap() from the web task,
    // takeRaceCrossing() from loop() and copyLaps() from HTTP handlers, so
    // guarded by a spinlock.
    static constexpr uint8_t LAP_QUEUE = 16;
    C5LapEvent pending_[LAP_QUEUE] = {};
    uint8_t pendingCount_ = 0;
    portMUX_TYPE lapMux_ = portMUX_INITIALIZER_UNLOCKED;
    volatile bool passStream_ = false;
    static constexpr uint8_t PASS_QUEUE = 16;
    C5Pass passes_[PASS_QUEUE] = {};
    uint8_t passCount_ = 0;
    uint8_t manualMask_ = 0;   // bit i: a manual lap waits for slot i (under lapMux_)

    void crossing(uint8_t pilot, uint32_t crossingUs, bool manual = false);
    void endPass(uint8_t pilot);
};
