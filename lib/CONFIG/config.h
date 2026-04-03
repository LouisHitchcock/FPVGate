#ifndef CONFIG_H
#define CONFIG_H

#include <ArduinoJson.h>
#include <AsyncJson.h>
#include <stdint.h>

/*
## Pinout ##
| ESP32 | RX5880 |
| :------------- |:-------------|
| 33 | RSSI |
| GND | GND |
| 19 | CH1 |
| 22 | CH2 |
| 23 | CH3 |
| 3V3 | +5V |

* **Led** goes to pin 21 and GND
* The optional **Buzzer** goes to pin 25 or 27 and GND

*/


//ESP32-S3 Super Mini
#if defined(ESP32S3_SUPERMINI)

#define PIN_LED 2              // External status LED (if present)
#define PIN_RGB_LED 1          // WS2812 RGB LED on GPIO1
#define NUM_LEDS 2
#define PIN_VBAT 0
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 3      // RSSI on Pin 3
#define PIN_RX5808_DATA 6      // CH1 on Pin 6
#define PIN_RX5808_SELECT 7    // CH2 on Pin 7
#define PIN_RX5808_CLOCK 4     // CH3 on Pin 4
#define PIN_BUZZER 5
#define BUZZER_INVERTED false
//#define PIN_MODE_SWITCH 1      // Mode selection: LOW=WiFi, HIGH=RotorHazard
// SD Card SPI pins
#define PIN_SD_CS 8
#define PIN_SD_SCK 2
#define PIN_SD_MOSI 10
#define PIN_SD_MISO 9

//LilyGO T-Energy S3
#elif defined(LILYGO_TENERGY_S3)

#define PIN_LED 2              // SAME AS DEVKITC: External LED on GPIO 2
#define PIN_RGB_LED 48         // SAME AS DEVKITC: WS2812 RGB LED
#define NUM_LEDS 2
#define PIN_VBAT 3             // DIFFERENT:
#define VBAT_SCALE 2           // 2:1 voltage divider (100K/100K)
#define VBAT_ADD 2             // Calibration offset
#define PIN_RX5808_RSSI 4      // SAME AS DEVKITC: RSSI on GPIO 4
#define PIN_RX5808_DATA 10     // SAME AS DEVKITC: CH1 on Pin 10
#define PIN_RX5808_SELECT 11   // SAME AS DEVKITC: CH2 on Pin 11
#define PIN_RX5808_CLOCK 12    // SAME AS DEVKITC: CH3 on Pin 12
#define PIN_BUZZER 5           // SAME AS DEVKITC: Buzzer on Pin 5
#define BUZZER_INVERTED false
#define PIN_MODE_SWITCH 9      // SAME AS DEVKITC: Mode selection
// SD Card SPI pins (SAME AS DEVKITC)
#define PIN_SD_CS 39           // SAME AS DEVKITC
#define PIN_SD_SCK 36          // SAME AS DEVKITC
#define PIN_SD_MOSI 35         // SAME AS DEVKITC
#define PIN_SD_MISO 37         // SAME AS DEVKITC

// Waveshare ESP32-S3-LCD-2 (16MB Flash, 8MB PSRAM, built-in TF card)
#elif defined(WAVESHARE_ESP32S3_LCD2)

#define PIN_LED 2              // External status LED (on header)
#define PIN_RGB_LED 15         // WS2812 RGB LED (on header, optional external)
#define NUM_LEDS 2
#define PIN_VBAT 5             // Battery voltage sense
#define VBAT_SCALE 3           // 3:1 voltage divider (200K/100K)
#define VBAT_ADD 0             // Calibration offset
#define PIN_RX5808_RSSI 4      // RSSI on GPIO4
#define PIN_RX5808_DATA 17     // CH1 on GPIO17
#define PIN_RX5808_SELECT 21   // CH2 on GPIO21
#define PIN_RX5808_CLOCK 18    // CH3 on GPIO18
#define PIN_BUZZER 6           // Buzzer on GPIO6 (on header)
#define BUZZER_INVERTED false
#define PIN_MODE_SWITCH 9      // Mode selection (on header)
// SD Card SPI pins (built-in TF card slot, shared SPI bus with LCD)
#define PIN_SD_CS 41
#define PIN_SD_SCK 39
#define PIN_SD_MOSI 38
#define PIN_SD_MISO 40

