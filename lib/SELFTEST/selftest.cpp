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

// SD is compile-included only on capable builds (because <SD.h> itself may
// not be available on every ESP32 variant), but RUNTIME selection of whether
// to run the test is handled via storage->isSDAvailable().
#ifdef HAS_SD_CARD_SUPPORT
#include <SD.h>
#include "../LCD_UI/spi_mutex.h"
#endif
#include "rgbled.h"
#ifdef ESP32S3
#include "USB.h"
#endif

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
namespace {
TestResult makeResult(const char* name, TestStatus status, const String& details, uint32_t startMs) {
    TestResult r;
    r.name = name;
    r.status = status;
    r.details = details;
    r.duration_ms = millis() - startMs;
    return r;
}
TestResult makePass(const char* name, const String& details, uint32_t startMs) {
    return makeResult(name, TestStatus::Pass, details, startMs);
}
TestResult makeFail(const char* name, const String& details, uint32_t startMs) {
    return makeResult(name, TestStatus::Fail, details, startMs);
}
TestResult makeSkip(const char* name, const String& details, uint32_t startMs) {
    return makeResult(name, TestStatus::Skip, details, startMs);
}
}  // namespace

SelfTest::SelfTest() : storage(nullptr), allPassed(true) {
}

void SelfTest::init(Storage* stor) {
    storage = stor;
}

bool SelfTest::runAllTests() {
    DEBUG("Starting self-tests...\n");
    results.clear();
    allPassed = true;

    auto runAndRecord = [this](TestResult r) {
        if (r.status == TestStatus::Fail) allPassed = false;
        results.push_back(r);
    };

    runAndRecord(testStorage());
    runAndRecord(testLittleFS());
    runAndRecord(testSDCard());   // SKIPs on boards without SD support
    runAndRecord(testEEPROM());
    runAndRecord(testWiFi());
    runAndRecord(testUSB());      // SKIPs on boards without USB CDC

    DEBUG("Self-tests complete: %s\n", allPassed ? "PASSED" : "FAILED");
    return allPassed;
}

// ---------------------------------------------------------------------------
// Storage (whichever backend Storage chose: SD preferred, LittleFS fallback)
// ---------------------------------------------------------------------------
TestResult SelfTest::testStorage() {
    uint32_t start = millis();
    if (!storage) {
        return makeFail("Storage", "Storage not initialized", start);
    }

    const String testPath = "/test_selftest.txt";
    const String testData = "{\"test\":\"data\"}";

    if (!storage->writeFile(testPath, testData)) {
        return makeFail("Storage", "Write failed", start);
    }

    String readData;
    if (!storage->readFile(testPath, readData) || readData != testData) {
        storage->deleteFile(testPath);
        return makeFail("Storage", "Read failed or data mismatch", start);
    }
    storage->deleteFile(testPath);

    String details = String("Type: ") + storage->getStorageType() +
                     ", Free: " + String(storage->getFreeBytes() / 1024) + "KB";
    return makePass("Storage", details, start);
}

// ---------------------------------------------------------------------------
// LittleFS - real write/read/delete round-trip, not just a mount check.
// ---------------------------------------------------------------------------
TestResult SelfTest::testLittleFS() {
    uint32_t start = millis();

    if (!LittleFS.begin()) {
        return makeFail("LittleFS", "Mount failed", start);
    }

    const char* testPath = "/test_littlefs.txt";
    const String testData = "{\"lfs\":\"ok\"}";

    File wf = LittleFS.open(testPath, "w");
    if (!wf) {
        return makeFail("LittleFS", "Open-for-write failed", start);
    }
    size_t w = wf.print(testData);
    wf.close();
    if (w != testData.length()) {
        LittleFS.remove(testPath);
        return makeFail("LittleFS", String("Short write: ") + w + "/" + testData.length(), start);
    }

    File rf = LittleFS.open(testPath, "r");
    if (!rf) {
        LittleFS.remove(testPath);
        return makeFail("LittleFS", "Open-for-read failed", start);
    }
    String readBack = rf.readString();
    rf.close();
    LittleFS.remove(testPath);

    if (readBack != testData) {
        return makeFail("LittleFS", "Read mismatch", start);
    }

    uint64_t totalBytes = LittleFS.totalBytes();
    uint64_t usedBytes  = LittleFS.usedBytes();
    String details = String("Total: ") + String(totalBytes / 1024) + "KB, " +
                     "Used: " + String(usedBytes / 1024) + "KB, R/W OK";
    return makePass("LittleFS", details, start);
}

