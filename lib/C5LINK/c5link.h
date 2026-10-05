#pragma once

#include <Arduino.h>
#include "config.h"

// UART contract shared with the ESP32-C5 RF node. Lines are payload*XOR\n,
// where XOR is the upper-case two-digit XOR of the payload bytes.
//
// C5 firmware 2 adds scan mode: the S3 sends P,<MHz>,... (one entry per slot,
// 0 = off) and the C5 cycles through the slots itself, sending one binary
// record per cycle (FPVGateC5RX multipilot/src/node_core.h):
//   0xA5, len, payload[len], crc8(len, payload)
//   payload: 'M', seq u8, t0 u32, slot mask u8, then per slot in the mask:
//   value u16 (bits 0-9 rssi, bit 15 failed), dt u16 (us after t0)
// Older C5 firmware gets the F/OK slot cycle below.
class C5Link {
public:
    static constexpr uint8_t C5_MAX_PILOTS = 8;
    static constexpr uint32_t BAUD = 921600;
    // Keep enough time for the C5's F/G -> TUNING -> OK handshake and several
    // RSSI samples before advancing to the next pilot. The microsecond sample
    // timestamps improve crossing accuracy independently of slot duration.
    static constexpr uint32_t SLOT_MS = 16;
    static constexpr uint32_t ONLINE_TIMEOUT_MS = 2500;  // the C5 sends status at least every second
    // UART reads can arrive in bursts while the main loop is servicing other
    // peripherals. Keep enough history to absorb a full short burst without
    // overwriting samples before C5MultiPilot drains them.
    // Scan mode delivers ~1 kHz per pilot, so this is ~128 ms of history.
    static constexpr uint8_t SAMPLE_QUEUE_DEPTH = 128;
    // A 2 kHz-per-pilot stream of 42-byte records is ~45 KB/s; 4 KB rides
    // out ~90 ms of main-loop stall.
    static constexpr size_t RX_BUFFER_BYTES = 4096;
    static constexpr uint32_t SLOT_RESEND_MS = 250;

