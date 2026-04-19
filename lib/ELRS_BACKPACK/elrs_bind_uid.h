#pragma once

#include <stddef.h>
#include <stdint.h>

/**
 * ELRS backpack UID from bind phrase — same algorithm as vrxc_elrs elrs_backpack.hash_phrase
 * (MD5 of -DMY_BINDING_PHRASE="...", first 6 bytes, first byte forced even).
 */
void elrs_backpack_compute_uid6(const char* bind_phrase, const char* callsign_fallback, uint8_t uid[6]);

/** True if uid is non-zero (has a binding target). */
bool elrs_backpack_uid_valid(const uint8_t uid[6]);

constexpr size_t kElrsBackpackBindPhraseMax = 32;
