#include "webserver.h"
#include "version.h"
#include <ElegantOTA.h>

#include <DNSServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include <esp_wifi.h>
#include <HTTPClient.h>

#include "debug.h"
#include "elrs_backpack_espnow.h"

#ifdef HAS_RGB_LED
#include "rgbled.h"
extern RgbLed* g_rgbLed;
#endif
#ifdef HAS_I2S_AUDIO
#include "audio.h"
extern AudioAnnouncer* g_audioAnnouncer;
#endif

#ifdef HAS_SD_CARD_SUPPORT
#include <SD.h>
#endif

// Global storage pointer for static functions
static Storage* g_storage = nullptr;
static Config* g_config = nullptr;

static const uint8_t DNS_PORT = 53;
static IPAddress netMsk(255, 255, 255, 0);
static DNSServer dnsServer;
static IPAddress ipAddress;
static AsyncWebServer server(80);
static AsyncEventSource events("/events");

// Hostname is always fpvgate.local (timerNumber-based hostnames removed for iOS compatibility)
static char wifi_hostname[16] = "fpvgate";
static const char *wifi_ap_ssid_prefix = "FPVGate";
static const char *wifi_ap_password = "fpvgate1";
static const char *wifi_ap_address = "192.168.4.1";
String wifi_ap_ssid;

/** When ELRS backpack ESP-NOW is enabled, use AP+STA so ESP-NOW can share the radio with Wi-Fi. */
static wifi_mode_t effectiveWifiModeForRole(bool primaryAp, Config* cfg) {
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    if (cfg && cfg->getElrsBackpackEspnow()) {
        return WIFI_AP_STA;
    }
#else
    (void)cfg;
#endif
    return primaryAp ? WIFI_AP : WIFI_STA;
}

void Webserver::requestWifiStackReinit() {
    elrsBackpackEspnowStopIfRunning();
    WiFi.softAPdisconnect(true);
    WiFi.disconnect(true, true);
    wifiMode = WIFI_OFF;
    if (conf->getSsid()[0] == 0) {
        changeMode = WIFI_AP;
    } else {
        changeMode = WIFI_STA;
    }
    changeTimeMs = millis() - WIFI_RECONNECT_TIMEOUT_MS - 1;
    DEBUG("WiFi stack reinit requested (ELRS backpack / mode)\n");
}

void Webserver::init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l, RaceHistory *raceHist, Storage *stor, SelfTest *test, RX5808 *rx5808, TrackManager *trackMgr, WebhookManager *webhookMgr, RHManager *rhMgr) {

    ipAddress.fromString(wifi_ap_address);

    conf = config;
    g_config = config;  // Set global pointer for static functions
    timer = lapTimer;
    monitor = batMonitor;
    buz = buzzer;
    led = l;
    history = raceHist;
    storage = stor;
    g_storage = stor;  // Set global pointer for static functions
    selftest = test;
    
    // Hostname is always fpvgate.local
    strcpy(wifi_hostname, "fpvgate");
    DEBUG("Hostname: %s.local\n", wifi_hostname);
    rx = rx5808;
    trackManager = trackMgr;
    webhooks = webhookMgr;
    rhManager = rhMgr;
    transportMgr = nullptr;

    wifi_ap_ssid = String(wifi_ap_ssid_prefix) + "_" + WiFi.macAddress().substring(WiFi.macAddress().length() - 6);
    wifi_ap_ssid.replace(":", "");
    DEBUG("WiFi AP SSID configured: %s\n", wifi_ap_ssid.c_str());

    WiFi.persistent(false);
    WiFi.disconnect();
    WiFi.mode(WIFI_OFF);
    // Reduce TX power to prevent boot-looping in AP mode due to power consumption
    // WIFI_POWER_11dBm provides good range while keeping power consumption manageable
    WiFi.setTxPower(WIFI_POWER_11dBm);
    // Long Range protocol disabled for compatibility with standard devices
    // esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_LR);
    // esp_wifi_set_protocol(WIFI_IF_AP, WIFI_PROTOCOL_LR);
    if (conf->getSsid()[0] == 0) {
        changeMode = WIFI_AP;
    } else {
        changeMode = WIFI_STA;
    }
    changeTimeMs = millis();
    lastStatus = WL_DISCONNECTED;
}

void Webserver::setTransportManager(TransportManager *tm) {
    transportMgr = tm;
}

void Webserver::recheckWifiMode() {
    // Re-evaluate WiFi mode based on current config
    // Called after config is restored from SD backup
    if (wifiMode == WIFI_AP && conf->getSsid()[0] != 0) {
        // Config now has SSID but we're in AP mode - switch to STA
        DEBUG("Config has SSID, switching from AP to STA mode\n");
        changeMode = WIFI_STA;
        changeTimeMs = millis();
    }
}

// TransportInterface implementation
void Webserver::sendLapEvent(uint32_t lapTimeMs) {
    if (!servicesStarted) return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", lapTimeMs);
    events.send(buf, "lap");
}

void Webserver::sendRssiEvent(uint8_t rssi) {
    if (!servicesStarted) return;
    char buf[16];
    snprintf(buf, sizeof(buf), "%u", rssi);
    events.send(buf, "rssi");
}

void Webserver::sendRaceStateEvent(const char* state) {
    if (!servicesStarted) {
        DEBUG("[SSE] sendRaceStateEvent SKIPPED (services not started)\n");
        return;
    }
    const int n = events.count();
    if (n > 0) {
        DEBUG("[SSE] sendRaceStateEvent: '%s' to %d client(s)\n", state, n);
    }
    events.send(state, "raceState");
}

void Webserver::sendSlaveLapEvent(uint32_t lapTimeMs, const char* pilotName, const char* pilotPhonetic, uint32_t pilotColor, const char* slaveHostname) {
    if (!servicesStarted) return;
    
    // Build JSON payload for SSE event
    JsonDocument doc;
    doc["lapTimeMs"] = lapTimeMs;
    doc["pilotName"] = pilotName;
    doc["pilotPhonetic"] = pilotPhonetic;
    doc["pilotColor"] = pilotColor;
    doc["slaveHostname"] = slaveHostname;
    
    String output;
    serializeJson(doc, output);
    events.send(output.c_str(), "slaveLap");
}

// Send lap data to master (for slave mode)
void Webserver::sendLapToMaster(uint32_t lapTimeMs) {
    DEBUG("[Slave] sendLapToMaster called, lapTime=%u, syncMode=%d\n", lapTimeMs, conf->getRaceSyncMode());
    
    // Only send if in slave mode and master hostname is configured
    if (conf->getRaceSyncMode() != RACE_SYNC_SLAVE) {
        DEBUG("[Slave] Not in slave mode (mode=%d), skipping\n", conf->getRaceSyncMode());
        return;
    }
    
    const char* masterHostname = conf->getMasterHostname();
    if (masterHostname[0] == '\0') {
        DEBUG("[Slave] No master hostname configured, not sending lap\n");
        return;
    }
    
    char url[96];
    snprintf(url, sizeof(url), "http://%s/timer/remoteLap", masterHostname);
    
    DEBUG("[Slave] Sending lap to master: %s (time=%u ms)\n", url, lapTimeMs);
    
    HTTPClient http;
    http.setConnectTimeout(500);
    http.setTimeout(1000);
    
    if (http.begin(url)) {
        http.addHeader("Content-Type", "application/json");
        
        // Build JSON payload with pilot info
        JsonDocument doc;
        doc["lapTimeMs"] = lapTimeMs;
        doc["pilotName"] = conf->getPilotCallsign();
        doc["pilotPhonetic"] = conf->getPilotPhonetic();
        doc["pilotColor"] = conf->getPilotColor();
        doc["slaveHostname"] = String(wifi_hostname) + ".local";
        
        String payload;
        serializeJson(doc, payload);
        
        int httpCode = http.POST(payload);
        if (httpCode <= 0) {
            DEBUG("[Slave] FAILED to send lap: %s\n", http.errorToString(httpCode).c_str());
        } else {
            DEBUG("[Slave] Lap sent OK (HTTP %d)\n", httpCode);
        }
        http.end();
    } else {
        DEBUG("[Slave] http.begin() FAILED\n");
    }
}

// Send sync command to all configured slave timers
static void sendSyncCommand(Config* config, const char* endpoint) {
    if (config->getRaceSyncMode() != 1) return;  // Only master sends
    
    uint8_t timerCount = config->getSyncedTimerCount();
    if (timerCount == 0) return;
    
    DEBUG("[Sync] Sending %s to %d slave(s)\n", endpoint, timerCount);
    
    for (uint8_t i = 0; i < timerCount; i++) {
        const char* hostname = config->getSyncedTimer(i);
        if (hostname[0] == '\0') continue;
        
        char url[64];
        snprintf(url, sizeof(url), "http://%s%s", hostname, endpoint);
        
        DEBUG("[Sync] -> %s\n", url);
        
        HTTPClient http;
        http.setConnectTimeout(500);
        http.setTimeout(1000);
        
        if (http.begin(url)) {
            int httpCode = http.POST("");
            if (httpCode <= 0) {
                DEBUG("[Sync] FAILED: %s\n", http.errorToString(httpCode).c_str());
            } else {
                DEBUG("[Sync] OK (HTTP %d)\n", httpCode);
            }
            http.end();
        } else {
            DEBUG("[Sync] http.begin() FAILED\n");
        }
    }
}

// Public triggers - called from main loop (core 1)
// Timer actions happen immediately; SSE broadcast is deferred to core 0
// via pendingRaceState, which handleWebUpdate() picks up.
void Webserver::triggerStart() {
    sendSyncCommand(conf, "/timer/start");
    timer->start();
    pendingRaceState = "started";
}

void Webserver::triggerStop() {
    sendSyncCommand(conf, "/timer/stop");
    timer->stop();
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    elrsBackpackEspnowOnRaceStop(conf);
#endif
    pendingRaceState = "stopped";
}

void Webserver::triggerClearLaps() {
    sendSyncCommand(conf, "/timer/clearLaps");
    pendingRaceState = "cleared";
}

