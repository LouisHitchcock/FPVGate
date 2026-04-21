#ifndef SELFTEST_H
#define SELFTEST_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>
#include "config.h"

// Forward declarations
class Config;
class Storage;
class RX5808;
class LapTimer;
class Buzzer;
class RaceHistory;
class RgbLed;

// 3-state outcome. SKIP is distinct from FAIL so tests that don't apply to
// the current board/hardware (e.g. no SD inserted, no RGB LED chain) don't
// look like failures. All "is this feature present?" decisions are made at
// RUNTIME so adding a new board doesn't silently flip a test to fail.
enum class TestStatus : uint8_t {
    Pass = 0,
    Fail = 1,
    Skip = 2,
};

struct TestResult {
    String name;
    TestStatus status = TestStatus::Fail;
    String details;
    uint32_t duration_ms = 0;

    // Convenience: treat SKIP as "not failing" for backwards-compat call sites.
    bool passed() const { return status != TestStatus::Fail; }
    const char* statusString() const {
        switch (status) {
            case TestStatus::Pass: return "pass";
            case TestStatus::Skip: return "skip";
            default: return "fail";
        }
    }
};

class SelfTest {
   public:
    SelfTest();
    void init(Storage* stor);
    
    // Run all tests
    bool runAllTests();
    
    // Individual tests. None of these are compile-gated: each returns SKIP at
    // runtime when the capability isn't available on this board.
    TestResult testStorage();
    TestResult testSDCard();
    TestResult testLittleFS();
    TestResult testEEPROM();
    TestResult testWiFi();
    TestResult testBattery();
    TestResult testRX5808(RX5808* rx5808);
    TestResult testLapTimer(LapTimer* timer);
    TestResult testAudio(Buzzer* buzzer);
    TestResult testConfig(Config* config);
    TestResult testRaceHistory(RaceHistory* history);
    TestResult testWebServer();
    TestResult testOTA();
    TestResult testTrackManager();
    TestResult testWebhooks();
    TestResult testTransport();
    TestResult testSPIMod(RX5808* rx5808);
    TestResult testRGBLED(RgbLed* rgbLed);
    TestResult testUSB();
    
    // Get results
    String getResultsJSON();
    bool allTestsPassed() const { return allPassed; }
    
   private:
    Storage* storage;
    std::vector<TestResult> results;
    bool allPassed;
};

#endif
