#pragma once

// Host-testable parts of the ELRS backpack race control: the MSPv2 frame
// parser and the switch-to-command logic. No Arduino or ESP-IDF here.
#include <stdint.h>
#include <stddef.h>

namespace ElrsBackpackCore {

// MSP_ELRS_BACKPACK_SET_RECORDING_STATE. An ELRS transmitter sends it to its
// backpack when the DVR Rec switch changes, and the backpack forwards it over
// ESP-NOW. Payload: state (1 = recording), then the DVR delay as uint16 LE.
constexpr uint16_t SET_RECORDING_STATE = 0x0305;

inline uint8_t crc(uint8_t value, uint8_t byte) {
    value ^= byte;
    for (unsigned i = 0; i < 8; ++i)
        value = value & 0x80 ? uint8_t((value << 1) ^ 0xD5) : uint8_t(value << 1);
    return value;
}

// One ESP-NOW frame carries one MSPv2 frame: $X, direction, flag, function
// and size (both uint16 LE), payload, CRC8 DVB-S2 over flag..payload.
// Returns the recording state (0 or 1), or -1 if the frame is anything else.
inline int recordingState(const uint8_t* data, size_t length) {
    if (!data || length < 9 || data[0] != '$' || data[1] != 'X') return -1;
    if (data[2] != '<' && data[2] != '>') return -1;
    const uint16_t function = uint16_t(data[4] | data[5] << 8);
    const uint16_t size = uint16_t(data[6] | data[7] << 8);
    if (function != SET_RECORDING_STATE || size < 1 || length < size_t(size) + 9) return -1;
    uint8_t checksum = 0;
    for (size_t i = 3; i < size_t(size) + 8; ++i) checksum = crc(checksum, data[i]);
    if (checksum != data[size + 8]) return -1;
    return data[8] ? 1 : 0;
}

enum class Command : uint8_t { None, Start, Stop };

// Turns switch states into race commands. The transmitter only sends on a
// change, so each new position is one command. A position is acted on once
// it has held for the debounce time, so a bouncing or brushed switch gives
// at most one command, and a repeat of the position already acted on (for
// example after the radio restarts) gives none.
class SwitchControl {
public:
    explicit SwitchControl(uint32_t debounceMs = 300) : debounceMs_(debounceMs) {}

    void received(bool on, uint32_t now) {
        pending_ = on;
        pendingAt_ = now;
        hasPending_ = true;
    }

    Command poll(uint32_t now, bool invert) {
        if (!hasPending_ || now - pendingAt_ < debounceMs_) return Command::None;
        hasPending_ = false;
        if (known_ && pending_ == applied_) return Command::None;
        known_ = true;
        applied_ = pending_;
        return applied_ != invert ? Command::Start : Command::Stop;
    }

private:
    uint32_t debounceMs_;
    uint32_t pendingAt_ = 0;
    bool pending_ = false, hasPending_ = false;
    bool applied_ = false, known_ = false;
};

struct RaceState {
    bool c5 = false;          // gate-managed races; other receivers need a browser to save
    bool running = false;
    bool busy = false;        // a start, stop or history save is in progress
    bool saveFailed = false;  // Stop retries the save
};

// Whether a switch command goes to the race. Start only when nothing is
// running; Stop only while there is a race (or a failed save) to stop.
// Anything else is refused with a reason for the status display.
inline Command decide(Command command, const RaceState& race, const char** reason) {
    *reason = "";
    if (command == Command::None) return Command::None;
    if (!race.c5) { *reason = "needsC5"; return Command::None; }
    if (command == Command::Start) {
        if (race.running || race.busy) { *reason = "running"; return Command::None; }
        return Command::Start;
    }
    if (!race.running && !race.busy && !race.saveFailed) { *reason = "notRunning"; return Command::None; }
    return Command::Stop;
}

} // namespace ElrsBackpackCore
