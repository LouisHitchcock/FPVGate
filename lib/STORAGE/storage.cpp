#include "storage.h"
#include "debug.h"
#include "config.h"
#include <FS.h>
#include "../LCD_UI/spi_mutex.h"

Storage::Storage() : sdAvailable(false) {
#ifdef HAS_SD_CARD_SUPPORT
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
    
#ifdef HAS_SD_CARD_SUPPORT
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

#ifdef HAS_SD_CARD_SUPPORT
bool Storage::initSD() {
    DEBUG("\n=== SD Card Initialization ===\n");
    DEBUG("Pin Configuration:\n");
    DEBUG("  CS   = GPIO %d\n", PIN_SD_CS);
    DEBUG("  SCK  = GPIO %d\n", PIN_SD_SCK);
    DEBUG("  MOSI = GPIO %d\n", PIN_SD_MOSI);
    DEBUG("  MISO = GPIO %d\n", PIN_SD_MISO);
    
    // Initialize CS pin
    pinMode(PIN_SD_CS, OUTPUT);
    digitalWrite(PIN_SD_CS, HIGH);
    
#if defined(WAVESHARE_ESP32S3_LCD2)
    // Take mutex before touching shared FSPI so we don't reconfigure the bus while the LCD is
    // mid-blit (which causes tearing/corruption during boot overlay).
    if (!spiMutexTake(pdMS_TO_TICKS(500))) {
        DEBUG("SPI mutex timeout - skipping SD init\n");
        return false;
    }
#endif
    
    // Create custom SPI bus for SD card
#if defined(WAVESHARE_ESP32S3_LCD2)
    // Waveshare board: SD card shares SPI pins with LCD (MOSI=38, SCK=39, MISO=40)
    // Must use FSPI (same peripheral as LCD) with proper CS management
    spi = new SPIClass(FSPI);
    DEBUG("SPI bus object created (FSPI - shared with LCD)\n");
#else
    spi = new SPIClass(HSPI);
    DEBUG("SPI bus object created (HSPI)\n");
#endif
    
    // Begin SPI bus with correct pin order: SCK, MISO, MOSI, SS
    spi->begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
    DEBUG("SPI bus initialized\n");
    
    // Try to initialize SD card at 10MHz (safe for short wires)
    DEBUG("Attempting SD.begin() at 10MHz...\n");
#if !defined(WAVESHARE_ESP32S3_LCD2)
    spiMutexTake();
#endif
    bool sdOk = SD.begin(PIN_SD_CS, *spi, 10000000);
    spiMutexGive();
    if (!sdOk) {
        DEBUG("ERROR: SD.begin() failed!\n");
        DEBUG("Possible causes:\n");
        DEBUG("  1. Card not inserted\n");
        DEBUG("  2. Card not FAT32 formatted\n");
        DEBUG("  3. Loose wiring\n");
        DEBUG("  4. Incompatible card\n");
        DEBUG("  5. Insufficient power\n");
#if defined(WAVESHARE_ESP32S3_LCD2)
        // Do NOT tear down FSPI: LCD shares the same bus. spi->end() leaves the peripheral
        // unusable and gfx->begin() does not fully re-init it. Leave bus begun so LCD keeps working.
        (void)0;
#else
        spi->end();
        delete spi;
        spi = nullptr;
#endif
        return false;
    }
    
    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        DEBUG("No SD card attached\n");
        SD.end();
#if defined(WAVESHARE_ESP32S3_LCD2)
        // Do NOT tear down FSPI (shared with LCD) - see comment above.
        (void)0;
#else
        spi->end();
        delete spi;
        spi = nullptr;
#endif
        return false;
    }
    
    DEBUG("✅ SD card mounted successfully\n");
    DEBUG("SD Card Type: ");
    if (cardType == CARD_MMC) {
        DEBUG("MMC\n");
    } else if (cardType == CARD_SD) {
        DEBUG("SDSC\n");
    } else if (cardType == CARD_SDHC) {
        DEBUG("SDHC/SDXC\n");
    } else {
        DEBUG("UNKNOWN\n");
    }
    
    uint64_t cardSize = SD.cardSize() / (1024 * 1024);
    DEBUG("SD Card Size: %lluMB\n", cardSize);
    
    uint64_t usedBytes = SD.usedBytes() / (1024 * 1024);
    DEBUG("SD Card Used: %lluMB\n", usedBytes);
    
    return true;
}
#endif

