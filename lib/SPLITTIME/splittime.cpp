#include "splittime.h"
#include "debug.h"

SplitTimeManager::SplitTimeManager() {
    clearAll();
    memset(clockSync, 0, sizeof(clockSync));
    memset(gateDistances, 0, sizeof(gateDistances));
}

void SplitTimeManager::setClockOffset(uint8_t gateIndex, int32_t offsetMs, uint32_t rttMs) {
    if (gateIndex >= SPLIT_MAX_GATES) return;
    clockSync[gateIndex].offsetMs = offsetMs;
    clockSync[gateIndex].rttMs = rttMs;
    clockSync[gateIndex].lastSyncMs = millis();
    clockSync[gateIndex].synced = true;
    DEBUG("[Split] Gate %d clock offset: %d ms (RTT: %u ms)\n", gateIndex, offsetMs, rttMs);
}

GateClockSync SplitTimeManager::getClockSync(uint8_t gateIndex) const {
    if (gateIndex >= SPLIT_MAX_GATES) {
        GateClockSync empty = {0, 0, 0, false};
        return empty;
    }
    return clockSync[gateIndex];
}

void SplitTimeManager::addCrossing(uint8_t gateNumber, uint32_t raceElapsedMs) {
    if (gateNumber == 0 || gateNumber > SPLIT_MAX_GATES) return;
    if (crossingCount >= SPLIT_MAX_CROSSINGS) {
        DEBUG("[Split] Max crossings reached, ignoring\n");
        return;
    }

    crossings[crossingCount].gateNumber = gateNumber;
    crossings[crossingCount].raceElapsedMs = raceElapsedMs;
    crossingCount++;

    DEBUG("[Split] Crossing: gate=%u raceElapsed=%u ms (total crossings: %u)\n",
          gateNumber, raceElapsedMs, crossingCount);
}

void SplitTimeManager::clearAll() {
    memset(crossings, 0, sizeof(crossings));
    crossingCount = 0;
    DEBUG("[Split] All crossings cleared\n");
}

void SplitTimeManager::setGateDistance(uint8_t gateNumber, float distanceM) {
    if (gateNumber == 0 || gateNumber > SPLIT_MAX_GATES) return;
    gateDistances[gateNumber] = distanceM;
}

uint8_t SplitTimeManager::getGateCount() const {
    uint8_t maxGate = 0;
    for (uint16_t i = 0; i < crossingCount; i++) {
        if (crossings[i].gateNumber > maxGate) {
            maxGate = crossings[i].gateNumber;
        }
    }
    return maxGate;
}

uint8_t SplitTimeManager::getSplits(SectorSplit* output, uint8_t maxOutput) const {
    if (crossingCount < 2 || maxOutput == 0) return 0;

    uint8_t splitCount = 0;

    // For each crossing, find the next crossing at the next higher gate number.
    // This produces only valid sectors: G1->G2, G2->G3, etc.
    // A crossing at the highest gate resets to the lowest for the next lap.
    for (uint16_t i = 0; i < crossingCount && splitCount < maxOutput; i++) {
        const GateCrossing& from = crossings[i];
        uint8_t nextGate = from.gateNumber + 1;

        // Find the next crossing at nextGate that happens after this one
        for (uint16_t j = i + 1; j < crossingCount; j++) {
            if (crossings[j].gateNumber == nextGate &&
                crossings[j].raceElapsedMs > from.raceElapsedMs) {
                
                SectorSplit& split = output[splitCount];
                split.fromGate = from.gateNumber;
                split.toGate = nextGate;
                split.sectorTimeMs = crossings[j].raceElapsedMs - from.raceElapsedMs;

                // Calculate distance and speed if available
                split.distanceM = gateDistances[nextGate];
                if (split.distanceM > 0 && split.sectorTimeMs > 0) {
                    split.speedMps = (split.distanceM * 1000.0f) / (float)split.sectorTimeMs;
                } else {
                    split.speedMps = 0;
                }

                // Determine lap index: count how many complete sequences of gate 1
                // have been seen before this sector's start
                uint8_t lapIdx = 0;
                uint8_t lowestGate = crossings[0].gateNumber;
                for (uint16_t k = 0; k < crossingCount; k++) {
                    if (crossings[k].gateNumber < lowestGate) lowestGate = crossings[k].gateNumber;
                }
                for (uint16_t k = 1; k <= i; k++) {
                    if (crossings[k].gateNumber == lowestGate) lapIdx++;
                }
                split.lapIndex = lapIdx;

                splitCount++;
                break; // Only match the first valid next-gate crossing
            }
        }
    }

    return splitCount;
}

uint32_t SplitTimeManager::getLatestSectorTime(uint8_t fromGate, uint8_t toGate) const {
    // Walk backwards through crossings to find the most recent matching pair
    for (int16_t i = crossingCount - 1; i >= 1; i--) {
        if (crossings[i].gateNumber == toGate) {
            // Look for the preceding fromGate crossing
            for (int16_t j = i - 1; j >= 0; j--) {
                if (crossings[j].gateNumber == fromGate) {
                    if (crossings[i].raceElapsedMs > crossings[j].raceElapsedMs) {
                        return crossings[i].raceElapsedMs - crossings[j].raceElapsedMs;
                    }
                    break;
                }
            }
        }
    }
    return 0;
}

uint32_t SplitTimeManager::getBestSectorTime(uint8_t fromGate, uint8_t toGate) const {
    uint32_t best = UINT32_MAX;

    for (uint16_t i = 1; i < crossingCount; i++) {
        if (crossings[i].gateNumber == toGate) {
            // Look for the preceding fromGate crossing
            for (int16_t j = i - 1; j >= 0; j--) {
                if (crossings[j].gateNumber == fromGate) {
                    if (crossings[i].raceElapsedMs > crossings[j].raceElapsedMs) {
                        uint32_t sectorTime = crossings[i].raceElapsedMs - crossings[j].raceElapsedMs;
                        if (sectorTime < best) {
                            best = sectorTime;
                        }
                    }
                    break;
                }
            }
        }
    }

    return (best == UINT32_MAX) ? 0 : best;
}

int16_t SplitTimeManager::findPreviousCrossing(uint8_t gateNumber, uint16_t beforeIndex) const {
    for (int16_t i = beforeIndex - 1; i >= 0; i--) {
        if (crossings[i].gateNumber == gateNumber) {
            return i;
        }
    }
    return -1;
}