void Webserver::triggerConfigUpdated() {
    pendingConfigUpdate = true;
}

bool Webserver::consumePendingLap(uint32_t& lapMs) {
    if (_hasLcdLap) {
        lapMs = _pendingLcdLap;
        _hasLcdLap = false;
        return true;
    }
    return false;
}

bool Webserver::consumePendingClear() {
    if (_pendingLcdClear) {
        _pendingLcdClear = false;
        return true;
    }
    return false;
}

void Webserver::setPendingLcdEvent(PendingLcdEvent ev) {
    _pendingLcdEvent = ev;
}

Webserver::PendingLcdEvent Webserver::consumePendingLcdEvent() {
    PendingLcdEvent ev = _pendingLcdEvent;
    _pendingLcdEvent = PendingLcdEvent::None;
    return ev;
}

bool Webserver::isConnected() {
    // WiFi transport is always "connected" if services are started
    // Individual clients connect/disconnect via SSE but that's transparent
    return servicesStarted;
}

void Webserver::update(uint32_t currentTimeMs) {
    handleWebUpdate(currentTimeMs);
}

void Webserver::handleWebUpdate(uint32_t currentTimeMs) {
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    elrsBackpackEspnowPoll(conf, currentTimeMs);
#endif
    // Process deferred race state events from LCD triggers (must run on core 0)
    if (pendingRaceState) {
        const char* state = (const char*)pendingRaceState;
        pendingRaceState = nullptr;
        DEBUG("[LCD->SSE] Deferred race state: '%s'\n", state);
        if (transportMgr) {
            transportMgr->broadcastRaceStateEvent(state);
        }
    }
    
    // Process deferred config update notification from LCD (must run on core 0)
    if (pendingConfigUpdate) {
        pendingConfigUpdate = false;
        if (servicesStarted) {
            DEBUG("[LCD->SSE] Config updated, notifying web clients\n");
            events.send("updated", "configUpdated");
        }
    }

    if (sendRssi && ((currentTimeMs - rssiSentMs) > WEB_RSSI_SEND_TIMEOUT_MS)) {
        sendRssiEvent(timer->getRssi());
        rssiSentMs = currentTimeMs;
    }

    // Send SSE keepalive ping to prevent connection timeout
    if (servicesStarted && ((currentTimeMs - sseKeepaliveMs) > WEB_SSE_KEEPALIVE_MS)) {
        events.send("ping", "keepalive", millis());
        sseKeepaliveMs = currentTimeMs;
    }

    wl_status_t status = WiFi.status();

    if (status != lastStatus && wifiMode == WIFI_STA) {
        DEBUG("WiFi status = %u\n", status);
        switch (status) {
            case WL_NO_SSID_AVAIL:
            case WL_CONNECT_FAILED:
            case WL_CONNECTION_LOST:
                changeTimeMs = currentTimeMs;
                changeMode = WIFI_AP;
                break;
            case WL_DISCONNECTED:  // try reconnection
                changeTimeMs = currentTimeMs;
                break;
            case WL_CONNECTED:
                buz->playCue(BUZZER_CUE_WEB_CHIRP);
                led->off();
                wifiConnected = true;
                DEBUG("WiFi connected successfully!\n");
                DEBUG("IP address: %s\n", WiFi.localIP().toString().c_str());
                DEBUG("SSID: %s\n", WiFi.SSID().c_str());
#ifdef HAS_RGB_LED
                if (g_rgbLed) g_rgbLed->setStatus(STATUS_USER_CONNECTED);
#endif
                break;
            default:
                break;
        }
        lastStatus = status;
    }
    if (status != WL_CONNECTED && wifiMode == WIFI_STA && (currentTimeMs - changeTimeMs) > WIFI_CONNECTION_TIMEOUT_MS) {
        changeTimeMs = currentTimeMs;
        if (!wifiConnected) {
            changeMode = WIFI_AP;  // if we didnt manage to ever connect to wifi network
            // Signal WiFi connection failure - set orange color briefly
#ifdef HAS_RGB_LED
            if (g_rgbLed) {
                g_rgbLed->setColor(CRGB::Orange, RGB_SOLID);
            }
#endif
        } else {
            DEBUG("WiFi Connection failed, reconnecting\n");
            WiFi.reconnect();
            startServices();
            buz->playCue(BUZZER_CUE_WEB_CHIRP);
            led->blink(200);
        }
    }
    if (changeMode != wifiMode && changeMode != WIFI_OFF && (currentTimeMs - changeTimeMs) > WIFI_RECONNECT_TIMEOUT_MS) {
        switch (changeMode) {
            case WIFI_AP:
                DEBUG("Changing to WiFi AP mode\n");

                elrsBackpackEspnowStopIfRunning();
                WiFi.softAPdisconnect(true);
                WiFi.disconnect(true);
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
                /* Sets MACs inside: WiFi.mode(WIFI_AP_STA) + disconnect — not after WIFI_OFF (0x3001 NOT_INIT). */
                elrsBackpackEspnowPrepareWifiMacForElrs(conf);
#else
                WiFi.mode(WIFI_OFF);
                delay(30);
#endif

                wifiMode = WIFI_AP;
                WiFi.setHostname(wifi_hostname);  // hostname must be set before the mode is set to STA
                WiFi.mode(effectiveWifiModeForRole(true, conf));
                changeTimeMs = currentTimeMs;

                // Power-saving settings for AP mode to prevent boot-looping
                // Reduce TX power specifically for AP mode (already set globally but ensure it's applied)
                WiFi.setTxPower(WIFI_POWER_11dBm);
                
                WiFi.softAPConfig(ipAddress, ipAddress, netMsk);
                DEBUG("Starting WiFi AP: %s with password: %s\n", wifi_ap_ssid.c_str(), wifi_ap_password);
                
                // Start AP with max 4 connections to limit power draw.
                // When ELRS backpack ESP-NOW is on, use ch 1 — same as ExpressLRS SetSoftMACAddress() so
                // goggles ACK; otherwise ch 6 is a reasonable default for AP-only.
                {
                    uint8_t ap_ch = 6;
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
                    if (conf && conf->getElrsBackpackEspnow()) {
                        ap_ch = kElrsBackpackEspnowWifiChannel;
                    }
#endif
                    WiFi.softAP(wifi_ap_ssid.c_str(), wifi_ap_password, ap_ch, 0, 4);
                }
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
                /* softAP() / driver can revert custom MACs set in prepare; VRx accepts only source MAC == bind UID. */
                elrsBackpackEspnowReassertCustomMacsForElrs(conf);
#endif

#ifdef SEEED_XIAO_ESP32S3
                // Disable WiFi power saving for faster responsiveness on XIAO
                // The XIAO's chip antenna and power delivery can cause connection delays with PS enabled
                esp_wifi_set_ps(WIFI_PS_NONE);
                DEBUG("WiFi power saving disabled for XIAO\n");
#endif
                
                // Set lower beacon interval to reduce power consumption (in multiples of 100ms, default is 100)
                // Note: Higher values = less frequent beacons = lower power but slightly slower connection
                esp_wifi_set_max_tx_power(44); // 11dBm in 0.25dBm units (44 * 0.25 = 11dBm)
                
                DEBUG("WiFi AP started. SSID: %s, Power: 11dBm, Max clients: 4\n", WiFi.softAPSSID().c_str());
                elrsBackpackEspnowStartIfEnabled(conf);
                startServices();
                buz->beep(1000);
                led->on(1000);
                break;
            case WIFI_STA:
                DEBUG("Connecting to WiFi network\n");
                elrsBackpackEspnowStopIfRunning();
                WiFi.softAPdisconnect(true);
                WiFi.disconnect(true);
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
                elrsBackpackEspnowPrepareWifiMacForElrs(conf);
#else
                WiFi.mode(WIFI_OFF);
                delay(30);
#endif
                wifiMode = WIFI_STA;
                WiFi.setHostname(wifi_hostname);  // hostname must be set before the mode is set to STA
                WiFi.mode(effectiveWifiModeForRole(false, conf));
                changeTimeMs = currentTimeMs;
                WiFi.begin(conf->getSsid(), conf->getPassword());
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
                elrsBackpackEspnowReassertCustomMacsForElrs(conf);
#endif
                elrsBackpackEspnowStartIfEnabled(conf);
                startServices();
                led->blink(200);
            default:
                break;
        }

        changeMode = WIFI_OFF;
    }

    if (servicesStarted) {
        dnsServer.processNextRequest();
    }
}

/** Is this an IP? */
static boolean isIp(String str) {
    for (size_t i = 0; i < str.length(); i++) {
        int c = str.charAt(i);
        if (c != '.' && (c < '0' || c > '9')) {
            return false;
        }
    }
    return true;
}

/** IP to String? */
static String toStringIp(IPAddress ip) {
    String res = "";
    for (int i = 0; i < 3; i++) {
        res += String((ip >> (8 * i)) & 0xFF) + ".";
    }
    res += String(((ip >> 8 * 3)) & 0xFF);
    return res;
}

static bool captivePortal(AsyncWebServerRequest *request) {
    // Allow configured hostname.local, fpvgate.local, fpvgateN.local, IP addresses
    String host = request->host();
    
    if (isIp(host)) {
        return false;  // IP addresses always allowed
    }
    
    // Allow the configured hostname
    if (host == (String(wifi_hostname) + ".local") ||
        host == "www." + String(wifi_hostname) + ".local") {
        return false;
    }
    
    // Always allow fpvgate.local
    if (host == "fpvgate.local" || host == "www.fpvgate.local") {
        return false;
    }
    
    // LEGACY: timerNumber-based hostnames (fpvgate1-8.local) removed for iOS compatibility
    // for (int i = 1; i <= 8; i++) {
    //     String allowed = "fpvgate" + String(i) + ".local";
    //     if (host == allowed || host == "www." + allowed) {
    //         return false;
    //     }
    // }
    
    DEBUG("Request redirected to captive portal\n");
    request->redirect(String("http://") + toStringIp(request->client()->localIP()));
    return true;
}

