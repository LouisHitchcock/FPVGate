#include "elrs_osd.h"

#include <ArduinoJson.h>
#include <ESPAsyncWebServer.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_idf_version.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <MD5Builder.h>

#include "debug.h"

ElrsOsd elrsOsd;

// ---------------------------------------------------------------------------
// Texts shown on the goggles. HDZero's OSD font draws symbols for a-z, so use
// UPPER CASE only (lower case is converted anyway).
// ---------------------------------------------------------------------------
#define OSD_TXT_LAP        "LAP"       // "LAP 5  23.45"
#define OSD_TXT_GATE1      "GATE 1"    // first pass (holeshot), not a lap
#define OSD_TXT_BEST3      "BEST 3"    // "BEST 3  72.34"
#define OSD_TXT_NONE       "--"
// Compact (column) layout, max ~6 characters per line
#define OSD_TXT_C_LAP      "LAST"
#define OSD_TXT_C_GATE1    "GATE1"
#define OSD_TXT_C_BEST3    "BEST3"
// Idle screen (no race running)
#define OSD_TXT_READY      "FPVGATE READY"
#define OSD_TXT_NO_RX      "FPVGATE NO C5 LINK"
#define OSD_TXT_NO_PILOT   "FPVGATE NO PILOT"
#define OSD_TXT_C_READY    "READY"
#define OSD_TXT_C_NO_RX    "C5 OFF"
#define OSD_TXT_C_NO_PILOT "NO PLT"

static constexpr uint16_t MSP_ELRS_SET_OSD = 0x00B6;
static constexpr uint8_t OSD_SUB_CLEAR = 0x02;
static constexpr uint8_t OSD_SUB_WRITE = 0x03;
static constexpr uint8_t OSD_SUB_DISPLAY = 0x04;
static constexpr uint8_t OSD_ROWS = 18;   // HDZero OSD grid
static constexpr uint8_t OSD_COLS = 50;

