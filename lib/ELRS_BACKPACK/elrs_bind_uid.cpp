#include "elrs_bind_uid.h"

#include <cstring>
#include <cstdio>

#include <mbedtls/md5.h>

void elrs_backpack_compute_uid6(const char* bind_phrase, const char* callsign_fallback, uint8_t uid[6]) {
    const char* src = nullptr;
    if (bind_phrase && bind_phrase[0] != '\0') {
        src = bind_phrase;
    } else if (callsign_fallback && callsign_fallback[0] != '\0') {
        src = callsign_fallback;
    }
    if (!src) {
        memset(uid, 0, 6);
        return;
    }

    char buf[96];
    int n = snprintf(buf, sizeof(buf), "-DMY_BINDING_PHRASE=\"%s\"", src);
    if (n <= 0 || static_cast<size_t>(n) >= sizeof(buf)) {
        memset(uid, 0, 6);
        return;
    }

    unsigned char md[16];
    mbedtls_md5_context ctx;
    mbedtls_md5_init(&ctx);
    mbedtls_md5_starts(&ctx);
    mbedtls_md5_update(&ctx, reinterpret_cast<const unsigned char*>(buf), static_cast<size_t>(n));
    mbedtls_md5_finish(&ctx, md);
    mbedtls_md5_free(&ctx);

    memcpy(uid, md, 6);
    if ((uid[0] & 1u) != 0) {
        uid[0] = static_cast<uint8_t>(uid[0] - 1u);
    }
}

bool elrs_backpack_uid_valid(const uint8_t uid[6]) {
    for (int i = 0; i < 6; i++) {
        if (uid[i] != 0) {
            return true;
        }
    }
    return false;
}