static void handleRoot(AsyncWebServerRequest *request) {
    if (captivePortal(request)) {  // If captive portal redirect instead of displaying the page.
        return;
    }
    
    // Redirect hostname requests to IP address for iOS Safari compatibility
    // iOS Safari has mDNS issues with SSE/fetch on .local hostnames
    String host = request->host();
    if (!isIp(host)) {
        // Get the device's IP address
        IPAddress deviceIP = (WiFi.getMode() == WIFI_AP) ? WiFi.softAPIP() : WiFi.localIP();
        String redirectUrl = "http://" + deviceIP.toString() + request->url();
        DEBUG("Redirecting %s to %s\n", host.c_str(), redirectUrl.c_str());
        request->redirect(redirectUrl);
        return;
    }
    
#ifdef HAS_RGB_LED
    // Flash green when user accesses web interface
    if (g_rgbLed) g_rgbLed->flashGreen();
#endif

    // LittleFS is already mounted in startServices(), don't remount
    if (!LittleFS.exists("/index.html")) {
        request->send(500, "text/plain",
            "Web UI not found. LittleFS not mounted or /index.html missing.\n"
            "Did you add a LittleFS partition + run uploadfs?");
        return;
    }

    request->send(LittleFS, "/index.html", "text/html");
}

static void handleNotFound(AsyncWebServerRequest *request) {
    if (captivePortal(request)) {  // If captive portal redirect instead of displaying the error page.
        return;
    }

    String path = request->url();

#ifdef HAS_SD_CARD_SUPPORT
    // Try SD card as a fallback for any unknown path (e.g. /sounds_*/file.mp3)
    if (g_storage && g_storage->isSDAvailable() && SD.exists(path)) {
        const char* contentType = "application/octet-stream";
        if (path.endsWith(".mp3")) contentType = "audio/mpeg";
        else if (path.endsWith(".svg")) contentType = "image/svg+xml";
        else if (path.endsWith(".ico")) contentType = "image/x-icon";
        else if (path.endsWith(".json")) contentType = "application/json";
        else if (path.endsWith(".txt")) contentType = "text/plain";
        DEBUG("[404->SD] Serving from SD fallback: %s\n", path.c_str());
        request->send(SD, path, contentType);
        return;
    }
#endif

    String message = F("File Not Found\n\n");
    message += F("URI: ");
    message += path;
    message += F("\nMethod: ");
    message += (request->method() == HTTP_GET) ? "GET" : "POST";
    message += F("\nArguments: ");
    message += request->args();
    message += F("\n");

    for (uint8_t i = 0; i < request->args(); i++) {
        message += String(F(" ")) + request->argName(i) + F(": ") + request->arg(i) + F("\n");
    }
    AsyncWebServerResponse *response = request->beginResponse(404, "text/plain", message);
    response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    response->addHeader("Pragma", "no-cache");
    response->addHeader("Expires", "-1");
    request->send(response);
}

static bool startLittleFS() {
    Serial.println("[INFO] Attempting to mount LittleFS...");
    if (!LittleFS.begin(false)) {
        Serial.println("[WARN] LittleFS mount failed, attempting to format...");
        DEBUG("LittleFS mount failed, attempting to format...\n");
        if (!LittleFS.begin(true)) {
            Serial.println("[ERROR] LittleFS format failed!");
            DEBUG("LittleFS format failed\n");
            return false;
        }
        Serial.println("[INFO] LittleFS formatted and mounted");
        DEBUG("LittleFS formatted and mounted\n");
        return true;
    }
    Serial.println("[INFO] LittleFS mounted successfully");
    DEBUG("LittleFS mounted successfully\n");
    return true;
}

static void startMDNS() {
    DEBUG("Starting mDNS with hostname: %s\n", wifi_hostname);
    
    if (!MDNS.begin(wifi_hostname)) {
        DEBUG("ERROR: mDNS failed to start!\n");
        return;
    }

    String instance = String(wifi_hostname) + "_" + WiFi.macAddress();
    instance.replace(":", "");
    MDNS.setInstanceName(instance);
    MDNS.addService("http", "tcp", 80);
    
    DEBUG("mDNS started successfully\n");
    DEBUG("  Hostname: %s.local\n", wifi_hostname);
    DEBUG("  Instance: %s\n", instance.c_str());
    DEBUG("  HTTP service advertised on port 80\n");
}

