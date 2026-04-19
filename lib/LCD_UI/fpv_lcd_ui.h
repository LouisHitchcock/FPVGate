#pragma once

#include <lvgl.h>
#include <Arduino.h>
#include <Arduino_GFX_Library.h>
#include "buzzer.h"
#include "CST820.h"

#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
/** Snapshot from ELRS Backpack LCD page; applied on Save (core 1). */
struct ElrsLcdSettingsApply {
    uint8_t backpackEspnow;
    uint8_t osdLapRow;
    uint8_t osdLapCol;
    uint8_t osdClearOnStop;
    uint8_t osdPlaybackLaps;
    char bindPhrase[33];  // NUL-terminated, max 32 chars (matches config / web)
};
#endif

// LCD UI class matching StarForge display implementation
class FpvLcdUI {
public:
    FpvLcdUI();
    ~FpvLcdUI();
    bool begin();

    // FreeRTOS task entry
    static void uiTask(void* parameter);
    
    // Data update methods
    void updateRSSI(uint8_t rssi);
    void addLap(uint32_t lapTimeMs);  // Thread-safe: called from loop() on core 1
    void clearLaps();                  // Thread-safe: called from loop() on core 1
    
    // Button action polling (read from main loop on core 1)
    bool consumeStartRequest();
    bool consumeStopRequest();
    bool consumeClearRequest();
    
    // System/band/channel button polling (read from main loop on core 1)
    int8_t consumeSystemDelta();   // Returns +1, -1, or 0
    int8_t consumeBandDelta();     // Returns +1, -1, or 0
    int8_t consumeChannelDelta();  // Returns +1, -1, or 0
    
    // Threshold button polling (read from main loop on core 1)
    int8_t consumeEnterDelta();    // Returns +5, -5, or 0
    int8_t consumeExitDelta();     // Returns +5, -5, or 0
    
    // Buzzer cue request (read from main loop on core 1)
    BuzzerCue consumeBuzzerCue();  // BUZZER_CUE_NONE if none pending
    
    // Thread-safe display update (called from main loop on core 1)
    void setBandChannelDisplay(uint8_t systemIdx, uint8_t bandIdx, uint8_t channelIdx, uint16_t freqMhz);
    void setThresholdDisplay(uint8_t enterRssi, uint8_t exitRssi);
    void setBatteryDisplay(uint16_t voltage);  // Voltage in tenths of volts (e.g. 42 = 4.2V)
    /** Core 1: WiFi on/off and ELRS backpack on/off for persistent top status bar (LCD task applies). */
    void setStatusBarIndicators(bool wifiEnabled, bool elrsBackpackEnabled);
    
    void updateBandChannel(uint8_t band, uint8_t channel);
    void updateFrequency(uint16_t freq);
    void updateThreshold(uint8_t enter_rssi, uint8_t exit_rssi);
    void updateLapTimes(float* lapTimes, uint8_t lapCount);
    void updateBattery(uint8_t percentage, float voltage);
    void updateStatus(const char* status);
    void updateRaceTime(uint32_t raceTimeMs);     // Update total race time
    void updateCurrentLapTime(uint32_t lapTimeMs); // Update current lap time
    void updateFastestLap(uint32_t lapTimeMs);     // Update fastest lap display
    void updateFastest3Laps(uint32_t totalTimeMs); // Update best 3 consecutive

    /** Call from main (core 1) when SD init and bootstrap are done; dismisses "Booting" overlay. */
    void setBootComplete();

#if defined(WAVESHARE_ESP32S3_LCD2)
    /** QMI8658 for portrait 0°/180° auto-rotate; call after IMU begin() and LCD begin(). */
    void setImu(class Qmi8658* imu);
    /** Core 1: true once when user tapped Sleep in System Settings (same deep sleep as power button). */
    bool consumeDeepSleepRequest();
#endif

#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    /** Core 1: true once after user tapped Save on ELRS Backpack tab. */
    bool consumeElrsLcdSettingsApply(ElrsLcdSettingsApply* out);
    /** Core 0 (UI task): load widgets from config (boot or after apply). */
    void syncElrsLcdSettingsWidgets(uint8_t backpackEspnow, uint8_t osdLapRow, uint8_t osdLapCol,
                                    uint8_t osdClearOnStop, uint8_t osdPlaybackLaps, const char* bindPhrase);
    /** Core 1: call after settings were written to storage (flash + sync). UI task shows brief "Saved!" on Save. */
    void notifyElrsSettingsSaved();
#endif

#if defined(BOARD_ESP32_S3_TOUCH)
    /** ST7789 DISPOFF+SLPIN; CST816D touch sleep. Call before ESP deep sleep (after SD unmount). */
    void prepareHardwareForDeepSleep();
#endif

