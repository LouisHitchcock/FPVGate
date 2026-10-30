#pragma once

#include "c5multipilot.h"
#include "laptimer.h"
#include "racehistory.h"
#include "c5raceevents.h"

// HTTP/LCD callers only queue commands. loop() owns timer transitions and
// storage, while the high priority C5 task continues servicing the receiver.
class C5RaceControl {
public:
    struct PilotIdentity {
        char name[21] = {}, phonetic[21] = {};
        uint32_t color = 0;
        uint16_t frequency = 0;
    };
    struct Status {
        bool running = false;
        bool busy = false;
        bool saveFailed = false;
        bool eventManaged = false;
        bool eventFailed = false;
        uint32_t timestamp = 0;
        uint32_t savedTimestamp = 0;
        const char* reason = "";
        const char* error = "";
        PilotIdentity roster[8];
    };
    void begin(Config* config, LapTimer* timer, C5MultiPilot* detector, RaceHistory* history);
    void setEvents(C5RaceEvents* events) { events_ = events; }
    bool requestStart(uint32_t timestamp = 0);
    bool requestStartAfterCountdown(uint32_t timestamp = 0);
    bool completeCountdownStart();
    bool consumeCountdownRequest();
    bool requestStop(); // also retries a failed save, without stopping twice
    bool requestClear();
    void update();
    Status status();
    const char* takeStateEvent();

private:
    Config* config_ = nullptr;
    LapTimer* timer_ = nullptr;
    C5MultiPilot* detector_ = nullptr;
    RaceHistory* history_ = nullptr;
    C5RaceEvents* events_ = nullptr;
    bool historySaved_ = false;
    enum class Command { None, Start, Stop, Clear };
    Command command_ = Command::None;
    uint32_t requestedTimestamp_ = 0;
    bool stopAfterStart_ = false;
    bool countdownRequested_ = false;
    bool countdownActive_ = false;
    uint32_t countdownUntilMs_ = 0;
    uint32_t lastTimestamp_ = 0;
    uint32_t heatMs_ = 0;
    float trackLength_ = 0;
    Status status_;
    RaceSession race_ = {};
    const char* event_ = nullptr;
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
    void start(uint32_t timestamp);
    void finish(const char* reason);
    void save();
};
