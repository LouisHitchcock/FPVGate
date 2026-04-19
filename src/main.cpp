#include <Arduino.h>
#include "freertos/task.h"
#include "debug.h"
#include "led.h"
#include "webserver.h"
#include "racehistory.h"
#include "storage.h"
#include <time.h>
#include <algorithm>
#include <cstring>
#include <vector>
#include "selftest.h"
#include "transport.h"
#include "trackmanager.h"
#include "usb.h"
#include "webhook.h"
#include "rotorhazard.h"
// DISABLED FOR NOW: #include "nodemode.h"
#include <ElegantOTA.h>
#include "esp_log.h"
#include "esp_task_wdt.h"
#ifdef HAS_RGB_LED
#include "rgbled.h"
#endif
#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
#include "../lib/LCD_UI/fpv_lcd_ui.h"
#include "qmi8658.h"
#endif
#ifdef ENABLE_POWER_SWITCH
#include "power.h"
#endif
#ifdef HAS_I2S_AUDIO
#include "audio.h"
#endif

#if defined(ESP32)
// Increase Arduino loopTask stack to reduce overflow risk with LCD/UI + async stack usage.
SET_LOOP_TASK_STACK_SIZE(16384);
extern bool loopTaskWDTEnabled;
#endif

// ====================================================================
// ROTORHAZARD MODE - CURRENTLY DISABLED
// To re-enable RotorHazard support in the future:
// 1. Uncomment the OperationMode enum below
// 2. Uncomment nodeMode initialization and usage throughout this file
// 3. Uncomment the mode detection logic in setup()
// 4. Uncomment the mode-specific code in loop()
// ====================================================================

// DISABLED: Operation mode enumeration
// enum OperationMode {
//     MODE_WIFI,
//     MODE_ROTORHAZARD
// };
// 
// OperationMode currentMode = MODE_WIFI;
// static NodeMode nodeMode;  // RotorHazard node mode controller

// Mode Switching Information:
// =========================
// SOFTWARE MODE SWITCH:
// - Change "opMode" in config via web interface (0=WiFi, 1=RotorHazard)
// - Requires REBOOT to take effect
// - Setting is stored in EEPROM and persists across reboots
//
// PHYSICAL MODE SWITCH (when installed):
// - GPIO9 to GND = Force WiFi mode (overrides software setting)
// - GPIO9 floating = Use software config setting
// - Hardware switch always takes priority over software setting

static RX5808 rx(PIN_RX5808_RSSI, PIN_RX5808_DATA, PIN_RX5808_SELECT, PIN_RX5808_CLOCK);
static Config config;
static Storage storage;
static SelfTest selfTest;
static Webserver ws;
static USBTransport usbTransport;
static TransportManager transportManager;
static Buzzer buzzer;
static Led led;
static RaceHistory raceHistory;
static TrackManager trackManager;
static WebhookManager webhookManager;
static RHManager rhManager;
#ifdef HAS_RGB_LED
static RgbLed rgbLed;
RgbLed* g_rgbLed = &rgbLed;
#else
void* g_rgbLed = nullptr;
#endif
#ifdef HAS_I2S_AUDIO
static AudioAnnouncer audioAnnouncer;
AudioAnnouncer* g_audioAnnouncer = &audioAnnouncer;
#else
void* g_audioAnnouncer = nullptr;
#endif
static LapTimer timer;
#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
static Qmi8658 g_qmi8658;
static FpvLcdUI* g_lcdUi = nullptr;
static TaskHandle_t g_lcdUiTask = nullptr;
static uint16_t g_lastKnownFreq = 0;  // Track config frequency for web->LCD sync
static uint8_t g_lastKnownEnter = 0;  // Track enter RSSI for web->LCD sync
static uint8_t g_lastKnownExit = 0;   // Track exit RSSI for web->LCD sync
static uint8_t g_currentSystem = 0;   // 0=Analog, 1=DJI, 2=HDZero, 3=WalkSnail

// Deferred race save: avoid holding SPI mutex during stop transition (SD + LCD share bus)
static RaceSession s_pendingLcdRaceSave;
static bool s_pendingLcdRaceSaveFlag = false;

// System definitions: { firstBandIdx, bandCount }
static const struct { uint8_t first; uint8_t count; } g_systemBands[] = {
    { 0, 6 },   // Analog: bands 0-5
    { 6, 8 },   // DJI: bands 6-13
    { 14, 4 },  // HDZero: bands 14-17
    { 18, 4 },  // WalkSnail: bands 18-21
};
static const uint8_t LCD_NUM_SYSTEMS = 4;

