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
        enteredUs_[i] = nowMs * 1000u;
        lastLapUs_[i] = 0;
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
        uint16_t value = 0;
        uint32_t sampleUs = 0;
        if (!link_->takeSample(i, value, sampleUs)) continue;
        // A small EMA keeps the C5's 1 kHz stream useful after UART slotting.
        filtered_[i] = (uint16_t)(((uint32_t)filtered_[i] * 3 + value) / 4);
        if (!running_) continue;
        const uint8_t enter = config_->getC5EnterRssi(i);
        const uint8_t exit = config_->getC5ExitRssi(i);
        const uint16_t enterHi = (uint16_t)enter * 4u;
        const uint16_t exitHi = (uint16_t)exit * 4u;
        if (!inside_[i] && filtered_[i] >= enterHi) {
            inside_[i] = true;
            enteredUs_[i] = sampleUs;
        } else if (inside_[i] && filtered_[i] <= exitHi) {
            inside_[i] = false;
            uint32_t crossingUs = sampleUs;
            uint32_t lapUs = lastLapUs_[i] ? (crossingUs - lastLapUs_[i]) : (crossingUs - enteredUs_[i]);
            uint32_t lap = (lapUs + 500u) / 1000u;
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
                lastLapUs_[i] = crossingUs;
            } else if (!lastLapUs_[i]) {
                lastLapUs_[i] = crossingUs;
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
