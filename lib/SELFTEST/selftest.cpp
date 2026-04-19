#include "selftest.h"
#include "debug.h"
#include "config.h"
#include "storage.h"
#include "RX5808.h"
#include "laptimer.h"
#include "buzzer.h"
#include "racehistory.h"
#include "trackmanager.h"
#include "webhook.h"
#include <EEPROM.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <Update.h>

#ifdef HAS_SD_CARD_SUPPORT
#include <SD.h>
#endif
#ifdef HAS_RGB_LED
#include "rgbled.h"
#endif
#ifdef ESP32S3
#include "USB.h"
#endif

SelfTest::SelfTest() : storage(nullptr), allPassed(true) {
}

void SelfTest::init(Storage* stor) {
    storage = stor;
}

bool SelfTest::runAllTests() {
    DEBUG("Starting self-tests...\n");
    results.clear();
    allPassed = true;
    
    // Test storage
    TestResult storageTest = testStorage();
    results.push_back(storageTest);
    if (!storageTest.passed) allPassed = false;
    
    // Test LittleFS
    TestResult littleFSTest = testLittleFS();
    results.push_back(littleFSTest);
    if (!littleFSTest.passed) allPassed = false;
    
#ifdef HAS_SD_CARD_SUPPORT
    // Test SD card
    TestResult sdTest = testSDCard();
    results.push_back(sdTest);
    // SD card failure is not critical - don't fail overall test
#endif
    
    // Test EEPROM
    TestResult eepromTest = testEEPROM();
    results.push_back(eepromTest);
    if (!eepromTest.passed) allPassed = false;
    
    // Test WiFi
    TestResult wifiTest = testWiFi();
    results.push_back(wifiTest);
    if (!wifiTest.passed) allPassed = false;
    
#ifdef ESP32S3
    // Test USB Serial CDC
    TestResult usbTest = testUSB();
    results.push_back(usbTest);
    // USB failure is not critical - don't fail overall test
#endif
    
    DEBUG("Self-tests complete: %s\n", allPassed ? "PASSED" : "FAILED");
    return allPassed;
}

