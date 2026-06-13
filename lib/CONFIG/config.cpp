#include "config.h"

#include <EEPROM.h>
#include <LittleFS.h>

#include "debug.h"

static float sanitizeBatteryDivider(float ratio) {
#if defined(WAVESHARE_ESP32S3_LCD2)
    if (ratio < 3.2f) return 3.3f;
#endif
    return ratio;
}

static const char* normalizeSelectedVoiceValue(const char* voiceValue) {
    if (!voiceValue || !voiceValue[0]) return "default";

    if (strcmp(voiceValue, "piper") == 0) return "default";

    if (strcmp(voiceValue, "german") == 0 || strcmp(voiceValue, "voice_de") == 0 || strcmp(voiceValue, "voice_german_de") == 0) return "de";
    if (strcmp(voiceValue, "spanish") == 0 || strcmp(voiceValue, "voice_es") == 0 || strcmp(voiceValue, "voice_spanish_es") == 0) return "es";
    if (strcmp(voiceValue, "french") == 0 || strcmp(voiceValue, "voice_fr") == 0 || strcmp(voiceValue, "voice_french_fr") == 0) return "fr";

    if (strcmp(voiceValue, "voice_default_en") == 0) return "default";
    if (strcmp(voiceValue, "voice_rachel_en") == 0) return "rachel";
    if (strcmp(voiceValue, "voice_adam_en") == 0) return "adam";
    if (strcmp(voiceValue, "voice_antoni_en") == 0) return "antoni";
    if (strcmp(voiceValue, "voice_matilda_en") == 0) return "matilda";

    const char* allowed[] = {"default", "rachel", "adam", "antoni", "matilda", "de", "es", "fr", "webspeech", nullptr};
    for (int i = 0; allowed[i] != nullptr; i++) {
        if (strcmp(voiceValue, allowed[i]) == 0) {
            return voiceValue;
        }
    }

    return "default";
}
#include "storage.h"
#include "battery.h"

#ifdef ESP32S3
#include <SD.h>
#endif

#define CONFIG_BACKUP_PATH "/config_backup.bin"

// Frequency lookup table (same as frontend script.js)
const uint16_t freqLookup[][8] = {
  {5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725}, // A
  {5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866}, // B
  {5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945}, // E
  {5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880}, // F
  {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917}, // R (RaceBand)
  {5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621}, // L (LowBand)
  {5660, 5695, 5735, 5770, 5805, 5878, 5914, 5839}, // DJIv1-25
  {5735, 5770, 5805, 0, 0, 0, 0, 5839},             // DJIv1-25CE
  {5695, 5770, 5878, 0, 0, 0, 0, 5839},             // DJIv1_50
  {5669, 5705, 5768, 5804, 5839, 5876, 5912, 0},    // DJI03/04-20
  {5768, 5804, 5839, 0, 0, 0, 0, 0},                // DJI03/04-20CE
  {5677, 5794, 5902, 0, 0, 0, 0, 0},                // DJI03/04-40
  {5794, 0, 0, 0, 0, 0, 0, 0},                      // DJI03/04-40CE
  {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917}, // DJI04-R
  {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917}, // HDZero-R
  {5707, 0, 0, 0, 0, 0, 0, 0},                      // HDZero-E
  {5740, 5760, 0, 5800, 0, 0, 0, 0},                // HDZero-F
  {5732, 5769, 5806, 5843, 0, 0, 0, 0},             // HDZero-CE
  {5658, 5659, 5732, 5769, 5806, 5843, 5880, 5917}, // WalkSnail-R
  {5660, 5695, 5735, 5770, 5805, 5878, 5914, 5839}, // WalkSnail-25
  {5735, 5770, 5805, 0, 0, 0, 0, 5839},             // WalkSnail-25CE
  {5695, 5770, 5878, 0, 0, 0, 0, 5839},             // WalkSnail-50
};

// Get band and channel indices from frequency
// Returns the FIRST match to prioritize analog bands over digital
static void getBandChannelFromFreq(uint16_t freq, int8_t* bandIndex, int8_t* channelIndex) {
    *bandIndex = -1;
    *channelIndex = -1;
    
    // Search through all bands (iterate forwards to prioritize analog bands A, B, E, F, R, L)
    for (int i = 0; i < 22; i++) {
        for (int j = 0; j < 8; j++) {
            if (freqLookup[i][j] == freq) {
                *bandIndex = i;
                *channelIndex = j;
                return; // Return first match (analog bands come first)
            }
        }
    }
}

void Config::init(void) {
    if (sizeof(laptimer_config_t) > EEPROM_RESERVED_SIZE) {
        DEBUG("Config size too big, adjust reserved EEPROM size\n");
        return;
    }

    EEPROM.begin(EEPROM_RESERVED_SIZE);  // Size of EEPROM
    load();                              // Override default settings from EEPROM

    checkTimeMs = millis();

    DEBUG("EEPROM Init Successful\n");
}

