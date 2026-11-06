#pragma once

#include <Arduino.h>
#include <vector>

class Storage;

// Every DEBUG line goes to serial and into a ring (logring.h) that survives a
// crash, watchdog or software reset, so /api/debuglog shows the lines that led
// up to one. With "Save log to SD card" on (off by default), a low-priority
// task appends the ring to /logs/log.txt every few seconds, including what a
// crash left unsaved. A power loss loses only the unsaved seconds.
class DebugLogger {
public:
    static constexpr size_t LINE_BYTES = 256;
    static constexpr size_t RECENT_BYTES = 6144;   // /api/debuglog
    static constexpr const char *LOG_PATH = "/logs/log.txt";
    static constexpr const char *OLD_LOG_PATH = "/logs/log.1.txt";
    static constexpr const char *ENABLED_PATH = "/logs/enabled";
    static constexpr size_t MAX_FILE_BYTES = 256 * 1024;
    static constexpr uint32_t WRITE_INTERVAL_MS = 5000;

    struct Status {
        bool sdEnabled;
        bool recoveredPrevious;   // the ring held lines from before this boot
        uint32_t boots;
        uint32_t unsaved;
        uint32_t lost;            // overwritten before saving, while saving was on
        uint32_t savedBytes;      // written to the card this boot
        uint32_t writeFailures;
        uint32_t lastWriteMs;
    };

    static DebugLogger &getInstance();

    void log(const char *format, ...) __attribute__((format(printf, 2, 3)));
    // Starts the SD writer. The card may become available later.
    void startWriter(Storage *storage);
    // Turns saving on or off; writes or removes the flag file on the card.
    bool setSdEnabled(bool on);
    Status status() const;
    // Newest lines, NUL-terminated; returns the position of out[0].
    uint32_t copyRecent(char *out, size_t size) const;

private:
    DebugLogger() {}
    void begin();
    void append(const char *text, size_t len);
    void writerLoop();
    void writeOnce();
    static void writerTask(void *self);

    bool begun_ = false;
    bool recovered_ = false;
    Storage *storage_ = nullptr;
    TaskHandle_t writer_ = nullptr;
    volatile bool sdEnabled_ = false;
    bool flagChecked_ = false;
    bool dirReady_ = false;
    size_t fileBytes_ = 0;
    bool fileSized_ = false;
    volatile uint32_t lostWhileOn_ = 0;
    volatile uint32_t savedBytes_ = 0;
    volatile uint32_t writeFailures_ = 0;
    volatile uint32_t lastWriteMs_ = 0;
};

// Redefine DEBUG macro to use logger
#undef DEBUG
#define DEBUG(...) DebugLogger::getInstance().log(__VA_ARGS__)