void Storage::shutdownForPowerOff() {
#ifdef HAS_SD_CARD_SUPPORT
    if (!sdAvailable) {
        return;
    }
    if (!spiMutexTake(pdMS_TO_TICKS(3000))) {
        return;
    }
    SD.end();
    sdAvailable = false;
    spiMutexGive();
#endif
}

bool Storage::writeFile(const String& path, const String& data) {
    DEBUG("Storage: Writing to %s (%d bytes)\n", path.c_str(), data.length());
    
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        DEBUG("[SPI] writeFile: Taking mutex...\n");
        spiMutexTake();
        DEBUG("[SPI] writeFile: Mutex acquired, opening file...\n");
        File file = SD.open(path, FILE_WRITE);
        if (!file) {
            DEBUG("[SPI] writeFile: Failed to open, releasing mutex\n");
            spiMutexGive();
            DEBUG("Failed to open file on SD: %s\n", path.c_str());
            return false;
        }
        DEBUG("[SPI] writeFile: File opened, writing data...\n");
        size_t written = file.print(data);
        file.close();
        DEBUG("[SPI] writeFile: Done, releasing mutex\n");
        spiMutexGive();
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
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        DEBUG("[SPI] readFile: %s - Taking mutex...\n", path.c_str());
        spiMutexTake();
        DEBUG("[SPI] readFile: Mutex acquired, checking exists...\n");
        if (!SD.exists(path)) {
            DEBUG("[SPI] readFile: File not found, releasing mutex\n");
            spiMutexGive();
            return false;
        }
        DEBUG("[SPI] readFile: Opening file...\n");
        File file = SD.open(path, FILE_READ);
        if (!file) {
            DEBUG("[SPI] readFile: Failed to open, releasing mutex\n");
            spiMutexGive();
            DEBUG("Failed to open file on SD: %s\n", path.c_str());
            return false;
        }
        DEBUG("[SPI] readFile: Reading data...\n");
        data = file.readString();
        file.close();
        DEBUG("[SPI] readFile: Done (%d bytes), releasing mutex\n", data.length());
        spiMutexGive();
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
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        spiMutexTake();
        bool ok = SD.remove(path);
        spiMutexGive();
        return ok;
    }
#endif
    return LittleFS.remove(path);
}

bool Storage::exists(const String& path) {
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        spiMutexTake();
        bool ok = SD.exists(path);
        spiMutexGive();
        return ok;
    }
#endif
    return LittleFS.exists(path);
}

bool Storage::mkdir(const String& path) {
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        spiMutexTake();
        bool ok = SD.mkdir(path);
        spiMutexGive();
        return ok;
    }
#endif
    return LittleFS.mkdir(path);
}

bool Storage::listDir(const String& path, std::vector<String>& files) {
    files.clear();
    
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        spiMutexTake();
        File root = SD.open(path);
        if (!root || !root.isDirectory()) {
            spiMutexGive();
            return false;
        }
        
        File file = root.openNextFile();
        while (file) {
            if (!file.isDirectory()) {
                files.push_back(String(file.name()));
            }
            file = root.openNextFile();
        }
        spiMutexGive();
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
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        spiMutexTake();
        uint64_t size = SD.cardSize();
        spiMutexGive();
        return size;
    }
#endif
    return LittleFS.totalBytes();
}

