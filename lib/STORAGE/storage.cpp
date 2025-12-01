#include "storage.h"
#include "debug.h"
#include "config.h"
#include <FS.h>

Storage::Storage() : sdAvailable(false) {
#ifdef ESP32S3
    spi = nullptr;
#endif
}

bool Storage::init() {
    DEBUG("Initializing storage...\n");
    
    // SD card init deferred to after boot to prevent watchdog timeout
    sdAvailable = false;
    DEBUG("Storage: Using LittleFS (SD card will be initialized after boot)\n");
    return true;
}

bool Storage::initSDDeferred() {
    DEBUG("Attempting deferred SD card initialization...\n");
    
#ifdef ESP32S3
    if (sdAvailable) {
        DEBUG("SD card already initialized\n");
        return true;
    }
    
    uint32_t startTime = millis();
    bool success = initSD();
    uint32_t duration = millis() - startTime;
    
    if (success) {
        sdAvailable = true;
        DEBUG("SD card initialized successfully (took %dms)\n", duration);
        return true;
    } else {
        DEBUG("SD card init failed after %dms\n", duration);
        return false;
    }
#else
    DEBUG("SD card not supported on this platform\n");
    return false;
#endif
}

#ifdef ESP32S3
bool Storage::initSD() {
    // SD card completely disabled
    DEBUG("SD card support temporarily disabled\n");
    return false;
    
    /* Commented out for now
    DEBUG("\n=== SD Card Initialization ===\n");
    DEBUG("Pin Configuration:\n");
    DEBUG("  CS   = GPIO %d\n", PIN_SD_CS);
    DEBUG("  SCK  = GPIO %d\n", PIN_SD_SCK);
    DEBUG("  MOSI = GPIO %d\n", PIN_SD_MOSI);
    DEBUG("  MISO = GPIO %d\n", PIN_SD_MISO);
    
    // Create custom SPI bus for SD card
    spi = new SPIClass(HSPI);
    DEBUG("SPI bus object created\n");
    
    // Begin SPI bus
    spi->begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
    DEBUG("SPI bus initialized\n");
    
    // Try to initialize SD card
    DEBUG("Attempting SD.begin() at 1MHz...\n");
    if (!SD.begin(PIN_SD_CS, *spi, 1000000, "/sd", 1, false)) {
        DEBUG("ERROR: SD.begin() failed!\n");
        DEBUG("Possible causes:\n");
        DEBUG("  1. Card not inserted\n");
        DEBUG("  2. Card not FAT32 formatted\n");
        DEBUG("  3. Loose wiring\n");
        DEBUG("  4. Incompatible card\n");
        DEBUG("  5. Insufficient power (3.3V required)\n");
        spi->end();
        delete spi;
        spi = nullptr;
        return false;
    }
    
    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        DEBUG("No SD card attached\n");
        SD.end();
        delete spi;
        spi = nullptr;
        return false;
    }
    
    DEBUG("SD card mounted successfully\n");
    DEBUG("SD Card Type: ");
    if (cardType == CARD_MMC) {
        DEBUG("MMC\n");
    } else if (cardType == CARD_SD) {
        DEBUG("SDSC\n");
    } else if (cardType == CARD_SDHC) {
        DEBUG("SDHC\n");
    } else {
        DEBUG("UNKNOWN\n");
    }
    
    uint64_t cardSize = SD.cardSize() / (1024 * 1024);
    DEBUG("SD Card Size: %lluMB\n", cardSize);
    
    return true;
    */
}
#endif

bool Storage::writeFile(const String& path, const String& data) {
    DEBUG("Storage: Writing to %s (%d bytes)\n", path.c_str(), data.length());
    
#ifdef ESP32S3
    if (sdAvailable) {
        File file = SD.open(path, FILE_WRITE);
        if (!file) {
            DEBUG("Failed to open file on SD: %s\n", path.c_str());
            return false;
        }
        size_t written = file.print(data);
        file.close();
        return written > 0;
    }
#endif
    
    // Fall back to LittleFS
    File file = LittleFS.open(path, "w");
    if (!file) {
        DEBUG("Failed to open file on LittleFS: %s\n", path.c_str());
        return false;
    }
    size_t written = file.print(data);
    file.close();
    return written > 0;
}

bool Storage::readFile(const String& path, String& data) {
#ifdef ESP32S3
    if (sdAvailable) {
        if (!SD.exists(path)) {
            return false;
        }
        File file = SD.open(path, FILE_READ);
        if (!file) {
            DEBUG("Failed to open file on SD: %s\n", path.c_str());
            return false;
        }
        data = file.readString();
        file.close();
        return true;
    }
#endif
    
    // Fall back to LittleFS
    if (!LittleFS.exists(path)) {
        return false;
    }
    File file = LittleFS.open(path, "r");
    if (!file) {
        DEBUG("Failed to open file on LittleFS: %s\n", path.c_str());
        return false;
    }
    data = file.readString();
    file.close();
    return true;
}

bool Storage::deleteFile(const String& path) {
#ifdef ESP32S3
    if (sdAvailable) {
        return SD.remove(path);
    }
#endif
    return LittleFS.remove(path);
}

bool Storage::exists(const String& path) {
#ifdef ESP32S3
    if (sdAvailable) {
        return SD.exists(path);
    }
#endif
    return LittleFS.exists(path);
}

bool Storage::mkdir(const String& path) {
#ifdef ESP32S3
    if (sdAvailable) {
        return SD.mkdir(path);
    }
#endif
    return LittleFS.mkdir(path);
}

bool Storage::listDir(const String& path, std::vector<String>& files) {
    files.clear();
    
#ifdef ESP32S3
    if (sdAvailable) {
        File root = SD.open(path);
        if (!root || !root.isDirectory()) {
            return false;
        }
        
        File file = root.openNextFile();
        while (file) {
            if (!file.isDirectory()) {
                files.push_back(String(file.name()));
            }
            file = root.openNextFile();
        }
        return true;
    }
#endif
    
    // LittleFS
    File root = LittleFS.open(path);
    if (!root || !root.isDirectory()) {
        return false;
    }
    
    File file = root.openNextFile();
    while (file) {
        if (!file.isDirectory()) {
            files.push_back(String(file.name()));
        }
        file = root.openNextFile();
    }
    return true;
}

uint64_t Storage::getTotalBytes() {
#ifdef ESP32S3
    if (sdAvailable) {
        return SD.cardSize();
    }
#endif
    return LittleFS.totalBytes();
}

uint64_t Storage::getUsedBytes() {
#ifdef ESP32S3
    if (sdAvailable) {
        return SD.usedBytes();
    }
#endif
    return LittleFS.usedBytes();
}

uint64_t Storage::getFreeBytes() {
    return getTotalBytes() - getUsedBytes();
}
