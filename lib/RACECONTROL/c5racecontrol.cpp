#include "c5racecontrol.h"
#include "trackmanager.h"
#include <algorithm>
#include <time.h>
#include <cstdio>

void C5RaceControl::begin(Config* config, LapTimer* timer, C5MultiPilot* detector, RaceHistory* history) {
    config_ = config;
    timer_ = timer;
    detector_ = detector;
    history_ = history;
}

C5RaceControl::Status C5RaceControl::status() {
    portENTER_CRITICAL(&mux_);
    Status result = status_;
    result.eventManaged = events_ != nullptr;
    portEXIT_CRITICAL(&mux_);
    return result;
}

bool C5RaceControl::requestStart(uint32_t timestamp) {
    if (!config_ || config_->getReceiverRadio() != 2) return false;
    // Every configured lap must fit, including Gate 1.
    const bool eventStart = events_ && config_->getEventMode();
    if (!eventStart && config_->getMaxLaps() >= C5MultiPilot::MAX_RACE_LAPS) return false;
    bool racer = false;
    for (uint8_t i = 0; i < 8; ++i)
        racer |= config_->getC5Frequency(i) && ((config_->getC5RaceMask() >> i) & 1);
    if (!eventStart && !racer) return false;
    portENTER_CRITICAL(&mux_);
    const bool accepted = !status_.running && !status_.busy && !status_.saveFailed;
    if (accepted) {
        status_ = {};
        status_.busy = true;
        command_ = Command::Start;
        requestedTimestamp_ = timestamp;
    }
    portEXIT_CRITICAL(&mux_);
    return accepted;
}

bool C5RaceControl::requestStop() {
    portENTER_CRITICAL(&mux_);
    // A repeated stop is harmless, including while the first is being saved.
    if (!status_.busy && (status_.running || status_.saveFailed)) {
        status_.busy = true;
        command_ = Command::Stop;
    } else if (status_.busy && !status_.running && !status_.timestamp) {
        stopAfterStart_ = true;
    }
    portEXIT_CRITICAL(&mux_);
    return true;
}

bool C5RaceControl::requestClear() {
    portENTER_CRITICAL(&mux_);
    const bool accepted = !status_.running && !status_.busy && !status_.saveFailed;
    if (accepted) {
        status_.busy = true;
        command_ = Command::Clear;
    }
    portEXIT_CRITICAL(&mux_);
    return accepted;
}

void C5RaceControl::update() {
    Command command;
    uint32_t timestamp;
    portENTER_CRITICAL(&mux_);
    command = command_;
    timestamp = requestedTimestamp_;
    command_ = Command::None;
    portEXIT_CRITICAL(&mux_);
    if (command == Command::Clear) {
        detector_->clear();
        race_ = {};
        portENTER_CRITICAL(&mux_);
        status_ = {};
        portEXIT_CRITICAL(&mux_);
        event_ = "cleared";
    } else if (command == Command::Start) start(timestamp);
    else if (command == Command::Stop) {
        if (status().running) finish("manual");
        else save();
    }
    portENTER_CRITICAL(&mux_);
    const bool stopAfterStart = stopAfterStart_;
    stopAfterStart_ = false;
    portEXIT_CRITICAL(&mux_);
    if (stopAfterStart && status().running) finish("manual");
    if (status().running) {
        if (detector_->allFinished()) finish("maxLaps");
        else if (heatMs_ && millis() - timer_->getRaceStartMs() >= heatMs_) finish("heatTime");
    }
}