    void begin(Config *config, HardwareSerial *port, int8_t rxPin, int8_t txPin);
    void poll(uint32_t nowMs);
    // A valid line from the C5 within the last ONLINE_TIMEOUT_MS. Signed
    // difference: the web task (other core) passes a "now" taken a moment
    // before poll() may have stamped a newer line.
    bool online(uint32_t nowMs) const {
        return heardAny_ && (int32_t)(nowMs - lastLineMs_) < (int32_t)ONLINE_TIMEOUT_MS;
    }
    bool online() const { return online_; }
    uint8_t enabledCount() const;
    bool tuningReady() const { return tuningReady_; }
    uint16_t requestedFrequency() const { return requestedFrequency_; }
    uint8_t reportedGain() const { return reportedGain_; }
    bool started() const { return port_ != nullptr; }
    uint8_t currentPilot() const { return activePilot_; }
    uint16_t rssi(uint8_t pilot) const { return pilot < C5_MAX_PILOTS ? rssi_[pilot] : 0; }
    bool takeSample(uint8_t pilot, uint16_t &value, uint32_t &timestampUs);
    uint32_t sampleSequenceGaps() const { return sampleSequenceGaps_; }
    uint32_t sampleQueueDrops() const { return sampleQueueDrops_; }
    uint32_t acceptedSamples() const { return acceptedSamples_; }
    uint32_t tuneToTuningUs() const { return tuneToTuningUs_; }
    uint32_t tuningToReadyUs() const { return tuningToReadyUs_; }
    uint32_t readyToFirstSampleUs() const { return readyToFirstSampleUs_; }
    uint32_t tuneToFirstSampleUs() const { return tuneToFirstSampleUs_; }
    const char *state() const { return state_; }
    uint16_t tunedFrequency() const { return reportedFrequency_; }
    // The C5 cycles through the slots itself (firmware 2 and up).
    bool scanMode() const { return scanMode_; }
    uint32_t scanRecords() const { return scanRecords_; }
    uint32_t badRecords() const { return badRecords_; }
    // Longest time between poll() calls and most bytes read by one poll()
    // since the last call to these (telemetry; read from the web task).
    uint32_t takePollGapMaxUs() { uint32_t v = pollGapMaxUs_; pollGapMaxUs_ = 0; return v; }
    uint32_t takePollBytesMax() { uint32_t v = pollBytesMax_; pollBytesMax_ = 0; return v; }

private:
    Config *config_ = nullptr;
    HardwareSerial *port_ = nullptr;
    uint32_t lastSlotMs_ = 0;
    uint32_t lastStatusMs_ = 0;
    struct Sample {
        uint16_t value;
        uint32_t timestampUs;
    };
    Sample sampleQueue_[C5_MAX_PILOTS][SAMPLE_QUEUE_DEPTH] = {};
    uint8_t sampleHead_[C5_MAX_PILOTS] = {};
    uint8_t sampleTail_[C5_MAX_PILOTS] = {};
    uint16_t rssi_[C5_MAX_PILOTS] = {};
    uint8_t lastSampleSeq_ = 0;
    bool sampleSeqValid_ = false;
    uint32_t sampleSequenceGaps_ = 0;
    uint32_t sampleQueueDrops_ = 0;
    uint32_t acceptedSamples_ = 0;
    uint32_t tuneSentUs_ = 0;
    uint32_t tuningReceivedUs_ = 0;
    uint32_t readyReceivedUs_ = 0;
    bool firstSampleRecorded_ = false;
    uint32_t tuneToTuningUs_ = 0;
    uint32_t tuningToReadyUs_ = 0;
    uint32_t readyToFirstSampleUs_ = 0;
    uint32_t tuneToFirstSampleUs_ = 0;
    uint8_t activePilot_ = 0;
    volatile uint32_t lastLineMs_ = 0;   // read by the web task on the other core
    volatile bool heardAny_ = false;
    uint16_t requestedFrequency_ = 0;
    uint16_t reportedFrequency_ = 0;
    bool tuningReady_ = false;
    bool gainDirty_ = true;
    uint8_t gain_ = 40;          // last gain sent
    uint8_t reportedGain_ = 0;   // gain in the C5's last status
    bool online_ = false;
    char state_[12] = "OFFLINE";
    char line_[96] = {};
    uint8_t lineLen_ = 0;

    // Scan mode.
    static constexpr uint8_t RECORD_SYNC = 0xA5;
    static constexpr uint8_t RECORD_MAX = 7 + 4 * C5_MAX_PILOTS;
    bool scanMode_ = false;
    uint16_t sentSlots_[C5_MAX_PILOTS] = {};
    bool slotsSent_ = false;
    bool awaitingScanAck_ = false;   // P sent, its SCAN status not seen yet
    uint32_t lastSlotsMs_ = 0;
    uint8_t recState_ = 0;           // 0 none, 1 length next, 2 payload + crc
    uint8_t recLen_ = 0;
    uint8_t recPos_ = 0;
    uint8_t rec_[RECORD_MAX + 1] = {};
    uint8_t lastCycleSeq_ = 0;
    bool cycleSeqValid_ = false;
    uint32_t scanRecords_ = 0;
    uint32_t badRecords_ = 0;
    // C5 clock -> micros(): the smallest (arrival - C5 time) seen, creeping
    // up 1 us every 16 records so it follows crystal drift either way.
    uint32_t clockOffset_ = 0;
    bool clockValid_ = false;
    uint8_t clockLeak_ = 0;
    uint8_t clockLateRun_ = 0;
    uint32_t lastPollUs_ = 0;
    volatile uint32_t pollGapMaxUs_ = 0;
    volatile uint32_t pollBytesMax_ = 0;

    void sendPayload(const char *payload);
    void sendTune(uint8_t pilot);
    void tuneNext();
    void parseLine(char *line, uint32_t nowMs);
    void sendSlots(uint32_t nowMs);
    bool slotsChanged() const;
    void handleRecord(uint32_t nowMs);
};
