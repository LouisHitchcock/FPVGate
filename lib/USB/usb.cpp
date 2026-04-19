#include "usb.h"
#include "debug.h"

#ifdef ESP32S3
extern RgbLed* g_rgbLed;
#endif

void USBTransport::init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, 
                        Buzzer *buzzer, Led *l, RaceHistory *raceHist, Storage *stor, 
                        SelfTest *test, RX5808 *rx5808, TrackManager *trackMgr) {
    conf = config;
    timer = lapTimer;
    monitor = batMonitor;
    buz = buzzer;
    led = l;
    history = raceHist;
    storage = stor;
    selftest = test;
    rx = rx5808;
    trackManager = trackMgr;
    
    rssiStreamingEnabled = false;
    lastRssiSentMs = 0;
    cmdBufferPos = 0;
    memset(cmdBuffer, 0, CMD_BUFFER_SIZE);
    
    // USB Serial is automatically initialized by ESP32-S3
    // Just set a reasonable timeout for non-blocking reads
    Serial.setTimeout(10);
    
    DEBUG("USB Transport initialized\n");
}

void USBTransport::sendLapEvent(uint32_t lapTimeMs) {
    if (!isConnected()) return;
    
    JsonDocument doc;
    doc["event"] = "lap";
    doc["data"] = lapTimeMs;
    
    serializeJson(doc, Serial);
    Serial.println();
}

void USBTransport::sendRssiEvent(uint8_t rssi) {
    if (!isConnected() || !rssiStreamingEnabled) return;
    
    JsonDocument doc;
    doc["event"] = "rssi";
    doc["data"] = rssi;
    
    serializeJson(doc, Serial);
    Serial.println();
}

void USBTransport::sendRaceStateEvent(const char* state) {
    if (!isConnected()) return;
    
    JsonDocument doc;
    doc["event"] = "raceState";
    doc["data"] = state;
    
    serializeJson(doc, Serial);
    Serial.println();
}

void USBTransport::sendSlaveLapEvent(uint32_t lapTimeMs, const char* pilotName, const char* pilotPhonetic, uint32_t pilotColor, const char* slaveHostname) {
    if (!isConnected()) return;
    
    JsonDocument doc;
    doc["event"] = "slaveLap";
    JsonObject data = doc["data"].to<JsonObject>();
    data["lapTimeMs"] = lapTimeMs;
    data["pilotName"] = pilotName;
    data["pilotPhonetic"] = pilotPhonetic;
    data["pilotColor"] = pilotColor;
    data["slaveHostname"] = slaveHostname;
    
    serializeJson(doc, Serial);
    Serial.println();
}

bool USBTransport::isConnected() {
    // Check if USB CDC is connected
    return Serial && Serial.availableForWrite() > 0;
}

void USBTransport::update(uint32_t currentTimeMs) {
    // Process incoming commands
    while (Serial.available() > 0) {
        char c = Serial.read();
        
        if (c == '\n' || c == '\r') {
            if (cmdBufferPos > 0) {
                cmdBuffer[cmdBufferPos] = '\0';
                processCommand(cmdBuffer);
                cmdBufferPos = 0;
            }
        } else if (cmdBufferPos < CMD_BUFFER_SIZE - 1) {
            cmdBuffer[cmdBufferPos++] = c;
        } else {
            // Buffer overflow, reset
            cmdBufferPos = 0;
        }
    }
    
    // Send periodic RSSI if streaming enabled
    if (rssiStreamingEnabled && (currentTimeMs - lastRssiSentMs) > RSSI_SEND_INTERVAL_MS) {
        sendRssiEvent(timer->getRssi());
        lastRssiSentMs = currentTimeMs;
    }
}

void USBTransport::enableRssiStreaming(bool enable) {
    rssiStreamingEnabled = enable;
}

