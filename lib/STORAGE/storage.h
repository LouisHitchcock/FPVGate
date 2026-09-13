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

// Web assets ship gzipped: scripts/gzip_assets.py stages data/ as <name>.gz and
// only that form is written to the filesystem image. ESPAsyncWebServer resolves
// the .gz fallback itself when serving, but a bare LittleFS.exists() on the
// uncompressed name does not, and would report a perfectly healthy filesystem
// as missing its UI. Use this anywhere a web asset's presence is checked.
inline bool webAssetExists(const String &path) {
    return LittleFS.exists(path) || LittleFS.exists(path + ".gz");
}

class Storage {
   public:
    Storage();
    bool init();
    bool initSDDeferred();  // Initialize SD card after boot
    bool isSDAvailable() const { return sdAvailable; }
    
    // File operations - automatically use SD if available, fall back to LittleFS
    bool writeFile(const String& path, const String& data);
    bool writeBinaryFile(const String& path, const uint8_t* data, size_t len);
    bool appendBinaryFile(const String& path, const uint8_t* data, size_t len);
    bool readFile(const String& path, String& data);
    bool readBinaryFile(const String& path, std::vector<uint8_t>& out);
    // Overwrite len bytes at offset without rewriting the rest of the file.
    bool patchBinaryFile(const String& path, size_t offset, const uint8_t* data, size_t len);
    bool fileSize(const String& path, size_t& out);
    bool deleteFile(const String& path);
    bool renameFile(const String& fromPath, const String& toPath);
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
