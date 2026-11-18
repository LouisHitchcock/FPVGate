#pragma once
#include <array>
#include <cstdint>
#include <cstdlib>
#include <new>
#ifdef ESP32
#include <esp_heap_caps.h>
#endif

// AsyncTCP copies these task-owned bytes into lwIP. They are not DMA buffers.
template<size_t Size>
struct FpvResponseBuffer : std::array<std::uint8_t, Size> {
    static void* operator new(size_t size, const std::nothrow_t&) noexcept {
#ifdef ESP32
        if (void* ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)) return ptr;
#endif
        return std::malloc(size);
    }
    static void operator delete(void* ptr) noexcept { std::free(ptr); }
    static void operator delete(void* ptr, const std::nothrow_t&) noexcept { std::free(ptr); }
};