void Webserver::startServices() {
    if (servicesStarted) {
        // Restart server and mDNS when WiFi mode changes
        // server.begin() must be called again after WiFi.mode(WIFI_OFF) kills the TCP socket
        server.begin();
        MDNS.end();
        delay(100);  // Give mDNS time to shut down
        startMDNS();
        DEBUG("Server and mDNS restarted for mode change\n");
        return;
    }

    // CORS headers - MUST be set before any handlers are registered
    // This is critical for iOS Safari which requires CORS for EventSource/SSE
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Max-Age", "600");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "*");
    DEBUG("CORS headers configured\n");

    startLittleFS();
    
    // Note: storage is already initialized in main.cpp before webserver starts
    // Do NOT call storage->init() here as it would reset the sdAvailable flag!
    
    // Note: race history is already initialized in main.cpp
    // Do NOT re-initialize it here

    server.on("/", handleRoot);
    server.on("/generate_204", handleRoot);  // handle Andriod phones doing shit to detect if there is 'real' internet and possibly dropping conn.
    server.on("/gen_204", handleRoot);
    server.on("/library/test/success.html", handleRoot);
    server.on("/hotspot-detect.html", handleRoot);
    server.on("/connectivity-check.html", handleRoot);
    server.on("/check_network_status.txt", handleRoot);
    server.on("/ncsi.txt", handleRoot);
    server.on("/fwlink", handleRoot);
    // Android captive portal probe paths – handle before serveStatic to avoid LittleFS open() errors
    server.on("/connecttest.txt", handleRoot);
    server.on("/connecttest.txt.gz", handleRoot);
    server.on("/connecttest.txt/index.htm", handleRoot);
    server.on("/connecttest.txt/index.htm.gz", handleRoot);

    server.on("/status", [this](AsyncWebServerRequest *request) {
        char buf[1536];
        char configBuf[256];
        conf->toJsonString(configBuf);
        const char *format =
            "\
Heap:\n\
\tFree:\t%i\n\
\tMin:\t%i\n\
\tSize:\t%i\n\
\tAlloc:\t%i\n\
Storage:\n\
\tType:\t%s\n\
\tUsed:\t%llu\n\
\tTotal:\t%llu\n\
\tFree:\t%llu\n\
Chip:\n\
\tModel:\t%s Rev %i, %i Cores, SDK %s\n\
\tFlashSize:\t%i\n\
\tFlashSpeed:\t%iMHz\n\
\tCPU Speed:\t%iMHz\n\
Network:\n\
\tIP:\t%s\n\
\tMAC:\t%s\n\
EEPROM:\n\
%s";

        snprintf(buf, sizeof(buf), format,
                 ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getHeapSize(), ESP.getMaxAllocHeap(),
                 storage->getStorageType().c_str(), storage->getUsedBytes(), storage->getTotalBytes(), storage->getFreeBytes(),
                 ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(), ESP.getSdkVersion(), ESP.getFlashChipSize(), ESP.getFlashChipSpeed() / 1000000, getCpuFrequencyMhz(),
                 WiFi.localIP().toString().c_str(), WiFi.macAddress().c_str(), configBuf);
        request->send(200, "text/plain", buf);
        led->on(200);
    });

    // Vertical OSD route
    server.on("/vert-OSD", [this](AsyncWebServerRequest *request) {
        request->send(LittleFS, "/vert-osd.html", "text/html");
    });

    // Helper lambda for CORS response
    auto sendCorsResponse = [](AsyncWebServerRequest *request, const char* body) {
        AsyncWebServerResponse *response = request->beginResponse(200, "application/json", body);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        request->send(response);
    };
    
    // OPTIONS handler for CORS preflight
    server.on("/timer/start", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
        AsyncWebServerResponse *response = request->beginResponse(204);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type");
        request->send(response);
    });
    
    // Countdown endpoint - triggers I2S speaker pre-race audio
    server.on("/timer/countdown", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
        AsyncWebServerResponse *response = request->beginResponse(204);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type");
        request->send(response);
    });
    
    // Countdown: only set pending LCD event; audio starts when LCD countdown actually starts (keeps them in sync)
    server.on("/timer/countdown", HTTP_POST, [this, sendCorsResponse](AsyncWebServerRequest *request) {
        setPendingLcdEvent(PendingLcdEvent::Countdown);
        sendCorsResponse(request, "{\"status\": \"OK\"}");
    });
    
    server.on("/timer/start", HTTP_POST, [this, sendCorsResponse](AsyncWebServerRequest *request) {
        // Send sync to slaves first (if master)
        sendSyncCommand(conf, "/timer/start");
        // Start local timer
        timer->start();
        // Notify RotorHazard (queued, sent on next process() tick)
        // Pass the race start timestamp so RH can sync to the same reference.
        if (rhManager && rhManager->isEnabled()) {
            rhManager->startRace(timer->getRaceStartMs());
        }
        if (transportMgr) {
            transportMgr->broadcastRaceStateEvent("started");
        }
#ifdef HAS_I2S_AUDIO
        if (g_audioAnnouncer) {
            g_audioAnnouncer->announceRaceStart();
        }
#endif
        sendCorsResponse(request, "{\"status\": \"OK\"}");
    });
    
    server.on("/timer/stop", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
        AsyncWebServerResponse *response = request->beginResponse(204);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type");
        request->send(response);
    });

    server.on("/timer/stop", HTTP_POST, [this, sendCorsResponse](AsyncWebServerRequest *request) {
        // Send sync to slaves first (if master)
        sendSyncCommand(conf, "/timer/stop");
        // Stop local timer
        timer->stop();
        // Notify RotorHazard (queued, sent on next process() tick)
        if (rhManager && rhManager->isEnabled()) {
            rhManager->stopRace();
        }
        if (transportMgr) {
            transportMgr->broadcastRaceStateEvent("stopped");
        }
        setPendingLcdEvent(PendingLcdEvent::ShowFinish);
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
        elrsBackpackEspnowOnRaceStop(conf);
#endif
#ifdef HAS_I2S_AUDIO
        if (g_audioAnnouncer) {
            g_audioAnnouncer->announceRaceStop();
        }
#endif
        sendCorsResponse(request, "{\"status\": \"OK\"}");
    });

    server.on("/timer/lap", HTTP_POST, [this](AsyncWebServerRequest *request) {
#ifdef HAS_RGB_LED
        if (g_rgbLed) {
            g_rgbLed->flashLap();
        }
#endif
        request->send(200, "application/json", "{\"status\": \"OK\"}");
    });

    // Manual lap addition - broadcasts lap event to all clients
    AsyncCallbackJsonWebHandler *addLapHandler = new AsyncCallbackJsonWebHandler("/timer/addLap", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        if (!jsonObj["lapTime"].isNull()) {
            uint32_t lapTimeMs = jsonObj["lapTime"].as<uint32_t>();
            if (transportMgr) {
                transportMgr->broadcastLapEvent(lapTimeMs);
            }
            // Forward to LCD
            _pendingLcdLap = lapTimeMs;
            _hasLcdLap = true;
#ifdef HAS_RGB_LED
            if (g_rgbLed) {
                g_rgbLed->flashLap();
            }
#endif
#ifdef HAS_I2S_AUDIO
            if (g_audioAnnouncer) {
                g_audioAnnouncer->announceLap(lapTimeMs);
            }
#endif
            // Trigger lap webhook if Gate LEDs enabled and Lap enabled
            if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookLap()) {
                webhooks->triggerLap();
            }
            // Send lap to master if in slave mode
            if (conf->getRaceSyncMode() == 2) {
                DEBUG("[Slave] Manual lap - sending to master: %u ms\n", lapTimeMs);
                sendLapToMaster(lapTimeMs);
            }
            // Report lap to RotorHazard with raw millis() timestamps for clock sync
            if (rhManager && timer) {
                rhManager->triggerLap(millis(), timer->getRaceStartMs());
            }
        }
        request->send(200, "application/json", "{\"status\": \"OK\"}");
    });
    server.addHandler(addLapHandler);

    // Playback endpoints - replay saved races
    AsyncCallbackJsonWebHandler *playbackStartHandler = new AsyncCallbackJsonWebHandler("/timer/playbackStart", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        if (transportMgr) {
            transportMgr->broadcastRaceStateEvent("started");
        }
        // Trigger race start webhook if Gate LEDs enabled
        if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookRaceStart()) {
            webhooks->triggerRaceStart();
        }
        request->send(200, "application/json", "{\"status\": \"OK\"}");
    });
    server.addHandler(playbackStartHandler);

    AsyncCallbackJsonWebHandler *playbackLapHandler = new AsyncCallbackJsonWebHandler("/timer/playbackLap", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        if (!jsonObj["lapTime"].isNull()) {
            uint32_t lapTimeMs = jsonObj["lapTime"].as<uint32_t>();
            if (transportMgr) {
                transportMgr->broadcastLapEvent(lapTimeMs);
            }
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
            elrsBackpackEspnowOnPlaybackLap(conf, lapTimeMs);
#endif
#ifdef HAS_RGB_LED
            if (g_rgbLed) {
                g_rgbLed->flashLap();
            }
#endif
            // Trigger lap webhook if Gate LEDs enabled and Lap enabled
            if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookLap()) {
                webhooks->triggerLap();
            }
        }
        request->send(200, "application/json", "{\"status\": \"OK\"}");
    });
    server.addHandler(playbackLapHandler);

    AsyncCallbackJsonWebHandler *playbackStopHandler = new AsyncCallbackJsonWebHandler("/timer/playbackStop", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        if (transportMgr) {
            transportMgr->broadcastRaceStateEvent("stopped");
        }
        // Trigger race stop webhook if Gate LEDs enabled
        if (webhooks && conf->getGateLEDsEnabled() && conf->getWebhookRaceStop()) {
            webhooks->triggerRaceStop();
        }
        request->send(200, "application/json", "{\"status\": \"OK\"}");
    });
    server.addHandler(playbackStopHandler);

    server.on("/timer/clearLaps", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
        AsyncWebServerResponse *response = request->beginResponse(204);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type");
        request->send(response);
    });
    
    server.on("/timer/clearLaps", HTTP_POST, [this, sendCorsResponse](AsyncWebServerRequest *request) {
        // Send sync to slaves first (if master)
        sendSyncCommand(conf, "/timer/clearLaps");
        // Broadcast clearLaps event to all connected clients (including OSD)
        if (transportMgr) {
            transportMgr->broadcastRaceStateEvent("cleared");
        }
        // Forward to LCD
        _pendingLcdClear = true;
        sendCorsResponse(request, "{\"status\": \"OK\"}");
    });

    // Race sync endpoints
    server.on("/timer/syncStatus", HTTP_GET, [this](AsyncWebServerRequest *request) {
        JsonDocument doc;
        doc["timerNumber"] = conf->getTimerNumber();
        doc["raceSyncMode"] = conf->getRaceSyncMode();
        doc["hostname"] = wifi_hostname;
        
        String output;
        serializeJson(doc, output);
        request->send(200, "application/json", output);
    });

    server.on("/timer/ping", HTTP_GET, [this](AsyncWebServerRequest *request) {
        // Simple ping endpoint for master to verify slave connectivity
        JsonDocument doc;
        doc["status"] = "OK";
        doc["hostname"] = wifi_hostname;
        doc["raceSyncMode"] = conf->getRaceSyncMode();
        
        String output;
        serializeJson(doc, output);
        
        // Add CORS headers for cross-origin sync requests
        AsyncWebServerResponse *response = request->beginResponse(200, "application/json", output);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        request->send(response);
    });
    
    // Test endpoint to manually trigger slave-to-master lap send
    server.on("/timer/testSlaveToMaster", HTTP_POST, [this](AsyncWebServerRequest *request) {
        DEBUG("[Slave] testSlaveToMaster endpoint called\n");
        
        // Force call sendLapToMaster with a test lap time
        uint32_t testLapTime = 12345; // Test lap time in ms
        sendLapToMaster(testLapTime);
        
        JsonDocument doc;
        doc["status"] = "OK";
        doc["raceSyncMode"] = conf->getRaceSyncMode();
        doc["masterHostname"] = conf->getMasterHostname();
        doc["testLapTime"] = testLapTime;
        
        String output;
        serializeJson(doc, output);
        
        AsyncWebServerResponse *response = request->beginResponse(200, "application/json", output);
        response->addHeader("Access-Control-Allow-Origin", "*");
        request->send(response);
    });

    // Remote lap endpoint - receives lap data from slave devices
    server.on("/timer/remoteLap", HTTP_OPTIONS, [](AsyncWebServerRequest *request) {
        AsyncWebServerResponse *response = request->beginResponse(204);
        response->addHeader("Access-Control-Allow-Origin", "*");
        response->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response->addHeader("Access-Control-Allow-Headers", "Content-Type");
        request->send(response);
    });
    
    AsyncCallbackJsonWebHandler *remoteLapHandler = new AsyncCallbackJsonWebHandler("/timer/remoteLap", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        
        uint32_t lapTimeMs = jsonObj["lapTimeMs"] | 0;
        const char* pilotName = jsonObj["pilotName"] | "Unknown";
        const char* pilotPhonetic = jsonObj["pilotPhonetic"] | pilotName;
        uint32_t pilotColor = jsonObj["pilotColor"] | 0x0080FF;
        const char* slaveHostname = jsonObj["slaveHostname"] | "unknown";
        
        DEBUG("[Master] Received remote lap from %s: %u ms (pilot: %s)\n", slaveHostname, lapTimeMs, pilotName);
        
        // Broadcast to all connected clients via SSE
        if (transportMgr) {
            transportMgr->broadcastSlaveLapEvent(lapTimeMs, pilotName, pilotPhonetic, pilotColor, slaveHostname);
        }
        
        // Add CORS headers for cross-origin requests from slave devices
        AsyncWebServerResponse *response = request->beginResponse(200, "application/json", "{\"status\": \"OK\"}");
        response->addHeader("Access-Control-Allow-Origin", "*");
        request->send(response);
    });
    server.addHandler(remoteLapHandler);

    server.on("/timer/rssiStart", HTTP_POST, [this](AsyncWebServerRequest *request) {
        sendRssi = true;
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200);
    });

    server.on("/timer/rssiStop", HTTP_POST, [this](AsyncWebServerRequest *request) {
        sendRssi = false;
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200);
    });

    server.on("/config", HTTP_GET, [this](AsyncWebServerRequest *request) {
        AsyncResponseStream *response = request->beginResponseStream("application/json");
        conf->toJson(*response, monitor);
        request->send(response);
        led->on(200);
    });

    server.on("/version", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String versionStr = FPVGATE_VERSION_STRING();
        request->send(200, "text/plain", versionStr);
    });

    AsyncCallbackJsonWebHandler *configJsonHandler = new AsyncCallbackJsonWebHandler("/config", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
#ifdef DEBUG_OUT
        serializeJsonPretty(jsonObj, DEBUG_OUT);
        DEBUG("\n");
#endif
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
        uint8_t prev_elrs_backpack = conf->getElrsBackpackEspnow();
        char prev_elrs_bind[33];
        strlcpy(prev_elrs_bind, conf->getElrsBackpackBindPhrase(), sizeof(prev_elrs_bind));
#endif
        conf->fromJson(jsonObj);
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
        bool reboot_to_enable_elrs_espnow = false;
        if (!jsonObj["elrsBackpackEspnow"].isNull() && prev_elrs_backpack != conf->getElrsBackpackEspnow()) {
            if (conf->getElrsBackpackEspnow() == 1 && prev_elrs_backpack == 0) {
                reboot_to_enable_elrs_espnow = true;
            } else {
                requestWifiStackReinit();
            }
        } else if (!jsonObj["elrsBackpackBindPhrase"].isNull() &&
                   strcmp(prev_elrs_bind, conf->getElrsBackpackBindPhrase()) != 0) {
            requestWifiStackReinit();
        }
#endif
        
        // Update battery monitor voltage divider if it changed
#ifdef HAS_BATTERY_MONITOR
        if (!jsonObj["batteryVoltageDivider"].isNull() && monitor) {
            float ratio = conf->getBatteryVoltageDivider();
            monitor->setVoltageDivider(ratio);
            DEBUG("Battery voltage divider updated to %.1f\n", ratio);
        }
#endif

#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
        if (reboot_to_enable_elrs_espnow) {
            conf->write();
            request->send(200, "application/json", "{\"status\":\"OK\",\"reboot\":true}");
            led->on(200);
            delay(200);
            ESP.restart();
            return;
        }
#endif
        
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200);
    });

    // Serve audio files from SD card voice directories (sounds_default, sounds_rachel, etc.)
    // Use onRequestBody to handle the route before serveStatic catches it
    server.on("/sounds_default/*", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String path = request->url();
        DEBUG("Audio request: %s\n", path.c_str());
        
#ifdef HAS_SD_CARD_SUPPORT
        if (storage->isSDAvailable() && SD.exists(path)) {
            DEBUG("Serving from SD: %s\n", path.c_str());
            request->send(SD, path, "audio/mpeg");
            return;
        }
#endif
        if (LittleFS.exists(path)) {
            DEBUG("Serving from LittleFS: %s\n", path.c_str());
            request->send(LittleFS, path, "audio/mpeg");
            return;
        }
        DEBUG("Audio file not found: %s\n", path.c_str());
        request->send(404, "text/plain", "Audio file not found");
    });
    
    server.on("/sounds_rachel/*", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String path = request->url();
        DEBUG("Audio request: %s\n", path.c_str());
        
#ifdef HAS_SD_CARD_SUPPORT
        if (storage->isSDAvailable() && SD.exists(path)) {
            DEBUG("Serving from SD: %s\n", path.c_str());
            request->send(SD, path, "audio/mpeg");
            return;
        }
#endif
        if (LittleFS.exists(path)) {
            DEBUG("Serving from LittleFS: %s\n", path.c_str());
            request->send(LittleFS, path, "audio/mpeg");
            return;
        }
        DEBUG("Audio file not found: %s\n", path.c_str());
        request->send(404, "text/plain", "Audio file not found");
    });
    
    server.on("/sounds_adam/*", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String path = request->url();
        DEBUG("Audio request: %s\n", path.c_str());
        
#ifdef HAS_SD_CARD_SUPPORT
        if (storage->isSDAvailable() && SD.exists(path)) {
            DEBUG("Serving from SD: %s\n", path.c_str());
            request->send(SD, path, "audio/mpeg");
            return;
        }
#endif
        if (LittleFS.exists(path)) {
            DEBUG("Serving from LittleFS: %s\n", path.c_str());
            request->send(LittleFS, path, "audio/mpeg");
            return;
        }
        DEBUG("Audio file not found: %s\n", path.c_str());
        request->send(404, "text/plain", "Audio file not found");
    });
    
    server.on("/sounds_antoni/*", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String path = request->url();
        DEBUG("Audio request: %s\n", path.c_str());
        
#ifdef HAS_SD_CARD_SUPPORT
        if (storage->isSDAvailable() && SD.exists(path)) {
            DEBUG("Serving from SD: %s\n", path.c_str());
            request->send(SD, path, "audio/mpeg");
            return;
        }
#endif
        if (LittleFS.exists(path)) {
            DEBUG("Serving from LittleFS: %s\n", path.c_str());
            request->send(LittleFS, path, "audio/mpeg");
            return;
        }
        DEBUG("Audio file not found: %s\n", path.c_str());
        request->send(404, "text/plain", "Audio file not found");
    });
    
    server.on("/sounds_matilda/*", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String path = request->url();
        DEBUG("Audio request: %s\n", path.c_str());
        
#ifdef HAS_SD_CARD_SUPPORT
        if (storage->isSDAvailable() && SD.exists(path)) {
            DEBUG("Serving from SD: %s\n", path.c_str());
            request->send(SD, path, "audio/mpeg");
            return;
        }
#endif
        if (LittleFS.exists(path)) {
            DEBUG("Serving from LittleFS: %s\n", path.c_str());
            request->send(LittleFS, path, "audio/mpeg");
            return;
        }
        DEBUG("Audio file not found: %s\n", path.c_str());
        request->send(404, "text/plain", "Audio file not found");
    });
    
    // Serve audio files from SD /sounds/ directory (legacy/fallback - PiperTTS)
    server.on("/sounds/*", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String path = request->url();
        DEBUG("Audio request (legacy): %s\n", path.c_str());
        
#ifdef HAS_SD_CARD_SUPPORT
        if (storage->isSDAvailable() && SD.exists(path)) {
            DEBUG("Serving from SD: %s\n", path.c_str());
            request->send(SD, path, "audio/mpeg");
            return;
        }
#endif
        if (LittleFS.exists(path)) {
            DEBUG("Serving from LittleFS: %s\n", path.c_str());
            request->send(LittleFS, path, "audio/mpeg");
            return;
        }
        DEBUG("Audio file not found: %s\n", path.c_str());
        request->send(404, "text/plain", "Audio file not found");
    });
    
    // RotorHazard integration status endpoint
    server.on("/api/rh/status", HTTP_GET, [this](AsyncWebServerRequest *request) {
        JsonDocument doc;
        bool en = rhManager && rhManager->isEnabled();
        bool conn = rhManager && rhManager->isConnected();
        bool synced = rhManager && rhManager->isClockSynced();
        uint32_t rttMs = rhManager ? rhManager->getLastSyncRttMs() : 0;
        doc["enabled"]     = en;
        doc["connected"]   = conn;
        doc["clockSynced"] = synced;
        doc["rttMs"]       = rttMs;
        doc["host"]        = conf->getRhHostIP();
        doc["node"]        = conf->getRhNodeIndex();
        String output;
        serializeJson(doc, output);
        request->send(200, "application/json", output);
    });

    // RotorHazard clock sync trigger endpoint
    server.on("/api/rh/syncClock", HTTP_POST, [this, sendCorsResponse](AsyncWebServerRequest *request) {
        if (rhManager) {
            rhManager->requestSync();
        }
        sendCorsResponse(request, "{\"status\":\"queued\"}");
    });

    // WiFi status endpoint (register before serveStatic to prevent VFS errors)
    server.on("/api/wifi", HTTP_GET, [this](AsyncWebServerRequest *request) {
        JsonDocument doc;
        
        // Get WiFi mode
        wifi_mode_t mode = WiFi.getMode();
        if (mode == WIFI_AP) {
            doc["mode"] = "AP";
            doc["ssid"] = WiFi.softAPSSID();
            doc["ip"] = WiFi.softAPIP().toString();
            doc["clients"] = WiFi.softAPgetStationNum();
            doc["rssi"] = 0;
        } else if (mode == WIFI_STA) {
            doc["mode"] = "STA";
            doc["ssid"] = WiFi.SSID();
            doc["ip"] = WiFi.localIP().toString();
            doc["clients"] = 0;
            doc["rssi"] = WiFi.RSSI();
            doc["connected"] = WiFi.status() == WL_CONNECTED;
        } else {
            doc["mode"] = "OFF";
            doc["ssid"] = "";
            doc["ip"] = "";
            doc["clients"] = 0;
            doc["rssi"] = 0;
            doc["connected"] = false;
        }
        
        String output;
        serializeJson(doc, output);
        request->send(200, "application/json", output);
        led->on(200);
    });
    
    // Serve other static files from LittleFS only
    server.serveStatic("/", LittleFS, "/").setCacheControl("max-age=600");

    events.onConnect([this](AsyncEventSourceClient *client) {
        if (client->lastId()) {
            DEBUG("Client reconnected! Last message ID that it got is: %u\n", client->lastId());
        }
        client->send("start", NULL, millis(), 1000);
        led->on(200);
    });

    // CORS headers set at start of startServices()

    server.onNotFound(handleNotFound);

    server.addHandler(&events);
    server.addHandler(configJsonHandler);

    // Race history endpoints
    server.on("/races", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String json = history->toJsonString();
        request->send(200, "application/json", json);
        led->on(200);
    });

    server.on("/races/download", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String json = history->toJsonString();
        AsyncWebServerResponse *response = request->beginResponse(200, "application/octet-stream", json);
        response->addHeader("Content-Disposition", "attachment; filename=\"races.json\"");
        response->addHeader("Content-Type", "application/json");
        request->send(response);
        led->on(200);
    });

    AsyncCallbackJsonWebHandler *raceSaveHandler = new AsyncCallbackJsonWebHandler("/races/save", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        
        RaceSession race;
        race.timestamp = jsonObj["timestamp"];
        race.fastestLap = jsonObj["fastestLap"];
        race.medianLap = jsonObj["medianLap"];
        race.best3LapsTotal = jsonObj["best3LapsTotal"];
        race.pilotName = jsonObj["pilotName"] | "";
        race.pilotCallsign = jsonObj["pilotCallsign"] | "";
        race.frequency = jsonObj["frequency"] | 0;
        race.band = jsonObj["band"] | "";
        race.channel = jsonObj["channel"] | 0;
        
        DEBUG("Parsing race save: trackId=%u\n", (uint32_t)(jsonObj["trackId"] | 0));
        race.trackId = jsonObj["trackId"] | 0;
        race.trackName = jsonObj["trackName"] | "";
        DEBUG("Parsing totalDistance...\n");
        race.totalDistance = jsonObj["totalDistance"] | 0.0;
        DEBUG("Parsed totalDistance=%.2f\n", race.totalDistance);
        
        // Sync mode
        race.syncMode = jsonObj["syncMode"] | 0;
        
        JsonArray lapsArray = jsonObj["lapTimes"];
        for (uint32_t lap : lapsArray) {
            race.lapTimes.push_back(lap);
        }
        
        // Parse pilots array if present (multi-pilot races)
        if (!jsonObj["pilots"].isNull()) {
            JsonArray pilotsArray = jsonObj["pilots"];
            for (JsonObject pilotObj : pilotsArray) {
                PilotData pilot;
                pilot.name = pilotObj["name"] | "";
                pilot.callsign = pilotObj["callsign"] | "";
                pilot.color = pilotObj["color"] | 0x0080FF;
                pilot.fastestLap = pilotObj["fastestLap"] | 0;
                pilot.isLocal = pilotObj["isLocal"] | false;
                JsonArray pilotLaps = pilotObj["lapTimes"];
                for (uint32_t lap : pilotLaps) {
                    pilot.lapTimes.push_back(lap);
                }
                race.pilots.push_back(pilot);
            }
            DEBUG("Parsed %d pilots\n", race.pilots.size());
        }
        
        bool success = history->saveRace(race);
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    AsyncCallbackJsonWebHandler *raceUploadHandler = new AsyncCallbackJsonWebHandler("/races/upload", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        String jsonString;
        serializeJson(json, jsonString);
        bool success = history->fromJsonString(jsonString);
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    server.on("/races/delete", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("timestamp", true)) {
            uint32_t timestamp = request->getParam("timestamp", true)->value().toInt();
            bool success = history->deleteRace(timestamp);
            request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing timestamp\"}");
        }
        led->on(200);
    });

    server.on("/races/clear", HTTP_POST, [this](AsyncWebServerRequest *request) {
        bool success = history->clearAll();
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    server.on("/races/update", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("timestamp", true) && 
            request->hasParam("name", true) && 
            request->hasParam("tag", true)) {
            uint32_t timestamp = request->getParam("timestamp", true)->value().toInt();
            String name = request->getParam("name", true)->value();
            String tag = request->getParam("tag", true)->value();
            float totalDistance = -1.0f;
            if (request->hasParam("totalDistance", true)) {
                totalDistance = request->getParam("totalDistance", true)->value().toFloat();
            }
            bool success = history->updateRace(timestamp, name, tag, totalDistance);
            request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing parameters\"}");
        }
        led->on(200);
    });

    AsyncCallbackJsonWebHandler *updateLapsHandler = new AsyncCallbackJsonWebHandler("/races/updateLaps", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        
        if (!!jsonObj["timestamp"].isNull() || !!jsonObj["lapTimes"].isNull()) {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing parameters\"}");
            return;
        }
        
        uint32_t timestamp = jsonObj["timestamp"];
        JsonArray lapsArray = jsonObj["lapTimes"];
        
        std::vector<uint32_t> lapTimes;
        for (JsonVariant lap : lapsArray) {
            lapTimes.push_back(lap.as<uint32_t>());
        }
        
        bool success = history->updateLaps(timestamp, lapTimes);
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    server.on("/races/downloadOne", HTTP_GET, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("timestamp")) {
            uint32_t timestamp = request->getParam("timestamp")->value().toInt();
            
            // Find the race
            const auto& races = history->getRaces();
            for (const auto& race : races) {
                if (race.timestamp == timestamp) {
                    // Create JSON for single race
                    JsonDocument doc;  // Increased for multi-pilot
                    JsonArray racesArray = doc["races"].to<JsonArray>();
                    JsonObject raceObj = racesArray.add<JsonObject>();
                    raceObj["timestamp"] = race.timestamp;
                    raceObj["fastestLap"] = race.fastestLap;
                    raceObj["medianLap"] = race.medianLap;
                    raceObj["best3LapsTotal"] = race.best3LapsTotal;
                    raceObj["name"] = race.name;
                    raceObj["tag"] = race.tag;
                    raceObj["pilotName"] = race.pilotName;
                    raceObj["pilotCallsign"] = race.pilotCallsign;
                    raceObj["frequency"] = race.frequency;
                    raceObj["band"] = race.band;
                    raceObj["channel"] = race.channel;
                    raceObj["syncMode"] = race.syncMode;
                    JsonArray lapsArray = raceObj["lapTimes"].to<JsonArray>();
                    for (uint32_t lap : race.lapTimes) {
                        lapsArray.add(lap);
                    }
                    
                    // Include pilots if present
                    if (!race.pilots.empty()) {
                        JsonArray pilotsArray = raceObj["pilots"].to<JsonArray>();
                        for (const auto& pilot : race.pilots) {
                            JsonObject pilotObj = pilotsArray.add<JsonObject>();
                            pilotObj["name"] = pilot.name;
                            pilotObj["callsign"] = pilot.callsign;
                            pilotObj["color"] = pilot.color;
                            pilotObj["fastestLap"] = pilot.fastestLap;
                            pilotObj["isLocal"] = pilot.isLocal;
                            JsonArray pilotLaps = pilotObj["lapTimes"].to<JsonArray>();
                            for (uint32_t lap : pilot.lapTimes) {
                                pilotLaps.add(lap);
                            }
                        }
                    }
                    
                    String json;
                    serializeJson(doc, json);
                    
                    String filename = "race_" + String(timestamp) + ".json";
                    AsyncWebServerResponse *response = request->beginResponse(200, "application/octet-stream", json);
                    response->addHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
                    response->addHeader("Content-Type", "application/json");
                    request->send(response);
                    led->on(200);
                    return;
                }
            }
            request->send(404, "application/json", "{\"status\": \"ERROR\", \"message\": \"Race not found\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing timestamp\"}");
        }
        led->on(200);
    });

    server.addHandler(raceSaveHandler);
    server.addHandler(raceUploadHandler);
    server.addHandler(updateLapsHandler);

    // Track endpoints
    server.on("/tracks", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String json = trackManager->toJsonString();
        request->send(200, "application/json", json);
        led->on(200);
    });

    AsyncCallbackJsonWebHandler *trackCreateHandler = new AsyncCallbackJsonWebHandler("/tracks/create", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        
        Track track;
        track.trackId = jsonObj["trackId"];
        track.name = jsonObj["name"] | "";
        track.tags = jsonObj["tags"] | "";
        track.distance = jsonObj["distance"] | 0.0f;
        track.notes = jsonObj["notes"] | "";
        track.imagePath = "";
        
        bool success = trackManager->createTrack(track);
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    AsyncCallbackJsonWebHandler *trackUpdateHandler = new AsyncCallbackJsonWebHandler("/tracks/update", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        JsonObject jsonObj = json.as<JsonObject>();
        
        if (!!jsonObj["trackId"].isNull()) {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing trackId\"}");
            return;
        }
        
        uint32_t trackId = jsonObj["trackId"];
        Track updatedTrack;
        updatedTrack.trackId = trackId;
        updatedTrack.name = jsonObj["name"] | "";
        updatedTrack.tags = jsonObj["tags"] | "";
        updatedTrack.distance = jsonObj["distance"] | 0.0f;
        updatedTrack.notes = jsonObj["notes"] | "";
        
        bool success = trackManager->updateTrack(trackId, updatedTrack);
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    server.on("/tracks/delete", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("trackId", true)) {
            uint32_t trackId = request->getParam("trackId", true)->value().toInt();
            bool success = trackManager->deleteTrack(trackId);
            
            // If deleted track was selected, deselect it
            if (success && conf->getSelectedTrackId() == trackId) {
                conf->setSelectedTrackId(0);
                timer->setTrack(nullptr);
            }
            
            request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing trackId\"}");
        }
        led->on(200);
    });

    server.on("/tracks/select", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("trackId", true)) {
            uint32_t trackId = request->getParam("trackId", true)->value().toInt();
            
            if (trackId == 0) {
                // Deselect track
                conf->setSelectedTrackId(0);
                timer->setTrack(nullptr);
                request->send(200, "application/json", "{\"status\": \"OK\"}");
            } else {
                Track* track = trackManager->getTrackById(trackId);
                if (track) {
                    conf->setSelectedTrackId(trackId);
                    timer->setTrack(track);
                    request->send(200, "application/json", "{\"status\": \"OK\"}");
                } else {
                    request->send(404, "application/json", "{\"status\": \"ERROR\", \"message\": \"Track not found\"}");
                }
            }
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing trackId\"}");
        }
        led->on(200);
    });

    server.on("/tracks/clear", HTTP_POST, [this](AsyncWebServerRequest *request) {
        bool success = trackManager->clearAll();
        
        // Clear selected track if any
        if (success && conf->getSelectedTrackId() != 0) {
            conf->setSelectedTrackId(0);
            timer->setTrack(nullptr);
        }
        
        request->send(200, "application/json", success ? "{\"status\": \"OK\"}" : "{\"status\": \"ERROR\"}");
        led->on(200);
    });

    server.on("/timer/distance", HTTP_GET, [this](AsyncWebServerRequest *request) {
        JsonDocument doc;
        doc["totalDistance"] = timer->getTotalDistance();
        doc["distanceRemaining"] = timer->getDistanceRemaining();
        
        Track* selectedTrack = timer->getSelectedTrack();
        if (selectedTrack) {
            doc["trackId"] = selectedTrack->trackId;
            doc["trackName"] = selectedTrack->name;
            doc["trackDistance"] = selectedTrack->distance;
        } else {
            doc["trackId"] = 0;
            doc["trackName"] = "";
            doc["trackDistance"] = 0.0f;
        }
        
        String json;
        serializeJson(doc, json);
        request->send(200, "application/json", json);
    });

    server.addHandler(trackCreateHandler);
    server.addHandler(trackUpdateHandler);

    // Self-test endpoint
    server.on("/api/selftest", HTTP_GET, [this](AsyncWebServerRequest *request) {
        selftest->runAllTests();
        String json = selftest->getResultsJSON();
        request->send(200, "application/json", json);
        led->on(200);
    });
    
    // Debug log endpoint for serial monitor
    server.on("/api/debuglog", HTTP_GET, [this](AsyncWebServerRequest *request) {
        const auto& buffer = DebugLogger::getInstance().getBuffer();
        JsonDocument doc;
        JsonArray logs = doc["logs"].to<JsonArray>();
        
        for (const auto& entry : buffer) {
            JsonObject log = logs.add<JsonObject>();
            log["timestamp"] = entry.timestamp;
            log["message"] = entry.message;
        }
        
        String json;
        serializeJson(doc, json);
        request->send(200, "application/json", json);
        led->on(200);
    });
    
    // Reboot endpoint
    server.on("/reboot", HTTP_POST, [this](AsyncWebServerRequest *request) {
        request->send(200, "application/json", "{\"status\": \"OK\", \"message\": \"Rebooting...\"}");
        led->on(200);
        // Restart immediately without delay to avoid blocking async_tcp task
        ESP.restart();
    });

    // SD card initialization endpoint
    server.on("/storage/initsd", HTTP_POST, [this](AsyncWebServerRequest *request) {
        bool success = storage->initSDDeferred();
        String json = success ? "{\"status\":\"OK\",\"message\":\"SD card initialized\"}" : 
                               "{\"status\":\"ERROR\",\"message\":\"SD card init failed\"}";
        request->send(success ? 200 : 500, "application/json", json);
        led->on(200);
    });
    
    // SD card test endpoint - list files
    server.on("/storage/sdtest", HTTP_GET, [this](AsyncWebServerRequest *request) {
#ifdef HAS_SD_CARD_SUPPORT
        String response = "SD Card Test:\n\n";
        response += "Available: " + String(storage->isSDAvailable() ? "YES" : "NO") + "\n";
        response += "Storage Type: " + storage->getStorageType() + "\n";
        
        if (storage->isSDAvailable()) {
            response += "\nRoot directories:\n";
            File root = SD.open("/");
            if (root) {
                File entry = root.openNextFile();
                while (entry) {
                    if (entry.isDirectory()) {
                        response += "  [DIR] " + String(entry.name()) + "\n";
                        
                        // List first 5 files in sounds_* directories
                        String entryName = String(entry.name());
                        if (entryName.startsWith("/sounds_")) {
                            File subdir = SD.open(entry.name());
                            if (subdir) {
                                int count = 0;
                                File file = subdir.openNextFile();
                                while (file && count < 5) {
                                    response += "    - " + String(file.name()) + " (" + String(file.size()) + " bytes)\n";
                                    file = subdir.openNextFile();
                                    count++;
                                }
                                if (count == 5) response += "    ... (more files)\n";
                                subdir.close();
                            }
                        }
                    } else {
                        response += "  [FILE] " + String(entry.name()) + " (" + String(entry.size()) + " bytes)\n";
                    }
                    entry = root.openNextFile();
                }
                root.close();
            } else {
                response += "ERROR: Could not open root directory\n";
            }
            
            // Test specific file
            response += "\nTest file access:\n";
            const char* testFile = "/sounds_adam/gate_1.mp3";
            response += "  " + String(testFile) + ": ";
            if (SD.exists(testFile)) {
                File f = SD.open(testFile);
                if (f) {
                    response += "EXISTS, size=" + String(f.size()) + " bytes\n";
                    f.close();
                } else {
                    response += "EXISTS but CANNOT OPEN\n";
                }
            } else {
                response += "NOT FOUND\n";
            }
        } else {
            response += "\nSD card not available!\n";
        }
        
        request->send(200, "text/plain", response);
#else
        request->send(200, "text/plain", "SD card not supported on this platform");
#endif
        led->on(200);
    });

    // Beep volume control endpoint
    server.on("/buzzer/volume", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("volume", true)) {
            uint8_t volume = request->getParam("volume", true)->value().toInt();
            if (volume > 100) volume = 100;
            buz->setVolume(volume);
            conf->setBeepVolume(volume);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing volume\"}");
        }
        led->on(200);
    });

