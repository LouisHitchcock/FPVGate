#ifndef SPLITTIME_H
#define SPLITTIME_H

#include <Arduino.h>

#define SPLIT_MAX_GATES 8
#define SPLIT_MAX_CROSSINGS 100

// A single gate crossing event
struct GateCrossing {
    uint8_t gateNumber;       // Gate number (1-8)
    uint32_t raceElapsedMs;   // Corrected race-elapsed time in ms
};

// A calculated sector split
struct SectorSplit {
    uint8_t fromGate;         // Starting gate number
    uint8_t toGate;           // Ending gate number
    uint32_t sectorTimeMs;    // Time to travel between gates (ms)
    uint32_t toRaceElapsedMs; // Absolute race-elapsed time at the 'to' crossing (ms)
    float distanceM;          // Distance between gates (meters, 0 if not set)
    float speedMps;           // Speed in m/s (0 if distance not set)
    uint8_t lapIndex;         // Which lap this split belongs to (0-based)
};

// Per-gate clock sync state
struct GateClockSync {
    int32_t offsetMs;         // Clock offset: add to gate's raceElapsedMs to correct
    uint32_t rttMs;           // Round-trip time of best sync sample
    uint32_t lastSyncMs;      // millis() when last sync was performed
    bool synced;              // True if at least one successful sync
};

class SplitTimeManager {
   public:
    SplitTimeManager();

    // Clock sync management
    void setClockOffset(uint8_t gateIndex, int32_t offsetMs, uint32_t rttMs);
    GateClockSync getClockSync(uint8_t gateIndex) const;

    // Crossing management
    void addCrossing(uint8_t gateNumber, uint32_t raceElapsedMs);
    void clearAll();

    // Split calculation
    // Returns number of splits calculated. Fills output array.
    uint8_t getSplits(SectorSplit* output, uint8_t maxOutput) const;

    // Get the latest sector time between two specific gates
    // Returns 0 if no data available
    uint32_t getLatestSectorTime(uint8_t fromGate, uint8_t toGate) const;

    // Get best (fastest) sector time between two gates across all laps
    uint32_t getBestSectorTime(uint8_t fromGate, uint8_t toGate) const;

    // Set gate distances (called from config)
    void setGateDistance(uint8_t gateNumber, float distanceM);

    // Get crossing count
    uint16_t getCrossingCount() const { return crossingCount; }

    // Check if split gates are active
    bool isActive() const { return crossingCount > 0; }

    // Get the number of configured gates (highest gate number seen)
    uint8_t getGateCount() const;

   private:
    GateCrossing crossings[SPLIT_MAX_CROSSINGS];
    uint16_t crossingCount;

    GateClockSync clockSync[SPLIT_MAX_GATES];
    float gateDistances[SPLIT_MAX_GATES + 1]; // distance from gate N to gate N+1

    // Find the last crossing for a specific gate number before a given index
    int16_t findPreviousCrossing(uint8_t gateNumber, uint16_t beforeIndex) const;
};

#endif // SPLITTIME_H
