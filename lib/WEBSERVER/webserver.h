#include <ESPAsyncWebServer.h>
#include <WiFi.h>

#include "battery.h"
#include "laptimer.h"
#include "racehistory.h"
#include "storage.h"
#include "selftest.h"
#include "transport.h"
#include "trackmanager.h"
#include "webhook.h"
#include "rotorhazard.h"
#include "splittime.h"

#define WIFI_CONNECTION_TIMEOUT_MS 30000
#define WIFI_RECONNECT_TIMEOUT_MS 500
#define WEB_RSSI_SEND_TIMEOUT_MS 200
#define WEB_SSE_KEEPALIVE_MS 15000

class Webserver : public TransportInterface {
   public:
    void init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l, RaceHistory *raceHist, Storage *stor, SelfTest *test, RX5808 *rx5808, TrackManager *trackMgr, WebhookManager *webhookMgr, RHManager *rhMgr = nullptr, SplitTimeManager *splitMgr = nullptr);
    void setTransportManager(TransportManager *tm);
    void recheckWifiMode();  // Re-evaluate WiFi mode after config changes
    void handleWebUpdate(uint32_t currentTimeMs);
    
    // TransportInterface implementation
    void sendLapEvent(uint32_t lapTimeMs) override;
    void sendRssiEvent(uint8_t rssi) override;
    void sendRaceStateEvent(const char* state) override;
    void sendSlaveLapEvent(uint32_t lapTimeMs, const char* pilotName, const char* pilotPhonetic, uint32_t pilotColor, const char* slaveHostname) override;
    bool isConnected() override;
    void update(uint32_t currentTimeMs) override;
    
    // Send lap data to master (for slave mode)
    void sendLapToMaster(uint32_t lapTimeMs);
    
    // Send split crossing to master (for split gate mode)
    void sendSplitCrossingToMaster(uint32_t raceElapsedMs);
    
    // Sync clocks with all split gate devices (called from master before race start)
    void syncSplitGateClocks();
    
    // Push gate config (gate number + master address) to all split gate devices
    void pushSplitGateConfigs();

   private:
    void startServices();

    Config *conf;
    LapTimer *timer;
    BatteryMonitor *monitor;
    Buzzer *buz;
    Led *led;
    RaceHistory *history;
    Storage *storage;
    SelfTest *selftest;
    RX5808 *rx;
    TrackManager *trackManager;
    WebhookManager *webhooks;
    RHManager *rhManager;
    SplitTimeManager *splitManager;
    TransportManager *transportMgr;

    wifi_mode_t wifiMode = WIFI_OFF;
    wl_status_t lastStatus = WL_IDLE_STATUS;
    volatile wifi_mode_t changeMode = WIFI_OFF;
    volatile uint32_t changeTimeMs = 0;
    bool servicesStarted = false;
    bool wifiConnected = false;

    bool sendRssi = false;
    uint32_t rssiSentMs = 0;
    uint32_t sseKeepaliveMs = 0;
};
