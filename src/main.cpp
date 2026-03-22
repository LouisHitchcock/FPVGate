#include "debug.h"
#include "led.h"
#include "webserver.h"
#include "racehistory.h"
#include "storage.h"
#include "selftest.h"
#include "transport.h"
#include "trackmanager.h"
#include "usb.h"
#include "webhook.h"
#include "rotorhazard.h"
#include "splittime.h"
// DISABLED FOR NOW: #include "nodemode.h"  // Uncomment to re-enable RotorHazard support
#include <ElegantOTA.h>
#ifdef HAS_RGB_LED
#include "rgbled.h"
#endif
#ifdef HAS_I2S_AUDIO
#include "audio.h"
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
static SplitTimeManager splitManager;
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
#ifdef HAS_BATTERY_MONITOR
static BatteryMonitor monitor;  // Enabled for T-Energy S3 or testing
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
    
    // Note: config.init() already called above
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
    if (voltageDivider == 0.0f) voltageDivider = VBAT_SCALE;  // Fallback to default if not set
    monitor.init(PIN_VBAT, voltageDivider, VBAT_ADD, &buzzer, &led);
    DEBUG("Battery monitoring initialized on GPIO%d (divider=%.1f, add=%d)\n", PIN_VBAT, voltageDivider, VBAT_ADD);
#endif
    
    // WiFi mode initialization (RotorHazard mode disabled)
    selfTest.init(&storage);
    
    // Initialize race history with storage backend
    // Note: This uses LittleFS initially; SD card will be mounted later in loop()
    if (raceHistory.init(&storage)) {
        DEBUG("Race history initialized, %d races loaded\n", raceHistory.getRaceCount());
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
    ws.init(&config, &timer, &monitor, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx, &trackManager, &webhookManager, &rhManager, &splitManager);
#else
    ws.init(&config, &timer, nullptr, &buzzer, &led, &raceHistory, &storage, &selfTest, &rx, &trackManager, &webhookManager, &rhManager, &splitManager);
#endif
    
    // Load split gate distances from config into SplitTimeManager
    for (uint8_t i = 0; i < config.getSplitGateCount(); i++) {
        splitManager.setGateDistance(config.getSplitGateNumberAt(i), config.getSplitGateDistance(i));
    }
    
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

void loop() {
    uint32_t currentTimeMs = millis();

    // LED Flashing removed - LED_BUILTIN (GPIO48) conflicts with FastLED RMT channels
    // External LEDs on GPIO5 are handled by rgbLed instead
    
    // Timing always runs
    timer.handleLapTimerUpdate(currentTimeMs);
    
    // Broadcast lap events to all transports (WiFi + USB)
    if (timer.isLapAvailable()) {
        uint32_t lapTime = timer.getLapTime();
        transportManager.broadcastLapEvent(lapTime);
        
        // Report crossing to RotorHazard with raw millis() timestamps for clock sync
        rhManager.triggerLap(timer.getLastCrossingAbsoluteMs(), timer.getRaceStartMs());
        
#ifdef HAS_I2S_AUDIO
        // Announce lap on speaker
        audioAnnouncer.announceLap(lapTime);
#endif
        
        // If in slave mode, also send lap to master
        ws.sendLapToMaster(lapTime);
        
        // If this device is a split gate, send crossing to master
        if (config.getSplitGateNumber() > 0) {
            ws.sendSplitCrossingToMaster(timer.getLastCrossingRaceTimeMs());
        }
        
        // If this device has split gates configured (is master), feed local crossing
        if (config.getSplitGateCount() > 0) {
            // Master's own gate - use its own gate number or treat as finish gate
            // The master gate is implicitly the start/finish gate
            uint8_t masterGateNum = config.getSplitGateCount() + 1; // After all split gates
            splitManager.addCrossing(masterGateNum, timer.getLastCrossingRaceTimeMs());
        }
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
    // Try once after 5 seconds of uptime
    if (!sdInitAttempted && currentTimeMs > 5000) {
        sdInitAttempted = true;
        DEBUG("\n=== Deferred SD card initialization ===\n");
        
        if (storage.initSDDeferred()) {
            DEBUG("SD card ready!\n");
            
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