static volatile uint32_t s_ackOk = 0;
static volatile uint32_t s_ackFail = 0;
static volatile uint32_t s_rebootAtMs = 0;

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
static void onSent(const esp_now_send_info_t*, esp_now_send_status_t status) {
#else
static void onSent(const uint8_t*, esp_now_send_status_t status) {
#endif
    if (status == ESP_NOW_SEND_SUCCESS) s_ackOk++;
    else s_ackFail++;
}

static uint8_t crc8DvbS2(uint8_t crc, uint8_t a) {
    crc ^= a;
    for (int i = 0; i < 8; i++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0xD5) : (uint8_t)(crc << 1);
    return crc;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
void ElrsOsd::begin() {
    Preferences p;
    p.begin("elrsosd", true);
    enabled_ = p.getBool("en", false);
    String ph = p.getString("phrase", "");
    strlcpy(phrase_, ph.c_str(), sizeof(phrase_));
    row_ = p.getUChar("row", 3);
    col_ = p.getUChar("col", 1);
    layout_ = p.getUChar("layout", LAYOUT_ROWS);
    clearOnStop_ = p.getBool("clrstop", false);
    idle_ = p.getBool("idle", true);
    p.end();
    if (row_ >= OSD_ROWS) row_ = 3;
    if (col_ >= OSD_COLS) col_ = 1;
    computeUid();
    DEBUG("ELRS OSD: enabled=%d phrase=%s uid=%02X:%02X:%02X:%02X:%02X:%02X\n", enabled_, phrase_[0] ? "(set)" : "(empty)",
          uid_[0], uid_[1], uid_[2], uid_[3], uid_[4], uid_[5]);
}

void ElrsOsd::save() {
    Preferences p;
    p.begin("elrsosd", false);
    p.putBool("en", enabled_);
    p.putString("phrase", phrase_);
    p.putUChar("row", row_);
    p.putUChar("col", col_);
    p.putUChar("layout", layout_);
    p.putBool("clrstop", clearOnStop_);
    p.putBool("idle", idle_);
    p.end();
}

// Same UID as ExpressLRS: first 6 bytes of MD5("-DMY_BINDING_PHRASE=\"<phrase>\""),
// with the multicast bit cleared.
void ElrsOsd::computeUid() {
    memset(uid_, 0, sizeof(uid_));
    uidValid_ = false;
    if (!phrase_[0]) return;
    char buf[96];
    int n = snprintf(buf, sizeof(buf), "-DMY_BINDING_PHRASE=\"%s\"", phrase_);
    if (n <= 0 || n >= (int)sizeof(buf)) return;
    // MD5Builder (Arduino core) works on both core 2.x and 3.x; the mbedtls
    // md5 API was renamed between mbedtls versions.
    uint8_t md[16];
    MD5Builder md5;
    md5.begin();
    md5.add((uint8_t*)buf, (uint16_t)n);
    md5.calculate();
    md5.getBytes(md);
    memcpy(uid_, md, 6);
    uid_[0] &= ~0x01;
    uidValid_ = true;
}

// ---------------------------------------------------------------------------
// Wi-Fi / ESP-NOW
// ---------------------------------------------------------------------------
int ElrsOsd::wifiModeForAp() const {
    return enabled() ? WIFI_AP_STA : WIFI_AP;
}

void ElrsOsd::afterModeSet() {
    if (!enabled()) return;
    // The goggle backpack only accepts packets whose source MAC is the bind UID.
    // STA is otherwise unused (never connects), so it carries the UID; the AP
    // keeps its own MAC.
    esp_err_t e = esp_wifi_set_mac(WIFI_IF_STA, uid_);
    if (e != ESP_OK) DEBUG("ELRS OSD: esp_wifi_set_mac(STA) err=%d\n", (int)e);
    // Same PHY set as the ExpressLRS backpacks (LR included).
    e = esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR);
    if (e != ESP_OK) DEBUG("ELRS OSD: esp_wifi_set_protocol(STA) err=%d\n", (int)e);
}

void ElrsOsd::afterApStarted() {
    if (!enabled()) return;
    stopEspNow();
    esp_wifi_set_ps(WIFI_PS_NONE);
    if (esp_now_init() != ESP_OK) {
        DEBUG("ELRS OSD: esp_now_init failed\n");
        return;
    }
    esp_now_register_send_cb(onSent);
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, uid_, 6);
    peer.channel = 0;            // current channel (AP is on 1)
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    esp_err_t e = esp_now_add_peer(&peer);
    if (e != ESP_OK && e != ESP_ERR_ESPNOW_EXIST) {
        DEBUG("ELRS OSD: esp_now_add_peer err=%d\n", (int)e);
        esp_now_deinit();
        return;
    }
    espnowReady_ = true;
    uint8_t ch = 0;
    wifi_second_chan_t sc;
    esp_wifi_get_channel(&ch, &sc);
    uint8_t mac[6] = {0};
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    DEBUG("ELRS OSD: ESP-NOW up, channel %u, STA MAC %02X:%02X:%02X:%02X:%02X:%02X (must equal UID)\n", ch, mac[0],
          mac[1], mac[2], mac[3], mac[4], mac[5]);
    linkTestLeft_ = 6;
    linkTestAtMs_ = millis() + 1500;
}

void ElrsOsd::stopEspNow() {
    if (!espnowReady_) return;
    esp_now_unregister_send_cb();
    esp_now_deinit();
    espnowReady_ = false;
}

void ElrsOsd::sendMsp(uint16_t function, const uint8_t* payload, uint16_t len) {
    if (!espnowReady_ || len > 64) return;
    uint8_t out[9 + 64];
    out[0] = '$';
    out[1] = 'X';
    out[2] = '<';
    out[3] = 0;                         // flags
    out[4] = function & 0xFF;
    out[5] = function >> 8;
    out[6] = len & 0xFF;
    out[7] = len >> 8;
    memcpy(out + 8, payload, len);
    uint8_t crc = 0;
    for (uint16_t i = 3; i < 8 + len; i++) crc = crc8DvbS2(crc, out[i]);
    out[8 + len] = crc;
    esp_err_t e = esp_now_send(uid_, out, 9 + len);
    if (e != ESP_OK) DEBUG("ELRS OSD: esp_now_send err=%d\n", (int)e);
}

void ElrsOsd::sendOsdSub(uint8_t sub) {
    sendMsp(MSP_ELRS_SET_OSD, &sub, 1);
}