void Config::load(void) {
    modified = false;
    EEPROM.get(0, conf);

    uint32_t version = 0xFFFFFFFF;
    if ((conf.version & CONFIG_MAGIC_MASK) == CONFIG_MAGIC) {
        version = conf.version & ~CONFIG_MAGIC_MASK;
    }
    
    DEBUG("EEPROM load: version=0x%08X, timerNumber=%d\n", conf.version, conf.timerNumber);

    // Handle version migration
    if (version != CONFIG_VERSION) {
        DEBUG("EEPROM config version mismatch (found=%u, expected=%u)\n", version, CONFIG_VERSION);
        
        // Migration from version 21 to 22: reinterpret maxHeatTime field from
        // minutes to 30-second blocks. Storage layout unchanged (both uint8_t
        // at the same offset); value is doubled so existing "1 min" stays
        // equivalent (2 * 30s = 60s).
        if (version == 21) {
            DEBUG("Migrating config from v21 to v22 (maxHeatTime minutes -> 30s blocks)\n");
            uint16_t doubled = (uint16_t)conf.maxHeatTime30s * 2;  // struct overlays old maxHeatTimeMin
            conf.maxHeatTime30s = (doubled > 60) ? 60 : (uint8_t)doubled;
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 20 to 22: add maxHeatTime30s field
        // (carved out of _reservedELRS padding). Default 0 = unlimited
        // preserves existing no-auto-stop behaviour for existing installs.
        else if (version == 20) {
            DEBUG("Migrating config from v20 to v22 (adding maxHeatTime30s)\n");
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 19 to 22: add raceCountdownMode + maxHeatTime30s
        // (carved out of _reservedELRS padding). Preserve the post-merge
        // behaviour (10-second visible countdown) for existing installs.
        else if (version == 19) {
            DEBUG("Migrating config from v19 to v22 (adding raceCountdownMode + maxHeatTime30s)\n");
            conf.raceCountdownMode = 1;  // Preserve post-merge 10-second countdown behaviour
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 18 to 22: no-op ELRS fields + raceCountdownMode + maxHeatTime30s.
        else if (version == 18) {
            DEBUG("Migrating config from v18 to v22 (no-op ELRS + raceCountdownMode + maxHeatTime30s)\n");
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 17 to 22: stamp current version only.
        else if (version == 17) {
            DEBUG("Migrating config from v17 to v22\n");
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 16 to 22.
        else if (version == 16) {
            DEBUG("Migrating config from v16 to v22\n");
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 15 to 22: add RotorHazard integration fields.
        else if (version == 15) {
            DEBUG("Migrating config from v15 to v22 (adding RH integration fields)\n");
            conf.rhEnabled = 0;
            memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));
            conf.rhNodeIndex = 0;
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 14 to 22: add speakerEnabled + RH.
        else if (version == 14) {
            DEBUG("Migrating config from v14 to v22 (adding speakerEnabled + RH)\n");
            conf.speakerEnabled = 1;  // Enabled by default
            conf.rhEnabled = 0;
            memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));
            conf.rhNodeIndex = 0;
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 13 to 22.
        else if (version == 13) {
            DEBUG("Migrating config from v13 to v22\n");
            conf.novaFilterKalman = 1;
            conf.novaFilterMedian = 0;
            conf.novaFilterMA = 0;
            conf.novaFilterEMA = 0;
            conf.novaFilterStepLimiter = 1;
            conf.novaKalmanQ = 200;
            conf.novaEmaAlpha = 15;
            conf.novaStepMax = 20;
            conf.speakerEnabled = 1;
            conf.rhEnabled = 0;
            memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));
            conf.rhNodeIndex = 0;
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 12 to 22.
        else if (version == 12) {
            DEBUG("Migrating config from v12 to v22\n");
            conf.receiverRadio = 0;
            conf.novaFilterKalman = 1;
            conf.novaFilterMedian = 0;
            conf.novaFilterMA = 0;
            conf.novaFilterEMA = 0;
            conf.novaFilterStepLimiter = 1;
            conf.novaKalmanQ = 200;
            conf.novaEmaAlpha = 15;
            conf.novaStepMax = 20;
            conf.speakerEnabled = 1;
            conf.rhEnabled = 0;
            memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));
            conf.rhNodeIndex = 0;
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 11 to 22.
        else if (version == 11) {
            DEBUG("Migrating config from v11 to v22\n");
            conf.autoThresholdEnabled = 0;
            conf.autoThresholdOffset = 15;
            conf.receiverRadio = 0;
            conf.novaFilterKalman = 1;
            conf.novaFilterMedian = 0;
            conf.novaFilterMA = 0;
            conf.novaFilterEMA = 0;
            conf.novaFilterStepLimiter = 1;
            conf.novaKalmanQ = 200;
            conf.novaEmaAlpha = 15;
            conf.novaStepMax = 20;
            conf.speakerEnabled = 1;
            conf.rhEnabled = 0;
            memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));
            conf.rhNodeIndex = 0;
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Migration from version 10 to 22.
        else if (version == 10) {
            DEBUG("Migrating config from v10 to v22\n");
            memset(conf.masterHostname, 0, sizeof(conf.masterHostname));
            conf.autoThresholdEnabled = 0;
            conf.autoThresholdOffset = 15;
            conf.receiverRadio = 0;
            conf.novaFilterKalman = 1;
            conf.novaFilterMedian = 0;
            conf.novaFilterMA = 0;
            conf.novaFilterEMA = 0;
            conf.novaFilterStepLimiter = 1;
            conf.novaKalmanQ = 200;
            conf.novaEmaAlpha = 15;
            conf.novaStepMax = 20;
            conf.speakerEnabled = 1;
            conf.rhEnabled = 0;
            memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));
            conf.rhNodeIndex = 0;
            conf.raceCountdownMode = 1;
            conf.maxHeatTime30s = 0;
            memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
            conf.version = CONFIG_VERSION | CONFIG_MAGIC;
            modified = true;
            write();
            DEBUG("Migration complete, config preserved\n");
        }
        // Unknown or very old version - try SD backup or reset
        else if (version > CONFIG_VERSION || version < 10) {
            DEBUG("Cannot migrate from version %u\n", version);
            if (loadFromSD()) {
                DEBUG("Successfully restored config from SD card backup\n");
                DEBUG("After SD restore: timerNumber=%d\n", conf.timerNumber);
                modified = true;
                write();
            } else {
                DEBUG("No SD backup found, using defaults\n");
                setDefaults();
            }
        }
    }

    // Sanity: announcerRate stored as x10 (1–20). If invalid, reset to default (10).
    if (conf.announcerRate < 1 || conf.announcerRate > 20) {
        DEBUG("Invalid announcerRate=%u; resetting to default 10\n", conf.announcerRate);
        conf.announcerRate = 10;
        modified = true;
    }

    // Sanity: minLap stored in 0.1s units. Reject corrupt/out-of-range values.
    // Valid range here is 1..200 => 0.1s..20.0s (UI currently exposes 1.0s..20.0s).
    if (conf.minLap < 1 || conf.minLap > 200 || conf.minLap == 0xFF) {
        DEBUG("Invalid minLap=%u; resetting to default 20 (2.0s)\n", conf.minLap);
        conf.minLap = 20;
        modified = true;
    }

    // Sanity: RSSI thresholds. Anything below the slider minimum (50) is treated as
    // corrupt and restored to a sensible default so the UI never boots showing the min.
    if (conf.enterRssi < 50 || conf.enterRssi == 0xFF) {
        DEBUG("Invalid enterRssi=%u; resetting to default 72\n", conf.enterRssi);
        conf.enterRssi = 72;
        modified = true;
    }
    if (conf.exitRssi < 50 || conf.exitRssi == 0xFF) {
        DEBUG("Invalid exitRssi=%u; resetting to default 68\n", conf.exitRssi);
        conf.exitRssi = 68;
        modified = true;
    }
    if (conf.exitRssi >= conf.enterRssi) {
        DEBUG("Invalid enter/exit relationship (enter=%u, exit=%u); clamping\n",
              conf.enterRssi, conf.exitRssi);
        if (conf.enterRssi > 50) {
            conf.exitRssi = conf.enterRssi - 1;
        } else {
            conf.enterRssi = 72;
            conf.exitRssi = 68;
        }
        modified = true;
    }

    const char* normalizedVoice = normalizeSelectedVoiceValue(conf.selectedVoice);
    if (strcmp(normalizedVoice, conf.selectedVoice) != 0) {
        DEBUG("Normalizing selectedVoice from '%s' to '%s'\n", conf.selectedVoice, normalizedVoice);
        strlcpy(conf.selectedVoice, normalizedVoice, sizeof(conf.selectedVoice));
        modified = true;
    }
}

void Config::write(void) {
    if (!modified) return;

    DEBUG("Writing to EEPROM (timerNumber=%d)\n", conf.timerNumber);

    EEPROM.put(0, conf);
    EEPROM.commit();

    DEBUG("Writing to EEPROM done\n");
    
    // Also backup to SD card if available
    if (saveToSD()) {
        DEBUG("Config backed up to SD card\n");
    }

    modified = false;
}