// FPVGate AIO V4 (XIAO ESP32S3-based, custom pinout)
#elif defined(FPVGATE_AIO_V4)

#define PIN_LED 21             // Onboard user LED
#define PIN_RGB_LED 44         // NeoPixel chain on D7 (GPIO44)
#define NUM_LEDS 3
#define PIN_VBAT 0             // External divider required if used
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 3      // D2 (GPIO3)
#define PIN_RX5808_DATA 5      // D4 (GPIO5)
#define PIN_RX5808_SELECT 6    // D5 (GPIO6) - LE
#define PIN_RX5808_CLOCK 4     // D3 (GPIO4)
#define PIN_BUZZER 43          // D6 (GPIO43)
#define BUZZER_INVERTED false
#define PIN_MODE_SWITCH 1      // D0 (GPIO1)
// SD Card SPI pins
#define PIN_SD_CS 2            // D1 (GPIO2)
#define PIN_SD_SCK 7           // D8 (GPIO7)
#define PIN_SD_MOSI 8          // D9 (GPIO8)
#define PIN_SD_MISO 9          // D10 (GPIO9)

// XIAO ESP32S3 Plus (16MB Flash)
#elif defined(XIAO_ESP32S3_PLUS)

#define PIN_LED 21             // Onboard user LED
#define PIN_RGB_LED 44         // NeoPixel chain on D7 (GPIO44)
#define NUM_LEDS 2
#define PIN_VBAT 1             // D0 (GPIO1) - BATSENSE
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 3      // D2 (GPIO3)
#define PIN_RX5808_DATA 5      // D4 (GPIO5)
#define PIN_RX5808_SELECT 6    // D5 (GPIO6) - LE
#define PIN_RX5808_CLOCK 4     // D3 (GPIO4)
#define PIN_BUZZER 43          // D6 (GPIO43)
#define BUZZER_INVERTED false
// SD Card SPI pins
#define PIN_SD_CS 2            // D1 (GPIO2)
#define PIN_SD_SCK 7           // D8 (GPIO7)
#define PIN_SD_MOSI 9          // D10 (GPIO9)
#define PIN_SD_MISO 8          // D9 (GPIO8)

// Seeed Studio XIAO ESP32S3
#elif defined(SEEED_XIAO_ESP32S3)

#define PIN_LED 21             // Onboard user LED
#define PIN_RGB_LED 44         // NeoPixel signal on D7 (GPIO44)
#define NUM_LEDS 2
#define PIN_VBAT 0             // External divider required if used
#define VBAT_SCALE 2
#define VBAT_ADD 2
#define PIN_RX5808_RSSI 3      // D2
#define PIN_RX5808_DATA 5      // D4
#define PIN_RX5808_SELECT 6    // D5
#define PIN_RX5808_CLOCK 4     // D3
#define PIN_BUZZER 5           // D4
#define BUZZER_INVERTED false
#define PIN_MODE_SWITCH 1      // D0
// SD Card SPI pins (XIAO S3 per user wiring)
#define PIN_SD_CS 2            // D1 (CS)
#define PIN_SD_SCK 7           // D8 (SCK)
#define PIN_SD_MOSI 8          // D9 (MOSI)
#define PIN_SD_MISO 9          // D10 (MISO)

//ESP32-S3 DevKitC
#elif defined(ESP32S3)

