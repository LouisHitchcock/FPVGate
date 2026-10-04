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
    uint8_t rssi(uint8_t pilot) const { return pilot < C5Link::C5_MAX_PILOTS ? filtered_[pilot] : 0; }
    bool takeLap(C5LapEvent &event);

private:
    Config *config_ = nullptr;
    C5Link *link_ = nullptr;
    bool running_ = false;
    bool inside_[C5Link::C5_MAX_PILOTS] = {};
    bool seen_[C5Link::C5_MAX_PILOTS] = {};
    uint32_t lastLapMs_[C5Link::C5_MAX_PILOTS] = {};
    uint32_t enteredMs_[C5Link::C5_MAX_PILOTS] = {};
    uint8_t filtered_[C5Link::C5_MAX_PILOTS] = {};
    C5LapEvent pending_[C5Link::C5_MAX_PILOTS] = {};
    uint8_t pendingCount_ = 0;
};