void USBTransport::processCommand(const char* cmdLine) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, cmdLine);
    
    if (error) {
        DEBUG("USB: JSON parse error: %s\n", error.c_str());
        return;
    }
    
    if (!!doc["cmd"].isNull()) {
        DEBUG("USB: Missing 'cmd' field\n");
        return;
    }
    
    const char* cmd = doc["cmd"];
    uint32_t id = doc["id"] | 0;
    
    // Timer commands
    if (strcmp(cmd, "timer/start") == 0) {
        timer->start();
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "timer/stop") == 0) {
        timer->stop();
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "timer/lap") == 0) {
#ifdef ESP32S3
        if (g_rgbLed) g_rgbLed->flashLap();
#endif
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "timer/addLap") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("lapTime")) {
            uint32_t lapTimeMs = doc["data"]["lapTime"];
            sendLapEvent(lapTimeMs);
#ifdef ESP32S3
            if (g_rgbLed) g_rgbLed->flashLap();
#endif
            sendResponse(id, "OK");
        } else {
            sendResponse(id, "ERROR", "Missing lapTime");
        }
        
    } else if (strcmp(cmd, "rssi/start") == 0) {
        enableRssiStreaming(true);
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "rssi/stop") == 0) {
        enableRssiStreaming(false);
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "config/get") == 0) {
        sendConfigResponse(id);
        
    } else if (strcmp(cmd, "config/set") == 0) {
        if (!doc["data"].isNull()) {
            JsonObject data = doc["data"];
            conf->fromJson(data);
            sendResponse(id, "OK");
        } else {
            sendResponse(id, "ERROR", "Missing data");
        }
        
    } else if (strcmp(cmd, "status") == 0) {
        sendStatusResponse(id);
        
    } else if (strcmp(cmd, "races/get") == 0) {
        JsonDocument respDoc;
        respDoc["id"] = id;
        respDoc["status"] = "OK";
        
        String racesJson = history->toJsonString();
        JsonDocument racesDoc;
        deserializeJson(racesDoc, racesJson);
        respDoc["data"] = racesDoc;
        
        serializeJson(respDoc, Serial);
        Serial.println();
        
    } else if (strcmp(cmd, "races/save") == 0) {
        if (!doc["data"].isNull()) {
            JsonObject data = doc["data"];
            RaceSession race;
            race.timestamp = data["timestamp"];
            race.fastestLap = data["fastestLap"];
            race.medianLap = data["medianLap"];
            race.best3LapsTotal = data["best3LapsTotal"];
            race.pilotName = data["pilotName"] | "";
            race.pilotCallsign = data["pilotCallsign"] | "";
            race.frequency = data["frequency"] | 0;
            race.band = data["band"] | "";
            race.channel = data["channel"] | 0;
            
            JsonArray lapsArray = data["lapTimes"];
            for (uint32_t lap : lapsArray) {
                race.lapTimes.push_back(lap);
            }
            
            bool success = history->saveRace(race);
            sendResponse(id, success ? "OK" : "ERROR");
        } else {
            sendResponse(id, "ERROR", "Missing data");
        }
        
    } else if (strcmp(cmd, "races/clear") == 0) {
        bool success = history->clearAll();
        sendResponse(id, success ? "OK" : "ERROR");
        
    } else if (strcmp(cmd, "selftest") == 0) {
        selftest->runAllTests();
        
        JsonDocument respDoc;
        respDoc["id"] = id;
        respDoc["status"] = "OK";
        
        String testJson = selftest->getResultsJSON();
        JsonDocument testDoc;
        deserializeJson(testDoc, testJson);
        respDoc["data"] = testDoc;
        
        serializeJson(respDoc, Serial);
        Serial.println();
        
    // LED commands
    } else if (strcmp(cmd, "led/preset") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("preset")) {
            uint8_t presetNum = doc["data"]["preset"];
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->setPreset((led_preset_e)presetNum);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing preset");
        }
        
    } else if (strcmp(cmd, "led/color") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("color")) {
            const char* colorHex = doc["data"]["color"];
            uint32_t color = (uint32_t)strtoul(colorHex, NULL, 16);
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->setManualColor(color);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing color");
        }
        
    } else if (strcmp(cmd, "led/brightness") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("brightness")) {
            uint8_t brightness = doc["data"]["brightness"];
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->setBrightness(brightness);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing brightness");
        }
        
    } else if (strcmp(cmd, "led/speed") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("speed")) {
            uint8_t speed = doc["data"]["speed"];
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->setEffectSpeed(speed);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing speed");
        }
        
    } else if (strcmp(cmd, "led/override") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("enable")) {
            bool enable = doc["data"]["enable"];
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->enableManualOverride(enable);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing enable");
        }
        
    } else if (strcmp(cmd, "led/fadecolor") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("color")) {
            const char* colorHex = doc["data"]["color"];
            uint32_t color = (uint32_t)strtoul(colorHex, NULL, 16);
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->setFadeColor(color);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing color");
        }
        
    } else if (strcmp(cmd, "led/strobecolor") == 0) {
        if (!doc["data"].isNull() && doc["data"].containsKey("color")) {
            const char* colorHex = doc["data"]["color"];
            uint32_t color = (uint32_t)strtoul(colorHex, NULL, 16);
#ifdef ESP32S3
            if (g_rgbLed) {
                g_rgbLed->setStrobeColor(color);
                sendResponse(id, "OK");
            } else {
                sendResponse(id, "ERROR", "RGB LED not available");
            }
#else
            sendResponse(id, "ERROR", "RGB LED not supported on this hardware");
#endif
        } else {
            sendResponse(id, "ERROR", "Missing color");
        }
        
    } else {
        sendResponse(id, "ERROR", "Unknown command");
    }
}