#define PIN_LED 2
#define PIN_RGB_LED 5          // WS2812 RGB LED on GPIO5
#define NUM_LEDS 2
#define PIN_VBAT 1             // Battery voltage test pin
#define VBAT_SCALE 2           // 2:1 voltage divider (adjust based on your divider)
#define VBAT_ADD 2             // Calibration offset: +0.2V correction
#define PIN_RX5808_RSSI 4      // RSSI on Pin 4 (GPIO3 is a strapping pin - causes boot issues!)
#define PIN_RX5808_DATA 10     // CH1 on Pin 10
#define PIN_RX5808_SELECT 11   // CH2 on Pin 11
#define PIN_RX5808_CLOCK 12    // CH3 on Pin 12
#define PIN_BUZZER 6           // Buzzer on GPIO6 (GPIO5 used for RGB LED)
#define BUZZER_INVERTED false
#define PIN_MODE_SWITCH 9      // Mode selection: LOW=WiFi, HIGH=RotorHazard
// SD Card SPI pins (tested and working configuration)
#define PIN_SD_CS 39
#define PIN_SD_SCK 36
#define PIN_SD_MOSI 35
#define PIN_SD_MISO 37
// I2S audio output (MAX98357A DAC)
#define PIN_I2S_BCLK 16
#define PIN_I2S_LRC  17
#define PIN_I2S_DOUT 18

#endif

// ====================================================================
// Centralized Platform Feature Defines
// Add new board defines here to automatically enable features across the codebase
// ====================================================================

// ESP32-S3 family boards (SD card support, SPI, USB CDC)
#if defined(ESP32S3) || defined(ESP32C3) || defined(ESP32S3_SUPERMINI) || defined(LILYGO_TENERGY_S3) || defined(SEEED_XIAO_ESP32S3) || defined(WAVESHARE_ESP32S3_LCD2) || defined(FPVGATE_AIO_V4) || defined(XIAO_ESP32S3_PLUS)
    #define HAS_SD_CARD_SUPPORT 1
    #define HAS_SPI_CLASS 1
#endif

// Boards with RGB LED support
#if defined(ESP32S3) || defined(ESP32S3_SUPERMINI) || defined(LILYGO_TENERGY_S3) || defined(SEEED_XIAO_ESP32S3) || defined(WAVESHARE_ESP32S3_LCD2) || defined(FPVGATE_AIO_V4) || defined(XIAO_ESP32S3_PLUS) || defined(PIN_RGB_LED)
    #define HAS_RGB_LED 1
#endif

// Boards with built-in battery monitoring
#if defined(LILYGO_TENERGY_S3) || defined(WAVESHARE_ESP32S3_LCD2) || defined(XIAO_ESP32S3_PLUS) || defined(ENABLE_BATTERY_TEST)
    #define HAS_BATTERY_MONITOR 1
#endif

// Boards with I2S audio output (MAX98357A speaker DAC)
#if defined(ESP32S3) && defined(PIN_I2S_BCLK)
    #define HAS_I2S_AUDIO 1
#endif

// Mode selection constants
#define WIFI_MODE LOW          // GND on switch pin = WiFi/Standalone mode
#define ROTORHAZARD_MODE HIGH  // HIGH (floating/pullup) = RotorHazard node mode

#define EEPROM_RESERVED_SIZE 1024
#define CONFIG_MAGIC_MASK (0b11U << 30)
#define CONFIG_MAGIC (0b01U << 30)
#define CONFIG_VERSION 17U

// Race sync mode constants
#define RACE_SYNC_DISABLED 0
#define RACE_SYNC_MASTER 1
#define RACE_SYNC_SLAVE 2

#define MAX_SPLIT_GATES 8

#define EEPROM_CHECK_TIME_MS 1000

// Battery type constants
#define BATTERY_TYPE_LIPO 0
#define BATTERY_TYPE_LIPOHV 1
#define BATTERY_TYPE_LIION 2

