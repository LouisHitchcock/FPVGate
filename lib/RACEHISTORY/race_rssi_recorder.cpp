#include "race_rssi_recorder.h"
#include <time.h>
#include "debug.h"

RaceRssiRecorder::RaceRssiRecorder()
    : storage(nullptr),
      recording(false),
      pendingReady(false),
      truncated(false),
      intervalMs(RACE_RSSI_INTERVAL_MS),
      sampleCount(0),
      lastSampleMs(0),
      stagingCount(0) {
    memset(staging, 0, sizeof(staging));
}

void RaceRssiRecorder::init(Storage* storageBackend) {
    storage = storageBackend;
}

String RaceRssiRecorder::sidecarBasenameForTimestamp(uint32_t timestamp) {
    time_t ts = timestamp;
    struct tm timeinfo;
    localtime_r(&ts, &timeinfo);
    char filename[40];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.rssi", &timeinfo);
    return String(filename);
}

String RaceRssiRecorder::sidecarPathForTimestamp(uint32_t timestamp) {
    return String("/races/") + sidecarBasenameForTimestamp(timestamp);
}

void RaceRssiRecorder::cleanupOrphans() {
    if (!storage) {
        return;
    }
    storage->deleteFile(RACE_RSSI_ACTIVE_PATH);
    // Keep pending until attached or next beginRace discards it.
}

void RaceRssiRecorder::discardPending() {
    if (!storage) {
        return;
    }
    storage->deleteFile(RACE_RSSI_PENDING_PATH);
    storage->deleteFile(RACE_RSSI_ACTIVE_PATH);
    pendingReady = false;
    sampleCount = 0;
    truncated = false;
    stagingCount = 0;
}

bool RaceRssiRecorder::writeHeaderPlaceholder() {
    if (!storage) {
        return false;
    }
    uint8_t hdr[RACE_RSSI_HEADER_SIZE];
    memset(hdr, 0, sizeof(hdr));
    // magic little-endian FGRH
    hdr[0] = 'F';
    hdr[1] = 'G';
    hdr[2] = 'R';
    hdr[3] = 'H';
    hdr[4] = RACE_RSSI_VERSION;
    hdr[5] = (uint8_t)(intervalMs & 0xFF);
    hdr[6] = (uint8_t)((intervalMs >> 8) & 0xFF);
    // sampleCount + flags filled on finalize
    return storage->writeBinaryFile(RACE_RSSI_ACTIVE_PATH, hdr, sizeof(hdr));
}

bool RaceRssiRecorder::flushStaging() {
    if (!storage || stagingCount == 0) {
        return true;
    }
    bool ok = storage->appendBinaryFile(RACE_RSSI_ACTIVE_PATH, staging, stagingCount);
    if (ok) {
        stagingCount = 0;
    }
    return ok;
}

bool RaceRssiRecorder::finalizeHeader() {
    if (!storage) {
        return false;
    }
    // Rewrite full file header by reading payload is expensive; instead rewrite header bytes only
    // by reading whole file if small enough, or rewrite header via temp.
    std::vector<uint8_t> data;
    if (!storage->readBinaryFile(RACE_RSSI_ACTIVE_PATH, data)) {
        return false;
    }
    if (data.size() < RACE_RSSI_HEADER_SIZE) {
        return false;
    }
    data[0] = 'F';
    data[1] = 'G';
    data[2] = 'R';
    data[3] = 'H';
    data[4] = RACE_RSSI_VERSION;
    data[5] = (uint8_t)(intervalMs & 0xFF);
    data[6] = (uint8_t)((intervalMs >> 8) & 0xFF);
    data[7] = (uint8_t)(sampleCount & 0xFF);
    data[8] = (uint8_t)((sampleCount >> 8) & 0xFF);
    data[9] = (uint8_t)((sampleCount >> 16) & 0xFF);
    data[10] = (uint8_t)((sampleCount >> 24) & 0xFF);
    data[11] = truncated ? 1 : 0;

    // Ensure payload length matches sampleCount (header + samples)
    size_t expected = RACE_RSSI_HEADER_SIZE + sampleCount;
    if (data.size() > expected) {
        data.resize(expected);
    }
    if (!storage->writeBinaryFile(RACE_RSSI_ACTIVE_PATH, data.data(), data.size())) {
        return false;
    }
    storage->deleteFile(RACE_RSSI_PENDING_PATH);
    if (!storage->renameFile(RACE_RSSI_ACTIVE_PATH, RACE_RSSI_PENDING_PATH)) {
        // Fallback copy
        if (!storage->writeBinaryFile(RACE_RSSI_PENDING_PATH, data.data(), data.size())) {
            return false;
        }
        storage->deleteFile(RACE_RSSI_ACTIVE_PATH);
    }
    pendingReady = sampleCount > 0;
    return pendingReady;
}

void RaceRssiRecorder::beginRace() {
    if (!storage) {
        return;
    }
    // Only record when SD is available (primary design)
    if (!storage->isSDAvailable()) {
        recording = false;
        pendingReady = false;
        DEBUG("[RssiRec] SD unavailable - marshal capture disabled\n");
        return;
    }

    discardPending();
    recording = true;
    pendingReady = false;
    truncated = false;
    intervalMs = RACE_RSSI_INTERVAL_MS;
    sampleCount = 0;
    lastSampleMs = 0;
    stagingCount = 0;
    storage->mkdir("/races");
    if (!writeHeaderPlaceholder()) {
        DEBUG("[RssiRec] Failed to create active RSSI file\n");
        recording = false;
        return;
    }
    DEBUG("[RssiRec] Capture started\n");
}

