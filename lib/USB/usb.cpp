#include "usb.h"
#include "debug.h"
#include "version.h"
#include "../SERIAL/serial_guard.h"

#ifdef ESP32S3
extern RgbLed* g_rgbLed;
#endif
namespace {
constexpr uint32_t USB_SERIAL_WRITE_TIMEOUT_MS = 30000;

bool writeSerialBytes(const uint8_t* data, size_t length) {
    size_t offset = 0;
    uint32_t stalledSinceMs = millis();

    while (offset < length) {
        size_t written = Serial.write(data + offset, length - offset);
        if (written > 0) {
            offset += written;
            stalledSinceMs = millis();
            continue;
        }

        if ((millis() - stalledSinceMs) > USB_SERIAL_WRITE_TIMEOUT_MS) {
            return false;
        }
        delay(1);
    }

    return true;
}
}  // namespace

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
    sessionActive = false;
    lastRssiSentMs = 0;
    cmdBufferPos = 0;
    memset(cmdBuffer, 0, CMD_BUFFER_SIZE);
    
    // USB Serial is automatically initialized by ESP32-S3
    // Just set a reasonable timeout for non-blocking reads
    Serial.setTimeout(10);
    
    DEBUG("USB Transport initialized\n");
}

void USBTransport::writeJsonLine(const JsonDocument& doc) {
    markUsbProtocolActivity();
    String payload;
    serializeJson(doc, payload);
    serialOutputLock();
    const uint8_t* payloadBytes = reinterpret_cast<const uint8_t*>(payload.c_str());
    uint8_t newlineByte = '\n';
    bool payloadComplete = writeSerialBytes(payloadBytes, payload.length());
    if (!payloadComplete) {
        serialOutputUnlock();
        return;
    }

    writeSerialBytes(&newlineByte, 1);
    serialOutputUnlock();
}

void USBTransport::sendLapEvent(uint32_t lapTimeMs) {
    if (!isConnected() || !sessionActive) return;
    
    JsonDocument doc;
    doc["event"] = "lap";
    doc["data"] = lapTimeMs;
    
    writeJsonLine(doc);
}

void USBTransport::sendRssiEvent(uint8_t rssi) {
    if (!isConnected() || !sessionActive || !rssiStreamingEnabled) return;
    
    JsonDocument doc;
    doc["event"] = "rssi";
    doc["data"] = rssi;
    
    writeJsonLine(doc);
}

void USBTransport::sendRaceStateEvent(const char* state) {
    if (!isConnected() || !sessionActive) return;
    
    JsonDocument doc;
    doc["event"] = "raceState";
    doc["data"] = state;
    
    writeJsonLine(doc);
}

void USBTransport::sendSlaveLapEvent(uint32_t lapTimeMs, const char* pilotName, const char* pilotPhonetic, uint32_t pilotColor, const char* slaveHostname) {
    if (!isConnected() || !sessionActive) return;
    
    JsonDocument doc;
    doc["event"] = "slaveLap";
    JsonObject data = doc["data"].to<JsonObject>();
    data["lapTimeMs"] = lapTimeMs;
    data["pilotName"] = pilotName;
    data["pilotPhonetic"] = pilotPhonetic;
    data["pilotColor"] = pilotColor;
    data["slaveHostname"] = slaveHostname;
    
    writeJsonLine(doc);
}

bool USBTransport::isConnected() {
    // Treat the CDC device presence itself as the connection signal.
    // availableForWrite() can legitimately hit 0 while the host is still
    // connected, which caused false disconnects and dropped commands.
    return Serial;
}

void USBTransport::resetSessionState() {
    sessionActive = false;
    rssiStreamingEnabled = false;
    lastRssiSentMs = 0;
}