void Config::toJson(AsyncResponseStream& destination, BatteryMonitor* batteryMonitor) {
    // Use https://arduinojson.org/v6/assistant to estimate memory
    JsonDocument config;
    config["freq"] = conf.frequency;
    
    // Use stored band/channel indices if valid, otherwise compute from frequency
    if (conf.bandIndex < 22 && conf.channelIndex < 8) {
        config["bandIndex"] = conf.bandIndex;
        config["channelIndex"] = conf.channelIndex;
    } else {
        // Fallback: compute from frequency
        int8_t bandIdx = -1;
        int8_t channelIdx = -1;
        getBandChannelFromFreq(conf.frequency, &bandIdx, &channelIdx);
        if (bandIdx >= 0 && channelIdx >= 0) {
            config["bandIndex"] = bandIdx;
            config["channelIndex"] = channelIdx;
        }
    }
    
    config["minLap"] = conf.minLap;
    config["alarm"] = conf.alarm;
    config["anType"] = conf.announcerType;
    config["anRate"] = conf.announcerRate;
    config["enterRssi"] = conf.enterRssi;
    config["exitRssi"] = conf.exitRssi;
    config["maxLaps"] = conf.maxLaps;
    config["ledMode"] = conf.ledMode;
    config["ledBrightness"] = conf.ledBrightness;
    config["ledColor"] = conf.ledColor;
    config["ledPreset"] = conf.ledPreset;
    config["ledSpeed"] = conf.ledSpeed;
    config["ledFadeColor"] = conf.ledFadeColor;
    config["ledStrobeColor"] = conf.ledStrobeColor;
    config["ledManualOverride"] = conf.ledManualOverride;
    config["opMode"] = conf.operationMode;
    config["tracksEnabled"] = conf.tracksEnabled;
    config["selectedTrackId"] = conf.selectedTrackId;
    config["webhooksEnabled"] = conf.webhooksEnabled;
    config["webhookCount"] = conf.webhookCount;
    JsonArray webhooks = config["webhookIPs"].to<JsonArray>();
    for (uint8_t i = 0; i < conf.webhookCount; i++) {
        webhooks.add(conf.webhookIPs[i]);
    }
    config["gateLEDsEnabled"] = conf.gateLEDsEnabled;
    config["webhookRaceStart"] = conf.webhookRaceStart;
    config["webhookRaceStop"] = conf.webhookRaceStop;
    config["webhookLap"] = conf.webhookLap;
    config["name"] = conf.pilotName;
    config["pilotCallsign"] = conf.pilotCallsign;
    config["pilotPhonetic"] = conf.pilotPhonetic;
    config["pilotColor"] = conf.pilotColor;
    config["theme"] = conf.theme;
    config["selectedVoice"] = conf.selectedVoice;
    config["lapFormat"] = conf.lapFormat;
    config["ssid"] = conf.ssid;
    config["pwd"] = conf.password;
    config["batteryType"] = conf.batteryType;
    config["batteryCells"] = conf.batteryCells;
    config["lowBatteryAlarmPerCell"] = conf.lowBatteryAlarmPerCell;
    config["batteryAlarmEnabled"] = conf.batteryAlarmEnabled;
    config["batteryVoltageDivider"] = conf.batteryVoltageDivider;
    
    // Beep volume
    config["beepVolume"] = conf.beepVolume;
    
    // Race sync settings
    DEBUG("toJson: sending timerNumber=%d\n", conf.timerNumber);
    config["timerNumber"] = conf.timerNumber;
    config["raceSyncMode"] = conf.raceSyncMode;
    config["syncedTimerCount"] = conf.syncedTimerCount;
    JsonArray syncTimers = config["syncedTimers"].to<JsonArray>();
    for (uint8_t i = 0; i < conf.syncedTimerCount; i++) {
        syncTimers.add(conf.syncedTimers[i]);
    }
    config["masterHostname"] = conf.masterHostname;
    
    // Auto threshold settings
    config["autoThresholdEnabled"] = conf.autoThresholdEnabled;
    config["autoThresholdOffset"] = conf.autoThresholdOffset;
    
    // Receiver radio
    config["receiverRadio"] = conf.receiverRadio;
    
    // Novacore filter config
    config["novaFilterKalman"] = conf.novaFilterKalman;
    config["novaFilterMedian"] = conf.novaFilterMedian;
    config["novaFilterMA"] = conf.novaFilterMA;
    config["novaFilterEMA"] = conf.novaFilterEMA;
    config["novaFilterStepLimiter"] = conf.novaFilterStepLimiter;
    config["novaKalmanQ"] = conf.novaKalmanQ;
    config["novaEmaAlpha"] = conf.novaEmaAlpha;
    config["novaStepMax"] = conf.novaStepMax;
    
    // Speaker output
    config["speakerEnabled"] = conf.speakerEnabled;
#ifdef HAS_I2S_AUDIO
    config["hasI2SAudio"] = 1;  // Tell WebUI this build supports speaker
#else
    config["hasI2SAudio"] = 0;
#endif
    
    // RotorHazard integration
    config["rhEnabled"] = conf.rhEnabled;
    config["rhHostIP"] = conf.rhHostIP;
    config["rhNodeIndex"] = conf.rhNodeIndex;

    // Pre-race countdown mode (0=Less than 5, 1=10 Second Countdown)
    config["raceCountdownMode"] = conf.raceCountdownMode;

    // Maximum heat time in 30-second blocks (0 = unlimited)
    config["maxHeatTime30s"] = conf.maxHeatTime30s;
    
    // Add battery voltage if monitor exists
    if (batteryMonitor) {
        uint16_t batteryVoltage = batteryMonitor->getBatteryVoltage();
        float voltage = batteryVoltage / 10.0f;
        config["batteryVoltage"] = voltage;
    }
    
    serializeJson(config, destination);
}

void Config::toJsonString(char* buf) {
    JsonDocument config;
    config["freq"] = conf.frequency;
    config["minLap"] = conf.minLap;
    config["alarm"] = conf.alarm;
    config["anType"] = conf.announcerType;
    config["anRate"] = conf.announcerRate;
    config["enterRssi"] = conf.enterRssi;
    config["exitRssi"] = conf.exitRssi;
    config["maxLaps"] = conf.maxLaps;
    config["ledMode"] = conf.ledMode;
    config["ledBrightness"] = conf.ledBrightness;
    config["ledColor"] = conf.ledColor;
    config["ledPreset"] = conf.ledPreset;
    config["ledSpeed"] = conf.ledSpeed;
    config["ledFadeColor"] = conf.ledFadeColor;
    config["ledStrobeColor"] = conf.ledStrobeColor;
    config["ledManualOverride"] = conf.ledManualOverride;
    config["opMode"] = conf.operationMode;
    config["tracksEnabled"] = conf.tracksEnabled;
    config["selectedTrackId"] = conf.selectedTrackId;
    config["name"] = conf.pilotName;
    config["ssid"] = conf.ssid;
    config["pwd"] = conf.password;
    serializeJsonPretty(config, buf, 256);
}