    /** Request countdown overlay (e.g. from web). Safe to call from any core. triggerStartOnComplete: if false, countdown is visual-only and does not call triggerStart() when done. */
    void requestCountdown(bool triggerStartOnComplete = true);
    /** Request STOPPED overlay (e.g. from web). Safe to call from any core. */
    void requestShowFinish();

private:
    // Display hardware
#if defined(BOARD_ESP32_S3_TOUCH)
    Arduino_DataBus* bus;
    Arduino_GFX* gfx;
    CST820* touch;
#endif

    // LVGL display buffer and driver
    static lv_disp_draw_buf_t s_drawBuf;
#if defined(BOARD_ESP32_S3_TOUCH)
    static lv_color_t* s_buf;  // Dynamically allocated full-screen buffer
#else
    static lv_color_t s_buf[240 * 60]; // 60-line buffer
#endif
    static lv_disp_drv_t s_dispDrv;
    static lv_indev_drv_t s_indevDrv;

#if defined(WAVESHARE_ESP32S3_LCD2)
    class Qmi8658* _imu = nullptr;
    volatile bool _deepSleepRequested = false;
    bool _portraitUpsideDown = false;
    uint8_t _orientCandidate = 0xFF;
    uint32_t _orientStableSince = 0;
    uint32_t _lastOrientPollMs = 0;
    void pollPortraitAutoRotate();
    void applyPortraitRotation(bool upsideDown);
#endif

    // Tabview and tabs
    lv_obj_t* tabview;
    lv_obj_t* tab_racing;
    lv_obj_t* tab_pilot;
    lv_obj_t* tab_calib;
    lv_obj_t* tab_system;
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    lv_obj_t* tab_elrs;
#endif
    
    // UI objects - main elements
    lv_obj_t* rssi_label;
    lv_obj_t* rssi_chart;
    lv_chart_series_t* rssi_series;
    lv_obj_t* rssi_enter_line;         // Racing tab enter threshold line
    lv_obj_t* rssi_exit_line;          // Racing tab exit threshold line
    lv_point_t rssi_enter_points[2];   // Line endpoints for racing enter threshold
    lv_point_t rssi_exit_points[2];    // Line endpoints for racing exit threshold
    lv_obj_t* lap_count_label;
    lv_obj_t* status_label;
    lv_obj_t* battery_label;
    lv_obj_t* battery_icon;
    lv_obj_t* status_wifi_label;
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    lv_obj_t* status_elrs_label;
#endif
    volatile bool _pendingWifiEnabled;
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    volatile bool _pendingElrsEnabled;
#endif
    volatile bool _statusBarDirty;
    
    // Race timing displays
    lv_obj_t* race_time_label;      // Total race time
    lv_obj_t* current_lap_label;    // Current lap time
    lv_obj_t* fastest_lap_label;    // Fastest single lap
    lv_obj_t* fastest_3_label;      // Fastest 3 consecutive laps
    
    // Calibration tab elements
    lv_obj_t* calib_rssi_label;
    lv_obj_t* calib_chart;
    lv_chart_series_t* calib_series;
    lv_obj_t* calib_enter_line;
    lv_obj_t* calib_exit_line;
    lv_obj_t* calib_enter_value;
    lv_obj_t* calib_exit_value;
    lv_point_t calib_enter_points[2];  // Line endpoints for enter threshold
    lv_point_t calib_exit_points[2];   // Line endpoints for exit threshold
    
    // Control buttons
    lv_obj_t* start_btn;
    lv_obj_t* stop_btn;
    lv_obj_t* clear_btn;
    lv_obj_t* mode_btn;
    
