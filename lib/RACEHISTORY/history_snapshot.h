#pragma once
#include <ArduinoJson.h>
#include <cstdlib>
#ifdef ESP32
#include <esp_heap_caps.h>
#endif

// History is not DMA/ISR data. Keep its temporary JSON tree and immutable
// response in external RAM where available, leaving internal RAM for lwIP.
class HistorySnapshotAllocator : public ArduinoJson::Allocator {
public:
    void* allocate(size_t size) override {
#ifdef ESP32
        if (void* ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)) return ptr;
#endif
        return std::malloc(size);
    }
    void deallocate(void* ptr) override { std::free(ptr); }
    void* reallocate(void* ptr, size_t size) override {
        if (!size) { deallocate(ptr); return nullptr; }
#ifdef ESP32
        if (void* moved = heap_caps_realloc(ptr, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)) return moved;
#endif
        return std::realloc(ptr, size);
    }
};