void C5RaceControl::start(uint32_t timestamp) {
    race_ = {};
    // Preserve chronological, collision-free IDs even without an RTC/browser.
    lastTimestamp_ = std::max(lastTimestamp_, history_->latestTimestamp());
    const time_t wall = time(nullptr);
    if (!timestamp) timestamp = wall > 0 ? (uint32_t)wall : millis() / 1000u;
    race_.timestamp = lastTimestamp_ = std::max(timestamp, lastTimestamp_ + 1);
    historySaved_ = false;
    // Bind identities and rules to the loaded heat before starting the timer.
    if (events_ && !events_->prepare(race_)) {
        portENTER_CRITICAL(&mux_);
        status_ = {};
        status_.error = events_->error();
        portEXIT_CRITICAL(&mux_);
        event_ = "startFailed";
        return;
    }
    // A loaded Event heat may restore a different roster after reboot. Check
    // the resulting live settings, not just the pre-prepare browser settings.
    bool racer = false;
    for (uint8_t i = 0; i < 8; ++i)
        racer |= config_->getC5Frequency(i) && ((config_->getC5RaceMask() >> i) & 1);
    if (!racer || config_->getMaxLaps() >= C5MultiPilot::MAX_RACE_LAPS) {
        const bool cancelled = !events_ || events_->cancel();
        portENTER_CRITICAL(&mux_);
        status_ = {};
        status_.saveFailed = status_.eventFailed = !cancelled;
        status_.error = cancelled ? "No racing pilots or invalid lap limit" : events_->error();
        portEXIT_CRITICAL(&mux_);
        event_ = "startFailed";
        return;
    }
    race_.minLapMs = config_->getMinLapMs();
    race_.syncMode = 3;
    heatMs_ = (uint32_t)config_->getMaxHeatTime30s() * 30000u;
    Track* track = timer_->getSelectedTrack();
    race_.trackId = track ? track->trackId : 0;
    race_.trackName = track ? track->name : "";
    trackLength_ = track ? track->distance : 0;
    for (uint8_t i = 0; i < 8; ++i) {
        if (!config_->getC5Frequency(i) || !((config_->getC5RaceMask() >> i) & 1)) continue;
        PilotData pilot = {};
        pilot.slot = i;
        pilot.name = config_->getC5PilotName(i);
        if (!pilot.name.length()) pilot.name = String("Pilot ") + String(i + 1);
        pilot.callsign = config_->getC5PilotPhonetic(i);
        pilot.color = config_->getC5PilotColor(i);
        pilot.frequency = config_->getC5Frequency(i);
        pilot.enter = config_->getC5EnterRssi(i);
        pilot.exit = config_->getC5ExitRssi(i);
        race_.pilots.push_back(pilot);
    }
    timer_->start();
    detector_->start(timer_->getRaceStartMs());
    Status started;
    started.running = true;
    started.timestamp = race_.timestamp;
    for (const auto& pilot : race_.pilots) {
        auto& identity = started.roster[pilot.slot];
        std::snprintf(identity.name, sizeof(identity.name), "%s", pilot.name.c_str());
        std::snprintf(identity.phonetic, sizeof(identity.phonetic), "%s", pilot.callsign.c_str());
        identity.color = pilot.color;
        identity.frequency = pilot.frequency;
    }
    portENTER_CRITICAL(&mux_);
    status_ = started;
    portEXIT_CRITICAL(&mux_);
    event_ = "started";
}

void C5RaceControl::finish(const char* reason) {
    portENTER_CRITICAL(&mux_);
    status_.running = false;
    status_.busy = true;
    status_.reason = reason;
    portEXIT_CRITICAL(&mux_);
    // Stop detection before taking the snapshot or doing any storage work.
    detector_->stop();
    uint32_t laps[C5MultiPilot::MAX_RACE_LAPS];
    PilotData* leader = nullptr;
    uint64_t leaderTotal = 0;
    for (auto& pilot : race_.pilots) {
        const uint8_t n = detector_->copyLaps(pilot.slot, laps, C5MultiPilot::MAX_RACE_LAPS);
        pilot.lapTimes.assign(laps, laps + n);
        uint64_t total = 0;
        for (uint8_t k = 0; k < n; ++k) {
            total += laps[k];
            if (k && (!pilot.fastestLap || laps[k] < pilot.fastestLap)) pilot.fastestLap = laps[k];
        }
        if (!leader || n > leader->lapTimes.size() || (n == leader->lapTimes.size() && total < leaderTotal)) {
            leader = &pilot;
            leaderTotal = total;
        }
    }
    if (leader) {
        race_.lapTimes = leader->lapTimes;
        race_.pilotName = leader->name;
        race_.pilotCallsign = leader->callsign;
        race_.frequency = leader->frequency;
        race_.fastestLap = leader->fastestLap;
        std::vector<uint32_t> sorted;
        if (race_.lapTimes.size() > 1) sorted.assign(race_.lapTimes.begin() + 1, race_.lapTimes.end());
        std::sort(sorted.begin(), sorted.end());
        if (!sorted.empty()) {
            const size_t mid = sorted.size() / 2;
            race_.medianLap = sorted.size() % 2 ? sorted[mid] : ((uint64_t)sorted[mid - 1] + sorted[mid]) / 2;
        }
        if (sorted.size() >= 3) race_.best3LapsTotal = sorted[0] + sorted[1] + sorted[2];
        race_.totalDistance = trackLength_ * (race_.lapTimes.empty() ? 0 : race_.lapTimes.size() - 1);
    }
    timer_->stop(); // finalizes the RSSI sidecar before history attaches it
    save();
    event_ = "stopped";
}

void C5RaceControl::save() {
    // An empty race doesn't create history. Failed saves remain available for
    // retry, and block a new start from discarding their laps/RSSI capture.
    const bool hasLaps = !race_.lapTimes.empty();
    const bool historyOk = !hasLaps || historySaved_ || history_->saveRace(race_);
    historySaved_ = historyOk && hasLaps;
    bool eventOk = true;
    if (historyOk && events_) {
        if (hasLaps) eventOk = events_->complete(race_);
        else eventOk = events_->cancel();
    }
    const bool ok = historyOk && eventOk;
    portENTER_CRITICAL(&mux_);
    status_.busy = false;
    status_.saveFailed = !ok;
    status_.eventFailed = !eventOk;
    status_.error = !eventOk ? events_->error() : !historyOk ? "Race history save failed" : "";
    status_.savedTimestamp = historySaved_ ? race_.timestamp : 0;
    portEXIT_CRITICAL(&mux_);
}

const char* C5RaceControl::takeStateEvent() {
    const char* event = event_;
    event_ = nullptr;
    return event;
}
