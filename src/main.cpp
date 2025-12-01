#include "debug.h"
#include "led.h"
#include "webserver.h"
#include "racehistory.h"
#include "storage.h"
#include "selftest.h"
#include <ElegantOTA.h>
#ifdef ESP32S3
#include "rgbled.h"
#endif

static RX5808 rx(PIN_RX5808_RSSI, PIN_RX5808_DATA, PIN_RX5808_SELECT, PIN_RX5808_CLOCK);
static Config config;
static Storage storage;
static SelfTest selfTest;
static Webserver ws;
static Buzzer buzzer;
static Led led;
static RaceHistory raceHistory;
#ifdef ESP32S3
static RgbLed rgbLed;
RgbLed* g_rgbLed = &rgbLed;
#else
void* g_rgbLed = nullptr;
#endif
static LapTimer timer;
static BatteryMonitor monitor;

static TaskHandle_t xTimerTask = NULL;

static void parallelTask(void *pvArgs) {
    for (;;) {
        uint32_t currentTimeMs = millis();
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
#ifdef ESP32S3
        rgbLed.handleRgbLed(currentTimeMs);
#endif
        ws.handleWebUpdate(currentTimeMs);
        config.handleEeprom(currentTimeMs);
        rx.handleFrequencyChange(currentTimeMs, config.getFrequency());
        monitor.checkBatteryState(currentTimeMs, config.getAlarmThreshold());
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
    }
}

static void initParallelTask() {
    disableCore0WDT();
    xTaskCreatePinnedToCore(parallelTask, "parallelTask", 8192, NULL, 0, &xTimerTask, 0);
}

void setup() {
    DEBUG_INIT;
#ifdef ESP32S3
    DEBUG("ESP32S3 build detected\n");
#else
    DEBUG("Generic ESP32 build\n");
#endif
    config.init();
    rx.init();
    buzzer.init(PIN_BUZZER, BUZZER_INVERTED);
    led.init(PIN_LED, false);
#ifdef ESP32S3
    rgbLed.init();
    // Apply saved LED configuration
    rgbLed.setBrightness(config.getLedBrightness());
    uint8_t ledMode = config.getLedMode();
    if (ledMode == 0) {
        rgbLed.off();
    } else if (ledMode == 1) {
        rgbLed.setManualColor(config.getLedColor());
    } else if (ledMode == 2) {
        rgbLed.setManualColor(config.getLedColor());
        rgbLed.setManualMode(RGB_PULSE);
    } else if (ledMode == 3) {
        rgbLed.setRainbowWave();
    }
#endif
    timer.init(&config, &rx, &buzzer, &led);
    monitor.init(PIN_VBAT, VBAT_SCALE, VBAT_ADD, &buzzer, &led);
    selfTest.init(&storage);
    ws.init(&config, &timer, &monitor, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx);
    led.on(400);
    buzzer.beep(200);
    initParallelTask();
}

void loop() {
    uint32_t currentTimeMs = millis();
    timer.handleLapTimerUpdate(currentTimeMs);
    ElegantOTA.loop();
}
