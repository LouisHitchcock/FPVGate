#pragma once
#include <cstdlib>
#include <new>
#ifdef ESP32
#include <esp_heap_caps.h>
#endif

// HTTP request/response metadata is task-owned, like its existing external
// response buffers. It is not used as a peripheral DMA buffer. Keep scarce
// internal RAM for the network stack; retain normal allocation on no-PSRAM
// boards and when external allocation is unavailable.
struct FpvWebObject {
    static void* operator new(size_t size) noexcept {
#ifdef ESP32
        if (void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)) return p;
#endif
        return std::malloc(size);
    }
    static void* operator new(size_t size, const std::nothrow_t&) noexcept {
        return operator new(size);
    }
    static void operator delete(void* p) noexcept { std::free(p); }
    static void operator delete(void* p, const std::nothrow_t&) noexcept { std::free(p); }
};