uint64_t Storage::getUsedBytes() {
#ifdef HAS_SD_CARD_SUPPORT
    if (sdAvailable) {
        spiMutexTake();
        uint64_t used = SD.usedBytes();
        spiMutexGive();
        return used;
    }
#endif
    return LittleFS.usedBytes();
}

uint64_t Storage::getFreeBytes() {
    return getTotalBytes() - getUsedBytes();
}

bool Storage::migrateSoundsToSD() {
#ifdef HAS_SD_CARD_SUPPORT
    if (!sdAvailable) {
        DEBUG("SD card not available, cannot migrate sounds\n");
        return false;
    }
    
    // Check if sounds already exist on SD
    spiMutexTake();
    bool soundsExist = SD.exists("/sounds");
    spiMutexGive();
    
    if (soundsExist) {
        DEBUG("Sounds directory already exists on SD card\n");
        return true;
    }
    
    // Check if sounds exist in LittleFS
    if (!LittleFS.exists("/sounds")) {
        DEBUG("No sounds directory in LittleFS to migrate\n");
        return false;
    }
    
    DEBUG("\n=== Migrating sounds to SD card ===\n");
    
    // Create sounds directory on SD
    spiMutexTake();
    bool mkdirOk = SD.mkdir("/sounds");
    spiMutexGive();
    
    if (!mkdirOk) {
        DEBUG("Failed to create /sounds directory on SD\n");
        return false;
    }
    
    // Copy all files from LittleFS /sounds to SD /sounds
    bool success = copyDirectory("/sounds", "/sounds", false);
    
    if (success) {
        DEBUG("✅ Migration complete!\n");
        DEBUG("You can now delete /sounds from LittleFS to free space\n");
    } else {
        DEBUG("❌ Migration failed\n");
    }
    
    return success;
#else
    return false;
#endif
}

bool Storage::copyDirectory(const String& srcPath, const String& dstPath, bool deleteSource) {
    DEBUG("Copying %s to SD card...\n", srcPath.c_str());
    
    File srcDir = LittleFS.open(srcPath);
    if (!srcDir || !srcDir.isDirectory()) {
        DEBUG("Failed to open source directory: %s\n", srcPath.c_str());
        return false;
    }
    
    int fileCount = 0;
    int errorCount = 0;
    uint32_t totalBytes = 0;
    
    File file = srcDir.openNextFile();
    while (file) {
        if (!file.isDirectory()) {
            String fileName = String(file.name());
            String dstFilePath = dstPath + "/" + fileName.substring(fileName.lastIndexOf('/') + 1);
            
            DEBUG("  Copying: %s -> %s", fileName.c_str(), dstFilePath.c_str());
            
            // Open destination file on SD
#ifdef HAS_SD_CARD_SUPPORT
            spiMutexTake();
            File dstFile = SD.open(dstFilePath, FILE_WRITE);
            if (!dstFile) {
                spiMutexGive();
                DEBUG(" [FAIL - can't open dest]\n");
                errorCount++;
                file = srcDir.openNextFile();
                continue;
            }
            
            // Copy data in chunks
            uint8_t buffer[512];
            size_t fileSize = file.size();
            size_t bytesRead;
            
            while ((bytesRead = file.read(buffer, sizeof(buffer))) > 0) {
                dstFile.write(buffer, bytesRead);
            }
            
            dstFile.close();
            spiMutexGive();
            
            totalBytes += fileSize;
            fileCount++;
            
            DEBUG(" [OK - %d bytes]\n", fileSize);
            
            // Delete source file if requested
            if (deleteSource) {
                LittleFS.remove(fileName);
                DEBUG("  Deleted source file\n");
            }
#endif
        }
        file = srcDir.openNextFile();
    }
    
    srcDir.close();
    
    DEBUG("\nCopied %d files (%d KB) with %d errors\n", 
          fileCount, totalBytes / 1024, errorCount);
    
    return errorCount == 0;
}