typedef struct {
    uint32_t version;
    uint16_t frequency;
    uint8_t bandIndex;         // Band index (0-21) - added for accurate band/channel restoration
    uint8_t channelIndex;      // Channel index (0-7) - added for accurate band/channel restoration
    uint8_t minLap;
    uint8_t alarm;             // Legacy alarm threshold (kept for migration)
    uint8_t announcerType;
    uint8_t announcerRate;
    uint8_t enterRssi;
    uint8_t exitRssi;
    uint8_t maxLaps;
    uint8_t ledMode;           // 0=off, 1=solid, 2=pulse, 3=rainbow (legacy, kept for migration)
    uint8_t ledBrightness;     // 0-255
    uint32_t ledColor;         // RGB as 0xRRGGBB (solid color)
    uint8_t ledPreset;         // 0-9 (new preset system)
    uint8_t ledSpeed;          // 1-20 (animation speed)
    uint32_t ledFadeColor;     // RGB for COLOR_FADE preset
    uint32_t ledStrobeColor;   // RGB for STROBE preset
    uint8_t ledManualOverride; // Manual override flag (0=off, 1=on)
    uint8_t operationMode;     // 0=WiFi, 1=RotorHazard (software switch)
    uint8_t tracksEnabled;     // Track feature enabled (0=disabled, 1=enabled)
    uint32_t selectedTrackId;  // Currently selected track (0=none)
    uint8_t webhooksEnabled;   // Webhooks enabled (0=disabled, 1=enabled)
    char webhookIPs[10][16];   // Up to 10 webhook IPs (xxx.xxx.xxx.xxx format)
    uint8_t webhookCount;      // Number of configured webhooks
    uint8_t gateLEDsEnabled;   // Gate LEDs feature enabled (0=disabled, 1=enabled)
    uint8_t webhookRaceStart;  // Send /RaceStart webhook (0=disabled, 1=enabled)
    uint8_t webhookRaceStop;   // Send /RaceStop webhook (0=disabled, 1=enabled)
    uint8_t webhookLap;        // Send /Lap webhook (0=disabled, 1=enabled)
    char pilotName[21];
    char pilotCallsign[21];    // Pilot callsign (for announcements)
    char pilotPhonetic[21];    // Phonetic pronunciation
    uint32_t pilotColor;       // Pilot color (0xRRGGBB)
    char theme[21];            // UI theme name
    char selectedVoice[21];    // Voice selection (default, rachel, piper, etc)
    char lapFormat[11];        // Lap announcement format (full, laptime, timeonly)
    char ssid[33];
    char password[33];
    uint8_t batteryType;       // Battery type: 0=LiPo, 1=LiPoHV, 2=Li-Ion
    uint8_t batteryCells;      // Number of cells (1-6 for LiPo/LiPoHV, 1 for Li-Ion)
    float lowBatteryAlarmPerCell;  // Alarm voltage per cell (3.0v-4.2v)
    uint8_t batteryAlarmEnabled;   // Battery alarm enabled (0=disabled, 1=enabled)
    float batteryVoltageDivider;   // Voltage divider ratio (e.g., 2.0 for 2:1, 5.5 for 11:2)
    uint8_t timerNumber;           // LEGACY: Timer number (no longer used for hostname, kept for config compatibility)
    uint8_t raceSyncMode;          // Race sync mode: 0=disabled, 1=master, 2=slave
    char syncedTimers[5][32];      // Up to 5 synced timer hostnames (for master mode)
    uint8_t syncedTimerCount;      // Number of configured synced timers
    uint8_t beepVolume;            // Buzzer volume 0-100 (percentage)
    char masterHostname[32];       // Master hostname for slave mode (e.g., "fpvgate.local" or "192.168.1.100")
    uint8_t autoThresholdEnabled;   // Auto threshold mode: 0=manual (static enter/exit), 1=rolling baseline
    uint8_t autoThresholdOffset;    // RSSI units above rolling baseline to trigger entry (5-80, default 15)
    uint8_t receiverRadio;          // Receiver module: 0=RX5808, 1=Novacore
    // Novacore filter configuration (only used when receiverRadio=1)
    uint8_t novaFilterKalman;       // Kalman filter: 0=off, 1=on
    uint8_t novaFilterMedian;       // Median-of-3 filter: 0=off, 1=on
    uint8_t novaFilterMA;           // Moving average filter: 0=off, 1=on
    uint8_t novaFilterEMA;          // EMA low-pass filter: 0=off, 1=on
    uint8_t novaFilterStepLimiter;  // Step limiter: 0=off, 1=on
    uint16_t novaKalmanQ;           // Kalman Q * 100 (100-1500, higher = more smoothing)
    uint8_t novaEmaAlpha;           // EMA alpha * 100 (5-80, lower = more smoothing)
    uint8_t novaStepMax;            // Step limiter max per sample (5-50)
    uint8_t speakerEnabled;         // I2S speaker output enabled (0=disabled, 1=enabled)
    // RotorHazard integration
    uint8_t rhEnabled;               // RH integration enabled (0=disabled, 1=enabled)
    char rhHostIP[32];               // RH server IP or hostname
    uint8_t rhNodeIndex;             // Node/seat index on RH (0-7)
    // Split time gate configuration
    uint8_t splitGateNumber;         // This device's gate number (0=not a split gate, 1-8)
    char splitMasterHostname[32];    // Master hostname to report crossings to (for gate devices)
    char splitGates[MAX_SPLIT_GATES][32];  // Split gate device hostnames (master stores these)
    uint8_t splitGateCount;          // Number of configured split gates
    uint8_t splitGateNumbers[MAX_SPLIT_GATES]; // Gate order (1-8) for each split gate device
    float splitGateDistances[MAX_SPLIT_GATES]; // Distance in meters from previous gate to this gate
} laptimer_config_t;