void RaceRssiRecorder::addSample(uint8_t rssi, uint32_t nowMs) {
    if (!recording || !storage) {
        return;
    }
    if (sampleCount >= RACE_RSSI_MAX_SAMPLES) {
        if (!truncated) {
            truncated = true;
            DEBUG("[RssiRec] Max samples reached - truncating\n");
        }
        return;
    }
    if (lastSampleMs != 0 && (nowMs - lastSampleMs) < intervalMs) {
        return;
    }
    lastSampleMs = nowMs;

    staging[stagingCount++] = rssi;
    sampleCount++;

    if (stagingCount >= RACE_RSSI_STAGING_SIZE) {
        if (!flushStaging()) {
            // Keep trying; if staging full and flush fails, drop oldest half to avoid blocking
            if (stagingCount >= RACE_RSSI_STAGING_SIZE) {
                memmove(staging, staging + (RACE_RSSI_STAGING_SIZE / 2), RACE_RSSI_STAGING_SIZE / 2);
                stagingCount = RACE_RSSI_STAGING_SIZE / 2;
                truncated = true;
            }
        }
    }
}

void RaceRssiRecorder::endRace() {
    if (!recording) {
        return;
    }
    recording = false;
    if (!storage) {
        return;
    }
    if (!flushStaging()) {
        DEBUG("[RssiRec] Final flush failed\n");
    }
    if (!finalizeHeader()) {
        DEBUG("[RssiRec] Finalize failed\n");
        pendingReady = false;
        storage->deleteFile(RACE_RSSI_ACTIVE_PATH);
        return;
    }
    DEBUG("[RssiRec] Capture ended: %u samples truncated=%d\n", sampleCount, (int)truncated);
}

bool RaceRssiRecorder::attachToRace(uint32_t timestamp, RaceRssiMeta& outMeta) {
    outMeta = RaceRssiMeta();
    if (!storage || !pendingReady) {
        return false;
    }
    String dest = sidecarPathForTimestamp(timestamp);
    String base = sidecarBasenameForTimestamp(timestamp);
    storage->deleteFile(dest);
    if (!storage->renameFile(RACE_RSSI_PENDING_PATH, dest)) {
        // Fallback read/write
        std::vector<uint8_t> data;
        if (!storage->readBinaryFile(RACE_RSSI_PENDING_PATH, data)) {
            return false;
        }
        if (!storage->writeBinaryFile(dest, data.data(), data.size())) {
            return false;
        }
        storage->deleteFile(RACE_RSSI_PENDING_PATH);
    }
    outMeta.hasHistory = true;
    outMeta.intervalMs = intervalMs;
    outMeta.sampleCount = sampleCount;
    outMeta.truncated = truncated;
    outMeta.file = base;
    pendingReady = false;
    DEBUG("[RssiRec] Attached sidecar %s (%u samples)\n", dest.c_str(), sampleCount);
    return true;
}

bool RaceRssiRecorder::readMetaFromFile(Storage* storage, const String& path, RaceRssiMeta& meta) {
    meta = RaceRssiMeta();
    if (!storage) {
        return false;
    }
    std::vector<uint8_t> data;
    if (!storage->readBinaryFile(path, data) || data.size() < RACE_RSSI_HEADER_SIZE) {
        return false;
    }
    if (data[0] != 'F' || data[1] != 'G' || data[2] != 'R' || data[3] != 'H') {
        return false;
    }
    meta.intervalMs = (uint16_t)data[5] | ((uint16_t)data[6] << 8);
    meta.sampleCount = (uint32_t)data[7] | ((uint32_t)data[8] << 8) | ((uint32_t)data[9] << 16) | ((uint32_t)data[10] << 24);
    meta.truncated = data[11] != 0;
    meta.hasHistory = meta.sampleCount > 0;
    int slash = path.lastIndexOf('/');
    meta.file = (slash >= 0) ? path.substring(slash + 1) : path;
    return true;
}

bool RaceRssiRecorder::loadSamples(Storage* storage, const String& basename, RaceRssiMeta& meta, std::vector<uint8_t>& samples) {
    samples.clear();
    meta = RaceRssiMeta();
    if (!storage || basename.length() == 0) {
        return false;
    }
    String path = basename.startsWith("/") ? basename : (String("/races/") + basename);
    std::vector<uint8_t> data;
    if (!storage->readBinaryFile(path, data) || data.size() < RACE_RSSI_HEADER_SIZE) {
        return false;
    }
    if (data[0] != 'F' || data[1] != 'G' || data[2] != 'R' || data[3] != 'H') {
        return false;
    }
    meta.intervalMs = (uint16_t)data[5] | ((uint16_t)data[6] << 8);
    meta.sampleCount = (uint32_t)data[7] | ((uint32_t)data[8] << 8) | ((uint32_t)data[9] << 16) | ((uint32_t)data[10] << 24);
    meta.truncated = data[11] != 0;
    meta.file = basename;
    size_t avail = data.size() - RACE_RSSI_HEADER_SIZE;
    uint32_t count = meta.sampleCount;
    if (count > avail) {
        count = (uint32_t)avail;
    }
    samples.assign(data.begin() + RACE_RSSI_HEADER_SIZE, data.begin() + RACE_RSSI_HEADER_SIZE + count);
    meta.sampleCount = count;
    meta.hasHistory = count > 0;
    return meta.hasHistory;
}