void Config::fromJson(JsonObject source) {
    // Ensure version is always set correctly when modifying config
    if ((conf.version & CONFIG_MAGIC_MASK) != CONFIG_MAGIC) {
        conf.version = CONFIG_VERSION | CONFIG_MAGIC;
    }
    
    if (!source["freq"].isNull() && source["freq"] != conf.frequency) {
        conf.frequency = source["freq"];
        modified = true;
    }
    // Store band and channel indices if provided
    if (!source["bandIndex"].isNull() && source["bandIndex"] != conf.bandIndex) {
        conf.bandIndex = source["bandIndex"];
        modified = true;
    }
    if (!source["channelIndex"].isNull() && source["channelIndex"] != conf.channelIndex) {
        conf.channelIndex = source["channelIndex"];
        modified = true;
    }
    if (!source["minLap"].isNull()) {
        int val = source["minLap"].as<int>();
        // Stored as 0.1s units; keep within a sane range.
        if (val >= 1 && val <= 200) {
            if ((uint8_t)val != conf.minLap) {
                conf.minLap = (uint8_t)val;
                modified = true;
            }
        } else {
            DEBUG("Rejected out-of-range minLap=%d\n", val);
        }
    }
    if (!source["alarm"].isNull() && source["alarm"] != conf.alarm) {
        conf.alarm = source["alarm"];
        modified = true;
    }
    if (!source["anType"].isNull() && source["anType"] != conf.announcerType) {
        uint8_t val = source["anType"].as<uint8_t>();
        if (val <= 4) {
            conf.announcerType = val;
            modified = true;
        }
    }
    if (!source["anRate"].isNull()) {
        int r = source["anRate"].as<int>();

        // UI range is 0.1–2.0, stored as x10 => 1–20
        if (r < 1) r = 10;     // fall back to default 1.0
        if (r > 20) r = 20;

        if ((uint8_t)r != conf.announcerRate) {
            conf.announcerRate = (uint8_t)r;
            modified = true;
        }
    }
    if (!source["enterRssi"].isNull() && source["enterRssi"] != conf.enterRssi) {
        int val = source["enterRssi"].as<int>();
        // Reject out-of-range values (UI slider is 50..255) so we don't persist
        // bogus zeros from stale/partial payloads.
        if (val >= 50 && val <= 255) {
            conf.enterRssi = (uint8_t)val;
            modified = true;
        } else {
            DEBUG("Rejected out-of-range enterRssi=%d\n", val);
        }
    }
    if (!source["exitRssi"].isNull() && source["exitRssi"] != conf.exitRssi) {
        int val = source["exitRssi"].as<int>();
        if (val >= 50 && val <= 254) {
            conf.exitRssi = (uint8_t)val;
            modified = true;
        } else {
            DEBUG("Rejected out-of-range exitRssi=%d\n", val);
        }
    }
    if (!source["maxLaps"].isNull() && source["maxLaps"] != conf.maxLaps) {
        conf.maxLaps = source["maxLaps"];
        modified = true;
    }
    if (!source["ledMode"].isNull() && source["ledMode"] != conf.ledMode) {
        conf.ledMode = source["ledMode"];
        modified = true;
    }
    if (!source["ledBrightness"].isNull() && source["ledBrightness"] != conf.ledBrightness) {
        conf.ledBrightness = source["ledBrightness"];
        modified = true;
    }
    if (!source["ledColor"].isNull() && source["ledColor"] != conf.ledColor) {
        conf.ledColor = source["ledColor"];
        modified = true;
    }
    if (!source["ledPreset"].isNull() && source["ledPreset"] != conf.ledPreset) {
        conf.ledPreset = source["ledPreset"];
        modified = true;
    }
    if (!source["ledSpeed"].isNull() && source["ledSpeed"] != conf.ledSpeed) {
        conf.ledSpeed = source["ledSpeed"];
        modified = true;
    }
    if (!source["ledFadeColor"].isNull() && source["ledFadeColor"] != conf.ledFadeColor) {
        conf.ledFadeColor = source["ledFadeColor"];
        modified = true;
    }
    if (!source["ledStrobeColor"].isNull() && source["ledStrobeColor"] != conf.ledStrobeColor) {
        conf.ledStrobeColor = source["ledStrobeColor"];
        modified = true;
    }
    if (!source["ledManualOverride"].isNull() && source["ledManualOverride"] != conf.ledManualOverride) {
        conf.ledManualOverride = source["ledManualOverride"];
        modified = true;
    }
    if (!source["opMode"].isNull() && source["opMode"] != conf.operationMode) {
        conf.operationMode = source["opMode"];
        modified = true;
    }
    if (!source["tracksEnabled"].isNull() && source["tracksEnabled"] != conf.tracksEnabled) {
        conf.tracksEnabled = source["tracksEnabled"];
        modified = true;
    }
    if (!source["selectedTrackId"].isNull() && source["selectedTrackId"] != conf.selectedTrackId) {
        conf.selectedTrackId = source["selectedTrackId"];
        modified = true;
    }
    if (!source["gateLEDsEnabled"].isNull() && source["gateLEDsEnabled"] != conf.gateLEDsEnabled) {
        conf.gateLEDsEnabled = source["gateLEDsEnabled"];
        modified = true;
    }
    if (!source["webhookRaceStart"].isNull() && source["webhookRaceStart"] != conf.webhookRaceStart) {
        conf.webhookRaceStart = source["webhookRaceStart"];
        modified = true;
    }
    if (!source["webhookRaceStop"].isNull() && source["webhookRaceStop"] != conf.webhookRaceStop) {
        conf.webhookRaceStop = source["webhookRaceStop"];
        modified = true;
    }
    if (!source["webhookLap"].isNull() && source["webhookLap"] != conf.webhookLap) {
        conf.webhookLap = source["webhookLap"];
        modified = true;
    }
    // Webhook IPs and enabled state
    if (!source["webhooksEnabled"].isNull() && source["webhooksEnabled"] != conf.webhooksEnabled) {
        conf.webhooksEnabled = source["webhooksEnabled"];
        modified = true;
    }
    if (!source["webhookIPs"].isNull()) {
        JsonArray webhookArray = source["webhookIPs"].as<JsonArray>();

        bool changed = false;

        // Compare count
        if (webhookArray.size() != conf.webhookCount) {
            changed = true;
        } else {
            // Compare entries
            uint8_t i = 0;
            for (JsonVariant ip : webhookArray) {
                const char* ipStr = ip.as<const char*>() ? ip.as<const char*>() : "";
                if (strcmp(conf.webhookIPs[i], ipStr) != 0) {
                    changed = true;
                    break;
                }
                i++;
            }
        }

        if (changed) {
            memset(conf.webhookIPs, 0, sizeof(conf.webhookIPs));
            conf.webhookCount = 0;

            for (JsonVariant ip : webhookArray) {
                if (conf.webhookCount < 10) {
                    const char* ipStr = ip.as<const char*>() ? ip.as<const char*>() : "";
                    strlcpy(conf.webhookIPs[conf.webhookCount], ipStr, 16);
                    conf.webhookCount++;
                }
            }
            modified = true;
        }
    }

    if (!source["name"].isNull()) {
        const char* v = source["name"] | "";
        if (strcmp(v, conf.pilotName) != 0) {
            strlcpy(conf.pilotName, v, sizeof(conf.pilotName));
            modified = true;
        }
    }
    if (!source["pilotCallsign"].isNull() && source["pilotCallsign"] != conf.pilotCallsign) {
        strlcpy(conf.pilotCallsign, source["pilotCallsign"] | "", sizeof(conf.pilotCallsign));
        modified = true;
    }
    if (!source["pilotPhonetic"].isNull() && source["pilotPhonetic"] != conf.pilotPhonetic) {
        strlcpy(conf.pilotPhonetic, source["pilotPhonetic"] | "", sizeof(conf.pilotPhonetic));
        modified = true;
    }
    if (!source["pilotColor"].isNull() && source["pilotColor"] != conf.pilotColor) {
        conf.pilotColor = source["pilotColor"];
        modified = true;
    }
    if (!source["theme"].isNull() && source["theme"] != conf.theme) {
        strlcpy(conf.theme, source["theme"] | "oceanic", sizeof(conf.theme));
        modified = true;
    }
    if (!source["selectedVoice"].isNull()) {
        const char* requestedVoice = source["selectedVoice"] | "default";
        const char* normalizedVoice = normalizeSelectedVoiceValue(requestedVoice);
        if (strcmp(normalizedVoice, conf.selectedVoice) != 0) {
            strlcpy(conf.selectedVoice, normalizedVoice, sizeof(conf.selectedVoice));
            modified = true;
        }
    }
    if (!source["lapFormat"].isNull() && source["lapFormat"] != conf.lapFormat) {
        strlcpy(conf.lapFormat, source["lapFormat"] | "full", sizeof(conf.lapFormat));
        modified = true;
    }
    if (!source["ssid"].isNull()) {
        const char* v = source["ssid"] | "";
        if (strcmp(v, conf.ssid) != 0) {
            strlcpy(conf.ssid, v, sizeof(conf.ssid));
            modified = true;
        }
    }
    if (!source["pwd"].isNull()) {
        const char* v = source["pwd"] | "";
        if (strcmp(v, conf.password) != 0) {
            strlcpy(conf.password, v, sizeof(conf.password));
            modified = true;
        }
    }
    if (!source["batteryType"].isNull() && source["batteryType"] != conf.batteryType) {
        conf.batteryType = source["batteryType"];
        modified = true;
    }
    if (!source["batteryCells"].isNull() && source["batteryCells"] != conf.batteryCells) {
        conf.batteryCells = source["batteryCells"];
        modified = true;
    }
    if (!source["lowBatteryAlarmPerCell"].isNull()) {
        float v = source["lowBatteryAlarmPerCell"].as<float>();
        if (conf.lowBatteryAlarmPerCell != v) {
            conf.lowBatteryAlarmPerCell = v;
            modified = true;
        }
    }
    if (!source["batteryAlarmEnabled"].isNull() && source["batteryAlarmEnabled"] != conf.batteryAlarmEnabled) {
        conf.batteryAlarmEnabled = source["batteryAlarmEnabled"];
        modified = true;
    }
    if (!source["batteryVoltageDivider"].isNull()) {
        float v = sanitizeBatteryDivider(source["batteryVoltageDivider"].as<float>());
        if (conf.batteryVoltageDivider != v) {
            conf.batteryVoltageDivider = v;
            modified = true;
        }
    }
    
    // Beep volume
    if (!source["beepVolume"].isNull() && source["beepVolume"] != conf.beepVolume) {
        uint8_t vol = source["beepVolume"].as<uint8_t>();
        if (vol <= 100) {
            conf.beepVolume = vol;
            modified = true;
        }
    }
    
    // Race sync settings
    if (!source["timerNumber"].isNull() && source["timerNumber"] != conf.timerNumber) {
        uint8_t num = source["timerNumber"].as<uint8_t>();
        DEBUG("fromJson: timerNumber changing from %d to %d\n", conf.timerNumber, num);
        if (num <= 8) {
            conf.timerNumber = num;
            modified = true;
        }
    }
    if (!source["raceSyncMode"].isNull() && source["raceSyncMode"] != conf.raceSyncMode) {
        uint8_t mode = source["raceSyncMode"].as<uint8_t>();
        if (mode <= 2) {
            conf.raceSyncMode = mode;
            modified = true;
        }
    }
    if (!source["syncedTimers"].isNull()) {
        JsonArray syncArray = source["syncedTimers"].as<JsonArray>();
        
        bool changed = false;
        
        // Compare count
        if (syncArray.size() != conf.syncedTimerCount) {
            changed = true;
        } else {
            // Compare entries
            uint8_t i = 0;
            for (JsonVariant timer : syncArray) {
                const char* timerStr = timer.as<const char*>() ? timer.as<const char*>() : "";
                if (strcmp(conf.syncedTimers[i], timerStr) != 0) {
                    changed = true;
                    break;
                }
                i++;
            }
        }
        
        if (changed) {
            memset(conf.syncedTimers, 0, sizeof(conf.syncedTimers));
            conf.syncedTimerCount = 0;
            
            for (JsonVariant timer : syncArray) {
                if (conf.syncedTimerCount < 5) {
                    const char* timerStr = timer.as<const char*>() ? timer.as<const char*>() : "";
                    strlcpy(conf.syncedTimers[conf.syncedTimerCount], timerStr, 32);
                    conf.syncedTimerCount++;
                }
            }
            modified = true;
        }
    }
    if (!source["masterHostname"].isNull()) {
        const char* hostname = source["masterHostname"] | "";
        if (strcmp(hostname, conf.masterHostname) != 0) {
            strlcpy(conf.masterHostname, hostname, sizeof(conf.masterHostname));
            modified = true;
        }
    }
    // Auto threshold settings
    if (!source["autoThresholdEnabled"].isNull() && source["autoThresholdEnabled"] != conf.autoThresholdEnabled) {
        uint8_t val = source["autoThresholdEnabled"].as<uint8_t>();
        if (val <= 1) {
            conf.autoThresholdEnabled = val;
            modified = true;
        }
    }
    if (!source["autoThresholdOffset"].isNull() && source["autoThresholdOffset"] != conf.autoThresholdOffset) {
        conf.autoThresholdOffset = source["autoThresholdOffset"].as<uint8_t>();
        modified = true;
    }
    // Receiver radio
    if (!source["receiverRadio"].isNull() && source["receiverRadio"] != conf.receiverRadio) {
        uint8_t val = source["receiverRadio"].as<uint8_t>();
        if (val <= 1) {
            conf.receiverRadio = val;
            modified = true;
        }
    }
    // Novacore filter config
    if (!source["novaFilterKalman"].isNull() && source["novaFilterKalman"] != conf.novaFilterKalman) {
        conf.novaFilterKalman = source["novaFilterKalman"].as<uint8_t>() ? 1 : 0;
        modified = true;
    }
    if (!source["novaFilterMedian"].isNull() && source["novaFilterMedian"] != conf.novaFilterMedian) {
        conf.novaFilterMedian = source["novaFilterMedian"].as<uint8_t>() ? 1 : 0;
        modified = true;
    }
    if (!source["novaFilterMA"].isNull() && source["novaFilterMA"] != conf.novaFilterMA) {
        conf.novaFilterMA = source["novaFilterMA"].as<uint8_t>() ? 1 : 0;
        modified = true;
    }
    if (!source["novaFilterEMA"].isNull() && source["novaFilterEMA"] != conf.novaFilterEMA) {
        conf.novaFilterEMA = source["novaFilterEMA"].as<uint8_t>() ? 1 : 0;
        modified = true;
    }
    if (!source["novaFilterStepLimiter"].isNull() && source["novaFilterStepLimiter"] != conf.novaFilterStepLimiter) {
        conf.novaFilterStepLimiter = source["novaFilterStepLimiter"].as<uint8_t>() ? 1 : 0;
        modified = true;
    }
    if (!source["novaKalmanQ"].isNull() && source["novaKalmanQ"] != conf.novaKalmanQ) {
        uint16_t val = source["novaKalmanQ"].as<uint16_t>();
        if (val >= 100 && val <= 1500) {
            conf.novaKalmanQ = val;
            modified = true;
        }
    }
    if (!source["novaEmaAlpha"].isNull() && source["novaEmaAlpha"] != conf.novaEmaAlpha) {
        uint8_t val = source["novaEmaAlpha"].as<uint8_t>();
        if (val >= 5 && val <= 80) {
            conf.novaEmaAlpha = val;
            modified = true;
        }
    }
    if (!source["novaStepMax"].isNull() && source["novaStepMax"] != conf.novaStepMax) {
        uint8_t val = source["novaStepMax"].as<uint8_t>();
        if (val >= 5 && val <= 50) {
            conf.novaStepMax = val;
            modified = true;
        }
    }
    // Speaker output
    if (!source["speakerEnabled"].isNull() && source["speakerEnabled"] != conf.speakerEnabled) {
        uint8_t val = source["speakerEnabled"].as<uint8_t>();
        if (val <= 1) {
            conf.speakerEnabled = val;
            modified = true;
        }
    }
    // RotorHazard integration
    if (!source["rhEnabled"].isNull() && source["rhEnabled"] != conf.rhEnabled) {
        uint8_t val = source["rhEnabled"].as<uint8_t>();
        if (val <= 1) {
            conf.rhEnabled = val;
            modified = true;
        }
    }
    if (!source["rhHostIP"].isNull()) {
        const char* v = source["rhHostIP"] | "";
        if (strcmp(v, conf.rhHostIP) != 0) {
            strlcpy(conf.rhHostIP, v, sizeof(conf.rhHostIP));
            modified = true;
        }
    }
    if (!source["rhNodeIndex"].isNull() && source["rhNodeIndex"] != conf.rhNodeIndex) {
        uint8_t val = source["rhNodeIndex"].as<uint8_t>();
        if (val <= 7) {
            conf.rhNodeIndex = val;
            modified = true;
        }
    }
    // Pre-race countdown mode
    if (!source["raceCountdownMode"].isNull() && source["raceCountdownMode"] != conf.raceCountdownMode) {
        uint8_t val = source["raceCountdownMode"].as<uint8_t>();
        if (val <= 1) {
            conf.raceCountdownMode = val;
            modified = true;
        }
    }
    // Maximum heat time in 30-second blocks (0 = unlimited, 1..60 = 30s..30min)
    if (!source["maxHeatTime30s"].isNull() && source["maxHeatTime30s"] != conf.maxHeatTime30s) {
        uint8_t val = source["maxHeatTime30s"].as<uint8_t>();
        if (val <= 60) {
            conf.maxHeatTime30s = val;
            modified = true;
        }
    }
}

