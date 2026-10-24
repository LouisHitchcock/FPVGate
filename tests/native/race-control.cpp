#include "c5racecontrol.h"
#include <cassert>
#include <iostream>

uint64_t g_nowUs = 1000000;
bool failSave = false;
int writes = 0;
RaceHistory::RaceHistory() : storage(nullptr), rssiRecorder(nullptr) {}
const std::vector<RaceSession>& RaceHistory::getRaces() { return races; }
uint32_t RaceHistory::latestTimestamp() const {
    uint32_t latest = 0;
    for (const auto& race : races) if (race.timestamp > latest) latest = race.timestamp;
    return latest;
}
bool RaceHistory::saveRace(const RaceSession& race) {
    ++writes;
    if (failSave) return false;
    races.insert(races.begin(), race);
    return true;
}

struct Fixture {
    Config config;
    C5Link link;
    C5MultiPilot detector;
    LapTimer timer;
    RaceHistory history;
    C5RaceControl control;
    Fixture(uint8_t maxLaps = 0, uint8_t heat = 0, uint8_t mask = 3) {
        failSave = false;
        writes = 0;
        config.maxLaps = maxLaps;
        config.heat = heat;
        config.raceMask = mask;
        detector.begin(&config, &link);
        control.begin(&config, &timer, &detector, &history);
    }
    void start() {
        assert(control.requestStart(1792840000));
        control.update();
        assert(control.status().running);
        assert(!control.requestStart());
    }
    void pass(uint8_t slot, uint32_t afterMs = 10000) {
        g_nowUs += (uint64_t)afterMs * 1000;
        assert(detector.requestManualLap(slot));
        detector.update(millis());
        control.update();
    }
    void rfPass(uint8_t slot, uint32_t afterMs) {
        g_nowUs += (uint64_t)afterMs * 1000;
        for (int i = 0; i < 360; ++i) {
            g_nowUs += 1000;
            link.samples[slot].push_back({(uint16_t)(i < 20 ? 1023 : 0), micros()});
            detector.update(millis());
        }
        control.update();
    }
};