void ElrsOsd::sendOsdText(uint8_t row, uint8_t col, const char* text) {
    if (row >= OSD_ROWS || col >= OSD_COLS) return;
    uint8_t pl[4 + OSD_COLS];
    pl[0] = OSD_SUB_WRITE;
    pl[1] = row;
    pl[2] = col;
    pl[3] = 0;
    size_t n = 0;
    for (; text[n] && n < (size_t)(OSD_COLS - col); n++) {
        char c = text[n];
        if (c >= 'a' && c <= 'z') c -= 'a' - 'A';
        pl[4 + n] = (uint8_t)c;
    }
    sendMsp(MSP_ELRS_SET_OSD, pl, 4 + n);
}

// ---------------------------------------------------------------------------
// Race logic
// ---------------------------------------------------------------------------
void ElrsOsd::setStatus(bool rxOnline, bool pilotOk, uint16_t rssi, uint16_t enter, bool raceRunning) {
    if (raceRunning && !seenRunning_) startPending_ = true;
    if (!raceRunning && seenRunning_) stopPending_ = true;
    seenRunning_ = raceRunning;
    rxOnline_ = rxOnline;
    pilotOk_ = pilotOk;
    enter_ = enter;
    lastRssi_ = rssi;
    if (rssi > rssiPeak_) rssiPeak_ = rssi;
}

void ElrsOsd::onLap(uint32_t lapTimeMs) {
    portENTER_CRITICAL(&mux_);
    uint8_t next = (lapHead_ + 1) % LAP_Q;
    if (next != lapTail_) {
        lapQ_[lapHead_] = lapTimeMs;
        lapHead_ = next;
    }
    portEXIT_CRITICAL(&mux_);
}

void ElrsOsd::resetRace() {
    gate1Pending_ = true;
    laps_.clear();
    lastLapMs_ = 0;
    gate1Ms_ = 0;
    best3Ms_ = 0;
}

// Fastest sum of 3 consecutive laps, Gate 1 excluded (same rule as the web UI).
void ElrsOsd::recomputeBest3() {
    best3Ms_ = 0;
    for (size_t i = 0; i + 2 < laps_.size(); i++) {
        uint32_t s = laps_[i] + laps_[i + 1] + laps_[i + 2];
        if (best3Ms_ == 0 || s < best3Ms_) best3Ms_ = s;
    }
}

// Seconds with hundredths, like the FPVGate web UI: "23.45", "72.34"
void ElrsOsd::fmtSeconds(uint32_t ms, char* out, size_t cap) {
    snprintf(out, cap, "%lu.%02lu", (unsigned long)(ms / 1000), (unsigned long)((ms % 1000) / 10));
}

void ElrsOsd::render() {
    char t1[12], t2[12], line[32];
    if (lastLapMs_) fmtSeconds(lastLapMs_, t1, sizeof(t1));
    else if (gate1Ms_) fmtSeconds(gate1Ms_, t1, sizeof(t1));
    else strlcpy(t1, OSD_TXT_NONE, sizeof(t1));
    if (best3Ms_) fmtSeconds(best3Ms_, t2, sizeof(t2));
    else strlcpy(t2, OSD_TXT_NONE, sizeof(t2));
    const bool showingGate1 = !lastLapMs_ && gate1Ms_;

    sendOsdSub(OSD_SUB_CLEAR);
    if (layout_ == LAYOUT_COLUMN) {
        // 4 short lines, fits the black side bar when flying 4:3 on a 16:9 screen
        sendOsdText(row_, col_, showingGate1 ? OSD_TXT_C_GATE1 : OSD_TXT_C_LAP);
        sendOsdText(row_ + 1, col_, t1);
        sendOsdText(row_ + 2, col_, OSD_TXT_C_BEST3);
        sendOsdText(row_ + 3, col_, t2);
    } else {
        if (showingGate1) snprintf(line, sizeof(line), OSD_TXT_GATE1 " %s", t1);
        else if (lastLapMs_) snprintf(line, sizeof(line), OSD_TXT_LAP " %u  %s", (unsigned)laps_.size(), t1);
        else snprintf(line, sizeof(line), OSD_TXT_LAP " %s", t1);
        sendOsdText(row_, col_, line);
        snprintf(line, sizeof(line), OSD_TXT_BEST3 "  %s", t2);
        sendOsdText(row_ + 1, col_, line);
    }
    sendOsdSub(OSD_SUB_DISPLAY);
}

