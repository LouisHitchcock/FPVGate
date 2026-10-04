#pragma once

#include <Arduino.h>
#include "config.h"

// UART contract shared with the ESP32-C5 RF node. Lines are payload*XOR\n,
// where XOR is the upper-case two-digit XOR of the payload bytes.
class C5Link {
public:
    static constexpr uint8_t C5_MAX_PILOTS = 8;
    static constexpr uint32_t BAUD = 921600;
    static constexpr uint32_t SLOT_MS = 20;            // time on each enabled pilot
    static constexpr uint32_t ONLINE_TIMEOUT_MS = 2500;  // the C5 sends status at least every second

    void begin(Config *config, HardwareSerial *port, int8_t rxPin, int8_t txPin);
    void poll(uint32_t nowMs);
    // A valid line from the C5 within the last ONLINE_TIMEOUT_MS.
    bool online(uint32_t nowMs) const { return heardAny_ && (nowMs - lastLineMs_) < ONLINE_TIMEOUT_MS; }
    bool online() const { return online_; }
    uint8_t enabledCount() const;
    bool tuningReady() const { return tuningReady_; }
    uint16_t requestedFrequency() const { return requestedFrequency_; }
    uint8_t reportedGain() const { return reportedGain_; }
    bool started() const { return port_ != nullptr; }
    uint8_t currentPilot() const { return activePilot_; }
    uint8_t rssi(uint8_t pilot) const { return pilot < C5_MAX_PILOTS ? rssi_[pilot] : 0; }
    bool takeSample(uint8_t pilot, uint8_t &value, uint32_t &timestampMs);
    const char *state() const { return state_; }
    uint16_t tunedFrequency() const { return reportedFrequency_; }

private:
    Config *config_ = nullptr;
    HardwareSerial *port_ = nullptr;
    uint32_t lastSlotMs_ = 0;
    uint32_t lastStatusMs_ = 0;
    uint32_t lastSampleMs_[C5_MAX_PILOTS] = {};
    uint8_t rssi_[C5_MAX_PILOTS] = {};
    bool samplePending_[C5_MAX_PILOTS] = {};
    uint8_t activePilot_ = 0;
    uint32_t lastLineMs_ = 0;
    bool heardAny_ = false;
    uint16_t requestedFrequency_ = 0;
    uint16_t reportedFrequency_ = 0;
    bool tuningReady_ = false;
    uint8_t gain_ = 40;          // last gain sent
    uint8_t reportedGain_ = 0;   // gain in the C5's last status
    bool online_ = false;
    char state_[12] = "OFFLINE";
    char line_[96] = {};
    uint8_t lineLen_ = 0;

    void sendPayload(const char *payload);
    void sendTune(uint8_t pilot);
    void tuneNext();
    void parseLine(char *line, uint32_t nowMs);
};
