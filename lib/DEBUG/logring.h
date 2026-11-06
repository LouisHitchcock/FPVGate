#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

// The log ring behind DebugLogger, kept free of Arduino so it can be tested on
// a PC. Positions count every byte ever written (head) and every byte saved to
// the SD card (saved); a byte lives at data[position % RING_BYTES], which
// stays consistent across uint32 wrap because RING_BYTES is a power of two.
//
// The ring is placed in RAM the ESP32 leaves alone on a crash, watchdog or
// software reset (not on power loss). valid() tells a ring left by the last
// boot from power-on garbage, so the lines before a crash are kept.
namespace logring {

constexpr size_t RING_BYTES = 8192;
static_assert((RING_BYTES & (RING_BYTES - 1)) == 0, "RING_BYTES must be a power of two");
constexpr uint32_t MAGIC = 0x474F4C46;   // "FLOG"

struct Ring {
    uint32_t magic;
    uint32_t check;
    uint32_t head;    // bytes ever appended
    uint32_t saved;   // bytes ever written to the SD card, or skipped
    uint32_t lost;    // bytes overwritten before they were saved
    uint32_t boots;   // boots this ring has survived, counting this one
    char data[RING_BYTES];
};

inline uint32_t checksum(const Ring &r) {
    return r.magic ^ (r.head * 2654435761u) ^ (r.saved * 40503u) ^ (r.lost * 2246822519u) ^
           (r.boots * 3266489917u) ^ 0x5A5AA5A5u;
}

inline void seal(Ring &r) { r.check = checksum(r); }

inline bool valid(const Ring &r) {
    return r.magic == MAGIC && r.check == checksum(r) && (uint32_t)(r.head - r.saved) <= RING_BYTES;
}

inline void reset(Ring &r) {
    r.magic = MAGIC;
    r.head = r.saved = r.lost = r.boots = 0;
    seal(r);
}

inline uint32_t unsaved(const Ring &r) { return r.head - r.saved; }

// Bytes overwritten before saving are counted in lost, and saved moves past them.
inline void append(Ring &r, const char *text, size_t len) {
    if (len > RING_BYTES) {
        text += len - RING_BYTES;
        len = RING_BYTES;
    }
    const size_t at = r.head % RING_BYTES;
    const size_t first = len < RING_BYTES - at ? len : RING_BYTES - at;
    memcpy(r.data + at, text, first);
    memcpy(r.data, text + first, len - first);
    r.head += (uint32_t)len;
    if (unsaved(r) > RING_BYTES) {
        r.lost += unsaved(r) - (uint32_t)RING_BYTES;
        r.saved = r.head - (uint32_t)RING_BYTES;
    }
    seal(r);
}

// Copy up to max bytes starting at position from, which must still be in the
// ring (head - from <= RING_BYTES). Returns the byte count.
inline size_t copyFrom(const Ring &r, uint32_t from, char *out, size_t max) {
    uint32_t avail = r.head - from;
    if (avail > RING_BYTES) return 0;
    const size_t n = avail < max ? avail : max;
    const size_t at = from % RING_BYTES;
    const size_t first = n < RING_BYTES - at ? n : RING_BYTES - at;
    memcpy(out, r.data + at, first);
    memcpy(out + first, r.data, n - first);
    return n;
}

// The newest text, NUL-terminated in out (size bytes), starting at a line
// boundary when the oldest copied byte is mid-line. Returns the position of
// out[0], so callers can number lines across boots.
inline uint32_t recent(const Ring &r, char *out, size_t size) {
    if (size == 0) return r.head;
    uint32_t have = r.head < RING_BYTES ? r.head : (uint32_t)RING_BYTES;
    if (have > size - 1) have = (uint32_t)(size - 1);
    uint32_t from = r.head - have;
    size_t n = copyFrom(r, from, out, have);
    size_t skip = 0;
    if (from != 0) {
        // Trim a partial first line. With the whole ring copied, the byte
        // before out[0] has been overwritten (it shares the newest byte's
        // slot), so the start is always treated as mid-line.
        const bool midLine = have == RING_BYTES || r.data[(from - 1) % RING_BYTES] != '\n';
        if (midLine) {
            while (skip < n && out[skip] != '\n') ++skip;
            if (skip < n) ++skip;
        }
    }
    memmove(out, out + skip, n - skip);
    out[n - skip] = '\0';
    return from + (uint32_t)skip;
}

}  // namespace logring