uint16_t Config::getFrequency() {
    // === TEMPORARY HARDCODE FOR RX5808 CH1 PIN ISSUE ===
    // Hardcoded to R1 (5658 MHz) - Raceband Channel 1
    // TODO: Remove this once CH1 pin is fixed and revert to: return conf.frequency;
    // return 5658;
    // === END TEMPORARY HARDCODE ===
    return conf.frequency;
}

uint32_t Config::getMinLapMs() {
    return conf.minLap * 100;
}

uint8_t Config::getAlarmThreshold() {
    return conf.alarm;
}

uint8_t Config::getEnterRssi() {
    return conf.enterRssi;
}

uint8_t Config::getExitRssi() {
    return conf.exitRssi;
}

char* Config::getSsid() {
    return conf.ssid;
}

char* Config::getPassword() {
    return conf.password;
}

uint8_t Config::getMaxLaps() {
    return conf.maxLaps;
}

uint8_t Config::getLedMode() {
    return conf.ledMode;
}

uint8_t Config::getLedBrightness() {
    return conf.ledBrightness;
}

uint32_t Config::getLedColor() {
    return conf.ledColor;
}

uint8_t Config::getLedPreset() {
    return conf.ledPreset;
}

uint8_t Config::getLedSpeed() {
    return conf.ledSpeed;
}