#ifdef HAS_RGB_LED
    // LED control endpoints
    server.on("/led/color", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("color", true)) {
            String colorStr = request->getParam("color", true)->value();
            uint32_t color = strtol(colorStr.c_str(), NULL, 16);
            if (g_rgbLed) {
                g_rgbLed->setManualColor(color);
            }
            conf->setLedColor(color);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing color\"}");
        }
        led->on(200);
    });

    server.on("/led/mode", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("mode", true)) {
            uint8_t mode = request->getParam("mode", true)->value().toInt();
            if (g_rgbLed) {
                if (mode == 0) {
                    g_rgbLed->off();
                } else if (mode == 1) {
                    g_rgbLed->setManualMode(RGB_SOLID);
                } else if (mode == 2) {
                    g_rgbLed->setManualMode(RGB_PULSE);
                } else if (mode == 3) {
                    g_rgbLed->setRainbowWave();
                }
            }
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing mode\"}");
        }
        led->on(200);
    });

    server.on("/led/brightness", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("brightness", true)) {
            uint8_t brightness = request->getParam("brightness", true)->value().toInt();
            if (g_rgbLed) {
                g_rgbLed->setBrightness(brightness);
            }
            conf->setLedBrightness(brightness);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing brightness\"}");
        }
        led->on(200);
    });

    server.on("/led/preset", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("preset", true)) {
            uint8_t preset = request->getParam("preset", true)->value().toInt();
            if (g_rgbLed) {
                g_rgbLed->setPreset((led_preset_e)preset);
            }
            conf->setLedPreset(preset);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing preset\"}");
        }
        led->on(200);
    });

    server.on("/led/override", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("enable", true)) {
            bool enable = request->getParam("enable", true)->value() == "1";
            if (g_rgbLed) {
                g_rgbLed->enableManualOverride(enable);
            }
            conf->setLedManualOverride(enable ? 1 : 0);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing enable\"}");
        }
        led->on(200);
    });

    server.on("/led/error", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("code", true)) {
            uint8_t code = request->getParam("code", true)->value().toInt();
            if (g_rgbLed) {
                g_rgbLed->showErrorCode(code);
            }
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing code\"}");
        }
        led->on(200);
    });

    server.on("/led/speed", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("speed", true)) {
            uint8_t speed = request->getParam("speed", true)->value().toInt();
            if (g_rgbLed) {
                g_rgbLed->setEffectSpeed(speed);
            }
            conf->setLedSpeed(speed);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing speed\"}");
        }
        led->on(200);
    });

    server.on("/led/fadecolor", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("color", true)) {
            String colorStr = request->getParam("color", true)->value();
            uint32_t color = strtol(colorStr.c_str(), NULL, 16);
            if (g_rgbLed) {
                g_rgbLed->setFadeColor(color);
            }
            conf->setLedFadeColor(color);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing color\"}");
        }
        led->on(200);
    });

    server.on("/led/strobecolor", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("color", true)) {
            String colorStr = request->getParam("color", true)->value();
            uint32_t color = strtol(colorStr.c_str(), NULL, 16);
            if (g_rgbLed) {
                g_rgbLed->setStrobeColor(color);
            }
            conf->setLedStrobeColor(color);
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing color\"}");
        }
        led->on(200);
    });

    // Race color endpoint - sets solid color for race duration, auto-restores on race stop
    server.on("/led/racecolor", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("color", true)) {
            String colorStr = request->getParam("color", true)->value();
            uint32_t color = strtol(colorStr.c_str(), NULL, 16);
            if (g_rgbLed) {
                g_rgbLed->setRaceColor(color);
            }
            // Forward to external LED controllers via webhook
            if (webhooks && conf->getGateLEDsEnabled()) {
                webhooks->triggerRaceColor(color);
            }
            request->send(200, "application/json", "{\"status\": \"OK\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing color\"}");
        }
        led->on(200);
    });

    // LED debug status endpoint
    server.on("/led/debug", HTTP_GET, [this](AsyncWebServerRequest *request) {
        char buf[256];
        if (g_rgbLed) {
            snprintf(buf, sizeof(buf),
                "{\"preset\":%d,\"mode\":%d,\"override\":%s,\"color\":\"#%06X\"}",
                (int)conf->getLedPreset(),
                (int)g_rgbLed->getCurrentMode(),
                g_rgbLed->isManualOverride() ? "true" : "false",
                (unsigned int)((g_rgbLed->getCurrentColor().r << 16) | (g_rgbLed->getCurrentColor().g << 8) | g_rgbLed->getCurrentColor().b)
            );
        } else {
            snprintf(buf, sizeof(buf), "{\"error\":\"RGB LED not available\"}");
        }
        request->send(200, "application/json", buf);
    });
