// Common level/timestamp filter for native USB and the FPVGate UART consumer.
// Input/output: 10-bit RSSI and sample time in milliseconds. The median returns
// the middle sample's time; callers retain that time, not delivery time.
#ifndef C5MK_RSSI_FILTER_H
#define C5MK_RSSI_FILTER_H

#include "rssi_median.h"

namespace rhusb {
class RssiFilter {
public:
    void reset() {
        median_.reset();
        sampled_ = false;
    }
    bool push(uint16_t& level, uint32_t& timeMs, uint16_t windowMs) {
        if (level > 1023) return false;
        if (windowMs > RunningMedian::kMaxWindowMs) windowMs = RunningMedian::kMaxWindowMs;
        if (windowMs != windowMs_) {
            reset();
            windowMs_ = windowMs;
        }
        const uint32_t inputMs = timeMs;
        if (sampled_ && inputMs - lastInputMs_ > 100) reset();
        sampled_ = true;
        lastInputMs_ = inputMs;
        // Native RH reserves RSSI 0/255. Apply the same bounds to both paths.
        if (level < 4) level = 4;
        if (level > 1019) level = 1019;
        return !windowMs || median_.push(level, timeMs, windowMs);
    }

private:
    RunningMedian median_;
    uint32_t lastInputMs_ = 0;
    uint16_t windowMs_ = 0;
    bool sampled_ = false;
};
}  // namespace rhusb
#endif