uint32_t Config::getLedFadeColor() {
    return conf.ledFadeColor;
}

uint32_t Config::getLedStrobeColor() {
    return conf.ledStrobeColor;
}

uint8_t Config::getLedManualOverride() {
    return conf.ledManualOverride;
}

uint8_t Config::getOperationMode() {
    return conf.operationMode;
}

uint8_t Config::getTracksEnabled() {
    return conf.tracksEnabled;
}

uint32_t Config::getSelectedTrackId() {
    return conf.selectedTrackId;
}

uint8_t Config::getWebhooksEnabled() {
    return conf.webhooksEnabled;
}

uint8_t Config::getWebhookCount() {
    return conf.webhookCount;
}

const char* Config::getWebhookIP(uint8_t index) {
    if (index < conf.webhookCount) {
        return conf.webhookIPs[index];
    }
    return nullptr;
}

uint8_t Config::getGateLEDsEnabled() {
    return conf.gateLEDsEnabled;
}

uint8_t Config::getWebhookRaceStart() {
    return conf.webhookRaceStart;
}

uint8_t Config::getWebhookRaceStop() {
    return conf.webhookRaceStop;
}

uint8_t Config::getWebhookLap() {
    return conf.webhookLap;
}

char* Config::getPilotName() {
    return conf.pilotName;
}

char* Config::getPilotCallsign() {
    return conf.pilotCallsign;
}

char* Config::getPilotPhonetic() {
    return conf.pilotPhonetic;
}

uint32_t Config::getPilotColor() {
    return conf.pilotColor;
}

char* Config::getTheme() {
    return conf.theme;
}

char* Config::getSelectedVoice() {
    return conf.selectedVoice;
}

char* Config::getLapFormat() {
    return conf.lapFormat;
}

// Band/channel getters and setters
uint8_t Config::getBandIndex() {
    return conf.bandIndex;
}

uint8_t Config::getChannelIndex() {
    return conf.channelIndex;
}

void Config::setBandIndex(uint8_t idx) {
    if (conf.bandIndex != idx) {
        conf.bandIndex = idx;
        modified = true;
    }
}

void Config::setChannelIndex(uint8_t idx) {
    if (conf.channelIndex != idx) {
        conf.channelIndex = idx;
        modified = true;
    }
}

extern const uint16_t freqLookup[][8];

uint16_t Config::getFrequencyForBandChannel(uint8_t bandIdx, uint8_t channelIdx) {
    if (bandIdx < 22 && channelIdx < 8) {
        return freqLookup[bandIdx][channelIdx];
    }
    return 0;
}

// Setters for RotorHazard node mode
void Config::setFrequency(uint16_t freq) {
    if (conf.frequency != freq) {
        conf.frequency = freq;
        modified = true;
    }
}

void Config::setEnterRssi(uint8_t rssi) {
    if (conf.enterRssi != rssi) {
        conf.enterRssi = rssi;
        modified = true;
    }
}

void Config::setExitRssi(uint8_t rssi) {
    if (conf.exitRssi != rssi) {
        conf.exitRssi = rssi;
        modified = true;
    }
}

void Config::setOperationMode(uint8_t mode) {
    if (conf.operationMode != mode) {
        conf.operationMode = mode;
        modified = true;
    }
}

void Config::setLedPreset(uint8_t preset) {
    if (conf.ledPreset != preset) {
        conf.ledPreset = preset;
        modified = true;
    }
}

void Config::setLedBrightness(uint8_t brightness) {
    if (conf.ledBrightness != brightness) {
        conf.ledBrightness = brightness;
        modified = true;
    }
}

void Config::setLedSpeed(uint8_t speed) {
    if (conf.ledSpeed != speed) {
        conf.ledSpeed = speed;
        modified = true;
    }
}

void Config::setLedColor(uint32_t color) {
    if (conf.ledColor != color) {
        conf.ledColor = color;
        modified = true;
    }
}

void Config::setLedFadeColor(uint32_t color) {
    if (conf.ledFadeColor != color) {
        conf.ledFadeColor = color;
        modified = true;
    }
}

void Config::setLedStrobeColor(uint32_t color) {
    if (conf.ledStrobeColor != color) {
        conf.ledStrobeColor = color;
        modified = true;
    }
}

void Config::setLedManualOverride(uint8_t override) {
    if (conf.ledManualOverride != override) {
        conf.ledManualOverride = override;
        modified = true;
    }
}

void Config::setTracksEnabled(uint8_t enabled) {
    if (conf.tracksEnabled != enabled) {
        conf.tracksEnabled = enabled;
        modified = true;
    }
}

void Config::setSelectedTrackId(uint32_t trackId) {
    if (conf.selectedTrackId != trackId) {
        conf.selectedTrackId = trackId;
        modified = true;
    }
}

void Config::setWebhooksEnabled(uint8_t enabled) {
    if (conf.webhooksEnabled != enabled) {
        conf.webhooksEnabled = enabled;
        modified = true;
    }
}

bool Config::addWebhookIP(const char* ip) {
    if (conf.webhookCount >= 10) {
        DEBUG("Max webhooks reached\n");
        return false;
    }
    
    // Check if IP already exists
    for (uint8_t i = 0; i < conf.webhookCount; i++) {
        if (strcmp(conf.webhookIPs[i], ip) == 0) {
            DEBUG("Webhook IP already exists\n");
            return false;
        }
    }
    
    strlcpy(conf.webhookIPs[conf.webhookCount], ip, 16);
    conf.webhookCount++;
    modified = true;
    return true;
}

bool Config::removeWebhookIP(const char* ip) {
    for (uint8_t i = 0; i < conf.webhookCount; i++) {
        if (strcmp(conf.webhookIPs[i], ip) == 0) {
            // Shift remaining IPs down
            for (uint8_t j = i; j < conf.webhookCount - 1; j++) {
                strlcpy(conf.webhookIPs[j], conf.webhookIPs[j + 1], 16);
            }
            conf.webhookCount--;
            memset(conf.webhookIPs[conf.webhookCount], 0, 16);  // Clear last entry
            modified = true;
            return true;
        }
    }
    return false;
}

void Config::clearWebhookIPs() {
    memset(conf.webhookIPs, 0, sizeof(conf.webhookIPs));
    conf.webhookCount = 0;
    modified = true;
}

void Config::setGateLEDsEnabled(uint8_t enabled) {
    if (conf.gateLEDsEnabled != enabled) {
        conf.gateLEDsEnabled = enabled;
        modified = true;
    }
}

void Config::setWebhookRaceStart(uint8_t enabled) {
    if (conf.webhookRaceStart != enabled) {
        conf.webhookRaceStart = enabled;
        modified = true;
    }
}

void Config::setWebhookRaceStop(uint8_t enabled) {
    if (conf.webhookRaceStop != enabled) {
        conf.webhookRaceStop = enabled;
        modified = true;
    }
}

void Config::setWebhookLap(uint8_t enabled) {
    if (conf.webhookLap != enabled) {
        conf.webhookLap = enabled;
        modified = true;
    }
}

uint8_t Config::getBatteryType() {
    return conf.batteryType;
}

void Config::setBatteryType(uint8_t type) {
    if (conf.batteryType != type) {
        conf.batteryType = type;
        modified = true;
    }
}