#endif

    // Calibration wizard endpoints
    server.on("/calibration/start", HTTP_POST, [this](AsyncWebServerRequest *request) {
        timer->startCalibrationWizard();
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200);
    });

    server.on("/calibration/stop", HTTP_POST, [this](AsyncWebServerRequest *request) {
        timer->stopCalibrationWizard();
        request->send(200, "application/json", "{\"status\": \"OK\"}");
        led->on(200);
    });

    server.on("/calibration/data", HTTP_GET, [this](AsyncWebServerRequest *request) {
        uint16_t count = timer->getCalibrationRssiCount();
        
        // Build JSON response
        String json = "{\"count\":" + String(count) + ",\"data\":[";
        for (uint16_t i = 0; i < count; i++) {
            if (i > 0) json += ",";
            json += "{\"rssi\":" + String(timer->getCalibrationRssi(i)) + ",\"time\":" + String(timer->getCalibrationTimestamp(i)) + "}";
        }
        json += "]}";
        
        request->send(200, "application/json", json);
        led->on(200);
    });

    // Self-test endpoint
    server.on("/api/selftest", HTTP_GET, [this](AsyncWebServerRequest *request) {
        // Run RX5808 test
        TestResult rxTest = selftest->testRX5808(rx);
        
        // Run Lap Timer test
        TestResult timerTest = selftest->testLapTimer(timer);
        
        // Run Audio test
        TestResult audioTest = selftest->testAudio(buz);
        
        // Run Config test
        TestResult configTest = selftest->testConfig(conf);
        
        // Run Race History test
        TestResult historyTest = selftest->testRaceHistory(history);
        
        // Run Web Server test
        TestResult webTest = selftest->testWebServer();
        
        // Run OTA test
        TestResult otaTest = selftest->testOTA();
        
        // Run Storage test
        TestResult storageTest = selftest->testStorage();
        
        // Run LittleFS test
        TestResult littleFSTest = selftest->testLittleFS();
        
        // Run EEPROM test
        TestResult eepromTest = selftest->testEEPROM();
        
        // Run WiFi test
        TestResult wifiTest = selftest->testWiFi();
        
        // Run Battery test
        TestResult batteryTest = selftest->testBattery();
        
        // Run Track Manager test
        TestResult trackTest = selftest->testTrackManager();
        
        // Run Webhooks test
        TestResult webhookTest = selftest->testWebhooks();
        
        // Run Transport test
        TestResult transportTest = selftest->testTransport();
        
#ifdef HAS_RGB_LED
        // Run RGB LED test
        TestResult ledTest = selftest->testRGBLED(g_rgbLed);
#endif
        
#ifdef HAS_SD_CARD_SUPPORT
        // Run SD Card test
        TestResult sdTest = selftest->testSDCard();
#endif
        
        // Build JSON response
        String json = "{\"tests\":[";
        
        auto addTest = [&json](const TestResult& test, bool first = false) {
            if (!first) json += ",";
            json += "{\"name\":\"" + test.name + "\",\"passed\":" + String(test.passed ? "true" : "false") + 
                   ",\"details\":\"" + test.details + "\",\"duration\":" + String(test.duration_ms) + "}";
        };
        
        addTest(rxTest, true);
        addTest(timerTest);
        addTest(audioTest);
        addTest(configTest);
        addTest(historyTest);
        addTest(webTest);
        addTest(otaTest);
        addTest(storageTest);
        addTest(littleFSTest);
        addTest(eepromTest);
        addTest(wifiTest);
        addTest(batteryTest);
        addTest(trackTest);
        addTest(webhookTest);
        addTest(transportTest);
#ifdef HAS_RGB_LED
        addTest(ledTest);
#endif
#ifdef HAS_SD_CARD_SUPPORT
        addTest(sdTest);
#endif
        
        json += "]}";
        
        request->send(200, "application/json", json);
        led->on(200);
    });

    // SPI mod test endpoint
    server.on("/api/spitest", HTTP_GET, [this](AsyncWebServerRequest *request) {
        if (!rx) {
            request->send(500, "application/json", "{\"error\":\"RX5808 not initialized\"}");
            return;
        }

        static const uint16_t testFreqs[] = {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917};
        static const char* chanLabels[] = {"R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"};
        static const uint8_t numFreqs = 8;
        static const uint8_t samplesPerFreq = 10;
        static const uint8_t settleMs = 50;

        uint8_t rssiValues[numFreqs];
        uint8_t maxRssi = 0;
        uint8_t minRssi = 255;

        for (uint8_t i = 0; i < numFreqs; i++) {
            rx->setFrequency(testFreqs[i]);
            delay(settleMs);
            rx->handleFrequencyChange(millis(), testFreqs[i]);

            uint16_t sum = 0;
            for (uint8_t s = 0; s < samplesPerFreq; s++) {
                sum += rx->readRssi();
                delay(2);
            }
            rssiValues[i] = sum / samplesPerFreq;
            if (rssiValues[i] > maxRssi) maxRssi = rssiValues[i];
            if (rssiValues[i] < minRssi) minRssi = rssiValues[i];
        }

        // Restore configured frequency
        rx->setFrequency(conf->getFrequency());
        delay(settleMs);
        rx->handleFrequencyChange(millis(), conf->getFrequency());

        uint8_t spread = maxRssi - minRssi;
        bool passed = (spread >= 10);

        String json = "{\"passed\":" + String(passed ? "true" : "false") +
                     ",\"spread\":" + String(spread) +
                     ",\"min\":" + String(minRssi) +
                     ",\"max\":" + String(maxRssi) +
                     ",\"channels\":[";
        for (uint8_t i = 0; i < numFreqs; i++) {
            if (i > 0) json += ",";
            json += "{\"label\":\"" + String(chanLabels[i]) +
                   "\",\"freq\":" + String(testFreqs[i]) +
                   ",\"rssi\":" + String(rssiValues[i]) + "}";
        }
        json += "]}";

        request->send(200, "application/json", json);
        led->on(200);
    });

    // Webhook management endpoints
    server.on("/webhooks", HTTP_GET, [this](AsyncWebServerRequest *request) {
        String json = "{\"enabled\":" + String(webhooks ? (webhooks->isEnabled() ? "true" : "false") : "false") + ",\"webhooks\":[";
        if (webhooks) {
            uint8_t count = webhooks->getWebhookCount();
            for (uint8_t i = 0; i < count; i++) {
                if (i > 0) json += ",";
                json += "\"" + String(webhooks->getWebhookIP(i)) + "\"";
            }
        }
        json += "]}";
        request->send(200, "application/json", json);
        led->on(200);
    });

    server.on("/webhooks/add", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("ip", true)) {
            String ip = request->getParam("ip", true)->value();
            if (webhooks && webhooks->addWebhook(ip.c_str())) {
                conf->addWebhookIP(ip.c_str());
                request->send(200, "application/json", "{\"status\": \"OK\", \"message\": \"Webhook added\"}");
            } else {
                request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Failed to add webhook\"}");
            }
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing ip\"}");
        }
        led->on(200);
    });

    server.on("/webhooks/remove", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("ip", true)) {
            String ip = request->getParam("ip", true)->value();
            if (webhooks && webhooks->removeWebhook(ip.c_str())) {
                conf->removeWebhookIP(ip.c_str());
                request->send(200, "application/json", "{\"status\": \"OK\", \"message\": \"Webhook removed\"}");
            } else {
                request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Webhook not found\"}");
            }
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing ip\"}");
        }
        led->on(200);
    });

    server.on("/webhooks/clear", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (webhooks) {
            webhooks->clearWebhooks();
            conf->clearWebhookIPs();
            request->send(200, "application/json", "{\"status\": \"OK\", \"message\": \"All webhooks cleared\"}");
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Webhooks not initialized\"}");
        }
        led->on(200);
    });

    server.on("/webhooks/enable", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (request->hasParam("enabled", true)) {
            bool enabled = request->getParam("enabled", true)->value() == "1";
            if (webhooks) {
                webhooks->setEnabled(enabled);
                conf->setWebhooksEnabled(enabled ? 1 : 0);
                request->send(200, "application/json", "{\"status\": \"OK\", \"message\": \"Webhooks " + String(enabled ? "enabled" : "disabled") + "\"}");
            } else {
                request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Webhooks not initialized\"}");
            }
        } else {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Missing enabled\"}");
        }
        led->on(200);
    });

    // Proxy endpoint: forward JSON to individual or all gate LED controllers
    AsyncCallbackJsonWebHandler *webhookSendHandler = new AsyncCallbackJsonWebHandler("/webhooks/send", [this](AsyncWebServerRequest *request, JsonVariant &json) {
        if (!webhooks) {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Webhooks not initialized\"}");
            return;
        }
        
        JsonObject jsonObj = json.as<JsonObject>();
        String targetIP = jsonObj["ip"] | "all";
        
        // Build the payload to forward (everything except the "ip" field)
        JsonDocument fwdDoc;
        if (!jsonObj["effect"].isNull()) fwdDoc["effect"] = jsonObj["effect"];
        if (!jsonObj["brightness"].isNull()) fwdDoc["brightness"] = jsonObj["brightness"];
        if (!jsonObj["speed"].isNull()) fwdDoc["speed"] = jsonObj["speed"];
        if (!jsonObj["color"].isNull()) {
            JsonArray srcColor = jsonObj["color"];
            JsonArray dstColor = fwdDoc["color"].to<JsonArray>();
            for (JsonVariant v : srcColor) dstColor.add(v);
        }
        
        String payload;
        serializeJson(fwdDoc, payload);
        
        uint8_t sent = 0;
        uint8_t failed = 0;
        
        if (targetIP == "all") {
            uint8_t count = webhooks->getWebhookCount();
            for (uint8_t i = 0; i < count; i++) {
                if (webhooks->sendDirectJSON(webhooks->getWebhookIP(i), payload.c_str())) {
                    sent++;
                } else {
                    failed++;
                }
            }
        } else {
            if (webhooks->sendDirectJSON(targetIP.c_str(), payload.c_str())) {
                sent = 1;
            } else {
                failed = 1;
            }
        }
        
        char buf[128];
        snprintf(buf, sizeof(buf), "{\"status\": \"OK\", \"sent\": %d, \"failed\": %d}", sent, failed);
        request->send(200, "application/json", buf);
        led->on(200);
    });
    server.addHandler(webhookSendHandler);

    // Manual webhook triggers (for testing)
    server.on("/webhooks/trigger/flash", HTTP_POST, [this](AsyncWebServerRequest *request) {
        if (!webhooks) {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Webhooks not initialized\"}");
            return;
        }
        
        if (!webhooks->isEnabled()) {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"Webhooks are disabled\"}");
            return;
        }
        
        uint8_t hookCount = webhooks->getWebhookCount();
        if (hookCount == 0) {
            request->send(400, "application/json", "{\"status\": \"ERROR\", \"message\": \"No webhooks configured\"}");
            return;
        }
        
        DEBUG("Triggering flash webhook to %d endpoints\n", hookCount);
        
        // Send response before triggering webhooks to avoid blocking
        request->send(200, "application/json", "{\"status\": \"OK\", \"message\": \"Flash triggered\"}");
        led->on(200);
        
        // Trigger webhooks after response sent
        webhooks->triggerFlash();
    });

    ElegantOTA.setAutoReboot(true);
    ElegantOTA.begin(&server);

    server.begin();

    dnsServer.start(DNS_PORT, "*", ipAddress);
    dnsServer.setErrorReplyCode(DNSReplyCode::NoError);

    startMDNS();
    servicesStarted = true;
}
