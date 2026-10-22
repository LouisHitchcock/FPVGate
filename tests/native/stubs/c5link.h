// Host stand-in for C5Link: samples queued by the test, taken by C5MultiPilot.
#pragma once
#include <stdint.h>
#include <deque>
#include <utility>
#include "config.h"

class C5Link {
public:
    static constexpr uint8_t C5_MAX_PILOTS = 8;
    std::deque<std::pair<uint16_t, uint32_t>> queue[C5_MAX_PILOTS];
    bool takeSample(uint8_t pilot, uint16_t &value, uint32_t &timestampUs) {
        if (pilot >= C5_MAX_PILOTS || queue[pilot].empty()) return false;
        value = queue[pilot].front().first;
        timestampUs = queue[pilot].front().second;
        queue[pilot].pop_front();
        return true;
    }
};