void USBTransport::sendResponse(uint32_t id, const char* status) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = status;
    
    serializeJson(doc, Serial);
    Serial.println();
}

void USBTransport::sendResponse(uint32_t id, const char* status, const char* message) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = status;
    doc["message"] = message;
    
    serializeJson(doc, Serial);
    Serial.println();
}

void USBTransport::sendConfigResponse(uint32_t id) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = "OK";
    
    JsonObject data = doc["data"].to<JsonObject>();
    
    // Build config JSON manually (Config::toJson uses AsyncResponseStream)
    data["freq"] = conf->getFrequency();
    data["minLap"] = (uint8_t)(conf->getMinLapMs() / 100);
    data["alarm"] = conf->getAlarmThreshold();
    data["enterRssi"] = conf->getEnterRssi();
    data["exitRssi"] = conf->getExitRssi();
    data["maxLaps"] = conf->getMaxLaps();
    data["ledMode"] = conf->getLedMode();
    data["ledBrightness"] = conf->getLedBrightness();
    data["ledColor"] = conf->getLedColor();
    data["opMode"] = conf->getOperationMode();
    data["ssid"] = conf->getSsid();
    data["pwd"] = conf->getPassword();
    
    serializeJson(doc, Serial);
    Serial.println();
}

void USBTransport::sendStatusResponse(uint32_t id) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = "OK";
    
    JsonObject data = doc["data"].to<JsonObject>();
    
    // Heap info
    JsonObject heap = data["heap"].to<JsonObject>();
    heap["free"] = ESP.getFreeHeap();
    heap["min"] = ESP.getMinFreeHeap();
    heap["size"] = ESP.getHeapSize();
    heap["maxAlloc"] = ESP.getMaxAllocHeap();
    
    // Storage info
    JsonObject stor = data["storage"].to<JsonObject>();
    stor["type"] = storage->getStorageType();
    stor["used"] = storage->getUsedBytes();
    stor["total"] = storage->getTotalBytes();
    stor["free"] = storage->getFreeBytes();
    
    // Chip info
    JsonObject chip = data["chip"].to<JsonObject>();
    chip["model"] = ESP.getChipModel();
    chip["revision"] = ESP.getChipRevision();
    chip["cores"] = ESP.getChipCores();
    chip["sdk"] = ESP.getSdkVersion();
    chip["flashSize"] = ESP.getFlashChipSize();
    chip["flashSpeed"] = ESP.getFlashChipSpeed() / 1000000;
    chip["cpuSpeed"] = getCpuFrequencyMhz();
    
    // Network info
    JsonObject network = data["network"].to<JsonObject>();
    network["ip"] = WiFi.localIP().toString();
    network["mac"] = WiFi.macAddress();
    
    // Battery
    float voltage = (float)monitor->getBatteryVoltage() / 10;
    data["batteryVoltage"] = voltage;
    
    serializeJson(doc, Serial);
    Serial.println();
}
