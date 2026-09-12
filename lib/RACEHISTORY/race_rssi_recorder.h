#ifndef RACE_RSSI_RECORDER_H
#define RACE_RSSI_RECORDER_H

#include <Arduino.h>
#include <vector>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "storage.h"

// Binary sidecar magic "FGRH"
#define RACE_RSSI_MAGIC 0x48524746u
#define RACE_RSSI_VERSION 1
#define RACE_RSSI_HEADER_SIZE 12
#define RACE_RSSI_STAGING_SIZE 512
// Three buffers let sampling keep filling one while the writer task is
// busy with another, with a spare to absorb a slow SD write.
#define RACE_RSSI_BUFFER_COUNT 3
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

// Incremental JSON writer for the marshal RSSI response. Emits the header,
// then the sample array one value at a time, then the closing bracket, so a
// long capture never needs a contiguous text buffer. fill() returns 0 only
// once the whole document has been written, because ESPAsyncWebServer treats
// a zero-length chunk as end of response.
struct MarshalRssiStream {
    std::vector<uint8_t> samples;
    String head;

    size_t fill(uint8_t* buffer, size_t maxLen) {
        size_t written = 0;
        while (written < maxLen) {
            if (pendingPos < pendingLen) {
                buffer[written++] = (uint8_t)pending[pendingPos++];
            } else if (headPos < (size_t)head.length()) {
                buffer[written++] = (uint8_t)head[headPos++];
            } else if (sampleIdx < samples.size()) {
                queueSample();
            } else if (!tailQueued) {
                tailQueued = true;
                pending[0] = ']';
                pending[1] = '}';
                pendingLen = 2;
                pendingPos = 0;
            } else {
                break;
            }
        }
        return written;
    }

   private:
    size_t headPos = 0;
    size_t sampleIdx = 0;
    char pending[4] = {0};
    uint8_t pendingLen = 0;
    uint8_t pendingPos = 0;
    bool tailQueued = false;

    void queueSample() {
        pendingLen = 0;
        pendingPos = 0;
        if (sampleIdx) {
            pending[pendingLen++] = ',';
        }
        uint8_t v = samples[sampleIdx++];
        if (v >= 100) {
            pending[pendingLen++] = (char)('0' + (v / 100));
        }
        if (v >= 10) {
            pending[pendingLen++] = (char)('0' + ((v / 10) % 10));
        }
        pending[pendingLen++] = (char)('0' + (v % 10));
    }
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

    uint32_t droppedSamples() const { return dropped; }

   private:
    // One filled staging buffer handed to the writer task.
    struct WriteJob {
        uint8_t index;
        uint16_t length;
    };

    Storage* storage;
    bool recording;
    bool pendingReady;
    bool truncated;
    uint16_t intervalMs;
    uint32_t sampleCount;
    uint32_t lastSampleMs;
    uint16_t stagingCount;
    uint32_t dropped;
    // Sampling runs on the lap-detection loop, so it must never block on SD.
    // Filled buffers are posted to writerTask, which owns every SD append.
    uint8_t buffers[RACE_RSSI_BUFFER_COUNT][RACE_RSSI_STAGING_SIZE];
    int8_t activeBuffer;
    QueueHandle_t writeQueue;
    QueueHandle_t freeBuffers;
    TaskHandle_t writerTask;
    volatile bool writeFailed;

    static void writerTaskEntry(void* arg);
    void runWriter();
    bool acquireBuffer(TickType_t wait);
    bool postActiveBuffer();
    void releaseActiveBuffer();
    bool waitForWriterIdle(TickType_t wait);
    bool writeHeaderPlaceholder();
    bool finalizeHeader();
};

#endif
