// Host C5Link: samples queued by a test and consumed by C5MultiPilot.
#pragma once
#include "config.h"
#include <deque>
class C5Link {
public:
    static constexpr uint8_t C5_MAX_PILOTS = 8;
    struct Sample { uint16_t value; uint32_t us; };
    std::deque<Sample> samples[C5_MAX_PILOTS];
    bool takeSample(uint8_t i, uint16_t& value, uint32_t& us) {
        if (i >= C5_MAX_PILOTS || samples[i].empty()) return false;
        const auto s = samples[i].front();
        samples[i].pop_front();
        value = s.value;
        us = s.us;
        return true;
    }
};
