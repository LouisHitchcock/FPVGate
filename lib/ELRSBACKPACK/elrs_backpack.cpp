#include "elrs_backpack.h"
#include "config.h"
#include "laptimer.h"
#include "c5racecontrol.h"
#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <MD5Builder.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>
#include <string.h>

ElrsBackpack elrsBackpack;

namespace {
// Written only by the ESP-NOW receive callback, which runs in the Wi-Fi task:
// no allocation, logging or race work belongs there.
uint8_t boundUid[6] = {};
std::atomic<uint32_t> rxSeq{0}, rxFrames{0}, rxForeign{0}, rxOther{0};
std::atomic<int8_t> rxState{-1};

void received(const uint8_t* mac, const uint8_t* data, int length) {
    ++rxFrames;
    // Only the transmitter's own backpack sends from the binding UID.
    if (!mac || memcmp(mac, boundUid, 6) != 0) { ++rxForeign; return; }
    const int state = ElrsBackpackCore::recordingState(data, length > 0 ? size_t(length) : 0);
    if (state < 0) { ++rxOther; return; }
    rxState.store(int8_t(state));
    ++rxSeq;
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onReceive(const esp_now_recv_info_t* info, const uint8_t* data, int length) {
    received(info ? info->src_addr : nullptr, data, length);
}
#else
void onReceive(const uint8_t* mac, const uint8_t* data, int length) {
    received(mac, data, length);
}
#endif

bool flag(AsyncWebServerRequest* req, const char* key, uint8_t& value) {
    if (!req->hasParam(key, true)) return true;
    const String input = req->getParam(key, true)->value();
    if (input != "0" && input != "1") return false;
    value = input == "1";
    return true;
}
}

void ElrsBackpack::begin(Config* config, LapTimer* timer, C5RaceControl* race) {
    config_ = config;
    timer_ = timer;
    race_ = race;
    Preferences prefs;
    if (prefs.begin("elrsbp", true)) {
        Settings stored;
        if (prefs.getBytesLength("settings") == sizeof(stored) &&
            prefs.getBytes("settings", &stored, sizeof(stored)) == sizeof(stored) &&
            stored.version == 1 && stored.enabled <= 1 && stored.raceControl <= 1 &&
            stored.invert <= 1 && stored.hasUid <= 1) settings_ = stored;
        prefs.end();
    }
    memcpy(boundUid, settings_.uid, 6);
}

bool ElrsBackpack::racing() {
    if (timer_ && timer_->isRaceRunning()) return true;
    if (!race_) return false;
    const C5RaceControl::Status status = race_->status();
    return status.running || status.busy;
}

void ElrsBackpack::afterModeSet() {
    macOk_ = enabled() && esp_wifi_set_mac(WIFI_IF_STA, settings_.uid) == ESP_OK;
    // As the ExpressLRS backpacks set theirs. Station only: the hotspot
    // keeps the standard protocols for phones and laptops.
    if (macOk_) esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G |
                                                   WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR);
}

void ElrsBackpack::afterApStarted() {
    stop();
    uint8_t channel = 0;
    wifi_second_chan_t secondary;
    esp_wifi_get_channel(&channel, &secondary);
    // The transmitter's backpack sends on channel 1, to the binding UID.
    if (!enabled() || !macOk_ || channel != 1 || !(WiFi.getMode() & WIFI_AP)) return;
    if (esp_now_init() != ESP_OK) return;
    if (esp_now_register_recv_cb(onReceive) == ESP_OK) ready_ = true;
    else esp_now_deinit();
}

void ElrsBackpack::stop() {
    if (ready_) {
        esp_now_unregister_recv_cb();
        esp_now_deinit();
    }
    ready_ = false;
}

void ElrsBackpack::service(uint32_t now) {
    // Saving settings restarts the gate, but never in the middle of a race.
    const uint32_t reboot = rebootAt_.load();
    if (reboot && int32_t(now - reboot) >= 0 && !racing()) ESP.restart();
    if (!ready_ || !settings_.raceControl || !race_ || !config_) return;
    const uint32_t seq = rxSeq.load();
    if (seq != seenSeq_) {
        seenSeq_ = seq;
        switch_.received(rxState.load() == 1, now);
    }
    using ElrsBackpackCore::Command;
    // A queued start either runs or fails in the race's own update.
    if (startPending_) {
        const C5RaceControl::Status status = race_->status();
        if (!status.busy) {
            startPending_ = false;
            const bool error = status.error && status.error[0];
            result("start", status.running ? "started" : error ? status.error : "startFailed");
        }
    }
    const Command command = switch_.poll(now, settings_.invert);
    if (command == Command::None) return;
    // Read only when a command is due: it copies the whole roster.
    const C5RaceControl::Status status = race_->status();
    ElrsBackpackCore::RaceState state;
    state.c5 = config_->getReceiverRadio() == 2;
    state.running = status.running;
    state.busy = status.busy;
    state.saveFailed = status.saveFailed;
    const char* reason;
    const Command action = ElrsBackpackCore::decide(command, state, &reason);
    const char* name = command == Command::Start ? "start" : "stop";
    if (action == Command::Start) {
        startPending_ = race_->requestStartAfterCountdown();
        result(name, startPending_ ? "starting" : "notReady");
    } else if (action == Command::Stop) {
        race_->requestStop();
        result(name, "stopping");
    } else {
        result(name, reason);
    }
}