// Derive system index from band index
static uint8_t systemFromBand(uint8_t bandIdx) {
    if (bandIdx < 6) return 0;
    if (bandIdx < 14) return 1;
    if (bandIdx < 18) return 2;
    if (bandIdx < 22) return 3;
    return 0;
}

// Count available (non-zero freq) channels for a band
static uint8_t countAvailableChannels(uint8_t bandIdx) {
    uint8_t count = 0;
    for (uint8_t i = 0; i < 8; i++) {
        if (Config::getFrequencyForBandChannel(bandIdx, i) > 0) count++;
    }
    return count;
}

// Get next available channel index (skipping 0-freq entries)
static uint8_t nextAvailableChannel(uint8_t bandIdx, uint8_t currentCh, int8_t delta) {
    for (uint8_t i = 0; i < 8; i++) {
        currentCh = (currentCh + 8 + delta) % 8;
        if (Config::getFrequencyForBandChannel(bandIdx, currentCh) > 0) return currentCh;
    }
    return 0;
}
#endif
#ifdef HAS_BATTERY_MONITOR
static BatteryMonitor monitor;  // Enabled for T-Energy S3 or testing
#endif
#ifdef ENABLE_POWER_SWITCH
static PowerManager powerManager;  // Optional deep sleep toggle switch
#endif

static TaskHandle_t xTimerTask = NULL;
static bool sdInitAttempted = false;

static void parallelTask(void *pvArgs) {
    for (;;) {
        uint32_t currentTimeMs = millis();
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
#ifdef HAS_RGB_LED
        rgbLed.handleRgbLed(currentTimeMs);
#endif
        ws.handleWebUpdate(currentTimeMs);
        usbTransport.update(currentTimeMs);
        config.handleEeprom(currentTimeMs);
        rx.handleFrequencyChange(currentTimeMs, config.getFrequency());
#ifdef HAS_BATTERY_MONITOR
        monitor.checkBatteryState(currentTimeMs, config.getAlarmThreshold());
#endif
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
    }
}

static void initParallelTask() {
    disableCore0WDT();
    xTaskCreatePinnedToCore(parallelTask, "parallelTask", 8192, NULL, 0, &xTimerTask, 0);
}

