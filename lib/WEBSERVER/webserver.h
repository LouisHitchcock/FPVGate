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

#define WIFI_CONNECTION_TIMEOUT_MS 30000
#define WIFI_RECONNECT_TIMEOUT_MS 500
#define WEB_RSSI_SEND_TIMEOUT_MS 200
#define WEB_SSE_KEEPALIVE_MS 15000

class Webserver : public TransportInterface {
   public:
    void init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l, RaceHistory *raceHist, Storage *stor, SelfTest *test, RX5808 *rx5808, TrackManager *trackMgr, WebhookManager *webhookMgr, RHManager *rhMgr = nullptr);
    void setTransportManager(TransportManager *tm);
    void recheckWifiMode();  // Re-evaluate WiFi mode after config changes
    /** Disconnect and re-apply AP/STA Wi-Fi mode (public so LCD/UI callers can force a radio reinit). */
    void requestWifiStackReinit();
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
    
    // Public triggers (used by LCD UI to invoke the same logic as HTTP handlers)
    void triggerStart();
    void triggerStop();
    void triggerClearLaps();
    void triggerConfigUpdated();  // Notify web clients that config changed from LCD
    
    // Pending lap/clear for LCD display (poll from main loop)
    bool consumePendingLap(uint32_t& lapMs);
    bool consumePendingClear();

    /** Pending LCD display event: show countdown or finish overlay (set by web timer handlers, consumed by main loop). */
    enum class PendingLcdEvent { None, Countdown, ShowFinish };
    void setPendingLcdEvent(PendingLcdEvent ev);
    PendingLcdEvent consumePendingLcdEvent();

    /** True once WiFi (AP or STA) and web/DNS services are up. Used for boot overlay. */
    bool isServicesStarted() const { return servicesStarted; }

    /** LCD status bar: Wi-Fi icon "active" when services are up or the radio is out of OFF (internal + API). */
    bool isLcdWifiIndicatorOn() const {
        return servicesStarted || wifiMode != WIFI_OFF || WiFi.getMode() != WIFI_OFF;
    }

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
    
    // Pending race state from LCD triggers (set on core 1, consumed on core 0)
    volatile const char* pendingRaceState = nullptr;
    
    // Pending config update SSE notification (set on core 1, consumed on core 0)
    volatile bool pendingConfigUpdate = false;
    
    // Pending lap/clear for LCD (set by HTTP handlers, consumed by main loop)
    volatile uint32_t _pendingLcdLap = 0;
    volatile bool _hasLcdLap = false;
    volatile bool _pendingLcdClear = false;

    // Pending LCD overlay event (set by HTTP timer handlers, consumed by main loop)
    volatile PendingLcdEvent _pendingLcdEvent = PendingLcdEvent::None;
};
