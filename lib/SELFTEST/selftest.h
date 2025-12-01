#ifndef SELFTEST_H
#define SELFTEST_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

// Forward declarations
class Config;
class Storage;
class RX5808;
class LapTimer;
class Buzzer;
class RaceHistory;

#ifdef ESP32S3
class RgbLed;
#endif

struct TestResult {
    String name;
    bool passed;
    String details;
    uint32_t duration_ms;
};

class SelfTest {
   public:
    SelfTest();
    void init(Storage* stor);
    
    // Run all tests
    bool runAllTests();
    
    // Individual tests
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
    
#ifdef ESP32S3
    TestResult testRGBLED(RgbLed* rgbLed);
#endif
    
    // Get results
    String getResultsJSON();
    bool allTestsPassed() const { return allPassed; }
    
   private:
    Storage* storage;
    std::vector<TestResult> results;
    bool allPassed;
};

#endif
