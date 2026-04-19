#ifndef STORAGE_H
#define STORAGE_H

#include <Arduino.h>
#include <vector>
#include "config.h"

#ifdef HAS_SD_CARD_SUPPORT
#include <SD.h>
#include <SPI.h>
#endif

#include <LittleFS.h>

class Storage {
   public:
    Storage();
    bool init();
    bool initSDDeferred();  // Initialize SD card after boot
    bool isSDAvailable() const { return sdAvailable; }
    
    // File operations - automatically use SD if available, fall back to LittleFS
    bool writeFile(const String& path, const String& data);
    bool readFile(const String& path, String& data);
    bool deleteFile(const String& path);
    bool exists(const String& path);
    bool mkdir(const String& path);
    bool listDir(const String& path, std::vector<String>& files);
    
    // Storage info
    uint64_t getTotalBytes();
    uint64_t getUsedBytes();
    uint64_t getFreeBytes();
    String getStorageType() const { return sdAvailable ? "SD" : "LittleFS"; }
    
    // Migration helpers
    bool migrateSoundsToSD();
    bool copyDirectory(const String& srcPath, const String& dstPath, bool deleteSource = false);

    // Unmount SD cleanly before deep sleep / power-off (flush FAT). Safe to call if SD not mounted.
    void shutdownForPowerOff();
    
   private:
    bool sdAvailable;
    
#ifdef HAS_SD_CARD_SUPPORT
    bool initSD();
    SPIClass* spi;
#endif
};

#endif
