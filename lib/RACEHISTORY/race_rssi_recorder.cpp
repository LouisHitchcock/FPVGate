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
      stagingCount(0),
      dropped(0),
      activeBuffer(-1),
      writeQueue(nullptr),
      freeBuffers(nullptr),
      writerTask(nullptr),
      writeFailed(false) {
    memset(buffers, 0, sizeof(buffers));
}

void RaceRssiRecorder::init(Storage* storageBackend) {
    storage = storageBackend;
    if (writerTask) {
        return;
    }
    writeQueue = xQueueCreate(RACE_RSSI_BUFFER_COUNT, sizeof(WriteJob));
    freeBuffers = xQueueCreate(RACE_RSSI_BUFFER_COUNT, sizeof(uint8_t));
    if (!writeQueue || !freeBuffers) {
        DEBUG("[RssiRec] Queue allocation failed - capture disabled\n");
        return;
    }
    for (uint8_t i = 0; i < RACE_RSSI_BUFFER_COUNT; i++) {
        xQueueSend(freeBuffers, &i, 0);
    }
    // Low priority: this must never preempt lap detection. It only ever runs
    // when a buffer is full, so it is idle for most of a race.
    if (xTaskCreate(writerTaskEntry, "rssi_write", 3072, this, 1, &writerTask) != pdPASS) {
        DEBUG("[RssiRec] Writer task creation failed - capture disabled\n");
        writerTask = nullptr;
    }
}

void RaceRssiRecorder::writerTaskEntry(void* arg) {
    static_cast<RaceRssiRecorder*>(arg)->runWriter();
}

// Owns every SD append for the capture. The sampling path only ever posts a
// buffer index here, so a slow card cannot stall lap detection.
void RaceRssiRecorder::runWriter() {
    for (;;) {
        WriteJob job;
        if (xQueueReceive(writeQueue, &job, portMAX_DELAY) != pdTRUE) {
            continue;
        }
        if (storage && job.length > 0) {
            if (!storage->appendBinaryFile(RACE_RSSI_ACTIVE_PATH, buffers[job.index], job.length)) {
                writeFailed = true;
                DEBUG("[RssiRec] SD append failed\n");
            }
        }
        xQueueSend(freeBuffers, &job.index, 0);
    }
}

bool RaceRssiRecorder::acquireBuffer(TickType_t wait) {
    if (!freeBuffers) {
        return false;
    }
    uint8_t index = 0;
    if (xQueueReceive(freeBuffers, &index, wait) != pdTRUE) {
        return false;
    }
    activeBuffer = (int8_t)index;
    stagingCount = 0;
    return true;
}

bool RaceRssiRecorder::postActiveBuffer() {
    if (activeBuffer < 0 || !writeQueue) {
        return false;
    }
    WriteJob job = {(uint8_t)activeBuffer, stagingCount};
    activeBuffer = -1;
    stagingCount = 0;
    if (xQueueSend(writeQueue, &job, 0) != pdTRUE) {
        // Queue is sized to the buffer count, so this should be unreachable.
        xQueueSend(freeBuffers, &job.index, 0);
        return false;
    }
    return true;
}

// Hands the active buffer back without writing it. waitForWriterIdle counts
// buffers in the free pool, so an unreleased active buffer would hang it.
void RaceRssiRecorder::releaseActiveBuffer() {
    if (activeBuffer < 0 || !freeBuffers) {
        return;
    }
    uint8_t index = (uint8_t)activeBuffer;
    activeBuffer = -1;
    stagingCount = 0;
    xQueueSend(freeBuffers, &index, 0);
}