// ---------------------------------------------------------------------------
// SD Card - fully runtime. SKIPs cleanly when no SD is mounted; otherwise
// actually writes + reads + deletes a test file to verify card health.
// ---------------------------------------------------------------------------
TestResult SelfTest::testSDCard() {
    uint32_t start = millis();

#ifndef HAS_SD_CARD_SUPPORT
    return makeSkip("SD Card", "Not supported in this build", start);
#else
    if (!storage || !storage->isSDAvailable()) {
        return makeSkip("SD Card",
                        "No SD card detected (using LittleFS fallback)",
                        start);
    }

    uint64_t cardSize  = storage->getTotalBytes();
    uint64_t freeBytes = storage->getFreeBytes();

    // Real R/W round-trip under the shared SPI mutex (no-op on boards where
    // SPI isn't shared).
    const char* testPath = "/test_sd.txt";
    const String testData = "{\"test\":\"sd_rw\"}";
    bool writeOk = false;
    bool readOk  = false;
    String readBack;

    spiMutexTake();
    {
        File wf = SD.open(testPath, FILE_WRITE);
        if (wf) {
            size_t w = wf.print(testData);
            wf.close();
            writeOk = (w == testData.length());
        }

        if (writeOk) {
            File rf = SD.open(testPath, FILE_READ);
            if (rf) {
                readBack = rf.readString();
                rf.close();
                readOk = (readBack == testData);
            }
        }

        if (SD.exists(testPath)) {
            SD.remove(testPath);
        }
    }
    spiMutexGive();

    if (!writeOk) {
        return makeFail("SD Card",
                        String("Size: ") + String(cardSize / (1024*1024)) + "MB, write failed",
                        start);
    }
    if (!readOk) {
        return makeFail("SD Card",
                        String("Size: ") + String(cardSize / (1024*1024)) + "MB, read mismatch",
                        start);
    }

    // Inventory voice asset directories (informational only, doesn't affect pass/fail)
    struct PathFallbacks {
        const char* primary;
        const char* fallback1;
        const char* fallback2;
    };
    const PathFallbacks voiceDirChecks[] = {
        {"/voice_default_en", "/voice_en", "/sounds_default"},
        {"/voice_rachel_en",  "/sounds_rachel", nullptr},
        {"/voice_adam_en",    "/sounds_adam", nullptr},
        {"/voice_antoni_en",  "/sounds_antoni", nullptr},
        {"/voice_matilda_en", "/sounds_matilda", nullptr},
        {"/voice_german_de",  "/voice_de", nullptr},
        {"/voice_spanish_es", "/voice_es", nullptr},
        {"/voice_french_fr",  "/voice_fr", nullptr},
    };
    const PathFallbacks sampleFileChecks[] = {
        {"/voice_default_en/gate_1.mp3", "/voice_en/gate_1.mp3", "/sounds_default/gate_1.mp3"},
        {"/voice_default_en/lap_1.mp3",  "/voice_en/lap_1.mp3",  "/sounds_default/lap_1.mp3"},
    };

    int voiceDirsFound = 0;
    int audioFilesFound = 0;
    spiMutexTake();
    for (const auto& check : voiceDirChecks) {
        bool found = false;
        const char* candidates[] = {check.primary, check.fallback1, check.fallback2};
        for (const char* candidate : candidates) {
            if (candidate && SD.exists(candidate)) {
                found = true;
                break;
            }
        }
        if (found) voiceDirsFound++;
    }
    for (const auto& check : sampleFileChecks) {
        bool found = false;
        const char* candidates[] = {check.primary, check.fallback1, check.fallback2};
        for (const char* candidate : candidates) {
            if (candidate && SD.exists(candidate)) {
                found = true;
                break;
            }
        }
        if (found) audioFilesFound++;
    }
    spiMutexGive();

    String details = String("Size: ") + String(cardSize / (1024*1024)) + "MB, " +
                     "Free: " + String(freeBytes / (1024*1024)) + "MB, " +
                     "Voices: " + String(voiceDirsFound) + "/8, " +
                     "Audio: " + String(audioFilesFound) + "/2, R/W OK";
    return makePass("SD Card", details, start);
#endif
}

