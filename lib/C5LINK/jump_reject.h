// Shared native-USB / UART-host jump admission. A short sudden rise from a
// quiet floor must not become a power-on/channel-change pass or graph spike.
#ifndef C5MK_JUMP_REJECT_H
#define C5MK_JUMP_REJECT_H
#include <stdint.h>
namespace rhusb {
struct Reject {
    uint16_t riseMs = 30;
    uint16_t holdMs = 90;
    uint16_t quietMs = 100;
    uint8_t margin = 16;
};
struct JumpState {
    bool quiet = false, quietSeen = false, jumping = false, jumpDropped = false;
    uint8_t nadir = 254, jumpMax = 0;
    uint32_t quietStartMs = 0, quietLastMs = 0, jumpUntilMs = 0;
    uint32_t jumpFirstMs = 0, jumpLastMs = 0;
};

// State may be a native Seat or a UART admission state. Return true only
// when the held peak has become visible. Crossing-specific state stays in
// each adapter; both consume the same admission decision and held peak.
template<class State>
bool advanceJump(State& s, uint8_t level, uint32_t sampleMs, uint8_t enter, const Reject& config) {
    const bool floor = level <= s.nadir + config.margin;
    int jumpLevel = s.nadir + 2 * config.margin;
    if (enter < jumpLevel) jumpLevel = enter;
    if (!s.jumping && !floor && config.riseMs && s.quietSeen &&
        s.quietLastMs - s.quietStartMs >= config.quietMs &&
        sampleMs - s.quietLastMs <= config.riseMs && level >= jumpLevel) {
        s.jumping = true;
        s.jumpDropped = false;
        s.jumpUntilMs = sampleMs + config.holdMs;
        s.jumpMax = 0;
    }
    if (floor) {
        if (!s.quiet) s.quietStartMs = sampleMs;
        s.quiet = s.quietSeen = true;
        s.quietLastMs = sampleMs;
    } else {
        s.quiet = false;
    }
    if (s.jumping) {
        if (level > s.jumpMax) {
            s.jumpMax = level;
            s.jumpFirstMs = s.jumpLastMs = sampleMs;
        } else if (level == s.jumpMax) {
            s.jumpLastMs = sampleMs;
        }
        if (floor) {
            s.jumping = false;
        } else if ((int32_t)(sampleMs - s.jumpUntilMs) >= 0) {
            s.jumping = false;
            return !s.jumpDropped;
        }
    }
    return false;
}
}  // namespace rhusb
#endif