// Before/after a race: is the receiver alive, and what RSSI does it see?
// "*" after the numbers = at or above the enter threshold (would count a pass).
void ElrsOsd::renderIdle() {
    char line[32];
    const uint16_t rssi = rssiPeak_;
    rssiPeak_ = 0;
    const bool above = enter_ && rssi >= enter_;
    const bool results = hasResults() && !clearOnStop_;

    sendOsdSub(OSD_SUB_CLEAR);
    if (layout_ == LAYOUT_COLUMN) {
        sendOsdText(row_, col_, !rxOnline_ ? OSD_TXT_C_NO_RX : !pilotOk_ ? OSD_TXT_C_NO_PILOT : OSD_TXT_C_READY);
        snprintf(line, sizeof(line), "R%u%s", (unsigned)rssi, above ? "*" : "");
        sendOsdText(row_ + 1, col_, (rxOnline_ && pilotOk_) ? line : OSD_TXT_NONE);
        if (results) {
            char t[12];
            if (lastLapMs_) fmtSeconds(lastLapMs_, t, sizeof(t)); else strlcpy(t, OSD_TXT_NONE, sizeof(t));
            sendOsdText(row_ + 3, col_, OSD_TXT_C_LAP);
            sendOsdText(row_ + 4, col_, t);
            if (best3Ms_) fmtSeconds(best3Ms_, t, sizeof(t)); else strlcpy(t, OSD_TXT_NONE, sizeof(t));
            sendOsdText(row_ + 5, col_, OSD_TXT_C_BEST3);
            sendOsdText(row_ + 6, col_, t);
        }
    } else {
        sendOsdText(row_, col_, !rxOnline_ ? OSD_TXT_NO_RX : !pilotOk_ ? OSD_TXT_NO_PILOT : OSD_TXT_READY);
        if (rxOnline_ && pilotOk_) {
            snprintf(line, sizeof(line), "RSSI %u/%u%s", (unsigned)rssi, (unsigned)enter_, above ? " *" : "");
            sendOsdText(row_ + 1, col_, line);
        }
        if (results) {
            char t[12];
            if (lastLapMs_) fmtSeconds(lastLapMs_, t, sizeof(t)); else strlcpy(t, OSD_TXT_NONE, sizeof(t));
            snprintf(line, sizeof(line), OSD_TXT_LAP " %u  %s", (unsigned)laps_.size(), t);
            sendOsdText(row_ + 3, col_, line);
            if (best3Ms_) fmtSeconds(best3Ms_, t, sizeof(t)); else strlcpy(t, OSD_TXT_NONE, sizeof(t));
            snprintf(line, sizeof(line), OSD_TXT_BEST3 "  %s", t);
            sendOsdText(row_ + 4, col_, line);
        }
    }
    sendOsdSub(OSD_SUB_DISPLAY);
}

void ElrsOsd::renderLinkTest() {
    sendOsdSub(OSD_SUB_CLEAR);
    sendOsdText(row_, col_, "FPVGATE");
    sendOsdText(row_ + 1, col_, "OSD OK");
    sendOsdSub(OSD_SUB_DISPLAY);
}

