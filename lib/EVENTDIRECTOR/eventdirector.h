#pragma once

#include "c5raceevents.h"
#include "config.h"
#include <atomic>
#include <memory>
#include <string>

// All document mutations use the same lease. Reading is permitted during a
// race, editing is not. Revisions reject writes from stale browser tabs.
class EventDirector : public C5RaceEvents {
public:
    static constexpr const char* PATH = "/event.json";
    static constexpr const char* UPLOAD = "/event-upload.tmp";
    static constexpr size_t MAX_BYTES = 512u * 1024u;
    class Lease {
    public:
        explicit Lease(EventDirector* owner) : owner_(owner) {}
        ~Lease() { owner_->locked_ = false; }
    private:
        EventDirector* owner_;
    };
    void begin(Config* config, Storage* storage, RaceHistory* history);
    bool prepare(RaceSession& race) override;
    bool complete(const RaceSession& race) override;
    bool cancel() override;
    const char* error() const override { return error_.load(); }
    int errorStatus() const { return errorStatus_; }
    std::shared_ptr<Lease> readLease();
    std::shared_ptr<Lease> editLease();
    bool commitUpload(uint32_t& revision); // caller holds an edit lease
    void update(); // recover a persisted result/session after reboot
    bool takeChanged() { return changed_.exchange(false); }

private:
    Config* config_ = nullptr;
    Storage* storage_ = nullptr;
    RaceHistory* history_ = nullptr;
    std::atomic<bool> locked_{false}, active_{false};
    std::atomic<bool> changed_{false};
    std::atomic<const char*> error_{""};
    std::atomic<int> errorStatus_{500};
    std::string snapshot_;
    uint32_t checkedAt_ = 0;
    std::shared_ptr<Lease> lease();
    bool recover(); // caller holds lease
    bool finish(const RaceSession& race); // caller holds lease
    bool fail(const char* error, int status = 500);
};
