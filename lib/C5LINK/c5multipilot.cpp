#include "c5multipilot.h"

void C5MultiPilot::begin(Config *config, C5Link *link) {
    config_ = config;
    link_ = link;
    pendingCount_ = 0;
}

void C5MultiPilot::start(uint32_t raceStartMs) {
    uint8_t mask = 0;
    for (uint8_t i = 0; i < 8; ++i)
        if (config_->getC5Frequency(i) && ((config_->getC5RaceMask() >> i) & 1)) mask |= 1u << i;
    racerMask_ = mask;
    racerCount_ = __builtin_popcount(mask);
    // The race clock is millis(); samples are stamped in micros().
    raceStartUs_ = micros() - (millis() - raceStartMs) * 1000u;
    portENTER_CRITICAL(&lapMux_);
    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) {
        inside_[i] = false;
        belowUs_[i] = 0;
        peak_[i] = 0;
        lapCount_[i] = 0;
        capturePeak_[i] = 0;
    }
    crossingCount_ = 0;
    pendingCount_ = 0;
    portEXIT_CRITICAL(&lapMux_);
    running_ = true;
}

void C5MultiPilot::stop() { running_ = false; }

// A pass is Enter -> Exit (with hysteresis), ending once the RSSI has stayed
// below Exit for PASS_MERGE_MS; it is timed at its highest filtered sample,
// as RotorHazard and LapTimer do. Each sample carries the C5's dump time
// mapped to micros(), so the peak time is exact to the sample (~1 ms per
// pilot in scan mode).
void C5MultiPilot::update(uint32_t nowMs) {
    (void)nowMs;
    if (!config_ || !link_) return;
    // The race roster is frozen by start(), including after stop for history.

    portENTER_CRITICAL(&lapMux_);
    uint8_t manual = manualMask_;
    manualMask_ = 0;
    portEXIT_CRITICAL(&lapMux_);
    if (manual && running_) {
        const uint32_t nowUs = micros();
        for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i)
            if ((manual >> i) & 1) crossing(i, nowUs, true);
    }

    for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) {
        if (!config_->getC5Frequency(i)) {   // slot switched off
            filtered_[i] = 0;
            inside_[i] = false;
            belowUs_[i] = 0;
            continue;
        }
        const uint16_t enterHi = (uint16_t)config_->getC5EnterRssi(i) * 4u;
        const uint16_t exitHi = (uint16_t)config_->getC5ExitRssi(i) * 4u;
        uint16_t value = 0;
        uint32_t sampleUs = 0;
        while (link_->takeSample(i, value, sampleUs)) {
            filtered_[i] = (uint16_t)(((uint32_t)filtered_[i] * 3 + value) / 4);
            if (filtered_[i] > peakHold_[i]) peakHold_[i] = filtered_[i];
            if (filtered_[i] > rhPeak_[i]) rhPeak_[i] = filtered_[i];
            portENTER_CRITICAL(&lapMux_);
            if (filtered_[i] > capturePeak_[i]) capturePeak_[i] = filtered_[i];
            portEXIT_CRITICAL(&lapMux_);
            if (!running_ && !passStream_) continue;
            const uint16_t f = filtered_[i];
            if (!inside_[i]) {
                if (f >= enterHi) {
                    inside_[i] = true;
                    peak_[i] = f;
                    peakUs_[i] = sampleUs;
                    belowUs_[i] = 0;
                }
                continue;
            }
            if (f > peak_[i]) {
                peak_[i] = f;
                peakUs_[i] = sampleUs;
            }
            if (belowUs_[i]) {
                if (f >= enterHi) belowUs_[i] = 0;   // back above Enter: the same pass
                else if (sampleUs - belowUs_[i] >= PASS_MERGE_MS * 1000u) endPass(i);
                continue;
            }
            if (f <= exitHi) belowUs_[i] = sampleUs | 1u;   // never 0, which means "above Exit"
        }
        // Samples stopped (slot retuned, link dropped): finish a pass that was waiting to end.
        if (inside_[i] && belowUs_[i] && micros() - belowUs_[i] >= PASS_MERGE_MS * 1000u) endPass(i);
    }
}

