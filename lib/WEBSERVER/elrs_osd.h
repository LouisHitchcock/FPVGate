#pragma once

// ELRS Backpack OSD for HDZero goggles.
//
// Sends lap info over ESP-NOW to the goggle's built-in ELRS backpack, the same
// way the ExpressLRS "Timer" backpack / RotorHazard VRxC_ELRS plugin does:
// MSP v2 packets MSP_ELRS_SET_OSD (0x00B6), unicast to the MAC derived from
// the ELRS bind phrase, on Wi-Fi channel 1.
//
// Shown on the goggles:
//   - last lap time
//   - fastest 3 consecutive laps (Gate 1 / holeshot excluded, as in the web UI)
//   - before a race (and after it): receiver status + live RSSI, refreshed
//     every second, so you can check everything works from the goggles
//
// Requirements:
//   - FPVGate in Wi-Fi AP mode (its own hotspot). The AP is moved to channel 1
//     and the STA interface (unused) takes the bind-phrase MAC.
//   - Goggle backpack flashed with the same bind phrase.
//
// Settings live in NVS (namespace "elrsosd"), not in the EEPROM config struct,
// so the main config layout is untouched. Configure at http://<fpvgate>/elrsosd

#include <Arduino.h>
#include <vector>

class AsyncWebServer;

class ElrsOsd {
public:
    enum Layout : uint8_t { LAYOUT_ROWS = 0, LAYOUT_COLUMN = 1 };

    // Load settings from NVS. Call once in setup(), before the web server starts Wi-Fi.
    void begin();

    bool enabled() const { return enabled_ && uidValid_; }
    const char* bindPhrase() const { return phrase_; }

    // Called by the web server around WiFi.softAP():
    //   wifiMode()        -> WIFI_AP_STA when enabled, otherwise WIFI_AP
    //   apChannel()       -> 1 when enabled, otherwise the default
    //   afterModeSet()    -> after WiFi.mode(), before softAP(): sets the STA MAC
    //   afterApStarted()  -> after softAP(): starts ESP-NOW and queues a link test
    int  wifiModeForAp() const;
    uint8_t apChannel(uint8_t defaultChannel) const { return enabled() ? 1 : defaultChannel; }
    void afterModeSet();
    void afterApStarted();
    // Wi-Fi going down or switching to STA mode.
    void stopEspNow();

    // Lap hook. Safe to call from any task: it only queues work for loop().
    void onLap(uint32_t lapTimeMs);

    // Receiver status for the idle screen. Call from loop() every pass:
    //   rxOnline: receiver answering (C5 link up; always true for RX5808)
    //   pilotOk:  a pilot slot is set to race
    //   rssi/enter: race pilot's RSSI and enter threshold, same scale
    //   raceRunning: LapTimer state; race start/stop are taken from its edges
    void setStatus(bool rxOnline, bool pilotOk, uint16_t rssi, uint16_t enter, bool raceRunning);

    // Call from loop(): does all ESP-NOW sending.
    void loop(uint32_t nowMs);

    void registerRoutes(AsyncWebServer& server);

private:
    // settings
    bool enabled_ = false;
    char phrase_[64] = {0};
    uint8_t row_ = 3;
    uint8_t col_ = 1;
    uint8_t layout_ = LAYOUT_ROWS;
    bool clearOnStop_ = false;     // after a race, idle screen without the results
    bool idle_ = true;             // show status + RSSI while no race runs

    uint8_t uid_[6] = {0};
    bool uidValid_ = false;

    // runtime
    bool espnowReady_ = false;
    volatile bool startPending_ = false;
    volatile bool stopPending_ = false;
    volatile bool testPending_ = false;
    static constexpr uint8_t LAP_Q = 8;
    volatile uint32_t lapQ_[LAP_Q] = {0};
    volatile uint8_t lapHead_ = 0, lapTail_ = 0;
    portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;

    bool gate1Pending_ = true;     // next lap event is Gate 1 (holeshot)
    std::vector<uint32_t> laps_;   // laps after Gate 1
    uint32_t lastLapMs_ = 0;
    uint32_t gate1Ms_ = 0;
    uint32_t best3Ms_ = 0;

    uint32_t resendAtMs_ = 0;      // one redundant resend after each update
    uint32_t nextRefreshMs_ = 0;   // periodic refresh (idle: 1 s, race: 3 s)
    bool raceRunning_ = false;
    bool seenRunning_ = false;     // last raceRunning passed to setStatus()
    bool rxOnline_ = false;
    bool pilotOk_ = false;
    uint16_t rssiPeak_ = 0;        // highest RSSI since the last idle refresh
    uint16_t enter_ = 0;
    uint16_t lastRssi_ = 0;
    bool peerAlive_ = false;       // goggles ACKed since the previous refresh
    uint32_t ackOkSeen_ = 0;
    uint8_t linkTestLeft_ = 0;
    uint32_t linkTestAtMs_ = 0;

    void computeUid();
    void save();
    void resetRace();
    void recomputeBest3();
    void render();                 // clear + write rows + display
    void renderLinkTest();
    void renderIdle();
    void updatePeerAlive();
    bool hasResults() const { return gate1Ms_ || !laps_.empty(); }
    void sendOsdText(uint8_t row, uint8_t col, const char* text);
    void sendOsdSub(uint8_t sub);
    void sendMsp(uint16_t function, const uint8_t* payload, uint16_t len);
    static void fmtSeconds(uint32_t ms, char* out, size_t cap);
};

extern ElrsOsd elrsOsd;