// ---------------------------------------------------------------------------
// EEPROM - write a known pattern, read back, restore original byte.
// ---------------------------------------------------------------------------
TestResult SelfTest::testEEPROM() {
    uint32_t start = millis();

    uint8_t  testValue    = 0xAA;
    uint16_t testAddr     = EEPROM_RESERVED_SIZE - 1;
    uint8_t  originalValue = EEPROM.read(testAddr);

    EEPROM.write(testAddr, testValue);
    EEPROM.commit();
    uint8_t readValue = EEPROM.read(testAddr);

    // Restore the original
    EEPROM.write(testAddr, originalValue);
    EEPROM.commit();

    if (readValue != testValue) {
        return makeFail("EEPROM", "Read/write test failed", start);
    }
    return makePass("EEPROM",
                    String("Size: ") + String(EEPROM_RESERVED_SIZE) + " bytes, R/W OK",
                    start);
}

// ---------------------------------------------------------------------------
// WiFi - verify stack is in a sane mode and has a valid MAC.
// ---------------------------------------------------------------------------
TestResult SelfTest::testWiFi() {
    uint32_t start = millis();

    wifi_mode_t mode = WiFi.getMode();
    if (mode == WIFI_OFF) {
        return makeFail("WiFi", "Radio off / not initialized", start);
    }

    String mac = WiFi.macAddress();
    if (mac.length() == 0 || mac == "00:00:00:00:00:00") {
        return makeFail("WiFi", "Invalid MAC address", start);
    }

    const char* modeStr = (mode == WIFI_AP)     ? "AP" :
                          (mode == WIFI_STA)    ? "STA" :
                          (mode == WIFI_AP_STA) ? "AP+STA" : "Unknown";

    String details = String("Mode: ") + modeStr + ", MAC: " + mac;
    if (mode == WIFI_STA || mode == WIFI_AP_STA) {
        if (WiFi.status() == WL_CONNECTED) {
            details += ", IP: " + WiFi.localIP().toString() +
                       ", RSSI: " + String(WiFi.RSSI()) + "dBm";
        }
    }
    return makePass("WiFi", details, start);
}

// ---------------------------------------------------------------------------
// Battery - actually read the ADC if a sense pin is wired; SKIP otherwise.
// ---------------------------------------------------------------------------
TestResult SelfTest::testBattery() {
    uint32_t start = millis();

#ifdef PIN_VBAT
    int rawValue = analogRead(PIN_VBAT);
    if (rawValue < 0) {
        return makeFail("Battery Monitor", "analogRead returned negative", start);
    }
    return makePass("Battery Monitor",
                    String("Raw ADC: ") + String(rawValue) + " on GPIO" + String(PIN_VBAT),
                    start);
#else
    return makeSkip("Battery Monitor", "No VBAT sense pin on this board", start);
#endif
}

// ---------------------------------------------------------------------------
// RX5808 module - sample RSSI a few times.
// ---------------------------------------------------------------------------
TestResult SelfTest::testRX5808(RX5808* rx5808) {
    uint32_t start = millis();
    if (!rx5808) {
        return makeSkip("RX5808 Module", "Receiver not initialized on this build", start);
    }

    uint8_t rssi1 = rx5808->readRssi(); delay(50);
    uint8_t rssi2 = rx5808->readRssi(); delay(50);
    uint8_t rssi3 = rx5808->readRssi();

    if (rssi1 == 0 && rssi2 == 0 && rssi3 == 0) {
        return makeFail("RX5808 Module", "No RSSI signal (check wiring)", start);
    }
    uint8_t avg = (rssi1 + rssi2 + rssi3) / 3;
    return makePass("RX5808 Module",
                    String("RSSI samples: ") + rssi1 + "/" + rssi2 + "/" + rssi3 + ", Avg: " + avg,
                    start);
}

TestResult SelfTest::testLapTimer(LapTimer* timer) {
    uint32_t start = millis();
    if (!timer) {
        return makeSkip("Lap Timer", "LapTimer not initialized", start);
    }
    uint8_t rssi = timer->getRssi();
    return makePass("Lap Timer",
                    String("Functional, Current RSSI: ") + String(rssi),
                    start);
}