void USBTransport::update(uint32_t currentTimeMs) {
    if (!isConnected()) {
        resetSessionState();
        while (Serial.available() > 0) {
            Serial.read();
        }
        return;
    }

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
    
    // Send periodic RSSI only for an active host session.
    if (sessionActive && rssiStreamingEnabled && (currentTimeMs - lastRssiSentMs) > RSSI_SEND_INTERVAL_MS) {
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
    markUsbProtocolActivity();

    if (strcmp(cmd, "session/open") == 0) {
        sessionActive = true;
        rssiStreamingEnabled = false;
        lastRssiSentMs = 0;
        sendSessionOpenResponse(id);
        return;
    }

    if (strcmp(cmd, "session/close") == 0) {
        resetSessionState();
        sendResponse(id, "OK");
        return;
    }

    if (strcmp(cmd, "version") == 0) {
        sendVersionResponse(id);
        return;
    }

    if (!sessionActive) {
        sendResponse(id, "ERROR", "USB session not open");
        return;
    }
    
    // Timer commands
    if (strcmp(cmd, "timer/start") == 0) {
        timer->start();
        sendRaceStateEvent("started");
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "timer/stop") == 0) {
        timer->stop();
        sendRaceStateEvent("stopped");
        sendResponse(id, "OK");
        
    } else if (strcmp(cmd, "timer/clearLaps") == 0) {
        sendRaceStateEvent("cleared");
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
            sendConfigUpdatedEvent();
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

        writeJsonLine(respDoc);
        
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

        writeJsonLine(respDoc);
        
    } else if (strcmp(cmd, "reboot") == 0) {
        sendResponse(id, "OK");
        delay(100);
        ESP.restart();
        
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

    writeJsonLine(doc);
}

void USBTransport::sendResponse(uint32_t id, const char* status, const char* message) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = status;
    doc["message"] = message;

    writeJsonLine(doc);
}

void USBTransport::sendSessionOpenResponse(uint32_t id) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = "OK";

    JsonObject data = doc["data"].to<JsonObject>();
    data["protocol"] = "usb-session-v1";
    data["sessionActive"] = 1;
    data["eventsRequireSession"] = 1;
    data["rssiStreamingEnabled"] = 0;

    writeJsonLine(doc);
}