void ElrsOsd::loop(uint32_t nowMs) {
    if (s_rebootAtMs && (int32_t)(nowMs - s_rebootAtMs) >= 0) {
        ESP.restart();
    }
    // Drain lap queue even when OSD is off, so it never fills.
    bool changed = false;
    if (startPending_) {
        startPending_ = false;
        portENTER_CRITICAL(&mux_);
        lapTail_ = lapHead_;
        portEXIT_CRITICAL(&mux_);
        resetRace();
        linkTestLeft_ = 0;
        raceRunning_ = true;
        changed = true;
    }
    for (;;) {
        uint32_t lap = 0;
        portENTER_CRITICAL(&mux_);
        bool have = lapTail_ != lapHead_;
        if (have) {
            lap = lapQ_[lapTail_];
            lapTail_ = (lapTail_ + 1) % LAP_Q;
        }
        portEXIT_CRITICAL(&mux_);
        if (!have) break;
        if (gate1Pending_) {
            gate1Pending_ = false;
            gate1Ms_ = lap;
        } else {
            laps_.push_back(lap);
            if (laps_.size() > 200) laps_.erase(laps_.begin());
            lastLapMs_ = lap;
            recomputeBest3();
        }
        changed = true;
    }
    bool stopped = false;
    if (stopPending_) {
        stopPending_ = false;
        stopped = raceRunning_;
        raceRunning_ = false;
    }
    if (!espnowReady_) return;

    if (testPending_) {
        testPending_ = false;
        linkTestLeft_ = 3;
        linkTestAtMs_ = nowMs;
    }
    if (linkTestLeft_ && (int32_t)(nowMs - linkTestAtMs_) >= 0) {
        renderLinkTest();
        linkTestAtMs_ = nowMs + 500;
        if (--linkTestLeft_ == 0) nextRefreshMs_ = nowMs + 3000;  // keep "OSD OK" up a moment
        DEBUG("ELRS OSD: link test sent, ack ok=%lu fail=%lu\n", (unsigned long)s_ackOk, (unsigned long)s_ackFail);
        return;
    }
    if (linkTestLeft_) return;

    if (raceRunning_) {
        if (changed) {
            render();
            resendAtMs_ = nowMs + 400;   // one redundant copy in case a frame was lost
            nextRefreshMs_ = nowMs + 3000;
        } else if (resendAtMs_ && (int32_t)(nowMs - resendAtMs_) >= 0) {
            resendAtMs_ = 0;
            render();
        } else if ((int32_t)(nowMs - nextRefreshMs_) >= 0) {
            // goggles switched on mid-race still get the screen
            render();
            nextRefreshMs_ = nowMs + 3000;
        }
        return;
    }

    // No race running
    if (stopped) {
        resendAtMs_ = 0;
        nextRefreshMs_ = nowMs;      // switch to the idle screen now
    }
    if ((int32_t)(nowMs - nextRefreshMs_) < 0) return;
    nextRefreshMs_ = nowMs + 1000;
    if (idle_) {
        renderIdle();
    } else if (stopped || changed) {
        if (hasResults() && !clearOnStop_) render();
        else {
            sendOsdSub(OSD_SUB_CLEAR);
            sendOsdSub(OSD_SUB_DISPLAY);
        }
    }
}