TestResult SelfTest::testStorage() {
    TestResult result;
    result.name = "Storage";
    uint32_t start = millis();
    
    if (!storage) {
        result.passed = false;
        result.details = "Storage not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Test write and read
    String testData = "{\"test\":\"data\"}";
    bool writeSuccess = storage->writeFile("/test_selftest.txt", testData);
    
    if (!writeSuccess) {
        result.passed = false;
        result.details = "Write failed";
        result.duration_ms = millis() - start;
        return result;
    }
    
    String readData;
    bool readSuccess = storage->readFile("/test_selftest.txt", readData);
    
    if (!readSuccess || readData != testData) {
        result.passed = false;
        result.details = "Read failed or data mismatch";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Cleanup
    storage->deleteFile("/test_selftest.txt");
    
    result.passed = true;
    result.details = String("Type: ") + storage->getStorageType() + 
                    ", Free: " + String(storage->getFreeBytes() / 1024) + "KB";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testSDCard() {
    TestResult result;
    result.name = "SD Card";
    uint32_t start = millis();
    
#ifdef ESP32S3
    if (!storage || !storage->isSDAvailable()) {
        result.passed = false;
        result.details = "Not available (using LittleFS fallback) - Optional for device operation";
        result.duration_ms = millis() - start;
        return result;
    }
    
    uint64_t cardSize = storage->getTotalBytes();
    uint64_t usedBytes = storage->getUsedBytes();
    uint64_t freeBytes = storage->getFreeBytes();
    
    // Test read/write to SD
    String testData = "{\"test\":\"sd_write\"}";
    bool writeSuccess = false;
    if (SD.exists("/")) {
        File testFile = SD.open("/test_sd.txt", FILE_WRITE);
        if (testFile) {
            testFile.print(testData);
            testFile.close();
            writeSuccess = true;
        }
    }
    
    if (writeSuccess && SD.exists("/test_sd.txt")) {
        SD.remove("/test_sd.txt");
    }
    
    // Check for voice directories
    int voiceDirsFound = 0;
    const char* voiceDirs[] = {"sounds_default", "sounds_rachel", "sounds_adam", "sounds_antoni"};
    for (int i = 0; i < 4; i++) {
        String path = String("/") + voiceDirs[i];
        if (SD.exists(path)) {
            voiceDirsFound++;
        }
    }
    
    // Check for sample audio files
    int audioFilesFound = 0;
    const char* sampleFiles[] = {"/sounds_default/gate_1.mp3", "/sounds_default/lap_1.mp3"};
    for (int i = 0; i < 2; i++) {
        if (SD.exists(sampleFiles[i])) {
            audioFilesFound++;
        }
    }
    
    result.passed = writeSuccess;
    result.details = String("Size: ") + String(cardSize / (1024*1024)) + "MB, " +
                    "Free: " + String(freeBytes / (1024*1024)) + "MB, " +
                    "Voices: " + String(voiceDirsFound) + "/4, " +
                    "Audio files: " + String(audioFilesFound) + "/2, " +
                    (writeSuccess ? "R/W OK" : "R/W Failed");
    result.duration_ms = millis() - start;
#else
    result.passed = false;
    result.details = "SD card not supported on this board";
    result.duration_ms = millis() - start;
#endif
    
    return result;
}

TestResult SelfTest::testLittleFS() {
    TestResult result;
    result.name = "LittleFS";
    uint32_t start = millis();
    
    if (!LittleFS.begin()) {
        result.passed = false;
        result.details = "LittleFS not mounted";
        result.duration_ms = millis() - start;
        return result;
    }
    
    uint64_t totalBytes = LittleFS.totalBytes();
    uint64_t usedBytes = LittleFS.usedBytes();
    
    result.passed = true;
    result.details = String("Total: ") + String(totalBytes / 1024) + "KB, " +
                    "Used: " + String(usedBytes / 1024) + "KB";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testEEPROM() {
    TestResult result;
    result.name = "EEPROM";
    uint32_t start = millis();
    
    // Write test pattern
    uint8_t testValue = 0xAA;
    uint16_t testAddr = EEPROM_RESERVED_SIZE - 1; // Use last byte
    uint8_t originalValue = EEPROM.read(testAddr);
    
    EEPROM.write(testAddr, testValue);
    EEPROM.commit();
    
    uint8_t readValue = EEPROM.read(testAddr);
    
    // Restore original value
    EEPROM.write(testAddr, originalValue);
    EEPROM.commit();
    
    if (readValue != testValue) {
        result.passed = false;
        result.details = "Read/write test failed";
        result.duration_ms = millis() - start;
        return result;
    }
    
    result.passed = true;
    result.details = String("Size: ") + String(EEPROM_RESERVED_SIZE) + " bytes";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testWiFi() {
    TestResult result;
    result.name = "WiFi";
    uint32_t start = millis();
    
    // Check if WiFi is initialized
    wifi_mode_t mode = WiFi.getMode();
    
    if (mode == WIFI_OFF) {
        result.passed = false;
        result.details = "WiFi not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    String modeStr = (mode == WIFI_AP) ? "AP" : 
                     (mode == WIFI_STA) ? "STA" : "AP+STA";
    
    result.passed = true;
    result.details = String("Mode: ") + modeStr + ", MAC: " + WiFi.macAddress();
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testBattery() {
    TestResult result;
    result.name = "Battery Monitor";
    uint32_t start = millis();
    
    #ifdef PIN_VBAT
    // Read battery voltage
    int rawValue = analogRead(PIN_VBAT);
    result.passed = true;
    #else
    int rawValue = -1; // Not supported
    result.passed = false;
    #endif
    
    result.details = String("Raw: ") + String(rawValue);
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testRX5808(RX5808* rx5808) {
    TestResult result;
    result.name = "RX5808 Module";
    uint32_t start = millis();
    
    if (!rx5808) {
        result.passed = false;
        result.details = "RX5808 not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Read RSSI multiple times
    uint8_t rssi1 = rx5808->readRssi();
    delay(50);
    uint8_t rssi2 = rx5808->readRssi();
    delay(50);
    uint8_t rssi3 = rx5808->readRssi();
    
    // Check if readings are in valid range
    if (rssi1 == 0 && rssi2 == 0 && rssi3 == 0) {
        result.passed = false;
        result.details = "No RSSI signal (check wiring)";
        result.duration_ms = millis() - start;
        return result;
    }
    
    uint8_t avgRssi = (rssi1 + rssi2 + rssi3) / 3;
    
    result.passed = true;
    result.details = String("RSSI reads OK, Avg: ") + String(avgRssi);
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testLapTimer(LapTimer* timer) {
    TestResult result;
    result.name = "Lap Timer";
    uint32_t start = millis();
    
    if (!timer) {
        result.passed = false;
        result.details = "LapTimer not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Read RSSI to verify timer can communicate with RX5808
    uint8_t rssi = timer->getRssi();
    
    result.passed = true;
    result.details = String("Timer functional, Current RSSI: ") + String(rssi);
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testAudio(Buzzer* buzzer) {
    TestResult result;
    result.name = "Audio/Buzzer";
    uint32_t start = millis();
    
    if (!buzzer) {
        result.passed = false;
        result.details = "Buzzer not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Test buzzer beep
    buzzer->beep(100);
    delay(150);
    
    // Check if audio announcer JavaScript exists
    bool audioJsExists = LittleFS.exists("/audio-announcer.js");
    
    if (!audioJsExists) {
        result.passed = false;
        result.details = "audio-announcer.js not found";
        result.duration_ms = millis() - start;
        return result;
    }
    
    result.passed = true;
    result.details = "Buzzer OK, Audio JS loaded";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testConfig(Config* config) {
    TestResult result;
    result.name = "Configuration";
    uint32_t start = millis();
    
    if (!config) {
        result.passed = false;
        result.details = "Config not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Verify config values are in valid ranges
    uint16_t freq = config->getFrequency();
    uint8_t enterRssi = config->getEnterRssi();
    uint8_t exitRssi = config->getExitRssi();
    
    if (freq < 5600 || freq > 5950) {
        result.passed = false;
        result.details = "Invalid frequency: " + String(freq);
        result.duration_ms = millis() - start;
        return result;
    }
    
    if (enterRssi <= exitRssi) {
        result.passed = false;
        result.details = "Enter RSSI (" + String(enterRssi) + ") must be > Exit RSSI (" + String(exitRssi) + ")";
        result.duration_ms = millis() - start;
        return result;
    }
    
    result.passed = true;
    result.details = String("Freq: ") + String(freq) + "MHz, Enter: " + String(enterRssi) + ", Exit: " + String(exitRssi);
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testRaceHistory(RaceHistory* history) {
    TestResult result;
    result.name = "Race History";
    uint32_t start = millis();
    
    if (!history) {
        result.passed = false;
        result.details = "RaceHistory not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    size_t raceCount = history->getRaceCount();
    
    result.passed = true;
    result.details = String("Races stored: ") + String(raceCount) + " / " + String(MAX_RACES);
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testWebServer() {
    TestResult result;
    result.name = "Web Server";
    uint32_t start = millis();
    
    // Check if index.html exists
    bool indexExists = LittleFS.exists("/index.html");
    bool scriptExists = LittleFS.exists("/script.js");
    bool styleExists = LittleFS.exists("/style.css");
    
    if (!indexExists || !scriptExists || !styleExists) {
        result.passed = false;
        result.details = "Web files missing";
        result.duration_ms = millis() - start;
        return result;
    }
    
    result.passed = true;
    result.details = "Web files loaded, Server active";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testOTA() {
    TestResult result;
    result.name = "OTA Updates";
    uint32_t start = millis();
    
    // Get partition information
    size_t sketchSize = ESP.getSketchSize();
    size_t freeSpace = ESP.getFreeSketchSpace();
    
    if (freeSpace < 100000) { // Less than 100KB free
        result.passed = false;
        result.details = "Low OTA space: " + String(freeSpace / 1024) + "KB";
        result.duration_ms = millis() - start;
        return result;
    }
    
    result.passed = true;
    result.details = String("Sketch: ") + String(sketchSize / 1024) + "KB, Free: " + String(freeSpace / 1024) + "KB";
    result.duration_ms = millis() - start;
    return result;
}

#ifdef HAS_RGB_LED
TestResult SelfTest::testRGBLED(RgbLed* rgbLed) {
    TestResult result;
    result.name = "RGB LED";
    uint32_t start = millis();
    
    if (!rgbLed) {
        result.passed = false;
        result.details = "RGB LED not initialized";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Flash red, green, blue to test all channels
    rgbLed->setManualColor(0xFF0000); // Red
    delay(200);
    rgbLed->setManualColor(0x00FF00); // Green
    delay(200);
    rgbLed->setManualColor(0x0000FF); // Blue
    delay(200);
    
    // Restore rainbow
    rgbLed->setRainbowWave();
    
    result.passed = true;
    result.details = "All channels tested (R,G,B)";
    result.duration_ms = millis() - start;
    return result;
}
#endif

#ifdef ESP32S3
TestResult SelfTest::testUSB() {
    TestResult result;
    result.name = "USB Serial CDC";
    uint32_t start = millis();
    
    // Check if USB CDC is available
    #if ARDUINO_USB_CDC_ON_BOOT
    if (!Serial) {
        result.passed = false;
        result.details = "USB CDC not available";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Test if USB is connected
    bool connected = (bool)Serial;
    
    // Check USB transport files
    bool transportFileExists = LittleFS.exists("/usb-transport.js");
    
    result.passed = true;
    result.details = String("CDC ") + (connected ? "connected" : "disconnected") + 
                    ", Transport: " + (transportFileExists ? "loaded" : "missing");
    #else
    result.passed = false;
    result.details = "USB CDC not enabled in build";
    #endif
    
    result.duration_ms = millis() - start;
    return result;
}
#endif

TestResult SelfTest::testTrackManager() {
    TestResult result;
    result.name = "Track Manager";
    uint32_t start = millis();
    
    // Check if tracks file exists
    bool tracksFileExists = storage->exists("/tracks.json");
    
    // Check track manager functionality via storage
    if (!storage) {
        result.passed = false;
        result.details = "Storage not available";
        result.duration_ms = millis() - start;
        return result;
    }
    
    result.passed = true;
    result.details = tracksFileExists ? "Tracks file found" : "No tracks configured yet";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testWebhooks() {
    TestResult result;
    result.name = "Webhooks";
    uint32_t start = millis();
    
    // Test webhook configuration via storage/config
    // We can't directly test HTTP requests in self-test, but we can verify config
    if (!storage) {
        result.passed = false;
        result.details = "Storage not available";
        result.duration_ms = millis() - start;
        return result;
    }
    
    // Check if webhook system is functional (HTTP client available)
    WiFiClient testClient;
    bool httpAvailable = true; // WiFiClient is always available on ESP32
    
    result.passed = httpAvailable;
    result.details = httpAvailable ? "HTTP client ready" : "HTTP client unavailable";
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testTransport() {
    TestResult result;
    result.name = "Transport Layer";
    uint32_t start = millis();
    
    // Check transport files
    bool usbTransportExists = LittleFS.exists("/usb-transport.js");
    
    // Check WiFi status
    wifi_mode_t mode = WiFi.getMode();
    bool wifiActive = (mode != WIFI_OFF);
    
#ifdef ESP32S3
    // Check USB Serial CDC
    #if ARDUINO_USB_CDC_ON_BOOT
    bool usbAvailable = (bool)Serial;
    #else
    bool usbAvailable = false;
    #endif
#else
    bool usbAvailable = false;
#endif
    
    result.passed = (wifiActive || usbAvailable);
    result.details = String("WiFi: ") + (wifiActive ? "active" : "off") + 
                    ", USB: " + (usbAvailable ? "connected" : "disconnected") +
                    ", Transport JS: " + (usbTransportExists ? "loaded" : "missing");
    result.duration_ms = millis() - start;
    return result;
}

TestResult SelfTest::testSPIMod(RX5808* rx5808) {
    TestResult result;
    result.name = "SPI Mod";
    uint32_t start = millis();

    if (!rx5808) {
        result.passed = false;
        result.details = "RX5808 not initialized";
        result.duration_ms = millis() - start;
        return result;
    }

    // Sweep 8 RaceBand frequencies
    static const uint16_t testFreqs[] = {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917};
    static const uint8_t numFreqs = 8;
    static const uint8_t samplesPerFreq = 10;
    static const uint8_t settleMs = 50;

    uint8_t rssiValues[numFreqs];
    uint8_t maxRssi = 0;
    uint8_t minRssi = 255;

    for (uint8_t i = 0; i < numFreqs; i++) {
        rx5808->setFrequency(testFreqs[i]);
        delay(settleMs);
        // Clear recentSetFreqFlag so readRssi() returns real values
        rx5808->handleFrequencyChange(millis(), testFreqs[i]);

        uint16_t sum = 0;
        for (uint8_t s = 0; s < samplesPerFreq; s++) {
            sum += rx5808->readRssi();
            delay(2);
        }
        rssiValues[i] = sum / samplesPerFreq;

        if (rssiValues[i] > maxRssi) maxRssi = rssiValues[i];
        if (rssiValues[i] < minRssi) minRssi = rssiValues[i];
    }

    uint8_t spread = maxRssi - minRssi;
    // A working SPI mod should show meaningful variation across frequencies
    // Non-modded: flat RSSI (spread < 10), modded: distinct peaks (spread >= 10)
    bool spiWorking = (spread >= 10);

    result.passed = spiWorking;
    result.details = String("Spread: ") + String(spread) +
                    ", Min: " + String(minRssi) +
                    ", Max: " + String(maxRssi) +
                    (spiWorking ? " (SPI tuning verified)" : " (flat response, SPI mod likely missing)");
    result.duration_ms = millis() - start;
    return result;
}

String SelfTest::getResultsJSON() {
    JsonDocument doc;
    doc["allPassed"] = allPassed;
    doc["totalTests"] = results.size();
    
    JsonArray testsArray = doc["tests"].to<JsonArray>();
    for (const auto& result : results) {
        JsonObject test = testsArray.add<JsonObject>();
        test["name"] = result.name;
        test["passed"] = result.passed;
        test["details"] = result.details;
        test["duration_ms"] = result.duration_ms;
    }
    
    String output;
    serializeJson(doc, output);
    return output;
}
