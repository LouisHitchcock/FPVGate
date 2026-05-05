#pragma once

#include <Arduino.h>
#include <vector>

#include "../SERIAL/serial_guard.h"

#define DEBUG_BUFFER_SIZE 100

class DebugLogger {
public:
    struct LogEntry {
        unsigned long timestamp;
        char message[256];
    };
    
    static DebugLogger& getInstance() {
        static DebugLogger instance;
        return instance;
    }
    
    void log(const char* format, ...) {
        va_list args;
        va_start(args, format);
        
        LogEntry entry;
        entry.timestamp = millis();
        vsnprintf(entry.message, sizeof(entry.message), format, args);
        
        va_end(args);
        
        // Add to ring buffer
        if (buffer.size() >= DEBUG_BUFFER_SIZE) {
            buffer.erase(buffer.begin());
        }
        buffer.push_back(entry);
        
        if (!shouldSuppressDebugSerial()) {
            serialOutputLock();
            Serial.printf("[%lu] %s", entry.timestamp, entry.message);
            serialOutputUnlock();
        }
    }
    
    const std::vector<LogEntry>& getBuffer() const {
        return buffer;
    }
    
    void clear() {
        buffer.clear();
    }
    
private:
    DebugLogger() {}
    std::vector<LogEntry> buffer;
};

// Redefine DEBUG macro to use logger
#undef DEBUG
#define DEBUG(...) DebugLogger::getInstance().log(__VA_ARGS__)
