#pragma once

#include "racehistory.h"

// Optional event director. A failed event commit must be retryable without
// writing the already-persisted race a second time.
class C5RaceEvents {
public:
    virtual ~C5RaceEvents() = default;
    virtual bool prepare(RaceSession& race) = 0;
    virtual bool complete(const RaceSession& race) = 0;
    virtual bool cancel() = 0;
    virtual const char* error() const = 0;
};
