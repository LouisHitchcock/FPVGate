#include "debuglogger.h"

#include <esp_attr.h>
#include <esp_system.h>

#include "logring.h"
#include "storage.h"

// Not cleared by a crash, watchdog or software reset; logring::valid() tells
// it from power-on contents.
static __NOINIT_ATTR logring::Ring ring;
// Held only to copy bytes in or out of the ring, never around I/O.
static portMUX_TYPE ringMux = portMUX_INITIALIZER_UNLOCKED;

DebugLogger &DebugLogger::getInstance() {
    static DebugLogger instance;
    return instance;
}

static const char *resetName(esp_reset_reason_t reason) {
    switch (reason) {
        case ESP_RST_POWERON: return "power on";
        case ESP_RST_EXT: return "external pin";
        case ESP_RST_SW: return "software restart";
        case ESP_RST_PANIC: return "crash";
        case ESP_RST_INT_WDT: return "interrupt watchdog";
        case ESP_RST_TASK_WDT: return "task watchdog";
        case ESP_RST_WDT: return "watchdog";
        case ESP_RST_DEEPSLEEP: return "deep sleep wake";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_SDIO: return "SDIO";
        default: return "unknown";
    }
}

void DebugLogger::begin() {
    // First line of this boot. Called once, from the first log() call.
    portENTER_CRITICAL(&ringMux);
    if (logring::valid(ring)) {
        recovered_ = logring::unsaved(ring) > 0 || ring.head > 0;
        ring.boots++;
        // Overwrites from the last boot are not this boot's loss.
        ring.lost = 0;
        logring::seal(ring);
    } else {
        logring::reset(ring);
        ring.boots = 1;
        logring::seal(ring);
    }
    portEXIT_CRITICAL(&ringMux);
    begun_ = true;
    const esp_reset_reason_t reason = esp_reset_reason();
    log("=== Boot %lu, reset reason %d (%s)%s ===\n", (unsigned long)ring.boots, (int)reason, resetName(reason),
        recovered_ ? "; lines above are from before the reset" : "");
}

void DebugLogger::append(const char *text, size_t len) {
    portENTER_CRITICAL(&ringMux);
    const uint32_t lostBefore = ring.lost;
    logring::append(ring, text, len);
    const uint32_t lostNow = ring.lost - lostBefore;
    portEXIT_CRITICAL(&ringMux);
    if (lostNow && sdEnabled_) lostWhileOn_ = lostWhileOn_ + lostNow;
}

void DebugLogger::log(const char *format, ...) {
    if (!begun_) begin();
    char line[LINE_BYTES];
    int n = snprintf(line, sizeof(line), "[%lu] ", (unsigned long)millis());
    if (n < 0) n = 0;
    va_list args;
    va_start(args, format);
    int m = vsnprintf(line + n, sizeof(line) - n, format, args);
    va_end(args);
    size_t len = n + (m < 0 ? 0 : ((size_t)m < sizeof(line) - n ? (size_t)m : sizeof(line) - n - 1));
    Serial.write((const uint8_t *)line, len);
    // The writer's own storage messages would otherwise feed back into the log.
    if (writer_ && xTaskGetCurrentTaskHandle() == writer_) return;
    append(line, len);
}

uint32_t DebugLogger::copyRecent(char *out, size_t size) const {
    portENTER_CRITICAL(&ringMux);
    const uint32_t from = logring::recent(ring, out, size);
    portEXIT_CRITICAL(&ringMux);
    return from;
}

DebugLogger::Status DebugLogger::status() const {
    Status s{};
    portENTER_CRITICAL(&ringMux);
    s.boots = ring.boots;
    s.unsaved = logring::unsaved(ring);
    portEXIT_CRITICAL(&ringMux);
    s.sdEnabled = sdEnabled_;
    s.recoveredPrevious = recovered_;
    s.lost = lostWhileOn_;
    s.savedBytes = savedBytes_;
    s.writeFailures = writeFailures_;
    s.lastWriteMs = lastWriteMs_;
    return s;
}

void DebugLogger::startWriter(Storage *storage) {
    if (writer_ || !storage) return;
    storage_ = storage;
    // Core 0 beside the web server; priority 1 so it preempts only the idle
    // parallelTask loop, and it sleeps between writes.
    xTaskCreatePinnedToCore(writerTask, "logWriter", 4096, this, 1, &writer_, 0);
}

bool DebugLogger::setSdEnabled(bool on) {
    if (!storage_ || !storage_->isSDAvailable()) return false;
    bool ok;
    if (on) {
        storage_->mkdir("/logs");
        ok = storage_->writeFile(ENABLED_PATH, "1");
    } else {
        ok = !storage_->exists(ENABLED_PATH) || storage_->deleteFile(ENABLED_PATH);
    }
    if (!ok) return false;
    if (on && !sdEnabled_) {
        // Save from now on, plus what the ring still holds.
        lostWhileOn_ = 0;
        log("=== Saving the log to the SD card ===\n");
    }
    sdEnabled_ = on;
    flagChecked_ = true;
    if (!on) log("=== Stopped saving the log to the SD card ===\n");
    return true;
}

void DebugLogger::writerTask(void *self) { static_cast<DebugLogger *>(self)->writerLoop(); }

void DebugLogger::writerLoop() {
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(WRITE_INTERVAL_MS));
        if (!storage_->isSDAvailable()) continue;
        if (!flagChecked_) {
            sdEnabled_ = storage_->exists(ENABLED_PATH);
            flagChecked_ = true;
        }
        if (sdEnabled_) writeOnce();
    }
}

void DebugLogger::writeOnce() {
    static char chunk[2048];   // this task only
    if (!dirReady_) dirReady_ = storage_->mkdir("/logs") || storage_->exists("/logs");
    if (!fileSized_) fileSized_ = storage_->fileSize(LOG_PATH, fileBytes_) || !storage_->exists(LOG_PATH);
    for (int i = 0; i < 4; ++i) {
        // appendBinaryFile falls back to LittleFS without a card; never log to flash.
        if (!storage_->isSDAvailable()) return;
        if (const uint32_t lost = lostWhileOn_) {
            lostWhileOn_ = 0;
            char note[96];
            int n = snprintf(note, sizeof(note), "[%lu] [log] %lu bytes were overwritten before they could be saved\n",
                             (unsigned long)millis(), (unsigned long)lost);
            if (n > 0) storage_->appendBinaryFile(LOG_PATH, (const uint8_t *)note, (size_t)n);
        }
        portENTER_CRITICAL(&ringMux);
        const uint32_t from = ring.saved;
        const size_t len = logring::copyFrom(ring, from, chunk, sizeof(chunk));
        portEXIT_CRITICAL(&ringMux);
        if (!len) return;
        if (fileBytes_ + len > MAX_FILE_BYTES) {
            if (storage_->exists(OLD_LOG_PATH)) storage_->deleteFile(OLD_LOG_PATH);
            storage_->renameFile(LOG_PATH, OLD_LOG_PATH);
            fileBytes_ = 0;
        }
        if (!storage_->appendBinaryFile(LOG_PATH, (const uint8_t *)chunk, len)) {
            writeFailures_ = writeFailures_ + 1;
            return;
        }
        fileBytes_ += len;
        portENTER_CRITICAL(&ringMux);
        // If the ring overwrote these bytes meanwhile, saved has already moved on.
        if (ring.saved == from) {
            ring.saved = from + (uint32_t)len;
            logring::seal(ring);
        }
        portEXIT_CRITICAL(&ringMux);
        savedBytes_ = savedBytes_ + (uint32_t)len;
        lastWriteMs_ = millis();
    }
}