// Blocks until every buffer is back in the free pool, i.e. the writer has
// drained. Only called from endRace, never from the sampling path.
bool RaceRssiRecorder::waitForWriterIdle(TickType_t wait) {
    if (!freeBuffers) {
        return false;
    }
    TickType_t deadline = xTaskGetTickCount() + wait;
    while (uxQueueMessagesWaiting(freeBuffers) < RACE_RSSI_BUFFER_COUNT) {
        if ((int32_t)(xTaskGetTickCount() - deadline) >= 0) {
            return false;
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
    return true;
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
    dropped = 0;
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

bool RaceRssiRecorder::finalizeHeader() {
    if (!storage) {
        return false;
    }
    // Patch the 12 header bytes in place. Reading the whole sidecar back just
    // to rewrite its first 12 bytes would cost a 45 KB allocation plus a full
    // rewrite at the end of every race.
    size_t fileBytes = 0;
    if (!storage->fileSize(RACE_RSSI_ACTIVE_PATH, fileBytes) || fileBytes < RACE_RSSI_HEADER_SIZE) {
        return false;
    }
    // The file is the authority on how many samples actually landed. If a write
    // failed mid-race, trust the bytes on disk rather than the counter.
    uint32_t onDisk = (uint32_t)(fileBytes - RACE_RSSI_HEADER_SIZE);
    if (onDisk != sampleCount) {
        DEBUG("[RssiRec] Sample count %u does not match %u on disk - trusting disk\n",
              sampleCount, onDisk);
        truncated = true;
        sampleCount = onDisk;
    }

    uint8_t hdr[RACE_RSSI_HEADER_SIZE];
    hdr[0] = 'F';
    hdr[1] = 'G';
    hdr[2] = 'R';
    hdr[3] = 'H';
    hdr[4] = RACE_RSSI_VERSION;
    hdr[5] = (uint8_t)(intervalMs & 0xFF);
    hdr[6] = (uint8_t)((intervalMs >> 8) & 0xFF);
    hdr[7] = (uint8_t)(sampleCount & 0xFF);
    hdr[8] = (uint8_t)((sampleCount >> 8) & 0xFF);
    hdr[9] = (uint8_t)((sampleCount >> 16) & 0xFF);
    hdr[10] = (uint8_t)((sampleCount >> 24) & 0xFF);
    hdr[11] = truncated ? 1 : 0;
    if (!storage->patchBinaryFile(RACE_RSSI_ACTIVE_PATH, 0, hdr, sizeof(hdr))) {
        return false;
    }
    storage->deleteFile(RACE_RSSI_PENDING_PATH);
    if (!storage->renameFile(RACE_RSSI_ACTIVE_PATH, RACE_RSSI_PENDING_PATH)) {
        // Fallback copy. Only reached if the backend cannot rename; it costs a
        // full read of the sidecar, which is why rename is tried first.
        std::vector<uint8_t> data;
        if (!storage->readBinaryFile(RACE_RSSI_ACTIVE_PATH, data) ||
            !storage->writeBinaryFile(RACE_RSSI_PENDING_PATH, data.data(), data.size())) {
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

    if (!writerTask) {
        DEBUG("[RssiRec] Writer task unavailable - marshal capture disabled\n");
        return;
    }

    // Drain the previous race's writes BEFORE deleting its files, otherwise a
    // queued append would recreate the active sidecar after discardPending.
    recording = false;
    releaseActiveBuffer();
    waitForWriterIdle(pdMS_TO_TICKS(2000));
    discardPending();
    pendingReady = false;
    truncated = false;
    writeFailed = false;
    intervalMs = RACE_RSSI_INTERVAL_MS;
    sampleCount = 0;
    lastSampleMs = 0;
    dropped = 0;
    storage->mkdir("/races");
    if (!writeHeaderPlaceholder()) {
        DEBUG("[RssiRec] Failed to create active RSSI file\n");
        return;
    }
    if (!acquireBuffer(pdMS_TO_TICKS(100))) {
        DEBUG("[RssiRec] No staging buffer available\n");
        return;
    }
    recording = true;
    DEBUG("[RssiRec] Capture started\n");
}

// Runs on the lap-detection loop. Every path here is non-blocking: a full
// buffer is handed to the writer task and a fresh one taken with zero wait.
// If the writer has not kept up the sample is dropped rather than stalling
// lap detection, and the capture is flagged truncated.
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

    if (activeBuffer < 0 && !acquireBuffer(0)) {
        // Writer is still behind. Count the loss instead of counting a sample
        // that never reaches the file, which would skew the graph time axis.
        dropped++;
        truncated = true;
        return;
    }

    buffers[activeBuffer][stagingCount++] = rssi;
    sampleCount++;

    if (stagingCount >= RACE_RSSI_STAGING_SIZE) {
        postActiveBuffer();
        acquireBuffer(0);  // Failure is handled on the next sample.
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
    // The buffer must go back to the pool either way, or waitForWriterIdle
    // below can never see all of them free and will always time out.
    if (stagingCount > 0) {
        postActiveBuffer();
    } else {
        releaseActiveBuffer();
    }
    // Off the sampling path, so waiting here is safe and keeps the sidecar
    // complete before the header is finalized.
    if (!waitForWriterIdle(pdMS_TO_TICKS(5000))) {
        DEBUG("[RssiRec] Writer did not drain in time\n");
        truncated = true;
    }
    if (writeFailed) {
        truncated = true;
    }
    if (!finalizeHeader()) {
        DEBUG("[RssiRec] Finalize failed\n");
        pendingReady = false;
        storage->deleteFile(RACE_RSSI_ACTIVE_PATH);
        return;
    }
    DEBUG("[RssiRec] Capture ended: %u samples dropped=%u truncated=%d\n",
          sampleCount, dropped, (int)truncated);
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
    // Reuse the buffer we already read rather than allocating a second one of
    // the same size. At the 45000-sample cap the copy would double peak heap.
    data.resize(RACE_RSSI_HEADER_SIZE + count);
    data.erase(data.begin(), data.begin() + RACE_RSSI_HEADER_SIZE);
    samples.swap(data);
    meta.sampleCount = count;
    meta.hasHistory = count > 0;
    return meta.hasHistory;
}