void setup() {
#ifdef ENABLE_POWER_SWITCH
#if defined(WAVESHARE_ESP32S3_LCD2) && defined(LCD_BACKLIGHT)
    powerManager.init(PIN_POWER_SWITCH, LCD_BACKLIGHT);
#endif
#endif
#if defined(WAVESHARE_ESP32S3_LCD2) && defined(PIN_RX5808_POWER_CTRL)
    // PNP high-side: LOW powers RX5808; assert before LCD/storage init (rx.init() repeats for safety).
    pinMode(PIN_RX5808_POWER_CTRL, OUTPUT);
    digitalWrite(PIN_RX5808_POWER_CTRL, LOW);
#endif

    // ====================================================================
    // ROTORHAZARD MODE DETECTION - CURRENTLY DISABLED
    // Mode switching has been disabled - system now runs in WiFi mode only
    // To re-enable: uncomment the mode detection block below
    // ====================================================================
    
    // Initialize storage first (LittleFS only at boot)
    storage.init();
    
    // Initialize config and connect to storage for SD backup/restore
    config.setStorage(&storage);
    config.init();
    
    /* DISABLED: RotorHazard mode detection
    // Check physical mode switch
    pinMode(PIN_MODE_SWITCH, INPUT_PULLUP);
    delay(10);  // Allow pin to settle
    
    int modePin = digitalRead(PIN_MODE_SWITCH);
    
    // Physical switch overrides software setting
    // If pin is explicitly pulled LOW (to GND), force WiFi mode
    // If pin reads HIGH (floating with pullup), use software config
    if (modePin == WIFI_MODE) {
        // Physical switch connected to GND = force WiFi mode
        currentMode = MODE_WIFI;
    } else {
        // Pin is HIGH (floating) = use software config
        uint8_t configMode = config.getOperationMode();
        if (configMode == 0) {
            currentMode = MODE_WIFI;
        } else {
            currentMode = MODE_ROTORHAZARD;
        }
    }
    */
    
    // Initialize serial (115200)
    Serial.begin(115200);
    delay(100);
    
    // Clear serial buffer
    while (Serial.available()) {
        Serial.read();
    }
    
    // Always enable debug output (WiFi mode only)
    DEBUG_INIT;

#ifdef ENABLE_POWER_SWITCH
    powerManager.logBootReason();
#endif
    
#ifdef USE_ADC_DMA
    DEBUG("Build flag: USE_ADC_DMA=ON\n");
#else
    DEBUG("Build flag: USE_ADC_DMA=OFF\n");
#endif

    // Debug: Show config state after serial is ready
    DEBUG("Config state: SSID='%s', timerNumber=%d, version=0x%08X\n", 
          config.getSsid(), config.getTimerNumber(), config.getVersion());
    
    // Suppress VFS file-not-found errors (reduces spam from API endpoint checks)
    esp_log_level_set("vfs_api", ESP_LOG_NONE);
    
#ifdef LILYGO_TENERGY_S3
        DEBUG("LilyGO T-Energy S3 build detected - WiFi Mode (Battery monitoring enabled)\n");
#elif defined(WAVESHARE_ESP32S3_LCD2)
        DEBUG("Waveshare ESP32-S3-LCD-2 build detected - WiFi Mode (Battery monitoring enabled)\n");
#elif defined(ESP32S3) && defined(ENABLE_BATTERY_TEST)
        DEBUG("ESP32S3 DevKitC build - WiFi Mode (Battery TEST MODE enabled on GPIO%d)\n", PIN_VBAT);
#elif defined(ESP32S3)
        DEBUG("ESP32S3 build detected - WiFi Mode\n");
#else
        DEBUG("Generic ESP32 build - WiFi Mode\n");
#endif
    
#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
    // Initialize LVGL-based StarForge-style UI (Arduino_GFX + full-screen buffer)
    DEBUG("Initializing LCD UI...\n");
    
    g_lcdUi = new FpvLcdUI();
    if (g_lcdUi) {
        if (g_lcdUi->begin()) {
            if (!g_qmi8658.begin()) {
                DEBUG("QMI8658 IMU not found — continuing without it\n");
            }
            g_lcdUi->setImu(&g_qmi8658);
            BaseType_t result = xTaskCreatePinnedToCore(
                FpvLcdUI::uiTask, 
                "LcdUI", 
                16384,
                g_lcdUi,
                1,
                &g_lcdUiTask, 
                0
            );
            
            if (result == pdPASS) {
                DEBUG("LCD UI task started successfully (LVGL)\n");
            } else {
                DEBUG("Failed to create LCD UI task\n");
                delete g_lcdUi;
                g_lcdUi = nullptr;
            }
        } else {
            DEBUG("LCD UI begin() failed\n");
            delete g_lcdUi;
            g_lcdUi = nullptr;
        }
    } else {
        DEBUG("Failed to allocate LCD UI instance\n");
    }
#endif
    
    // Note: config.init() already called above
    // Keep logs usable even if third-party libs call esp_task_wdt_reset() on
    // unregistered tasks in this framework mix.
    esp_log_level_set("task_wdt", ESP_LOG_NONE);
#if defined(ESP32)
    disableLoopWDT();
    esp_task_wdt_deinit();
    loopTaskWDTEnabled = false;
#endif
    rx.init();
    buzzer.init(PIN_BUZZER, BUZZER_INVERTED);
    buzzer.setVolume(config.getBeepVolume());  // Apply saved volume
    led.init(PIN_LED, false);
#ifdef HAS_RGB_LED
    rgbLed.init();
    // Apply saved LED configuration from config
    rgbLed.setBrightness(config.getLedBrightness());
    rgbLed.setEffectSpeed(config.getLedSpeed());
    rgbLed.setManualColor(config.getLedColor());
    rgbLed.setFadeColor(config.getLedFadeColor());
    rgbLed.setStrobeColor(config.getLedStrobeColor());
    rgbLed.enableManualOverride(config.getLedManualOverride());
    // Apply preset last so all colors are set
    rgbLed.setPreset((led_preset_e)config.getLedPreset());
#endif
    timer.init(&config, &rx, &buzzer, &led, &webhookManager);
#ifdef HAS_BATTERY_MONITOR
    // Initialize battery monitoring with config voltage divider ratio
    float voltageDivider = config.getBatteryVoltageDivider();
#if defined(WAVESHARE_ESP32S3_LCD2)
    // Migrate older saved configs that defaulted too low for this board.
    if (voltageDivider < 3.2f) voltageDivider = 3.3f;
#endif
    if (voltageDivider == 0.0f) voltageDivider = VBAT_SCALE;  // Fallback to default if not set
    monitor.init(PIN_VBAT, voltageDivider, VBAT_ADD, &buzzer, &led);
    DEBUG("Battery monitoring initialized on GPIO%d (divider=%.1f, add=%d)\n", PIN_VBAT, voltageDivider, VBAT_ADD);
#endif
    
    // WiFi mode initialization (RotorHazard mode disabled)
    selfTest.init(&storage);
    
    // Initialize race history with storage backend
    if (raceHistory.init(&storage)) {
        DEBUG("Race history initialized\n");
    } else {
        DEBUG("Race history initialization failed\n");
    }
    
    // Initialize track manager
    if (trackManager.init(&storage)) {
        DEBUG("Track manager initialized, %d tracks loaded\n", trackManager.getTrackCount());
    } else {
        DEBUG("Track manager initialization failed\n");
    }
    
    // Load selected track if tracks are enabled
    if (config.getTracksEnabled() && config.getSelectedTrackId() != 0) {
        Track* selectedTrack = trackManager.getTrackById(config.getSelectedTrackId());
        if (selectedTrack) {
            timer.setTrack(selectedTrack);
            DEBUG("Selected track loaded: %s\n", selectedTrack->name.c_str());
        }
    }
    
    // Initialize webhook manager and load webhooks from config
    webhookManager.setEnabled(config.getWebhooksEnabled());
    for (uint8_t i = 0; i < config.getWebhookCount(); i++) {
        const char* ip = config.getWebhookIP(i);
        if (ip) {
            webhookManager.addWebhook(ip);
            DEBUG("Loaded webhook: %s\n", ip);
        }
    }
    
    // Initialize RotorHazard integration
    rhManager.init(&config);
    
#ifdef HAS_BATTERY_MONITOR
    ws.init(&config, &timer, &monitor, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx, &trackManager, &webhookManager, &rhManager);
#else
    ws.init(&config, &timer, nullptr, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx, &trackManager, &webhookManager, &rhManager);
#endif
    
    // Initialize USB transport
#ifdef HAS_BATTERY_MONITOR
    usbTransport.init(&config, &timer, &monitor, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx, &trackManager);
#else
    usbTransport.init(&config, &timer, nullptr, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx, &trackManager);
#endif
    
    // Register transports with TransportManager
    transportManager.addTransport(&ws);
    transportManager.addTransport(&usbTransport);
    
    // Set TransportManager in webserver for event broadcasting
    ws.setTransportManager(&transportManager);
    
    DEBUG("Transport system initialized (WiFi + USB)\n");
    
#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
    // Initialize LCD band/channel display from config
    if (g_lcdUi) {
        uint8_t bandIdx = config.getBandIndex();
        uint8_t channelIdx = config.getChannelIndex();
        uint16_t freq = config.getFrequency();
        g_currentSystem = systemFromBand(bandIdx);
        g_lcdUi->setBandChannelDisplay(g_currentSystem, bandIdx, channelIdx, freq);
        g_lastKnownFreq = freq;
        g_lastKnownEnter = config.getEnterRssi();
        g_lastKnownExit = config.getExitRssi();
        g_lcdUi->setThresholdDisplay(g_lastKnownEnter, g_lastKnownExit);
        g_lcdUi->setStatusBarIndicators(ws.isLcdWifiIndicatorOn());
    }
#endif
    
    led.on(400);
    buzzer.beep(200);
    initParallelTask();  // Start Core 0 task
    
    /* DISABLED: RotorHazard mode initialization
    if (currentMode == MODE_WIFI) {
        // WiFi mode - start web server and services
        selfTest.init(&storage);
        ws.init(&config, &timer, &monitor, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx);
        led.on(400);
        buzzer.beep(200);
        initParallelTask();  // Start Core 0 task
    } else {
        // RotorHazard mode - start node protocol
        nodeMode.begin(&timer, &config);
        led.blink(100, 1900);  // Slow blink = node mode active (100ms on, 1900ms off)
        // NO parallel task (avoid WiFi interference)
        // NO buzzer beep (silent operation)
    }
    */
}