// The pass is over: report it, timed at its peak.
void C5MultiPilot::endPass(uint8_t pilot) {
    inside_[pilot] = false;
    belowUs_[pilot] = 0;
    if (passStream_) {
        portENTER_CRITICAL(&lapMux_);
        if (passCount_ < PASS_QUEUE) passes_[passCount_++] = {pilot, peakUs_[pilot], peak_[pilot]};
        portEXIT_CRITICAL(&lapMux_);
    }
    if (running_) crossing(pilot, peakUs_[pilot]);
}

// LapTimer's rules for every slot: the first pass after the start is Gate 1
// (timed from the start), then pass to pass, ignoring passes inside the
// minimum lap time (except a manual lap: the race director meant it).
void C5MultiPilot::crossing(uint8_t pilot, uint32_t crossingUs, bool manual) {
    const bool racer = (racerMask_ >> pilot) & 1;
    if (racer && racerCount_ == 1) {
        portENTER_CRITICAL(&lapMux_);
        if (crossingCount_ < CROSSING_QUEUE) crossings_[crossingCount_++] = crossingUs;
        portEXIT_CRITICAL(&lapMux_);
    }
    if ((int32_t)(crossingUs - raceStartUs_) <= 0) return;   // from before the start
    const uint8_t n = lapCount_[pilot];
    uint32_t lapUs;
    if (n == 0) {
        lapUs = crossingUs - raceStartUs_;
    } else {
        lapUs = crossingUs - lastCrossingUs_[pilot];
        if (!manual && lapUs <= config_->getMinLapMs() * 1000u) return;
    }
    lastCrossingUs_[pilot] = crossingUs;
    const C5LapEvent lap = {pilot, n, (lapUs + 500u) / 1000u, racer};
    portENTER_CRITICAL(&lapMux_);
    if (n < MAX_RACE_LAPS) {
        laps_[pilot][n] = lap.lapTimeMs;
        lapCount_[pilot] = n + 1;
    }
    if (pendingCount_ < LAP_QUEUE) pending_[pendingCount_++] = lap;
    portEXIT_CRITICAL(&lapMux_);
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

bool C5MultiPilot::takePass(C5Pass &pass) {
    bool got = false;
    portENTER_CRITICAL(&lapMux_);
    if (passCount_) {
        pass = passes_[0];
        for (uint8_t i = 1; i < passCount_; ++i) passes_[i - 1] = passes_[i];
        --passCount_;
        got = true;
    }
    portEXIT_CRITICAL(&lapMux_);
    return got;
}

// Read and restart from the current value. A sample landing between the
// two lines is at worst missed from this frame's peak, never stuck in it.
uint16_t C5MultiPilot::takePeakHold(uint8_t pilot) {
    if (pilot >= C5Link::C5_MAX_PILOTS) return 0;
    const uint16_t v = peakHold_[pilot];
    peakHold_[pilot] = filtered_[pilot];
    return v;
}

uint16_t C5MultiPilot::takeRhPeak(uint8_t pilot) {
    if (pilot >= C5Link::C5_MAX_PILOTS) return 0;
    const uint16_t v = rhPeak_[pilot];
    rhPeak_[pilot] = filtered_[pilot];
    return v;
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

void C5MultiPilot::takeCaptureFrame(uint8_t* values) {
    portENTER_CRITICAL(&lapMux_);
    for (uint8_t i = 0; i < 8; ++i) {
        values[i] = capturePeak_[i] / 4;
        capturePeak_[i] = 0;
    }
    portEXIT_CRITICAL(&lapMux_);
}

uint8_t C5MultiPilot::copyLaps(uint8_t pilot, uint32_t *out, uint8_t max) {
    if (pilot >= C5Link::C5_MAX_PILOTS) return 0;
    portENTER_CRITICAL(&lapMux_);
    uint8_t n = lapCount_[pilot] < max ? lapCount_[pilot] : max;
    memcpy(out, laps_[pilot], n * sizeof(uint32_t));
    portEXIT_CRITICAL(&lapMux_);
    return n;
}

bool C5MultiPilot::requestManualLap(uint8_t pilot) {
    if (pilot >= C5Link::C5_MAX_PILOTS || !running_ || !((racerMask_ >> pilot) & 1)) return false;
    portENTER_CRITICAL(&lapMux_);
    manualMask_ |= (uint8_t)(1u << pilot);
    portEXIT_CRITICAL(&lapMux_);
    return true;
}
