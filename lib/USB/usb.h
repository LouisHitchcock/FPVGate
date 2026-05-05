#ifndef USB_H
#define USB_H

/**
 * USB Serial CDC Transport Implementation
 * 
 * Provides USB connectivity for FPVGate, allowing direct serial connection
 * without WiFi. Implements the TransportInterface for seamless integration
 * with the existing web server event system.
 * 
 * Features:
 * - JSON-based command protocol over Serial CDC
 * - Bidirectional communication (commands + events)
 * - Real-time lap timing, RSSI streaming, and race control
 * - LED control commands for all RGB presets
 * - Automatic client detection and connection management
 * 
 * Protocol:
 * Commands are sent as JSON objects, one per line:
 * {"method":"POST","path":"timer/start","data":{}}
 * 
 * Events are sent as JSON objects prefixed with "EVENT:":
 * EVENT:{"type":"lap","data":12345}
 */

#include <Arduino.h>
#include "transport.h"
#include "config.h"
#include "rgbled.h"
#include "laptimer.h"
#include "battery.h"
#include "buzzer.h"
#include "led.h"
#include "racehistory.h"
#include "storage.h"
#include "selftest.h"
#include "RX5808.h"
#include "trackmanager.h"

#ifdef ESP32S3
#include "rgbled.h"
#endif

// USB Serial transport using native ESP32-S3 USB CDC
class USBTransport : public TransportInterface {
   public:
    void init(Config *config, LapTimer *lapTimer, BatteryMonitor *batMonitor, Buzzer *buzzer, 
              Led *led, RaceHistory *raceHist, Storage *stor, SelfTest *test, RX5808 *rx5808, TrackManager *trackMgr);
    
    // TransportInterface implementation
    void sendLapEvent(uint32_t lapTimeMs) override;
    void sendRssiEvent(uint8_t rssi) override;
    void sendRaceStateEvent(const char* state) override;
    void sendSlaveLapEvent(uint32_t lapTimeMs, const char* pilotName, const char* pilotPhonetic, uint32_t pilotColor, const char* slaveHostname) override;
    bool isConnected() override;
    void update(uint32_t currentTimeMs) override;
    
    // Enable/disable RSSI streaming
    void enableRssiStreaming(bool enable);

   private:
    void writeJsonLine(const JsonDocument& doc);
    void processCommand(const char* cmdLine);
    void sendResponse(uint32_t id, const char* status);
    void sendResponse(uint32_t id, const char* status, const char* message);
    void sendSessionOpenResponse(uint32_t id);
    void sendConfigResponse(uint32_t id);
    void sendStatusResponse(uint32_t id);
    void sendConfigUpdatedEvent();
    void sendVersionResponse(uint32_t id);
    void resetSessionState();
    
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
    
    bool rssiStreamingEnabled;
    bool sessionActive;
    uint32_t lastRssiSentMs;
    static const uint32_t RSSI_SEND_INTERVAL_MS = 200;
    
    // Command buffer
    static const size_t CMD_BUFFER_SIZE = 512;
    char cmdBuffer[CMD_BUFFER_SIZE];
    size_t cmdBufferPos;
};

#endif  // USB_H
