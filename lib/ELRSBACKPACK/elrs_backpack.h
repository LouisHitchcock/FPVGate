#pragma once

#include <Arduino.h>
#include <atomic>
#include "elrs_backpack_core.h"

class AsyncWebServer;
class Config;
class LapTimer;
class C5RaceControl;

// Link to an ELRS transmitter's backpack over ESP-NOW, for starting and
// stopping a race from a switch on the radio. Off by default; when on, the
// hotspot moves to Wi-Fi channel 1 and the station MAC becomes the binding
// phrase UID, as every backpack on that binding does.
class ElrsBackpack {
public:
    void begin(Config*, LapTimer*, C5RaceControl*);
    bool enabled() const { return settings_.enabled && settings_.hasUid; }
    // Wi-Fi hooks, called by the web server around its mode changes.
    void afterModeSet();
    void afterApStarted();
    void stop();
    // Main loop: applies switch commands to the race, the same way the
    // Start and Stop buttons do.
    void service(uint32_t now);
    void registerRoutes(AsyncWebServer&);

private:
    struct Settings {
        uint8_t version = 1, enabled = 0, raceControl = 1, invert = 0, hasUid = 0;
        uint8_t uid[6] = {};
    } settings_;
    Config* config_ = nullptr;
    LapTimer* timer_ = nullptr;
    C5RaceControl* race_ = nullptr;
    ElrsBackpackCore::SwitchControl switch_;
    bool macOk_ = false, ready_ = false, startPending_ = false;
    uint32_t seenSeq_ = 0;
    std::atomic<uint32_t> rebootAt_{0};
    const char* lastCommand_ = "";
    const char* lastResult_ = "";
    uint32_t lastCommandAt_ = 0;
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
    bool racing();
    void result(const char* command, const char* outcome);
};

extern ElrsBackpack elrsBackpack;
