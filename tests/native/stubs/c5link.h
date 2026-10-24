#pragma once
#include "config.h"
#include <deque>
class C5Link {
public:
    static constexpr uint8_t C5_MAX_PILOTS = 8;
    struct Sample { uint16_t value; uint32_t us; };
    std::deque<Sample> samples[8];
    bool takeSample(uint8_t i, uint16_t& value, uint32_t& us) {
        if (samples[i].empty()) return false;
        const auto s = samples[i].front();
        samples[i].pop_front();
        value = s.value;
        us = s.us;
        return true;
    }
};
