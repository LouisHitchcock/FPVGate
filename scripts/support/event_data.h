#pragma once
#include <cstdlib>
#include <cstring>
#include <cstdint>
#ifdef ESP32
#include <esp_heap_caps.h>
#endif

// Queued SSE bytes are immutable CPU-owned data. lwIP copies them before
// transmission, so PSRAM is suitable; boards without it retain malloc fallback.
class FpvEventData {
    char* data_ = nullptr;
    size_t size_ = 0;
public:
    FpvEventData() = default;
    FpvEventData(const char* data, size_t size) { concat(data, size); }
    template<class Text> explicit FpvEventData(const Text& text) : FpvEventData(text.c_str(), text.length()) {}
    FpvEventData(const FpvEventData&) = delete;
    FpvEventData& operator=(const FpvEventData&) = delete;
    ~FpvEventData() { std::free(data_); }
    const char* c_str() const { return data_ ? data_ : ""; }
    size_t length() const { return size_; }
    bool concat(const char* data, size_t size) {
        if (!data && size) return false;
        if (size > SIZE_MAX - size_ - 1) return false;
        const size_t bytes = size_ + size;
        char* next = nullptr;
#ifdef ESP32
        next = static_cast<char*>(heap_caps_malloc(bytes + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
#endif
        if (!next) next = static_cast<char*>(std::malloc(bytes + 1));
        if (!next) return false;
        if (size_) std::memcpy(next, data_, size_);
        if (size) std::memcpy(next + size_, data, size);
        next[bytes] = 0;
        std::free(data_);
        data_ = next;
        size_ = bytes;
        return true;
    }
};