class Storage;  // Forward declaration
class BatteryMonitor;  // Forward declaration

class Config {
   public:
    void init();
    void load();
    void write();
    void toJson(AsyncResponseStream& destination, BatteryMonitor* batteryMonitor = nullptr);
    void toJsonString(char* buf);
    void fromJson(JsonObject source);
    void handleEeprom(uint32_t currentTimeMs);
    
    // SD card backup/restore
    void setStorage(Storage* stor) { storage = stor; }
    bool saveToSD();
    bool loadFromSD();

    // getters and setters
    uint16_t getFrequency();
    uint32_t getMinLapMs();
    uint8_t getAlarmThreshold();
    uint8_t getEnterRssi();
    uint8_t getExitRssi();
    uint8_t getAnnouncerType();
    uint8_t getAutoThresholdEnabled();
    uint8_t getAutoThresholdOffset();
    uint8_t getMaxLaps();
    uint8_t getLedMode();
    uint8_t getLedBrightness();
    uint32_t getLedColor();
    uint8_t getLedPreset();
    uint8_t getLedSpeed();
    uint32_t getLedFadeColor();
    uint32_t getLedStrobeColor();
    uint8_t getLedManualOverride();
    uint8_t getTracksEnabled();
    uint32_t getSelectedTrackId();
    uint8_t getWebhooksEnabled();
    uint8_t getWebhookCount();
    const char* getWebhookIP(uint8_t index);
    uint8_t getGateLEDsEnabled();
    uint8_t getWebhookRaceStart();
    uint8_t getWebhookRaceStop();
    uint8_t getWebhookLap();
    char* getSsid();
    char* getPassword();
    uint8_t getOperationMode();
    char* getPilotCallsign();
    char* getPilotPhonetic();
    uint32_t getPilotColor();
    char* getTheme();
    char* getSelectedVoice();
    char* getLapFormat();
    uint8_t getBatteryType();
    uint8_t getBatteryCells();
    float getLowBatteryAlarmPerCell();
    uint8_t getBatteryAlarmEnabled();
    float getBatteryVoltageDivider();
    
    // Setters for RotorHazard node mode
    void setFrequency(uint16_t freq);
    void setEnterRssi(uint8_t rssi);
    void setExitRssi(uint8_t rssi);
    void setOperationMode(uint8_t mode);
    
