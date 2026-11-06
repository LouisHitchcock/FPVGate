#pragma once
#include <stdint.h>

// Is a RotorHazard link stamp (millis() | 1, 0 = never) still current at nowMs?
// HTTP handlers stamp from another task, so the stamp can be newer than a
// caller's clock reading. That must count as linked: treating the wrapped
// difference as a very old stamp makes one tick discard queued passes.
inline bool rhLinkCurrent(uint32_t nowMs, uint32_t linkMs, uint32_t timeoutMs) {
    if (!linkMs) return false;
    const uint32_t age = nowMs - linkMs;
    return age < timeoutMs || (uint32_t)(0u - age) < timeoutMs;
}