void USBTransport::sendConfigResponse(uint32_t id) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = "OK";
    
    JsonObject data = doc["data"].to<JsonObject>();
    
    data["freq"] = conf->getFrequency();
    if (conf->getBandIndex() < 22 && conf->getChannelIndex() < 8) {
        data["bandIndex"] = conf->getBandIndex();
        data["channelIndex"] = conf->getChannelIndex();
    }
    data["minLap"] = (uint8_t)(conf->getMinLapMs() / 100);
    data["alarm"] = conf->getAlarmThreshold();
    data["anType"] = conf->getAnnouncerType();
    data["anRate"] = conf->getAnnouncerRate();
    data["enterRssi"] = conf->getEnterRssi();
    data["exitRssi"] = conf->getExitRssi();
    data["maxLaps"] = conf->getMaxLaps();
    data["ledMode"] = conf->getLedMode();
    data["ledBrightness"] = conf->getLedBrightness();
    data["ledColor"] = conf->getLedColor();
    data["ledPreset"] = conf->getLedPreset();
    data["ledSpeed"] = conf->getLedSpeed();
    data["ledFadeColor"] = conf->getLedFadeColor();
    data["ledStrobeColor"] = conf->getLedStrobeColor();
    data["ledManualOverride"] = conf->getLedManualOverride();
    data["opMode"] = conf->getOperationMode();
    data["tracksEnabled"] = conf->getTracksEnabled();
    data["selectedTrackId"] = conf->getSelectedTrackId();
    data["webhooksEnabled"] = conf->getWebhooksEnabled();
    data["webhookCount"] = conf->getWebhookCount();
    JsonArray webhooks = data["webhookIPs"].to<JsonArray>();
    for (uint8_t i = 0; i < conf->getWebhookCount(); i++) {
        webhooks.add(conf->getWebhookIP(i));
    }
    data["gateLEDsEnabled"] = conf->getGateLEDsEnabled();
    data["webhookRaceStart"] = conf->getWebhookRaceStart();
    data["webhookRaceStop"] = conf->getWebhookRaceStop();
    data["webhookLap"] = conf->getWebhookLap();
    data["name"] = conf->getPilotName();
    data["pilotCallsign"] = conf->getPilotCallsign();
    data["pilotPhonetic"] = conf->getPilotPhonetic();
    data["pilotColor"] = conf->getPilotColor();
    data["theme"] = conf->getTheme();
    data["selectedVoice"] = conf->getSelectedVoice();
    data["lapFormat"] = conf->getLapFormat();
    data["ssid"] = conf->getSsid();
    data["pwd"] = conf->getPassword();
    data["batteryType"] = conf->getBatteryType();
    data["batteryCells"] = conf->getBatteryCells();
    data["lowBatteryAlarmPerCell"] = conf->getLowBatteryAlarmPerCell();
    data["batteryAlarmEnabled"] = conf->getBatteryAlarmEnabled();
    data["batteryVoltageDivider"] = conf->getBatteryVoltageDivider();
    data["beepVolume"] = conf->getBeepVolume();
    data["timerNumber"] = conf->getTimerNumber();
    data["raceSyncMode"] = conf->getRaceSyncMode();
    data["syncedTimerCount"] = conf->getSyncedTimerCount();
    JsonArray syncTimers = data["syncedTimers"].to<JsonArray>();
    for (uint8_t i = 0; i < conf->getSyncedTimerCount(); i++) {
        syncTimers.add(conf->getSyncedTimer(i));
    }
    data["masterHostname"] = conf->getMasterHostname();
    data["autoThresholdEnabled"] = conf->getAutoThresholdEnabled();
    data["autoThresholdOffset"] = conf->getAutoThresholdOffset();
    data["receiverRadio"] = conf->getReceiverRadio();
    data["novaFilterKalman"] = conf->getNovaFilterKalman();
    data["novaFilterMedian"] = conf->getNovaFilterMedian();
    data["novaFilterMA"] = conf->getNovaFilterMA();
    data["novaFilterEMA"] = conf->getNovaFilterEMA();
    data["novaFilterStepLimiter"] = conf->getNovaFilterStepLimiter();
    data["novaKalmanQ"] = conf->getNovaKalmanQ();
    data["novaEmaAlpha"] = conf->getNovaEmaAlpha();
    data["novaStepMax"] = conf->getNovaStepMax();
    data["speakerEnabled"] = conf->getSpeakerEnabled();
#ifdef HAS_I2S_AUDIO
    data["hasI2SAudio"] = 1;
#else
    data["hasI2SAudio"] = 0;
#endif
    data["rhEnabled"] = conf->getRhEnabled();
    data["rhHostIP"] = conf->getRhHostIP();
    data["rhNodeIndex"] = conf->getRhNodeIndex();
    data["raceCountdownMode"] = conf->getRaceCountdownMode();
    data["maxHeatTime30s"] = conf->getMaxHeatTime30s();
    data["batteryVoltage"] = monitor ? ((float)monitor->getBatteryVoltage() / 10.0f) : 0.0f;
    
    writeJsonLine(doc);
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
    float voltage = monitor ? ((float)monitor->getBatteryVoltage() / 10) : 0.0f;
    data["batteryVoltage"] = voltage;
    
    writeJsonLine(doc);
}

void USBTransport::sendConfigUpdatedEvent() {
    if (!isConnected() || !sessionActive) return;

    JsonDocument doc;
    doc["event"] = "configUpdated";
    doc["data"] = "updated";

    writeJsonLine(doc);
}

void USBTransport::sendVersionResponse(uint32_t id) {
    JsonDocument doc;
    doc["id"] = id;
    doc["status"] = "OK";

    JsonObject data = doc["data"].to<JsonObject>();
    data["version"] = FPVGATE_VERSION_STRING();
    data["protocol"] = "usb-session-v1";
    data["sessionRequired"] = 1;

    writeJsonLine(doc);
}