int main() {
    {
        Fixture f(2);
        f.start();
        f.pass(0, 1000); // Gate 1
        f.pass(1, 1000);
        assert(!f.detector.allFinished());
        f.pass(0);
        f.pass(0);
        assert(f.control.status().running); // slower pilot still racing
        uint32_t laps[64];
        assert(f.detector.copyLaps(0, laps, 64) == 3);
        assert(!f.detector.requestManualLap(0)); // already finished
        assert(f.detector.copyLaps(0, laps, 64) == 3);
        f.pass(1);
        f.pass(1);
        const auto s = f.control.status();
        assert(!s.running && !s.busy && s.savedTimestamp && !s.saveFailed);
        assert(std::string(s.reason) == "maxLaps");
        assert(f.timer.stops == 1 && writes == 1);
        const auto& saved = f.history.getRaces().front();
        assert(saved.pilots.size() == 2 && saved.pilots[0].lapTimes.size() == 3);
        assert(saved.pilots[1].lapTimes.size() == 3);
        assert(saved.lapTimes == saved.pilots[0].lapTimes);
        assert(saved.fastestLap == 10000 && saved.medianLap == 10500);
        assert(saved.trackId == 42 && saved.totalDistance == 200);
        f.control.requestStop(); f.control.update();
        f.control.update();
        assert(writes == 1 && f.timer.stops == 1);
    }
    {
        Fixture f(1, 0, 1);
        f.start();
        f.pass(0, 1000);
        assert(f.control.status().running);
        f.pass(0);
        assert(!f.control.status().running && writes == 1);
    }
    {
        Fixture f(0, 1);
        f.start();
        f.pass(0, 1000);
        f.config.heat = 0; // changing settings doesn't extend this heat
        g_nowUs = (uint64_t)(f.timer.startMs + 29999) * 1000;
        f.control.update(); assert(f.control.status().running);
        g_nowUs += 1000;
        f.control.update();
        assert(!f.control.status().running && writes == 1);
        assert(std::string(f.control.status().reason) == "heatTime");
        assert(f.history.getRaces().front().pilots[1].lapTimes.empty());
    }
    {
        Fixture f;
        f.start();
        f.pass(0);
        f.config.names[0] = "Changed";
        g_nowUs += 3600000000ULL;
        f.control.update(); assert(f.control.status().running); // unlimited
        failSave = true;
        f.control.requestStop(); f.control.update();
        assert(f.control.status().saveFailed && !f.control.status().savedTimestamp);
        assert(!f.control.requestStart()); // protect unsaved race
        assert(!f.control.requestClear());
        failSave = false;
        f.control.requestStop(); f.control.update();
        assert(!f.control.status().saveFailed && writes == 2 && f.timer.stops == 1);
        assert(f.history.getRaces().front().pilots[0].name == "Ann");
        const auto previous = f.control.status().savedTimestamp;
        f.start();
        assert(f.control.status().timestamp > previous); // same supplied second
        f.control.requestStop(); f.control.update();
        assert(f.control.requestClear()); f.control.update();
        assert(f.detector.racerMask() == 0 && f.control.status().timestamp == 0);
    }
    {
        Fixture f;
        f.start();
        f.control.requestStop(); f.control.update();
        assert(writes == 0 && !f.control.status().savedTimestamp); // no passes
    }
    {
        Fixture f;
        assert(f.control.requestStart());
        f.control.requestStop(); // stop while start is still queued
        f.control.update();
        assert(!f.control.status().running && f.timer.starts == 1 && f.timer.stops == 1);
    }
    {
        Fixture f(64);
        assert(!f.control.requestStart()); // cannot silently truncate target laps
        f.config.maxLaps = 0; f.config.raceMask = 0;
        assert(!f.control.requestStart());
    }
    {
        Fixture f(1, 0, 255);
        for (uint8_t slot = 0; slot < 8; ++slot) f.config.frequencies[slot] = 5658 + slot * 20;
        f.start();
        for (uint8_t slot = 0; slot < 8; ++slot) f.pass(slot, 1000);
        f.config.maxLaps = 50; // this race retains its starting limit
        for (uint8_t slot = 0; slot < 7; ++slot) {
            f.pass(slot);
            assert(f.control.status().running);
        }
        f.pass(7);
        assert(!f.control.status().running && writes == 1);
        assert(f.history.getRaces().front().pilots.size() == 8);
    }
    {
        Fixture f(1);
        f.config.frequencies[2] = 5732; // observer, not a racer
        f.start();
        f.rfPass(0, 1000);
        uint32_t laps[64];
        assert(f.detector.copyLaps(0, laps, 64) == 1);
        f.rfPass(0, 500); // rejected by minimum lap
        assert(f.detector.copyLaps(0, laps, 64) == 1);
        f.config.minLap = 5000; // frozen at the starting 2000 ms
        f.rfPass(0, 3000);
        assert(f.detector.copyLaps(0, laps, 64) == 2);
        f.rfPass(0, 3000); // finished racers cannot gain extra RF laps either
        assert(f.detector.copyLaps(0, laps, 64) == 2);
        f.rfPass(2, 3000);
        assert(f.control.status().running); // observer never completes roster
        f.rfPass(1, 3000);
        f.rfPass(1, 3000);
        assert(!f.control.status().running && writes == 1);
        assert(f.history.getRaces().front().pilots.size() == 2);
    }
    {
        g_nowUs = ((uint64_t)UINT32_MAX - 15000) * 1000;
        Fixture f(0, 1);
        f.start();
        f.pass(0, 1000);
        g_nowUs += 29000000;
        f.control.update();
        assert(!f.control.status().running && writes == 1); // millis rollover
        g_nowUs = 1000000;
    }
    std::cout << "PASS: C5 gate completion, heat limits, history, retries and idempotency\n";
}
