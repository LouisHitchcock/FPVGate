#pragma once
#include <atomic>

// Keep queued file responses open without filling all their TCP send windows.
// Ownership follows the response, so cancellation releases an admitted slot.
class FpvFileTransferSlot {
public:
    static constexpr unsigned capacity = 1;
    FpvFileTransferSlot() = default;
    FpvFileTransferSlot(const FpvFileTransferSlot&) = delete;
    FpvFileTransferSlot& operator=(const FpvFileTransferSlot&) = delete;

    ~FpvFileTransferSlot() {
        if (held_) active().fetch_sub(1);
    }

    bool acquire() {
        if (held_) return true;
        unsigned current = active().load();
        while (current < capacity) {
            if (active().compare_exchange_weak(current, current + 1)) {
                held_ = true;
                return true;
            }
        }
        return false;
    }

private:
    static std::atomic<unsigned>& active() {
        static std::atomic<unsigned> count{0};
        return count;
    }
    bool held_ = false;
};
