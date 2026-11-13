// Running median of one seat's RSSI levels over the last windowMs, the same
// kind of filter RotorHazard's nodes run on an RX5808. Portable, no allocation.
//
// At most one level per millisecond enters the window, so a seat scanned faster
// than 1 kHz keeps the full window in the 255 slots. Nothing comes out until
// the window has filled. Each output carries the time of the window's middle
// sample, so the filter delays the level but does not move a pass.
#ifndef C5MK_RSSI_MEDIAN_H
#define C5MK_RSSI_MEDIAN_H

#include <stdint.h>

namespace rhusb {

class RunningMedian {
public:
    static constexpr uint16_t kMaxWindowMs = 255;

    RunningMedian() { reset(); }

    void reset() {
        for (auto& count : counts_) count = 0;
        size_ = head_ = below_ = 0;
        median_ = 0;
        hasLast_ = filled_ = false;
    }

    // Takes a level and its time; returns true when they have been replaced
    // by a filtered level and that level's time.
    bool push(uint8_t& level, uint32_t& timeMs, uint16_t windowMs) {
        uint16_t full = level;
        if (!push(full, timeMs, windowMs)) return false;
        level = (uint8_t)full;
        return true;
    }

    // Preserve the UART path's 10-bit RSSI; USB quantises only after filtering.
    bool push(uint16_t& level, uint32_t& timeMs, uint16_t windowMs) {
        if (level > 1023) return false;
        if (hasLast_ && timeMs == lastMs_) return false;
        const uint32_t nowMs = timeMs;
        const uint16_t nowLow = (uint16_t)nowMs;
        hasLast_ = true;
        lastMs_ = nowMs;
        if (size_ == kSlots) {
            // At the maximum window and 1 kHz this capacity eviction is
            // also the first aged-out sample. Record warm-up before drop()
            // removes the only sample old enough to fill the window.
            if ((uint16_t)(nowLow - times_[head_]) >= windowMs) filled_ = true;
            drop();
        }
        const unsigned tail = (head_ + size_) % kSlots;
        levels_[tail] = level;
        times_[tail] = nowLow;
        ++size_;
        ++counts_[level];
        if (size_ == 1) {
            median_ = level;
            below_ = 0;
        } else if (level < median_) {
            ++below_;
        }
        // Full once a sample has aged out: the window then spans windowMs.
        while (size_ > 1 && (uint16_t)(nowLow - times_[head_]) >= windowMs) {
            drop();
            filled_ = true;
        }
        balance();
        if (!filled_) return false;
        level = median_;
        const unsigned middle = (head_ + (size_ - 1u) / 2u) % kSlots;
        timeMs = nowMs - (uint16_t)(nowLow - times_[middle]);
        return true;
    }

private:
    static constexpr unsigned kSlots = kMaxWindowMs;

    void drop() {
        const uint16_t oldest = levels_[head_];
        --counts_[oldest];
        if (oldest < median_) --below_;
        head_ = (uint16_t)((head_ + 1u) % kSlots);
        --size_;
    }

    // Moves the median to the lower middle level of the samples in the window.
    void balance() {
        const unsigned target = (size_ - 1u) / 2u;
        while (below_ > target) {
            --median_;
            below_ = (uint16_t)(below_ - counts_[median_]);
        }
        while ((unsigned)below_ + counts_[median_] <= target) {
            below_ = (uint16_t)(below_ + counts_[median_]);
            ++median_;
        }
    }

    uint8_t counts_[1024];
    uint16_t levels_[kSlots];
    uint16_t times_[kSlots];
    uint16_t size_, head_, below_;
    uint16_t median_;
    bool hasLast_, filled_;
    uint32_t lastMs_ = 0;
};

}  // namespace rhusb
#endif
