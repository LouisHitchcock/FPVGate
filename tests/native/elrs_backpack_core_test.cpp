#include "elrs_backpack_core.h"
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace ElrsBackpackCore;

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAIL line %d: %s\n", __LINE__, #cond); ++failures; } } while (0)

// The frame an ELRS backpack forwards: MSPv2, CRC8 DVB-S2 over flag..payload.
static std::vector<uint8_t> frame(uint16_t function, std::vector<uint8_t> payload, char direction = '<') {
    std::vector<uint8_t> out = {'$', 'X', uint8_t(direction), 0, uint8_t(function), uint8_t(function >> 8),
                                uint8_t(payload.size()), uint8_t(payload.size() >> 8)};
    out.insert(out.end(), payload.begin(), payload.end());
    uint8_t checksum = 0;
    for (size_t i = 3; i < out.size(); ++i) checksum = crc(checksum, out[i]);
    out.push_back(checksum);
    return out;
}

static int parse(const std::vector<uint8_t>& f) { return recordingState(f.data(), f.size()); }

static void parser() {
    CHECK(parse(frame(SET_RECORDING_STATE, {1, 0, 0})) == 1);
    CHECK(parse(frame(SET_RECORDING_STATE, {0, 5, 0})) == 0);
    CHECK(parse(frame(SET_RECORDING_STATE, {1, 0, 0}, '>')) == 1);
    CHECK(parse(frame(SET_RECORDING_STATE, {1})) == 1);       // delay bytes are optional to us
    CHECK(parse(frame(SET_RECORDING_STATE, {})) == -1);       // no state
    CHECK(parse(frame(0x00B6, {2})) == -1);                   // MSP_ELRS_SET_OSD
    auto bad = frame(SET_RECORDING_STATE, {1, 0, 0});
    bad.back() ^= 1;
    CHECK(parse(bad) == -1);                                  // corrupt CRC
    auto truncated = frame(SET_RECORDING_STATE, {1, 0, 0});
    truncated.pop_back();
    CHECK(parse(truncated) == -1);
    auto v1 = frame(SET_RECORDING_STATE, {1, 0, 0});
    v1[1] = 'M';
    CHECK(parse(v1) == -1);                                   // MSPv1 header
    CHECK(recordingState(nullptr, 12) == -1);
}

static void debounce() {
    SwitchControl s(300);
    CHECK(s.poll(1000, false) == Command::None);              // nothing heard: nothing done
    s.received(true, 0);
    CHECK(s.poll(299, false) == Command::None);
    CHECK(s.poll(300, false) == Command::Start);
    CHECK(s.poll(1000, false) == Command::None);              // one command per change

    // A bouncing switch settles to one command, timed from the last change.
    SwitchControl b(300);
    b.received(true, 0);
    b.received(false, 100);
    b.received(true, 200);
    CHECK(b.poll(450, false) == Command::None);
    CHECK(b.poll(500, false) == Command::Start);
    CHECK(b.poll(900, false) == Command::None);

    // A brush that returns to where it was gives nothing.
    b.received(false, 1000);
    b.received(true, 1100);
    CHECK(b.poll(1500, false) == Command::None);

    // The radio restarting with the switch still at Start repeats nothing.
    b.received(true, 2000);
    CHECK(b.poll(2400, false) == Command::None);

    b.received(false, 3000);
    CHECK(b.poll(3300, false) == Command::Stop);
    b.received(true, 4000);
    CHECK(b.poll(4300, false) == Command::Start);
}

static void invert() {
    SwitchControl s(300);
    s.received(true, 0);
    CHECK(s.poll(300, true) == Command::Stop);
    s.received(false, 400);
    CHECK(s.poll(700, true) == Command::Start);
}

static void wrap() {
    SwitchControl s(300);
    s.received(true, 0xFFFFFF00u);
    CHECK(s.poll(0x0000002Bu, false) == Command::None);       // 299 ms later, across the wrap
    CHECK(s.poll(0x0000002Cu, false) == Command::Start);
}

static void policy() {
    const char* reason = nullptr;
    RaceState idle;
    idle.c5 = true;
    CHECK(decide(Command::Start, idle, &reason) == Command::Start && reason[0] == 0);
    CHECK(decide(Command::Stop, idle, &reason) == Command::None);
    CHECK(std::string(reason) == "notRunning");
    CHECK(decide(Command::None, idle, &reason) == Command::None);

    RaceState running = idle;
    running.running = true;
    CHECK(decide(Command::Start, running, &reason) == Command::None);
    CHECK(std::string(reason) == "running");
    CHECK(decide(Command::Stop, running, &reason) == Command::Stop);

    // A command while the history is being saved: no second start, and a
    // stop is passed on (race control makes a repeated stop harmless).
    RaceState saving = idle;
    saving.busy = true;
    CHECK(decide(Command::Start, saving, &reason) == Command::None);
    CHECK(decide(Command::Stop, saving, &reason) == Command::Stop);

    // Stop retries a failed save, as the Stop button does.
    RaceState failed = idle;
    failed.saveFailed = true;
    CHECK(decide(Command::Stop, failed, &reason) == Command::Stop);

    RaceState rx5808;
    CHECK(decide(Command::Start, rx5808, &reason) == Command::None);
    CHECK(std::string(reason) == "needsC5");
    CHECK(decide(Command::Stop, rx5808, &reason) == Command::None);
}

int main() {
    parser();
    debounce();
    invert();
    wrap();
    policy();
    if (failures) return 1;
    std::printf("all assertions passed\n");
    return 0;
}
