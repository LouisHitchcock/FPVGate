#ifndef RACE_RSSI_RECORDER_H
#define RACE_RSSI_RECORDER_H

#include <Arduino.h>
#include <vector>
#include "storage.h"

// Binary sidecar magic "FGRH"
#define RACE_RSSI_MAGIC 0x48524746u
#define RACE_RSSI_VERSION 1
#define RACE_RSSI_HEADER_SIZE 12
#define RACE_RSSI_STAGING_SIZE 512
#define RACE_RSSI_INTERVAL_MS 20
#define RACE_RSSI_ACTIVE_PATH "/races/_active.rssi"
#define RACE_RSSI_PENDING_PATH "/races/_pending.rssi"
// Soft cap ~15 minutes @ 20ms
#define RACE_RSSI_MAX_SAMPLES 45000u

struct RaceRssiMeta {
    bool hasHistory = false;
    uint16_t intervalMs = RACE_RSSI_INTERVAL_MS;
    uint32_t sampleCount = 0;
    bool truncated = false;
    String file;  // basename e.g. "020826-153012.rssi"
};

class RaceRssiRecorder {
   public:
    RaceRssiRecorder();
    void init(Storage* storage);
    void beginRace();
    void addSample(uint8_t rssi, uint32_t nowMs);
    void endRace();
    void discardPending();
    bool hasPending() const { return pendingReady; }
    uint32_t pendingSampleCount() const { return sampleCount; }
    uint16_t pendingIntervalMs() const { return intervalMs; }
    bool pendingTruncated() const { return truncated; }
    // Rename pending capture to permanent sidecar for race timestamp; fills meta.
    bool attachToRace(uint32_t timestamp, RaceRssiMeta& outMeta);
    static String sidecarPathForTimestamp(uint32_t timestamp);
    static String sidecarBasenameForTimestamp(uint32_t timestamp);
    static bool loadSamples(Storage* storage, const String& basename, RaceRssiMeta& meta, std::vector<uint8_t>& samples);
    static bool readMetaFromFile(Storage* storage, const String& path, RaceRssiMeta& meta);
    void cleanupOrphans();

   private:
    Storage* storage;
    bool recording;
    bool pendingReady;
    bool truncated;
    uint16_t intervalMs;
    uint32_t sampleCount;
    uint32_t lastSampleMs;
    uint16_t stagingCount;
    uint8_t staging[RACE_RSSI_STAGING_SIZE];

    bool flushStaging();
    bool writeHeaderPlaceholder();
    bool finalizeHeader();
};

#endif