    // Settings controls
    lv_obj_t* system_label;
    lv_obj_t* band_label;
    lv_obj_t* channel_label;
    lv_obj_t* freq_label;
    lv_obj_t* threshold_label;
    lv_obj_t* threshold_enter_label;
    lv_obj_t* threshold_exit_label;
    lv_obj_t* brightness_slider;
    lv_obj_t* brightness_label;
    lv_obj_t* battery_voltage_label;  // System tab voltage display
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    lv_obj_t* elrs_backpack_switch;
    lv_obj_t* elrs_row_slider;
    lv_obj_t* elrs_row_label;
    lv_obj_t* elrs_auto_col_switch;
    lv_obj_t* elrs_col_slider;
    lv_obj_t* elrs_col_label;
    lv_obj_t* elrs_clear_osd_switch;
    lv_obj_t* elrs_playback_switch;
    lv_obj_t* elrs_save_btn;
    lv_obj_t* elrs_save_label;
    lv_obj_t* elrs_bind_textarea;
    lv_obj_t* elrs_keyboard;
    volatile bool _elrsApplyRequested;
    ElrsLcdSettingsApply _elrsApplySnap{};
    bool _elrsUiSyncing;
    volatile uint32_t _elrsSaveFlashUntilMs;
    bool _elrsSaveFlashShowingSaved;
#endif
    
    // Lap times display (full list for current race, up to 10 laps)
    lv_obj_t* lap_times_box;
    static const uint8_t LAP_TIMES_LABELS = 10;
    lv_obj_t* lap_times_labels[10];
    
    // Countdown overlay
    lv_obj_t* countdown_overlay;
    lv_obj_t* countdown_label;
    bool _countdownActive;
    int _countdownValue;
    uint32_t _countdownStartTime;
    bool _countdownTriggersStart;  // If true, set _startRequested when countdown completes (LCD button); if false, visual-only (web)
    bool _startingInFivePlayed;    // One-shot: "starting in less than 5" only at 5s mark
    int _lastBeepValue;
    static const uint32_t COUNTDOWN_INTERVAL = 1000;  // 1 second per number
    
    // Finish overlay  
    lv_obj_t* finish_overlay;
    lv_obj_t* finish_label;
    bool _finishActive;
    uint32_t _finishStartTime;
    static const uint32_t FINISH_DISPLAY_DURATION = 2000;  // Show for 2 seconds

    // Boot overlay (shown until setBootComplete(); written from main, read by UI task)
    lv_obj_t* boot_overlay;
    lv_obj_t* boot_title_label;  // "FPVGate"
    lv_obj_t* boot_label;       // "Booting..."
    volatile bool _bootComplete;
    bool _bootOverlayActive;
    
    // Touch and dimming
    uint32_t _lastTouchTime;
    bool _screenDimmed;
    uint8_t _userBrightness;
    
    // Cross-core RSSI feed (written from loop() on core 1, read by UI task on core 0)
    volatile uint8_t _pendingRssi;
    
    // Cross-core button flags (written from UI task on core 0, read by loop() on core 1)
    volatile bool _startRequested;
    volatile bool _stopRequested;
    volatile bool _clearRequested;

    // Cross-core display requests (written by main/webserver, read by UI task on core 0)
    volatile bool _requestCountdown;
    volatile bool _requestCountdownTriggerStart;
    volatile bool _requestShowFinish;
    
    // Cross-core system/band/channel button deltas (written from UI task core 0, read by loop core 1)
    volatile int8_t _systemDelta;
    volatile int8_t _bandDelta;
    volatile int8_t _channelDelta;
    
    // Cross-core threshold button deltas (written from UI task core 0, read by loop core 1)
    volatile int8_t _enterDelta;
    volatile int8_t _exitDelta;
    
    // Cross-core band/channel display update (written from loop core 1, read by UI task core 0)
    volatile uint8_t _pendingSystemIdx;
    volatile uint8_t _pendingBandIdx;
    volatile uint8_t _pendingChannelIdx;
    volatile uint16_t _pendingFreqMhz;
    volatile bool _bandChannelDirty;
    
    // Cross-core threshold display update (written from loop core 1, read by UI task core 0)
    volatile uint8_t _pendingEnterRssi;
    volatile uint8_t _pendingExitRssi;
    volatile bool _thresholdDirty;

