#include "config.h"

#include <EEPROM.h>

#include "debug.h"

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

    // If version is not current, reset to defaults
    if (version != CONFIG_VERSION) {
        setDefaults();
    }
}

void Config::write(void) {
    if (!modified) return;

    DEBUG("Writing to EEPROM\n");

    EEPROM.put(0, conf);
    EEPROM.commit();

    DEBUG("Writing to EEPROM done\n");

    modified = false;
}

void Config::toJson(AsyncResponseStream& destination) {
    // Use https://arduinojson.org/v6/assistant to estimate memory
    DynamicJsonDocument config(256);
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
    config["name"] = conf.pilotName;
    config["ssid"] = conf.ssid;
    config["pwd"] = conf.password;
    serializeJson(config, destination);
}

void Config::toJsonString(char* buf) {
    DynamicJsonDocument config(256);
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
    config["name"] = conf.pilotName;
    config["ssid"] = conf.ssid;
    config["pwd"] = conf.password;
    serializeJsonPretty(config, buf, 256);
}

void Config::fromJson(JsonObject source) {
    if (source["freq"] != conf.frequency) {
        conf.frequency = source["freq"];
        modified = true;
    }
    if (source["minLap"] != conf.minLap) {
        conf.minLap = source["minLap"];
        modified = true;
    }
    if (source["alarm"] != conf.alarm) {
        conf.alarm = source["alarm"];
        modified = true;
    }
    if (source["anType"] != conf.announcerType) {
        conf.announcerType = source["anType"];
        modified = true;
    }
    if (source["anRate"] != conf.announcerRate) {
        conf.announcerRate = source["anRate"];
        modified = true;
    }
    if (source["enterRssi"] != conf.enterRssi) {
        conf.enterRssi = source["enterRssi"];
        modified = true;
    }
    if (source["exitRssi"] != conf.exitRssi) {
        conf.exitRssi = source["exitRssi"];
        modified = true;
    }
    if (source["maxLaps"] != conf.maxLaps) {
        conf.maxLaps = source["maxLaps"];
        modified = true;
    }
    if (source.containsKey("ledMode") && source["ledMode"] != conf.ledMode) {
        conf.ledMode = source["ledMode"];
        modified = true;
    }
    if (source.containsKey("ledBrightness") && source["ledBrightness"] != conf.ledBrightness) {
        conf.ledBrightness = source["ledBrightness"];
        modified = true;
    }
    if (source.containsKey("ledColor") && source["ledColor"] != conf.ledColor) {
        conf.ledColor = source["ledColor"];
        modified = true;
    }
    if (source["name"] != conf.pilotName) {
        strlcpy(conf.pilotName, source["name"] | "", sizeof(conf.pilotName));
        modified = true;
    }
    if (source["ssid"] != conf.ssid) {
        strlcpy(conf.ssid, source["ssid"] | "", sizeof(conf.ssid));
        modified = true;
    }
    if (source["pwd"] != conf.password) {
        strlcpy(conf.password, source["pwd"] | "", sizeof(conf.password));
        modified = true;
    }
}

uint16_t Config::getFrequency() {
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

void Config::setDefaults(void) {
    DEBUG("Setting EEPROM defaults\n");
    // Reset everything to 0/false and then just set anything that zero is not appropriate
    memset(&conf, 0, sizeof(conf));
    conf.version = CONFIG_VERSION | CONFIG_MAGIC;
    conf.frequency = 5917;  // RaceBand Channel 8
    conf.minLap = 50;  // 5.0 seconds
    conf.alarm = 36;
    conf.announcerType = 2;
    conf.announcerRate = 10;
    conf.enterRssi = 120;
    conf.exitRssi = 100;
    conf.maxLaps = 0;
    conf.ledMode = 3;  // Rainbow wave by default
    conf.ledBrightness = 80;
    conf.ledColor = 0xFF00FF;  // Purple by default
    strlcpy(conf.ssid, "", sizeof(conf.ssid));
    strlcpy(conf.password, "", sizeof(conf.password));
    strlcpy(conf.pilotName, "", sizeof(conf.pilotName));
    modified = true;
    write();
}

void Config::handleEeprom(uint32_t currentTimeMs) {
    if (modified && ((currentTimeMs - checkTimeMs) > EEPROM_CHECK_TIME_MS)) {
        checkTimeMs = currentTimeMs;
        write();
    }
}