#ifdef ENABLE_POWER_SWITCH
#if defined(WAVESHARE_ESP32S3_LCD2) && defined(LCD_BACKLIGHT)
static void shutdownForDeepSleep() {
#if ENABLE_LCD_UI
    if (s_pendingLcdRaceSaveFlag) {
        s_pendingLcdRaceSaveFlag = false;
        raceHistory.saveRace(s_pendingLcdRaceSave);
    }
#endif
    timer.handleLapTimerUpdate(millis());
    config.write();
    storage.shutdownForPowerOff();

#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
    // Suspend LVGL first so touch releases the shared I2C bus before QMI8658 power-down.
    if (g_lcdUiTask) {
        vTaskSuspend(g_lcdUiTask);
        delay(50);
    }
    g_qmi8658.powerDown();
#endif

    // Stop the core-0 task from calling handleFrequencyChange, then software power-down via SPI.
    if (xTimerTask) {
        vTaskSuspend(xTimerTask);
        delay(10);
    }
    rx.setFrequency(POWER_DOWN_FREQ_MHZ);
#if defined(PIN_RX5808_POWER_CTRL)
    // PNP high-side: HIGH turns transistor off — remove VCC from RX5808 (lower deep-sleep drain).
    pinMode(PIN_RX5808_POWER_CTRL, OUTPUT);
    digitalWrite(PIN_RX5808_POWER_CTRL, HIGH);
#endif

#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
    if (g_lcdUi) {
        g_lcdUi->prepareHardwareForDeepSleep();
    }
#endif
}
#endif
#endif