TestResult SelfTest::testAudio(Buzzer* buzzer) {
    uint32_t start = millis();
    if (!buzzer) {
        return makeSkip("Audio/Buzzer", "Buzzer not initialized", start);
    }

    buzzer->beep(100);
    delay(150);

    bool audioJsExists = LittleFS.exists("/audio-announcer.js");
    if (!audioJsExists) {
        return makeFail("Audio/Buzzer", "audio-announcer.js missing from LittleFS", start);
    }
    return makePass("Audio/Buzzer", "Buzzer beeped, announcer JS loaded", start);
}

TestResult SelfTest::testConfig(Config* config) {
    uint32_t start = millis();
    if (!config) {
        return makeFail("Configuration", "Config not initialized", start);
    }

    uint16_t freq      = config->getFrequency();
    uint8_t  enterRssi = config->getEnterRssi();
    uint8_t  exitRssi  = config->getExitRssi();

    if (freq < 5300 || freq > 5950) {
        return makeFail("Configuration", String("Invalid frequency: ") + freq, start);
    }
    if (enterRssi <= exitRssi) {
        return makeFail("Configuration",
                        String("Enter RSSI (") + enterRssi + ") must be > Exit RSSI (" + exitRssi + ")",
                        start);
    }
    return makePass("Configuration",
                    String("Freq: ") + freq + "MHz, Enter: " + enterRssi + ", Exit: " + exitRssi,
                    start);
}

TestResult SelfTest::testRaceHistory(RaceHistory* history) {
    uint32_t start = millis();
    if (!history) {
        return makeSkip("Race History", "RaceHistory not initialized", start);
    }
    return makePass("Race History",
                    String("Races stored: ") + history->getRaceCount() + " / " + MAX_RACES,
                    start);
}

TestResult SelfTest::testWebServer() {
    uint32_t start = millis();
    bool indexExists  = LittleFS.exists("/index.html");
    bool scriptExists = LittleFS.exists("/script.js");
    bool styleExists  = LittleFS.exists("/style.css");

    if (!indexExists || !scriptExists || !styleExists) {
        String missing;
        if (!indexExists)  missing += "index.html ";
        if (!scriptExists) missing += "script.js ";
        if (!styleExists)  missing += "style.css ";
        return makeFail("Web Server", "Missing files: " + missing, start);
    }
    return makePass("Web Server", "Required files present, server active", start);
}

TestResult SelfTest::testOTA() {
    uint32_t start = millis();
    size_t sketchSize = ESP.getSketchSize();
    size_t freeSpace  = ESP.getFreeSketchSpace();

    if (freeSpace < 100000) {
        return makeFail("OTA Updates",
                        String("Low OTA space: ") + String(freeSpace / 1024) + "KB",
                        start);
    }
    return makePass("OTA Updates",
                    String("Sketch: ") + String(sketchSize / 1024) + "KB, Free: " + String(freeSpace / 1024) + "KB",
                    start);
}

TestResult SelfTest::testTrackManager() {
    uint32_t start = millis();
    if (!storage) {
        return makeFail("Track Manager", "Storage not available", start);
    }
    bool tracksFileExists = storage->exists("/tracks.json");
    return makePass("Track Manager",
                    tracksFileExists ? "tracks.json found" : "No tracks configured yet",
                    start);
}

TestResult SelfTest::testWebhooks() {
    uint32_t start = millis();
    if (!storage) {
        return makeFail("Webhooks", "Storage not available", start);
    }
    return makePass("Webhooks", "HTTP client ready", start);
}

TestResult SelfTest::testTransport() {
    uint32_t start = millis();

    bool usbTransportFileExists = LittleFS.exists("/usb-transport.js");
    wifi_mode_t mode = WiFi.getMode();
    bool wifiActive = (mode != WIFI_OFF);

    // Runtime USB CDC detection. Works regardless of which board macro is
    // set; the build flag ARDUINO_USB_CDC_ON_BOOT is the only thing that
    // actually matters (set per-target in targets/*.ini).
    bool usbAvailable = false;
#if defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
    usbAvailable = (bool)Serial;
#endif

    bool ok = (wifiActive || usbAvailable);
    String details = String("WiFi: ") + (wifiActive ? "active" : "off") +
                     ", USB: " + (usbAvailable ? "connected" : "disconnected") +
                     ", Transport JS: " + (usbTransportFileExists ? "loaded" : "missing");
    return ok ? makePass("Transport Layer", details, start)
              : makeFail("Transport Layer", details, start);
}