uint8_t Config::getBatteryCells() {
    return conf.batteryCells;
}

void Config::setBatteryCells(uint8_t cells) {
    if (conf.batteryCells != cells) {
        conf.batteryCells = cells;
        modified = true;
    }
}

float Config::getLowBatteryAlarmPerCell() {
    return conf.lowBatteryAlarmPerCell;
}

void Config::setLowBatteryAlarmPerCell(float voltage) {
    if (conf.lowBatteryAlarmPerCell != voltage) {
        conf.lowBatteryAlarmPerCell = voltage;
        modified = true;
    }
}

uint8_t Config::getBatteryAlarmEnabled() {
    return conf.batteryAlarmEnabled;
}

void Config::setBatteryAlarmEnabled(uint8_t enabled) {
    if (conf.batteryAlarmEnabled != enabled) {
        conf.batteryAlarmEnabled = enabled;
        modified = true;
    }
}

float Config::getBatteryVoltageDivider() {
    return conf.batteryVoltageDivider;
}

void Config::setBatteryVoltageDivider(float ratio) {
    ratio = sanitizeBatteryDivider(ratio);
    if (conf.batteryVoltageDivider != ratio) {
        conf.batteryVoltageDivider = ratio;
        modified = true;
    }
}

// Race sync getters and setters
uint8_t Config::getTimerNumber() {
    return conf.timerNumber;
}

void Config::setTimerNumber(uint8_t number) {
    if (number <= 8 && conf.timerNumber != number) {
        conf.timerNumber = number;
        modified = true;
    }
}

uint8_t Config::getRaceSyncMode() {
    return conf.raceSyncMode;
}

void Config::setRaceSyncMode(uint8_t mode) {
    if (mode <= 2 && conf.raceSyncMode != mode) {
        conf.raceSyncMode = mode;
        modified = true;
    }
}

uint8_t Config::getSyncedTimerCount() {
    return conf.syncedTimerCount;
}

const char* Config::getSyncedTimer(uint8_t index) {
    if (index < conf.syncedTimerCount) {
        return conf.syncedTimers[index];
    }
    return nullptr;
}

bool Config::addSyncedTimer(const char* hostname) {
    if (conf.syncedTimerCount >= 5) {
        DEBUG("Max synced timers reached\n");
        return false;
    }
    
    // Check if hostname already exists
    for (uint8_t i = 0; i < conf.syncedTimerCount; i++) {
        if (strcmp(conf.syncedTimers[i], hostname) == 0) {
            DEBUG("Synced timer already exists\n");
            return false;
        }
    }
    
    strlcpy(conf.syncedTimers[conf.syncedTimerCount], hostname, 32);
    conf.syncedTimerCount++;
    modified = true;
    return true;
}

bool Config::removeSyncedTimer(const char* hostname) {
    for (uint8_t i = 0; i < conf.syncedTimerCount; i++) {
        if (strcmp(conf.syncedTimers[i], hostname) == 0) {
            // Shift remaining timers down
            for (uint8_t j = i; j < conf.syncedTimerCount - 1; j++) {
                strlcpy(conf.syncedTimers[j], conf.syncedTimers[j + 1], 32);
            }
            conf.syncedTimerCount--;
            memset(conf.syncedTimers[conf.syncedTimerCount], 0, 32);  // Clear last entry
            modified = true;
            return true;
        }
    }
    return false;
}

void Config::clearSyncedTimers() {
    memset(conf.syncedTimers, 0, sizeof(conf.syncedTimers));
    conf.syncedTimerCount = 0;
    modified = true;
}

uint8_t Config::getBeepVolume() {
    return conf.beepVolume;
}

void Config::setBeepVolume(uint8_t volume) {
    if (volume <= 100 && conf.beepVolume != volume) {
        conf.beepVolume = volume;
        modified = true;
    }
}

char* Config::getMasterHostname() {
    return conf.masterHostname;
}

void Config::setMasterHostname(const char* hostname) {
    if (strcmp(hostname, conf.masterHostname) != 0) {
        strlcpy(conf.masterHostname, hostname, sizeof(conf.masterHostname));
        modified = true;
    }
}

uint8_t Config::getAutoThresholdEnabled() {
    return conf.autoThresholdEnabled;
}

void Config::setAutoThresholdEnabled(uint8_t enabled) {
    if (enabled <= 1 && conf.autoThresholdEnabled != enabled) {
        conf.autoThresholdEnabled = enabled;
        modified = true;
    }
}

uint8_t Config::getAutoThresholdOffset() {
    return conf.autoThresholdOffset;
}

void Config::setAutoThresholdOffset(uint8_t offset) {
    if (conf.autoThresholdOffset != offset) {
        conf.autoThresholdOffset = offset;
        modified = true;
    }
}

uint8_t Config::getReceiverRadio() {
    return conf.receiverRadio;
}

void Config::setReceiverRadio(uint8_t radio) {
    if (radio <= 1 && conf.receiverRadio != radio) {
        conf.receiverRadio = radio;
        modified = true;
    }
}

uint8_t Config::getNovaFilterKalman() { return conf.novaFilterKalman; }
uint8_t Config::getNovaFilterMedian() { return conf.novaFilterMedian; }
uint8_t Config::getNovaFilterMA() { return conf.novaFilterMA; }
uint8_t Config::getNovaFilterEMA() { return conf.novaFilterEMA; }
uint8_t Config::getNovaFilterStepLimiter() { return conf.novaFilterStepLimiter; }
uint16_t Config::getNovaKalmanQ() { return conf.novaKalmanQ; }
uint8_t Config::getNovaEmaAlpha() { return conf.novaEmaAlpha; }
uint8_t Config::getNovaStepMax() { return conf.novaStepMax; }

uint8_t Config::getAnnouncerType() { return conf.announcerType; }

uint8_t Config::getSpeakerEnabled() { return conf.speakerEnabled; }
void Config::setSpeakerEnabled(uint8_t enabled) {
    if (enabled <= 1 && conf.speakerEnabled != enabled) {
        conf.speakerEnabled = enabled;
        modified = true;
    }
}

// RotorHazard integration
uint8_t Config::getRhEnabled() { return conf.rhEnabled; }
void Config::setRhEnabled(uint8_t enabled) {
    if (enabled <= 1 && conf.rhEnabled != enabled) {
        conf.rhEnabled = enabled;
        modified = true;
    }
}
char* Config::getRhHostIP() { return conf.rhHostIP; }
void Config::setRhHostIP(const char* ip) {
    if (strcmp(ip, conf.rhHostIP) != 0) {
        strlcpy(conf.rhHostIP, ip, sizeof(conf.rhHostIP));
        modified = true;
    }
}
uint8_t Config::getRhNodeIndex() { return conf.rhNodeIndex; }
void Config::setRhNodeIndex(uint8_t index) {
    if (index <= 7 && conf.rhNodeIndex != index) {
        conf.rhNodeIndex = index;
        modified = true;
    }
}

uint8_t Config::getRaceCountdownMode() { return conf.raceCountdownMode <= 1 ? conf.raceCountdownMode : 1; }
void Config::setRaceCountdownMode(uint8_t mode) {
    if (mode <= 1 && conf.raceCountdownMode != mode) {
        conf.raceCountdownMode = mode;
        modified = true;
    }
}

uint8_t Config::getMaxHeatTime30s() { return conf.maxHeatTime30s; }
void Config::setMaxHeatTime30s(uint8_t blocks) {
    if (blocks <= 60 && conf.maxHeatTime30s != blocks) {
        conf.maxHeatTime30s = blocks;
        modified = true;
    }
}

