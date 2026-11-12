#include "../../scripts/support/file_transfer_slots.h"
#include <atomic>
#include <cassert>
#include <cstdio>
#include <memory>
#include <thread>
#include <vector>

int main() {
    {
        std::unique_ptr<FpvFileTransferSlot> first(new FpvFileTransferSlot);
        FpvFileTransferSlot second, waiting;
        assert(first->acquire());
        assert(first->acquire());
        assert(second.acquire());
        assert(!waiting.acquire());
        { FpvFileTransferSlot cancelled; assert(!cancelled.acquire()); }
        assert(!waiting.acquire());
        first.reset();  // Cancelling an active response admits a waiting one.
        assert(waiting.acquire());
    }
    std::atomic<unsigned> simultaneous{0};
    std::vector<std::thread> workers;
    for (unsigned i = 0; i < 8; ++i) workers.emplace_back([&] {
        for (unsigned j = 0; j < 10000; ++j) {
            FpvFileTransferSlot slot;
            while (!slot.acquire()) std::this_thread::yield();
            assert(++simultaneous <= 2);
            std::this_thread::yield();
            --simultaneous;
        }
    });
    for (auto& worker : workers) worker.join();
    FpvFileTransferSlot first, second, third;
    assert(first.acquire() && second.acquire() && !third.acquire());
    std::puts("PASS: queued/active cancellation, idempotent admission, 80000 concurrent transfers, no leaked slots");
}
