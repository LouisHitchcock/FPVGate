#pragma once
#include <stdint.h>

// The event task can stamp a link after the loop sampled its clock. A future
// stamp is not an expired timeout. Signed subtraction also handles millis wrap
// for intervals shorter than half the 32-bit clock range.
inline bool ethnetDhcpExpired(uint32_t now, uint32_t linkedAt, uint32_t timeout) {
    return static_cast<int32_t>(now - linkedAt) >= static_cast<int32_t>(timeout);
}