void Config::setDefaults(void) {
    DEBUG("Setting EEPROM defaults\n");
    // Reset everything to 0/false and then just set anything that zero is not appropriate
    memset(&conf, 0, sizeof(conf));
    conf.version = CONFIG_VERSION | CONFIG_MAGIC;
    conf.frequency = 5658;  // RaceBand Channel 1 (R1) - 5658 MHz
    conf.bandIndex = 4;  // RaceBand (R)
    conf.channelIndex = 0;  // Channel 1
    conf.minLap = 20;  // 2.0 seconds
    conf.alarm = 0;  // Alarm disabled
    conf.announcerType = 2;
    conf.announcerRate = 10;
    conf.enterRssi = 72;
    conf.exitRssi = 68;
    conf.maxLaps = 0;
    conf.ledMode = 3;  // Rainbow wave by default (legacy)
    conf.ledBrightness = 120;
    conf.ledColor = 14492325;  // 0xDD00A5 (purple-pink)
    conf.ledPreset = 3;  // Color fade preset by default
    conf.ledSpeed = 5;  // Medium speed
    conf.ledFadeColor = 0x0080FF;  // Blue for fade
    conf.ledStrobeColor = 0xFFFFFF;  // White for strobe
    conf.ledManualOverride = 0;  // Manual override off by default
    conf.operationMode = 0;  // WiFi mode by default
    conf.tracksEnabled = 1;  // Tracks enabled by default
    conf.selectedTrackId = 0;  // No track selected by default (will be set on first track creation)
    conf.webhooksEnabled = 0;  // Webhooks disabled by default (no IPs configured)
    conf.webhookCount = 0;  // No webhooks configured
    memset(conf.webhookIPs, 0, sizeof(conf.webhookIPs));  // Clear all webhook IPs
    conf.gateLEDsEnabled = 1;  // Gate LEDs enabled by default
    conf.webhookRaceStart = 1;  // Race start enabled by default
    conf.webhookRaceStop = 1;  // Race stop enabled by default
    conf.webhookLap = 1;  // Lap enabled by default
    strlcpy(conf.pilotName, "Louis", sizeof(conf.pilotName));  // Default pilot name
    strlcpy(conf.pilotCallsign, "Louis", sizeof(conf.pilotCallsign));  // Default callsign
    strlcpy(conf.pilotPhonetic, "Louie", sizeof(conf.pilotPhonetic));  // Default phonetic
    conf.pilotColor = 0x0080FF;  // Default blue color
    strlcpy(conf.theme, "oceanic", sizeof(conf.theme));  // Default theme
    strlcpy(conf.selectedVoice, "default", sizeof(conf.selectedVoice));  // Default voice
    strlcpy(conf.lapFormat, "timeonly", sizeof(conf.lapFormat));  // Default lap format
    strlcpy(conf.ssid, "", sizeof(conf.ssid));  // Empty WiFi credentials
    strlcpy(conf.password, "", sizeof(conf.password));  // Empty WiFi credentials
    conf.batteryType = BATTERY_TYPE_LIPO;  // Default to LiPo
    conf.batteryCells = 4;  // Default to 4S
    conf.lowBatteryAlarmPerCell = 3.5f;  // Default 3.5V per cell
    conf.batteryAlarmEnabled = 0;  // Disabled by default
    conf.batteryVoltageDivider = 2.0f;  // Default 2:1 voltage divider
    conf.timerNumber = 0;  // Default fpvgate.local
    conf.raceSyncMode = RACE_SYNC_DISABLED;  // Disabled by default
    conf.syncedTimerCount = 0;  // No synced timers
    memset(conf.syncedTimers, 0, sizeof(conf.syncedTimers));  // Clear synced timers
    conf.beepVolume = 100;  // Default 100% volume
    strlcpy(conf.masterHostname, "", sizeof(conf.masterHostname));  // Empty master hostname
    conf.autoThresholdEnabled = 0;  // Manual threshold mode by default
    conf.autoThresholdOffset = 65;  // Default baseline RSSI (ambient floor)
    conf.receiverRadio = 0;  // Default to RX5808
    // Novacore filter defaults
    conf.novaFilterKalman = 1;       // Kalman on
    conf.novaFilterMedian = 0;       // Median off
    conf.novaFilterMA = 0;           // Moving average off
    conf.novaFilterEMA = 0;          // EMA off
    conf.novaFilterStepLimiter = 1;  // Step limiter on
    conf.novaKalmanQ = 200;          // Q=2.0 (light smoothing)
    conf.novaEmaAlpha = 15;          // alpha=0.15
    conf.novaStepMax = 20;           // max step per sample
    conf.speakerEnabled = 1;         // Speaker enabled by default
    // RotorHazard integration defaults
    conf.rhEnabled = 0;              // Disabled by default
    memset(conf.rhHostIP, 0, sizeof(conf.rhHostIP));  // Empty host
    conf.rhNodeIndex = 0;            // Seat 0 by default
    // Pre-race countdown defaults: keep the post-merge 10-second visible countdown
    conf.raceCountdownMode = 1;
    // Maximum heat time: 0 = unlimited (no auto-stop), else N * 30 seconds
    conf.maxHeatTime30s = 0;
    // Reserved slack for future ELRS Backpack fields
    memset(conf._reservedELRS, 0, sizeof(conf._reservedELRS));
    modified = true;
    write();
}

void Config::handleEeprom(uint32_t currentTimeMs) {
    if (modified && ((currentTimeMs - checkTimeMs) > EEPROM_CHECK_TIME_MS)) {
        checkTimeMs = currentTimeMs;
        write();
    }
}

bool Config::saveToSD() {
    if (!storage || !storage->isSDAvailable()) {
        return false;
    }
    
    DEBUG("Saving config to SD: %s\n", CONFIG_BACKUP_PATH);
    
#ifdef ESP32S3
    File file = SD.open(CONFIG_BACKUP_PATH, FILE_WRITE);
    if (!file) {
        DEBUG("Failed to open config backup file for writing\n");
        return false;
    }
    
    size_t written = file.write((uint8_t*)&conf, sizeof(laptimer_config_t));
    file.close();
    
    if (written != sizeof(laptimer_config_t)) {
        DEBUG("Failed to write complete config (wrote %d of %d bytes)\n", written, sizeof(laptimer_config_t));
        return false;
    }
    
    DEBUG("Config saved to SD (%d bytes)\n", written);
    return true;
#else
    return false;
#endif
}

bool Config::loadFromSD() {
    if (!storage || !storage->isSDAvailable()) {
        return false;
    }
    
    DEBUG("Attempting to load config from SD: %s\n", CONFIG_BACKUP_PATH);
    
#ifdef ESP32S3
    if (!SD.exists(CONFIG_BACKUP_PATH)) {
        DEBUG("No config backup file found on SD\n");
        return false;
    }
    
    File file = SD.open(CONFIG_BACKUP_PATH, FILE_READ);
    if (!file) {
        DEBUG("Failed to open config backup file for reading\n");
        return false;
    }
    
    size_t fileSize = file.size();
    if (fileSize != sizeof(laptimer_config_t)) {
        DEBUG("Config backup file size mismatch (found %d, expected %d)\n", fileSize, sizeof(laptimer_config_t));
        file.close();
        return false;
    }
    
    laptimer_config_t temp_conf;
    size_t bytesRead = file.read((uint8_t*)&temp_conf, sizeof(laptimer_config_t));
    file.close();
    
    if (bytesRead != sizeof(laptimer_config_t)) {
        DEBUG("Failed to read complete config (read %d of %d bytes)\n", bytesRead, sizeof(laptimer_config_t));
        return false;
    }
    
    // Validate the loaded config
    uint32_t version = 0xFFFFFFFF;
    if ((temp_conf.version & CONFIG_MAGIC_MASK) == CONFIG_MAGIC) {
        version = temp_conf.version & ~CONFIG_MAGIC_MASK;
    }
    
    if (version != CONFIG_VERSION) {
        DEBUG("SD config version mismatch (found %u, expected %u)\n", version, CONFIG_VERSION);
        return false;
    }
    
    // Config is valid, use it
    memcpy(&conf, &temp_conf, sizeof(laptimer_config_t));
    DEBUG("Config loaded from SD successfully\n");
    return true;
#else
    return false;
#endif
}