void ElrsBackpack::result(const char* command, const char* outcome) {
    portENTER_CRITICAL(&mux_);
    lastCommand_ = command;
    lastResult_ = outcome;
    lastCommandAt_ = millis();
    portEXIT_CRITICAL(&mux_);
}

void ElrsBackpack::registerRoutes(AsyncWebServer& server) {
    server.on("/api/elrs", HTTP_GET, [this](AsyncWebServerRequest* req) {
        JsonDocument doc;
        doc["enabled"] = bool(settings_.enabled);
        doc["raceControl"] = bool(settings_.raceControl);
        doc["invert"] = bool(settings_.invert);
        doc["configured"] = bool(settings_.hasUid);
        doc["active"] = ready_;
        doc["apMode"] = (WiFi.getMode() & WIFI_AP) != 0;
        doc["frames"] = rxFrames.load();
        doc["foreign"] = rxForeign.load();
        doc["other"] = rxOther.load();
        doc["switchMessages"] = rxSeq.load();
        doc["switchState"] = rxState.load();
        portENTER_CRITICAL(&mux_);
        doc["lastCommand"] = lastCommand_;
        doc["lastResult"] = lastResult_;
        doc["lastCommandAgoMs"] = lastCommandAt_ ? millis() - lastCommandAt_ : 0;
        portEXIT_CRITICAL(&mux_);
        doc["restartPending"] = rebootAt_.load() != 0;
        String out;
        serializeJson(doc, out);
        AsyncWebServerResponse* response = req->beginResponse(200, "application/json", out);
        response->addHeader("Cache-Control", "no-store");
        req->send(response);
    });
    server.on("/api/elrs", HTTP_POST, [this](AsyncWebServerRequest* req) {
        if (racing() || rebootAt_.load()) {
            req->send(409, "application/json", "{\"error\":\"Stop the race or wait for the pending restart\"}");
            return;
        }
        Settings candidate = settings_;
        bool valid = flag(req, "enabled", candidate.enabled) &&
                     flag(req, "raceControl", candidate.raceControl) &&
                     flag(req, "invert", candidate.invert);
        if (valid && req->hasParam("phrase", true)) {
            // ELRS derives the UID from the build flag text, not the bare phrase.
            const String phrase = req->getParam("phrase", true)->value();
            valid = phrase.length() > 0 && phrase.length() <= 63;
            if (valid) {
                MD5Builder md5;
                md5.begin();
                md5.add("-DMY_BINDING_PHRASE=\"" + phrase + "\"");
                md5.calculate();
                uint8_t digest[16];
                md5.getBytes(digest);
                memcpy(candidate.uid, digest, 6);
                candidate.uid[0] &= ~1;  // a station MAC cannot be multicast
                candidate.hasUid = 1;
            }
        }
        if (valid && req->hasParam("forget", true) && req->getParam("forget", true)->value() == "1") {
            memset(candidate.uid, 0, 6);
            candidate.hasUid = 0;
        }
        if (!valid || (candidate.enabled && !candidate.hasUid)) {
            req->send(400, "application/json", "{\"error\":\"Invalid settings or missing binding phrase\"}");
            return;
        }
        // Only the derived UID is stored, never the phrase. Settings apply
        // after a restart, so the MAC and channel never change under a race.
        Preferences prefs;
        bool saved = prefs.begin("elrsbp", false);
        if (saved) {
            saved = prefs.putBytes("settings", &candidate, sizeof(candidate)) == sizeof(candidate);
            prefs.end();
        }
        if (saved) rebootAt_.store(millis() + 2000);
        req->send(saved ? 200 : 500, "application/json",
                  saved ? "{\"ok\":true,\"restart\":true}" : "{\"error\":\"Cannot save settings\"}");
    });
}