    // LED setters
    void setLedPreset(uint8_t preset);
    void setLedBrightness(uint8_t brightness);
    void setLedSpeed(uint8_t speed);
    void setLedColor(uint32_t color);
    void setLedFadeColor(uint32_t color);
    void setLedStrobeColor(uint32_t color);
    void setLedManualOverride(uint8_t override);
    void setTracksEnabled(uint8_t enabled);
    void setSelectedTrackId(uint32_t trackId);
    void setWebhooksEnabled(uint8_t enabled);
    bool addWebhookIP(const char* ip);
    bool removeWebhookIP(const char* ip);
    void clearWebhookIPs();
    void setGateLEDsEnabled(uint8_t enabled);
    void setWebhookRaceStart(uint8_t enabled);
    void setWebhookRaceStop(uint8_t enabled);
    void setWebhookLap(uint8_t enabled);
    void setBatteryType(uint8_t type);
    void setBatteryCells(uint8_t cells);
    void setLowBatteryAlarmPerCell(float voltage);
    void setBatteryAlarmEnabled(uint8_t enabled);
    void setBatteryVoltageDivider(float ratio);
    
    // Race sync getters and setters
    uint8_t getTimerNumber();
    void setTimerNumber(uint8_t number);
    uint8_t getRaceSyncMode();
    void setRaceSyncMode(uint8_t mode);
    uint8_t getSyncedTimerCount();
    const char* getSyncedTimer(uint8_t index);
    uint32_t getVersion() { return conf.version; }
    bool addSyncedTimer(const char* hostname);
    bool removeSyncedTimer(const char* hostname);
    void clearSyncedTimers();
    
    // Beep volume
    uint8_t getBeepVolume();
    void setBeepVolume(uint8_t volume);
    
    // Master hostname for slave mode
    char* getMasterHostname();
    void setMasterHostname(const char* hostname);
    
    // Auto threshold (rolling baseline)
    void setAutoThresholdEnabled(uint8_t enabled);
    void setAutoThresholdOffset(uint8_t offset);
    
    // Receiver radio
    uint8_t getReceiverRadio();
    void setReceiverRadio(uint8_t radio);
    
    // Speaker output
    uint8_t getSpeakerEnabled();
    void setSpeakerEnabled(uint8_t enabled);
    
    // RotorHazard integration
    uint8_t getRhEnabled();
    void setRhEnabled(uint8_t enabled);
    char* getRhHostIP();
    void setRhHostIP(const char* ip);
    uint8_t getRhNodeIndex();
    void setRhNodeIndex(uint8_t index);
    
    // Novacore filter config
    uint8_t getNovaFilterKalman();
    uint8_t getNovaFilterMedian();
    uint8_t getNovaFilterMA();
    uint8_t getNovaFilterEMA();
    uint8_t getNovaFilterStepLimiter();
    uint16_t getNovaKalmanQ();
    uint8_t getNovaEmaAlpha();
    uint8_t getNovaStepMax();
    
    // Split time gate config
    uint8_t getSplitGateNumber();
    void setSplitGateNumber(uint8_t gateNum);
    char* getSplitMasterHostname();
    void setSplitMasterHostname(const char* hostname);
    uint8_t getSplitGateCount();
    const char* getSplitGate(uint8_t index);
    uint8_t getSplitGateNumberAt(uint8_t index);
    float getSplitGateDistance(uint8_t index);
    bool addSplitGate(const char* hostname);
    bool removeSplitGate(const char* hostname);
    void clearSplitGates();
    void setSplitGateNumberAt(uint8_t index, uint8_t gateNum);
    void setSplitGateDistance(uint8_t index, float distance);

   private:
    laptimer_config_t conf;
    bool modified;
    volatile uint32_t checkTimeMs = 0;
    Storage* storage = nullptr;
    void setDefaults();
};

#endif // CONFIG_H