void loop() {
    uint32_t nowMs = millis();
    uint32_t currentTimeMs = nowMs;
    
    // Debug: Periodic "alive" message every 5 seconds with detailed memory stats
    static uint32_t lastAliveMs = 0;
    if (currentTimeMs - lastAliveMs > 5000) {
        lastAliveMs = currentTimeMs;
        uint32_t freeHeap = ESP.getFreeHeap();
        uint32_t minFreeHeap = ESP.getMinFreeHeap();
        uint32_t heapSize = ESP.getHeapSize();
        uint32_t usedHeap = heapSize - freeHeap;
        float usedPercent = (usedHeap * 100.0f) / heapSize;
        
        DEBUG("[HEAP] Free: %u KB / %u KB (%.1f%% used) | Min Free Ever: %u KB\n", 
              freeHeap / 1024, heapSize / 1024, usedPercent, minFreeHeap / 1024);
        
        // Check for low memory condition
        if (freeHeap < 50000) {  // Less than 50KB free
            DEBUG("[HEAP] WARNING: Low memory! Consider reducing LVGL buffer or chart points\n");
        }
    }

#ifdef ENABLE_POWER_SWITCH
#if defined(WAVESHARE_ESP32S3_LCD2) && defined(LCD_BACKLIGHT)
    if (g_lcdUi && g_lcdUi->consumeDeepSleepRequest()) {
        shutdownForDeepSleep();
        powerManager.enterDeepSleep();
    } else if (!powerManager.monitorSwitch()) {
        shutdownForDeepSleep();
        powerManager.enterDeepSleep();
    }
#endif
#endif

    // LED Flashing removed - LED_BUILTIN (GPIO48) conflicts with FastLED RMT channels
    // External LEDs on GPIO5 are handled by rgbLed instead
    
    // Timing always runs
    timer.handleLapTimerUpdate(currentTimeMs);
    
#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
    // Feed live RSSI and timing data to LCD UI
    if (g_lcdUi) {
        // Deferred race save from previous LCD Stop (runs one loop later to avoid holding SPI during stop)
        if (s_pendingLcdRaceSaveFlag) {
            s_pendingLcdRaceSaveFlag = false;
            raceHistory.saveRace(s_pendingLcdRaceSave);
        }
        g_lcdUi->updateRSSI(timer.getRssi());
        g_lcdUi->setStatusBarIndicators(ws.isLcdWifiIndicatorOn());

        // Update timers based on race state
        static bool wasRunning = false;
        bool isRunning = timer.isRaceRunning();
        
        if (isRunning) {
            // Race active - update all timers continuously
            g_lcdUi->updateRaceTime(timer.getRaceTimeMs());
            g_lcdUi->updateCurrentLapTime(timer.getCurrentLapTimeMs());
            g_lcdUi->updateFastestLap(timer.getFastestLapMs());
            g_lcdUi->updateFastest3Laps(timer.getFastest3ConsecutiveMs());
        } else if (wasRunning && !isRunning) {
            // Just stopped - reset all timer displays
            g_lcdUi->updateRaceTime(0);
            g_lcdUi->updateCurrentLapTime(0);
            g_lcdUi->updateFastestLap(0);
            g_lcdUi->updateFastest3Laps(0);
        }
        wasRunning = isRunning;
        
#ifdef HAS_BATTERY_MONITOR
        // Update battery display every 5 seconds
        static uint32_t lastBatteryUpdate = 0;
        if (currentTimeMs - lastBatteryUpdate > 5000) {
            lastBatteryUpdate = currentTimeMs;
            uint16_t voltage = monitor.getBatteryVoltage();
            DEBUG("Battery monitor sample: %u (%.2fV)\n", voltage, voltage / 10.0f);
            g_lcdUi->setBatteryDisplay(voltage);
        }
#endif
        
        // Handle LCD button presses (reuses webserver handler logic)
        if (g_lcdUi->consumeStartRequest()) {
            ws.triggerStart();
        }
        if (g_lcdUi->consumeStopRequest()) {
            // Build race from timer (before stop() clears lap data); save deferred to next loop
            // so we don't hold shared SPI mutex during stop transition (avoids crash/use-after-free)
            std::vector<uint32_t> laps;
            timer.getLapTimesForSave(laps);
            if (!laps.empty()) {
                s_pendingLcdRaceSave = {};
                s_pendingLcdRaceSave.timestamp = (uint32_t)time(nullptr);
                s_pendingLcdRaceSave.lapTimes = laps;
                s_pendingLcdRaceSave.fastestLap = timer.getFastestLapMs();
                s_pendingLcdRaceSave.best3LapsTotal = timer.getFastest3ConsecutiveMs();
                if (laps.size() > 1) {
                    std::vector<uint32_t> valid(laps.begin() + 1, laps.end());
                    std::sort(valid.begin(), valid.end());
                    size_t mid = valid.size() / 2;
                    s_pendingLcdRaceSave.medianLap = (valid.size() % 2 == 0) ? (uint32_t)((valid[mid - 1] + valid[mid]) / 2) : valid[mid];
                } else {
                    s_pendingLcdRaceSave.medianLap = 0;
                }
                s_pendingLcdRaceSave.name = "";
                s_pendingLcdRaceSave.tag = "";
                s_pendingLcdRaceSave.pilotName = config.getPilotName() ? config.getPilotName() : "";
                s_pendingLcdRaceSave.pilotCallsign = config.getPilotCallsign() ? config.getPilotCallsign() : "";
                s_pendingLcdRaceSave.frequency = config.getFrequency();
                s_pendingLcdRaceSave.band = "";
                s_pendingLcdRaceSave.channel = config.getChannelIndex();
                Track* tr = timer.getSelectedTrack();
                s_pendingLcdRaceSave.trackId = tr ? tr->trackId : 0;
                s_pendingLcdRaceSave.trackName = tr ? tr->name : "";
                s_pendingLcdRaceSave.totalDistance = timer.getTotalDistance();
                s_pendingLcdRaceSave.syncMode = 0;
                s_pendingLcdRaceSaveFlag = true;
            }
            ws.triggerStop();
        }
        if (g_lcdUi->consumeClearRequest()) {
            ws.triggerClearLaps();
            g_lcdUi->clearLaps();
        }
        // Sync display with web timer actions (countdown overlay, STOPPED overlay)
        auto lcdEv = ws.consumePendingLcdEvent();
        if (lcdEv == Webserver::PendingLcdEvent::Countdown) {
            g_lcdUi->requestCountdown(false);  // Web sends /timer/start separately
        } else if (lcdEv == Webserver::PendingLcdEvent::ShowFinish) {
            g_lcdUi->requestShowFinish();
        }
        
        // Handle LCD system/band/channel button presses
        int8_t systemDelta = g_lcdUi->consumeSystemDelta();
        int8_t bandDelta = g_lcdUi->consumeBandDelta();
        int8_t channelDelta = g_lcdUi->consumeChannelDelta();
        
        if (systemDelta != 0 || bandDelta != 0 || channelDelta != 0) {
            uint8_t bandIdx = config.getBandIndex();
            uint8_t channelIdx = config.getChannelIndex();
            uint8_t sys = g_currentSystem;
            
            if (systemDelta != 0) {
                // Change system, reset to first band and first available channel
                sys = (sys + LCD_NUM_SYSTEMS + systemDelta) % LCD_NUM_SYSTEMS;
                g_currentSystem = sys;
                bandIdx = g_systemBands[sys].first;
                channelIdx = 0;
                // Find first available channel
                for (uint8_t i = 0; i < 8; i++) {
                    if (Config::getFrequencyForBandChannel(bandIdx, i) > 0) {
                        channelIdx = i;
                        break;
                    }
                }
            }
            
            if (bandDelta != 0) {
                uint8_t first = g_systemBands[sys].first;
                uint8_t count = g_systemBands[sys].count;
                uint8_t localIdx = bandIdx - first;
                localIdx = (localIdx + count + bandDelta) % count;
                bandIdx = first + localIdx;
                // Reset to first available channel when band changes
                channelIdx = 0;
                for (uint8_t i = 0; i < 8; i++) {
                    if (Config::getFrequencyForBandChannel(bandIdx, i) > 0) {
                        channelIdx = i;
                        break;
                    }
                }
            }
            
            if (channelDelta != 0) {
                channelIdx = nextAvailableChannel(bandIdx, channelIdx, channelDelta);
            }
            
            uint16_t newFreq = Config::getFrequencyForBandChannel(bandIdx, channelIdx);
            if (newFreq > 0) {
                config.setBandIndex(bandIdx);
                config.setChannelIndex(channelIdx);
                config.setFrequency(newFreq);
                g_lcdUi->setBandChannelDisplay(sys, bandIdx, channelIdx, newFreq);
                g_lastKnownFreq = newFreq;
                ws.triggerConfigUpdated();
                DEBUG("[LCD] System/Band/Channel: sys=%d band=%d ch=%d freq=%d\n", sys, bandIdx, channelIdx, newFreq);
            }
        }
        
        // Handle LCD threshold +/- button presses
        int8_t enterDelta = g_lcdUi->consumeEnterDelta();
        int8_t exitDelta = g_lcdUi->consumeExitDelta();
        
        if (enterDelta != 0 || exitDelta != 0) {
            uint8_t enter = config.getEnterRssi();
            uint8_t exit_val = config.getExitRssi();
            
            if (enterDelta != 0) {
                int16_t newEnter = (int16_t)enter + enterDelta;
                if (newEnter < 50) newEnter = 50;
                if (newEnter > 255) newEnter = 255;
                enter = (uint8_t)newEnter;
                // Ensure enter > exit
                if (enter <= exit_val) exit_val = enter - 1;
            }
            
            if (exitDelta != 0) {
                int16_t newExit = (int16_t)exit_val + exitDelta;
                if (newExit < 50) newExit = 50;
                if (newExit > 254) newExit = 254;
                exit_val = (uint8_t)newExit;
                // Ensure exit < enter
                if (exit_val >= enter) enter = exit_val + 1;
            }
            
            config.setEnterRssi(enter);
            config.setExitRssi(exit_val);
            g_lcdUi->setThresholdDisplay(enter, exit_val);
            g_lastKnownEnter = enter;
            g_lastKnownExit = exit_val;
            ws.triggerConfigUpdated();
            DEBUG("[LCD] Threshold: enter=%d exit=%d\n", enter, exit_val);
        }
        
        // Detect web-originated frequency changes and sync to LCD
        uint16_t currentFreq = config.getFrequency();
        if (currentFreq != g_lastKnownFreq) {
            g_lastKnownFreq = currentFreq;
            uint8_t bandIdx = config.getBandIndex();
            uint8_t channelIdx = config.getChannelIndex();
            g_currentSystem = systemFromBand(bandIdx);
            g_lcdUi->setBandChannelDisplay(g_currentSystem, bandIdx, channelIdx, currentFreq);
            DEBUG("[LCD] Web config sync: sys=%d band=%d ch=%d freq=%d\n", g_currentSystem, bandIdx, channelIdx, currentFreq);
        }
        
        // Handle LCD countdown / overlay buzzer cues
        BuzzerCue lcdCue = g_lcdUi->consumeBuzzerCue();
        if (lcdCue != BUZZER_CUE_NONE) {
            buzzer.playCue(lcdCue);
        }
        
        // Detect web-originated threshold changes and sync to LCD
        uint8_t curEnter = config.getEnterRssi();
        uint8_t curExit = config.getExitRssi();
        if (curEnter != g_lastKnownEnter || curExit != g_lastKnownExit) {
            g_lastKnownEnter = curEnter;
            g_lastKnownExit = curExit;
            g_lcdUi->setThresholdDisplay(curEnter, curExit);
            DEBUG("[LCD] Web threshold sync: enter=%d exit=%d\n", curEnter, curExit);
        }
        
        // Forward web-originated laps and clears to LCD
        uint32_t webLap;
        if (ws.consumePendingLap(webLap)) {
            timer.addManualLap(webLap);  // Update LapTimer state
            g_lcdUi->addLap(webLap);     // Update LCD display
        }
        if (ws.consumePendingClear()) {
            g_lcdUi->clearLaps();
        }
    }
#endif
    
    // Broadcast lap events to all transports (WiFi + USB)
    if (timer.isLapAvailable()) {
        uint32_t lapTime = timer.getLapTime();
        transportManager.broadcastLapEvent(lapTime);

#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
        if (g_lcdUi) {
            g_lcdUi->addLap(lapTime);
        }
#endif

        // Report crossing to RotorHazard with raw millis() timestamps for clock sync
        rhManager.triggerLap(timer.getLastCrossingAbsoluteMs(), timer.getRaceStartMs());
        
#ifdef HAS_I2S_AUDIO
        // Announce lap on speaker
        audioAnnouncer.announceLap(lapTime);
#endif
        
        // If in slave mode, also send lap to master
        ws.sendLapToMaster(lapTime);
    }
    
#ifdef HAS_I2S_AUDIO
    // Drive non-blocking audio playback
    audioAnnouncer.handleAudio();
#endif
    
    // Process queued webhooks (non-blocking)
    webhookManager.process();
    
    // Process RotorHazard connection and queued lap events
    rhManager.process();
    
    // WiFi mode - original behavior (RotorHazard mode disabled)
    ElegantOTA.loop();
    
    // Initialize SD card after boot (deferred to prevent watchdog timeout)
    // At 2s; "Booting" overlay is shown until this block finishes, then user can interact
    if (!sdInitAttempted && currentTimeMs > 2000) {
        sdInitAttempted = true;
        DEBUG("\n=== Deferred SD card initialization ===\n");
        
        if (storage.initSDDeferred()) {
            DEBUG("SD card ready!\n");
            
            // Ensure SD has required directories (they were created on LittleFS at boot, before SD mounted)
            DEBUG("Creating SD folders: /races, /tracks, /tracks/images\n");
            storage.mkdir("/races");
            storage.mkdir("/tracks");
            storage.mkdir("/tracks/images");
            DEBUG("SD folders ready\n");

#ifdef HAS_I2S_AUDIO
            // Initialize speaker audio (requires SD card)
            audioAnnouncer.init(&config, &storage);
#endif
            
            // Try to restore config from SD backup if EEPROM was invalid
            // (This handles the case where config was reset to defaults during boot)
            DEBUG("Checking for config backup on SD card...\n");
            if (config.loadFromSD()) {
                DEBUG("Config restored from SD backup after SD mount\n");
                // Re-check WiFi mode - if SSID was restored, switch to STA
                ws.recheckWifiMode();
            }
            
            // Migrate sounds from LittleFS to SD card
            if (storage.migrateSoundsToSD()) {
                DEBUG("Sound files migrated successfully!\n");
                DEBUG("Recommend: delete /sounds from LittleFS to reclaim space\n");
            }
            
            // Reload race history from SD card
            if (raceHistory.loadRaces()) {
                DEBUG("Race history reloaded from SD card, %d races available\n", raceHistory.getRaceCount());
            } else {
                DEBUG("Race history reload from SD card failed\n");
            }
            
            // Reload tracks from SD card
            if (trackManager.loadTracks()) {
                DEBUG("Tracks reloaded from SD card, %d tracks available\n", trackManager.getTrackCount());
                
                // Reload selected track if tracks are enabled
                if (config.getTracksEnabled() && config.getSelectedTrackId() != 0) {
                    Track* selectedTrack = trackManager.getTrackById(config.getSelectedTrackId());
                    if (selectedTrack) {
                        timer.setTrack(selectedTrack);
                        DEBUG("Selected track reloaded: %s\n", selectedTrack->name.c_str());
                    }
                }
            } else {
                DEBUG("Tracks reload from SD card failed\n");
            }
        } else {
            DEBUG("SD card not available - using LittleFS only\n");
        }
    }
#if ENABLE_LCD_UI && defined(WAVESHARE_ESP32S3_LCD2)
    // Boot overlay runs *after* the SD block in the loop, so we only reach this once the SD init has run (or is blocking).
    // Use absolute time: clear 2.5s after boot so we fire the first time we get here after that (no relative 2000ms wait).
    // Dismiss boot overlay only when both SD init and WiFi services are ready, plus 500ms settle
    static bool bootCompleteSent = false;
    static uint32_t bootReadyAtMs = 0;
    if (!bootCompleteSent && sdInitAttempted && ws.isServicesStarted()) {
        if (bootReadyAtMs == 0) bootReadyAtMs = currentTimeMs;
        if ((currentTimeMs - bootReadyAtMs) >= 500) {
            if (g_lcdUi) g_lcdUi->setBootComplete();
            bootCompleteSent = true;
            DEBUG("\n=== Boot complete (overlay dismissed) ===\n");
        }
    }
#endif
    
    /* DISABLED: RotorHazard mode loop
    if (currentMode == MODE_WIFI) {
        // WiFi mode - original behavior
        ElegantOTA.loop();
        
        // ... SD card initialization code ...
    } else {
        // RotorHazard mode - run node protocol
        nodeMode.process();
        
        // Still update hardware (LED, buzzer) but NOT web server
        buzzer.handleBuzzer(currentTimeMs);
        led.handleLed(currentTimeMs);
#ifdef ESP32S3
        rgbLed.handleRgbLed(currentTimeMs);
#endif
        rx.handleFrequencyChange(currentTimeMs, config.getFrequency());
        monitor.checkBatteryState(currentTimeMs, config.getAlarmThreshold());
    }
    */
}
