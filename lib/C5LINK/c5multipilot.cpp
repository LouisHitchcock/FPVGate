#include "c5multipilot.h"

void C5MultiPilot::begin(Config *config, C5Link *link) {
    config_ = config;
    link_ = link;
    pendingCount_ = 0;
}

void C5MultiPilot::start(uint32_t nowMs) {
    (void)nowMs;
    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) {
        inside_[i] = false;
        lastLapUs_[i] = 0;
        peak_[i] = 0;
    }
    portENTER_CRITICAL(&lapMux_);
    crossingCount_ = 0;
    portEXIT_CRITICAL(&lapMux_);
    running_ = true;
}

void C5MultiPilot::stop() { running_ = false; }

// A pass is Enter -> Exit (with hysteresis); it is timed at its highest
// filtered sample, as RotorHazard and LapTimer do. Each sample carries the
// C5's dump time mapped to micros(), so the peak time is exact to the
// sample (~1 ms per pilot in scan mode).
void C5MultiPilot::update(uint32_t nowMs) {
    (void)nowMs;
    if (!config_ || !link_) return;
    int8_t race = -1;
    const uint16_t mainFreq = config_->getFrequency();
    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS && race < 0; ++i)
        if (mainFreq && config_->getC5Frequency(i) == mainFreq) race = (int8_t)i;
    racePilot_ = race;

    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) {
        if (!config_->getC5Frequency(i)) {   // slot switched off
            filtered_[i] = 0;
            inside_[i] = false;
            continue;
        }
        const uint16_t enterHi = (uint16_t)config_->getC5EnterRssi(i) * 4u;
        const uint16_t exitHi = (uint16_t)config_->getC5ExitRssi(i) * 4u;
        uint16_t value = 0;
        uint32_t sampleUs = 0;
        while (link_->takeSample(i, value, sampleUs)) {
            filtered_[i] = (uint16_t)(((uint32_t)filtered_[i] * 3 + value) / 4);
            if (!running_) continue;
            const uint16_t f = filtered_[i];
            if (!inside_[i]) {
                if (f >= enterHi) {
                    inside_[i] = true;
                    peak_[i] = f;
                    peakUs_[i] = sampleUs;
                }
                continue;
            }
            if (f > peak_[i]) {
                peak_[i] = f;
                peakUs_[i] = sampleUs;
            }
            if (f > exitHi) continue;
            inside_[i] = false;
            const uint32_t crossingUs = peakUs_[i];
            if (i == race) {
                portENTER_CRITICAL(&lapMux_);
                if (crossingCount_ < CROSSING_QUEUE) crossings_[crossingCount_++] = crossingUs;
                portEXIT_CRITICAL(&lapMux_);
            }
            // Per-pilot laps for the Calibration cards. The first pass is
            // the holeshot: it starts the clock. Passes inside the minimum
            // lap time are ignored.
            if (!lastLapUs_[i]) {
                lastLapUs_[i] = crossingUs;
                continue;
            }
            const uint32_t lap = (crossingUs - lastLapUs_[i] + 500u) / 1000u;
            if (lap < config_->getMinLapMs()) continue;
            lastLapUs_[i] = crossingUs;
            portENTER_CRITICAL(&lapMux_);
            if (pendingCount_ < C5Link::C5_MAX_PILOTS) pending_[pendingCount_++] = {i, lap};
            portEXIT_CRITICAL(&lapMux_);
        }
    }
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

bool C5MultiPilot::takeRaceCrossing(uint32_t &crossingUs) {
    bool got = false;
    portENTER_CRITICAL(&lapMux_);
    if (crossingCount_) {
        crossingUs = crossings_[0];
        for (uint8_t i = 1; i < crossingCount_; ++i) crossings_[i - 1] = crossings_[i];
        --crossingCount_;
        got = true;
    }
    portEXIT_CRITICAL(&lapMux_);
    return got;
}
