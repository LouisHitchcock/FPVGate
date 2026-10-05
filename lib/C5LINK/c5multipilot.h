#pragma once

#include <Arduino.h>
#include "c5link.h"

struct C5LapEvent {
    uint8_t pilot;
    uint32_t lapTimeMs;
};

class C5MultiPilot {
public:
    void begin(Config *config, C5Link *link);
    void start(uint32_t nowMs);
    void stop();
    void update(uint32_t nowMs);
    bool running() const { return running_; }
    uint16_t rssi(uint8_t pilot) const { return pilot < C5Link::C5_MAX_PILOTS ? filtered_[pilot] : 0; }
    // Above the enter threshold and not yet below exit (only while a race runs).
    bool inside(uint8_t pilot) const { return pilot < C5Link::C5_MAX_PILOTS && inside_[pilot]; }
    bool takeLap(C5LapEvent &event);
    // The slot on the main pilot frequency (Configuration), whose gate
    // crossings drive the race timer; -1 if no slot is on it.
    int8_t racePilot() const { return racePilot_; }
    // The race pilot's next gate crossing (micros(), at the RSSI peak of the
    // pass), for LapTimer::recordCrossing(). Drained by loop().
    bool takeRaceCrossing(uint32_t &crossingUs);

private:
    Config *config_ = nullptr;
    C5Link *link_ = nullptr;
    bool running_ = false;
    bool inside_[C5Link::C5_MAX_PILOTS] = {};
    // Keep the crossing clock in microseconds; the public lap event remains
    // milliseconds for compatibility with the existing timer/web API.
    uint32_t lastLapUs_[C5Link::C5_MAX_PILOTS] = {};
    // Highest filtered value inside the gate and when it was first reached.
    uint16_t peak_[C5Link::C5_MAX_PILOTS] = {};
    uint32_t peakUs_[C5Link::C5_MAX_PILOTS] = {};
    volatile int8_t racePilot_ = -1;
    static constexpr uint8_t CROSSING_QUEUE = 8;
    uint32_t crossings_[CROSSING_QUEUE] = {};
    uint8_t crossingCount_ = 0;
    uint16_t filtered_[C5Link::C5_MAX_PILOTS] = {};
    // Filled by update() in c5Task, drained by takeLap() from the web task
    // and takeRaceCrossing() from loop(), so guarded by a spinlock.
    C5LapEvent pending_[C5Link::C5_MAX_PILOTS] = {};
    uint8_t pendingCount_ = 0;
    portMUX_TYPE lapMux_ = portMUX_INITIALIZER_UNLOCKED;
};
