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
#include "c5link.h"
#include "c5multipilot.h"

#define WIFI_CONNECTION_TIMEOUT_MS 30000
#define WIFI_RECONNECT_TIMEOUT_MS 500
#define WEB_C5_SEND_TIMEOUT_MS 100   // ESP32-C5 multi-pilot view, 10 per second
#define WEB_RSSI_SEND_TIMEOUT_MS 200
#define WEB_C5_FAST_SEND_MS 40       // C5 RSSI debug popout, 25 frames a second
#define WEB_SSE_KEEPALIVE_MS 15000
#define RH_LINK_TIMEOUT_MS 15000     // RotorHazard plugin polls the clock every 5 s
#define WEB_RH_RSSI_SEND_MS 50       // RSSI to the RotorHazard plugin, 20 per second
#define EVENT_PATH "/event.json"     // race director event (SD if present, else LittleFS)
#define EVENT_TMP_PATH "/event.tmp"
#define EVENT_MAX_BYTES (512u * 1024u)
#define C5_IMAGE_PATH "/c5fw.bin"          // LittleFS: C5 firmware waiting to be sent
#define C5_IMAGE_TMP_PATH "/c5fw.tmp"
#define C5_IMAGE_MAX_BYTES 0x1E0000u       // one C5 app partition (FPVGateC5MK partitions.csv)

class Webserver : public TransportInterface {
   public:
    void init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, Led *l, RaceHistory *raceHist, Storage *stor, SelfTest *test, RX5808 *rx5808, TrackManager *trackMgr, WebhookManager *webhookMgr);
    void setTransportManager(TransportManager *tm);
    void setC5Receiver(C5Link *link, C5MultiPilot *multiPilot);
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

    // RotorHazard plugin 2: the plugin polls /api/rh/clock. While it has done
    // so recently it owns lap timing, and every pass streams to it as an
    // "rhPass" event (time in esp_timer microseconds).
    bool rhLinked(uint32_t nowMs) const { return rhLinkMs_ && (nowMs - rhLinkMs_) < RH_LINK_TIMEOUT_MS; }
    // RX5808 passes from LapTimer (millis()); C5 passes come from C5MultiPilot.
    void queueRhPass(uint8_t slot, uint32_t crossingMs, uint8_t peak);

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
    TransportManager *transportMgr;
    C5Link *c5Link = nullptr;
    C5MultiPilot *c5MultiPilot = nullptr;

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
    // Set by /api/system/reboot. The restart is deferred to handleWebUpdate so
    // the response is actually delivered before the device goes down; zero
    // means no reboot pending.
    volatile uint32_t _rebootRequestedMs = 0;
    volatile bool _pendingLcdClear = false;

    // Pending LCD overlay event (set by HTTP timer handlers, consumed by main loop)
    volatile PendingLcdEvent _pendingLcdEvent = PendingLcdEvent::None;

    // RotorHazard plugin 2 link (see rhLinked()).
    volatile uint32_t rhLinkMs_ = 0;
    uint32_t rhRssiSentMs_ = 0;
    struct RhPass {
        uint8_t slot;
        int64_t us;
        uint8_t peak;
    };
    static constexpr uint8_t RH_PASS_QUEUE = 8;
    RhPass rhPasses_[RH_PASS_QUEUE] = {};
    uint8_t rhPassCount_ = 0;
    portMUX_TYPE rhPassMux_ = portMUX_INITIALIZER_UNLOCKED;
    // rawPeak: the C5's 0..1023 peak, or -1 for RX5808 passes (no raw scale).
    void sendRhPass(uint8_t slot, int64_t us, uint8_t peak, int rawPeak = -1);
    void sendRhUpdates(uint32_t currentTimeMs);

    // Race director event (/api/event): written to EVENT_TMP_PATH as it
    // arrives, then renamed over EVENT_PATH once complete.
    bool eventUploadOk_ = false;

    // C5 firmware image (/api/c5/firmware), for C5Link::requestUpdate().
    struct C5Image {
        bool ok = false;
        uint32_t size = 0;
        uint8_t sha256[32] = {};
        char version[16] = {};   // "1.0.0"
        char board[12] = {};     // "c5zero"
        char error[48] = {};
    };
    C5Image c5Image_;
    void c5ImageChunk(uint8_t *data, size_t len, size_t index, size_t total);
};