// ---------------------------------------------------------------------------
// Web config page: http://<fpvgate>/elrsosd
// ---------------------------------------------------------------------------
static const char kPage[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>OSD HDZero</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:16px;background:#111;color:#eee}
label{display:block;margin:12px 0 4px}input,select{width:100%;padding:8px;font-size:16px;box-sizing:border-box;background:#222;color:#eee;border:1px solid #444;border-radius:6px}
input[type=checkbox]{width:auto}button{margin-top:16px;padding:10px 16px;font-size:16px;border:0;border-radius:6px;background:#2a7;color:#fff;margin-right:8px}
.s{margin-top:16px;padding:10px;background:#1b1b1b;border-radius:6px;font-size:14px;white-space:pre-line}a{color:#6cf}</style></head><body>
<h2>HDZero goggle OSD</h2>
<label><input type="checkbox" id="en"> Enable (ELRS Backpack via ESP-NOW)</label>
<label>Bind phrase (same as the goggle backpack)</label><input id="phrase" maxlength="63" autocomplete="off">
<label>Layout</label><select id="layout"><option value="0">2 rows (LAP / BEST 3)</option><option value="1">Narrow column (fits the 4:3 side bar)</option></select>
<label>Row (0-17)</label><input id="row" type="number" min="0" max="17">
<label>Column (0-49)</label><input id="col" type="number" min="0" max="49">
<label><input type="checkbox" id="idle"> Before/after a race: show receiver status and RSSI</label>
<label><input type="checkbox" id="clr"> When the race stops, hide the result</label>
<button onclick="save()">Save</button><button onclick="test()" style="background:#357">Test</button>
<div class="s" id="st">...</div><p><a href="/">&larr; back to FPVGate</a></p>
<script>
const $=id=>document.getElementById(id);
let filled=false;
async function load(){const j=await (await fetch('/api/elrsosd')).json();
if(!filled){filled=true;$('en').checked=j.enabled;$('phrase').value=j.phrase;$('row').value=j.row;$('col').value=j.col;$('layout').value=j.layout;$('clr').checked=j.clearOnStop;$('idle').checked=j.idle;}
$('st').textContent='Status: '+(j.espnow?'ESP-NOW active':'inactive')+(j.wifiApMode?'':' (FPVGate is not in AP mode!)')+'\nReceiver: '+(j.rxOnline?'ok':'no link')+'   RSSI: '+j.rssi+' / enter '+j.enter+'\nUID: '+j.uid+'\nWi-Fi channel: '+j.channel+'\nDelivered (ACK): '+j.ackOk+'   Failed: '+j.ackFail;}
async function save(){const b=new URLSearchParams({en:$('en').checked?1:0,phrase:$('phrase').value,row:$('row').value,col:$('col').value,layout:$('layout').value,clr:$('clr').checked?1:0,idle:$('idle').checked?1:0});
const j=await (await fetch('/api/elrsosd',{method:'POST',body:b})).json();
$('st').textContent=j.reboot?'Saved. Restarting FPVGate to apply Wi-Fi... reconnect in ~10 s.':'Saved.';if(!j.reboot)setTimeout(load,800);}
async function test(){await fetch('/api/elrsosd/test',{method:'POST'});setTimeout(load,2000);}
load();setInterval(load,5000);
</script></body></html>)HTML";

void ElrsOsd::registerRoutes(AsyncWebServer& server) {
    server.on("/elrsosd", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send_P(200, "text/html", kPage);
    });

    server.on("/api/elrsosd", HTTP_GET, [this](AsyncWebServerRequest* req) {
        JsonDocument doc;
        doc["enabled"] = enabled_;
        doc["phrase"] = phrase_;
        doc["row"] = row_;
        doc["col"] = col_;
        doc["layout"] = layout_;
        doc["clearOnStop"] = clearOnStop_;
        doc["idle"] = idle_;
        doc["rxOnline"] = rxOnline_;
        doc["rssi"] = lastRssi_;
        doc["enter"] = enter_;
        doc["espnow"] = espnowReady_;
        doc["wifiApMode"] = (WiFi.getMode() & WIFI_MODE_AP) != 0;
        char uid[18];
        snprintf(uid, sizeof(uid), "%02X:%02X:%02X:%02X:%02X:%02X", uid_[0], uid_[1], uid_[2], uid_[3], uid_[4], uid_[5]);
        doc["uid"] = uid;
        uint8_t ch = 0;
        wifi_second_chan_t sc;
        esp_wifi_get_channel(&ch, &sc);
        doc["channel"] = ch;
        doc["ackOk"] = (uint32_t)s_ackOk;
        doc["ackFail"] = (uint32_t)s_ackFail;
        String out;
        serializeJson(doc, out);
        req->send(200, "application/json", out);
    });

    server.on("/api/elrsosd", HTTP_POST, [this](AsyncWebServerRequest* req) {
        auto arg = [req](const char* name, String def) -> String {
            return req->hasParam(name, true) ? req->getParam(name, true)->value() : def;
        };
        const bool oldEnabled = enabled_;
        const String oldPhrase = phrase_;

        enabled_ = arg("en", enabled_ ? "1" : "0").toInt() != 0;
        strlcpy(phrase_, arg("phrase", phrase_).c_str(), sizeof(phrase_));
        row_ = (uint8_t)constrain(arg("row", String(row_)).toInt(), 0, OSD_ROWS - 1);
        col_ = (uint8_t)constrain(arg("col", String(col_)).toInt(), 0, OSD_COLS - 1);
        layout_ = arg("layout", String(layout_)).toInt() == LAYOUT_COLUMN ? LAYOUT_COLUMN : LAYOUT_ROWS;
        clearOnStop_ = arg("clr", clearOnStop_ ? "1" : "0").toInt() != 0;
        idle_ = arg("idle", idle_ ? "1" : "0").toInt() != 0;
        computeUid();
        save();

        // Wi-Fi mode, channel and MAC only change on a fresh Wi-Fi start.
        const bool reboot = (oldEnabled != enabled_) || (enabled_ && oldPhrase != phrase_);
        if (reboot) s_rebootAtMs = millis() + 1500;
        else testPending_ = true;  // show the new position on the goggles
        req->send(200, "application/json", reboot ? "{\"ok\":true,\"reboot\":true}" : "{\"ok\":true,\"reboot\":false}");
    });

    server.on("/api/elrsosd/test", HTTP_POST, [this](AsyncWebServerRequest* req) {
        testPending_ = true;
        req->send(200, "application/json", "{\"ok\":true}");
    });
}