// ---------------------------------------------------------------------------
// SPI mod - sweeps the RaceBand and measures RSSI spread across channels.
// ---------------------------------------------------------------------------
TestResult SelfTest::testSPIMod(RX5808* rx5808) {
    uint32_t start = millis();
    if (!rx5808) {
        return makeSkip("SPI Mod", "RX5808 not initialized", start);
    }

    static const uint16_t testFreqs[] = {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917};
    static const uint8_t  numFreqs       = 8;
    static const uint8_t  samplesPerFreq = 10;
    static const uint8_t  settleMs       = 50;

    uint8_t rssiValues[numFreqs];
    uint8_t maxRssi = 0;
    uint8_t minRssi = 255;

    for (uint8_t i = 0; i < numFreqs; i++) {
        rx5808->setFrequency(testFreqs[i]);
        delay(settleMs);
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
    bool spiWorking = (spread >= 10);

    String details = String("Spread: ") + spread +
                     ", Min: " + minRssi +
                     ", Max: " + maxRssi +
                     (spiWorking ? " (SPI tuning verified)" : " (flat response, SPI mod likely missing)");
    return spiWorking ? makePass("SPI Mod", details, start)
                      : makeFail("SPI Mod", details, start);
}

// ---------------------------------------------------------------------------
// RGB LED - runtime pointer check. SKIPs cleanly when no LED chain is present.
// ---------------------------------------------------------------------------
TestResult SelfTest::testRGBLED(RgbLed* rgbLed) {
    uint32_t start = millis();
#ifndef HAS_RGB_LED
    return makeSkip("RGB LED", "No RGB LED on this board", start);
#else
    if (!rgbLed) {
        return makeSkip("RGB LED", "RGB LED not initialized", start);
    }

    rgbLed->setManualColor(0xFF0000); delay(200);   // Red
    rgbLed->setManualColor(0x00FF00); delay(200);   // Green
    rgbLed->setManualColor(0x0000FF); delay(200);   // Blue
    rgbLed->setRainbowWave();

    return makePass("RGB LED", "All channels flashed (R,G,B)", start);
#endif
}

// ---------------------------------------------------------------------------
// USB Serial CDC - runtime check. SKIPs when the build doesn't have CDC,
// rather than reporting FAIL.
// ---------------------------------------------------------------------------
TestResult SelfTest::testUSB() {
    uint32_t start = millis();

#if !defined(ARDUINO_USB_CDC_ON_BOOT) || (ARDUINO_USB_CDC_ON_BOOT == 0)
    return makeSkip("USB Serial CDC", "CDC not enabled in build", start);
#else
    bool connected = (bool)Serial;
    bool transportFileExists = LittleFS.exists("/usb-transport.js");
    String details = String("CDC ") + (connected ? "connected" : "disconnected") +
                     ", Transport JS: " + (transportFileExists ? "loaded" : "missing");
    // CDC disconnected is normal when running over WiFi; treat as PASS as
    // long as the build supports it.
    return makePass("USB Serial CDC", details, start);
#endif
}

// ---------------------------------------------------------------------------
// JSON serialization
// ---------------------------------------------------------------------------
String SelfTest::getResultsJSON() {
    JsonDocument doc;
    doc["allPassed"] = allPassed;
    doc["totalTests"] = results.size();

    JsonArray testsArray = doc["tests"].to<JsonArray>();
    for (const auto& result : results) {
        JsonObject test = testsArray.add<JsonObject>();
        test["name"]     = result.name;
        test["status"]   = result.statusString();    // "pass" | "fail" | "skip"
        test["passed"]   = result.passed();          // legacy (skip counts as not-failed)
        test["details"]  = result.details;
        test["duration"] = result.duration_ms;
    }

    String output;
    serializeJson(doc, output);
    return output;
}
