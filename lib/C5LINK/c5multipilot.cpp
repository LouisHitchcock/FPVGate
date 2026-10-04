#include "c5multipilot.h"

void C5MultiPilot::begin(Config *config, C5Link *link) {
    config_ = config;
    link_ = link;
    pendingCount_ = 0;
}

void C5MultiPilot::start(uint32_t nowMs) {
    running_ = true;
    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) {
        inside_[i] = false;
        seen_[i] = false;
        enteredMs_[i] = nowMs;
        lastLapMs_[i] = 0;
    }
}

void C5MultiPilot::stop() { running_ = false; }

void C5MultiPilot::update(uint32_t nowMs) {
    if (!config_ || !link_) return;
    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) {
        if (!config_->getC5Frequency(i)) {   // slot switched off
            filtered_[i] = 0;
            inside_[i] = false;
            continue;
        }
        uint8_t value = 0;
        uint32_t sampleMs = 0;
        if (!link_->takeSample(i, value, sampleMs)) continue;
        // A small EMA keeps the C5's 1 kHz stream useful after UART slotting.
        filtered_[i] = (uint8_t)(((uint16_t)filtered_[i] * 3 + value) / 4);
        if (!running_) continue;
        const uint8_t enter = config_->getC5EnterRssi(i);
        const uint8_t exit = config_->getC5ExitRssi(i);
        if (!inside_[i] && filtered_[i] >= enter) {
            inside_[i] = true;
            enteredMs_[i] = sampleMs;
        } else if (inside_[i] && filtered_[i] <= exit) {
            inside_[i] = false;
            uint32_t crossing = sampleMs;
            uint32_t lap = lastLapMs_[i] ? (crossing - lastLapMs_[i]) : (crossing - enteredMs_[i]);
            bool queued = false;
            if (lap >= config_->getMinLapMs()) {
                portENTER_CRITICAL(&lapMux_);
                if (pendingCount_ < C5Link::C5_MAX_PILOTS) {
                    pending_[pendingCount_++] = {i, lap};
                    queued = true;
                }
                portEXIT_CRITICAL(&lapMux_);
            }
            if (queued) {
                lastLapMs_[i] = crossing;
            } else if (!lastLapMs_[i]) {
                lastLapMs_[i] = crossing;
            }
        }
    }
    (void)nowMs;
}

bool C5MultiPilot::takeLap(C5LapEvent &event) {
    bool got = false;
    portENTER_CRITICAL(&lapMux_);
    if (pendingCount_) {
        event = pending_[0];
        for (uint8_t i = 1; i < pendingCount_; ++i) pending_[i - 1] = pending_[i];
        --pendingCount_;
        got = true;
    }
    portEXIT_CRITICAL(&lapMux_);
    return got;
}