    // Cross-core battery display update (written from loop core 1, read by UI task core 0)
    volatile uint16_t _pendingBatteryVoltage;
    volatile bool _batteryDirty;

    // Cross-core race timing display (written from loop core 1, read by UI task core 0; LVGL only on core 0)
    volatile uint32_t _pendingRaceTimeMs;
    volatile uint32_t _pendingCurrentLapTimeMs;
    volatile uint32_t _pendingFastestLapMs;
    volatile uint32_t _pendingFastest3LapsMs;
    volatile bool _raceTimingDirty;
    
    // Cross-core buzzer request (written from UI task core 0, read by loop core 1)
    volatile uint8_t _pendingBuzzerCue;  // BuzzerCue as uint8_t; 0 = BUZZER_CUE_NONE
    
    // Cross-core lap feed (written from loop() on core 1, read by UI task on core 0)
    static const uint8_t MAX_DISPLAY_LAPS = 10;  // Full list for current race (matches timer max)
    volatile uint32_t _lapBuffer[10];  // Last 10 lap times in ms (newest at 0)
    volatile uint8_t _lapCount;        // Total laps recorded
    volatile bool _lapsDirty;          // New lap data available
    
    // Update tracking
    uint32_t _lastGraphUpdate;

    // Internal helpers
    void createUI();
    void createRacingTab();
    void createPilotTab();
    void createCalibTab();
    void createSystemTab();
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    void createElrsTab();
    static void elrsRowSliderEvent(lv_event_t* e);
    static void elrsColSliderEvent(lv_event_t* e);
    static void elrsAutoColSwitchEvent(lv_event_t* e);
    static void elrsSaveBtnEvent(lv_event_t* e);
    static void elrsBindPhraseTaEvent(lv_event_t* e);
    static void elrsKeyboardDismissEvent(lv_event_t* e);
    void elrsHideBindKeyboard();
    static void elrsUpdateRowLabel(FpvLcdUI* ui);
    static void elrsUpdateColLabel(FpvLcdUI* ui);
#endif
    void processRssiUpdate();
    void processLapUpdate();           // Called from UI task only
    void processBandChannelUpdate();   // Called from UI task only
    void processThresholdUpdate();     // Called from UI task only
    void processBatteryUpdate();       // Called from UI task only
    void processRaceTimingUpdate();    // Called from UI task only
    void updateScreenBrightness();
    
    // Countdown/finish overlay methods (called from UI task core 0 only)
    void startCountdown(bool triggerStartWhenComplete = true);
    void updateCountdown();
    void stopCountdown();
    void showFinish();
    void updateFinish();
    void stopFinish();
    void processBootOverlay();   // Dismiss boot overlay when _bootComplete (UI task only)
#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)
    void processElrsSaveFlash();  // UI task: brief Save -> Saved! feedback after notifyElrsSettingsSaved()
#endif
    void createPersistentHeader(lv_obj_t* parent);
    void processStatusBarUpdate();

    // LVGL callbacks
    static void dispFlush(lv_disp_drv_t* disp, const lv_area_t* area, lv_color_t* color_p);
    static void touchpadRead(lv_indev_drv_t* indev_driver, lv_indev_data_t* data);
    static void startBtnEvent(lv_event_t* e);
    static void stopBtnEvent(lv_event_t* e);
    static void clearBtnEvent(lv_event_t* e);
    static void systemPrevEvent(lv_event_t* e);
    static void systemNextEvent(lv_event_t* e);
    static void bandPrevEvent(lv_event_t* e);
    static void bandNextEvent(lv_event_t* e);
    static void channelPrevEvent(lv_event_t* e);
    static void channelNextEvent(lv_event_t* e);
    static void enterDecEvent(lv_event_t* e);
    static void enterIncEvent(lv_event_t* e);
    static void exitDecEvent(lv_event_t* e);
    static void exitIncEvent(lv_event_t* e);
    static void brightnessSliderEvent(lv_event_t* e);
    static void racingScrollBeginEvent(lv_event_t* e);
#if defined(WAVESHARE_ESP32S3_LCD2)
    static void deepSleepBtnEvent(lv_event_t* e);
#endif
};
