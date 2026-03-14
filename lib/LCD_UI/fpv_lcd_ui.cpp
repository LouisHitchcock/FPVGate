#include "fpv_lcd_ui.h"
#include "spi_mutex.h"
#ifdef HAS_I2S_AUDIO
#include "audio.h"
extern AudioAnnouncer* g_audioAnnouncer;
#endif

#if ENABLE_LCD_UI

// Define the global SPI mutex
SemaphoreHandle_t g_spiMutex = nullptr;

// LCD pins for Waveshare ESP32-S3 Touch LCD
#define LCD_BL 1  // Backlight pin

// Touch I2C pins (CST820 on Waveshare ESP32-S3-Touch-LCD-2)
#if defined(BOARD_ESP32_S3_TOUCH)
#define LCD_I2C_SDA 48
#define LCD_I2C_SCL 47
#define LCD_TOUCH_RST -1
#define LCD_TOUCH_INT -1
#endif

// Static member initialization
lv_disp_draw_buf_t FpvLcdUI::s_drawBuf;
lv_disp_drv_t FpvLcdUI::s_dispDrv;
lv_indev_drv_t FpvLcdUI::s_indevDrv;

#if defined(BOARD_ESP32_S3_TOUCH)
    lv_color_t* FpvLcdUI::s_buf = nullptr;
#else
    lv_color_t FpvLcdUI::s_buf[240 * 60];
#endif

FpvLcdUI::FpvLcdUI()
    : 
#if defined(BOARD_ESP32_S3_TOUCH)
      bus(nullptr), gfx(nullptr), touch(nullptr),
#endif
      rssi_label(nullptr), rssi_chart(nullptr), rssi_series(nullptr),
      lap_count_label(nullptr), status_label(nullptr),
      battery_label(nullptr), battery_icon(nullptr),
      race_time_label(nullptr), current_lap_label(nullptr),
      fastest_lap_label(nullptr), fastest_3_label(nullptr),
      start_btn(nullptr), stop_btn(nullptr), clear_btn(nullptr), mode_btn(nullptr),
      system_label(nullptr),
      band_label(nullptr), channel_label(nullptr), freq_label(nullptr), 
      threshold_label(nullptr), threshold_enter_label(nullptr), threshold_exit_label(nullptr),
      brightness_slider(nullptr), brightness_label(nullptr),
      lap_times_box(nullptr),
      countdown_overlay(nullptr), countdown_label(nullptr),
      _countdownActive(false), _countdownValue(10), _countdownStartTime(0), _lastBeepValue(-1), _countdownTriggersStart(true), _startingInFivePlayed(false),
      finish_overlay(nullptr), finish_label(nullptr),
      _finishActive(false), _finishStartTime(0),
      boot_overlay(nullptr), boot_title_label(nullptr), boot_label(nullptr), _bootComplete(false), _bootOverlayActive(false),
      _lastTouchTime(0), _screenDimmed(false), _userBrightness(100),
      _pendingRssi(0),
      _startRequested(false), _stopRequested(false), _clearRequested(false),
      _requestCountdown(false), _requestCountdownTriggerStart(false), _requestShowFinish(false),
      _systemDelta(0), _bandDelta(0), _channelDelta(0),
      _enterDelta(0), _exitDelta(0),
      _pendingSystemIdx(0), _pendingBandIdx(0), _pendingChannelIdx(0), _pendingFreqMhz(0), _bandChannelDirty(false),
      _pendingEnterRssi(120), _pendingExitRssi(100), _thresholdDirty(false),
      _pendingBatteryVoltage(0), _batteryDirty(false),
      _pendingRaceTimeMs(0), _pendingCurrentLapTimeMs(0), _pendingFastestLapMs(0), _pendingFastest3LapsMs(0), _raceTimingDirty(false),
      _pendingBuzzerMs(0),
      _lapCount(0), _lapsDirty(false),
      _lastGraphUpdate(0) {
    for (int i = 0; i < LAP_TIMES_LABELS; ++i) {
        lap_times_labels[i] = nullptr;
        _lapBuffer[i] = 0;
    }
}

FpvLcdUI::~FpvLcdUI() {
#if defined(BOARD_ESP32_S3_TOUCH)
    if (touch) delete touch;
    if (gfx) delete gfx;
    if (bus) delete bus;
    if (s_buf) {
        heap_caps_free(s_buf);
        s_buf = nullptr;
    }
#endif
}

bool FpvLcdUI::begin() {
#if !defined(ENABLE_LCD_UI) || !defined(WAVESHARE_ESP32S3_LCD2)
    return false;
#endif

    Serial.println("\n====================================");
    Serial.println("LCD UI: Initializing");
    Serial.println("====================================\n");

    // Initialize backlight
    pinMode(LCD_BL, OUTPUT);
    digitalWrite(LCD_BL, LOW);  // Turn off first
    Serial.println("LCD: Backlight OFF (initializing)");

#if defined(BOARD_ESP32_S3_TOUCH)
    // Waveshare ESP32-S3-Touch-LCD-2: Use Arduino_GFX with SPI2
    Serial.println("LCD: Using Arduino_GFX for ESP32-S3");
    
    // Create SPI data bus (DC, CS, SCK, MOSI, MISO, SPI_NUM, isSPI_Mode)
    bus = new Arduino_ESP32SPI(42 /* DC */, 45 /* CS */, 39 /* SCK */, 38 /* MOSI */, 40 /* MISO */, FSPI /* spi_num */, true);
    
    // Create ST7789 display driver (bus, RST, rotation, IPS, width, height)
    gfx = new Arduino_ST7789(bus, -1 /* RST */, 0 /* rotation */, true /* IPS */, 240 /* width */, 320 /* height */);
    
    // Initialize display
    Serial.println("LCD: Calling gfx->begin()...");
    if (!gfx->begin()) {
        Serial.println("ERROR: gfx->begin() failed!");
        return false;
    }
    Serial.println("LCD: gfx->begin() succeeded");
    
    gfx->fillScreen(0x0000);  // BLACK in RGB565 (removed as a global by newer GFX lib versions)
    Serial.println("LCD: Arduino_GFX initialized");
#endif

    // Turn on backlight
    pinMode(LCD_BL, OUTPUT);
    digitalWrite(LCD_BL, HIGH);
    Serial.println("LCD: Backlight ON (digitalWrite HIGH)");
    _lastTouchTime = millis();
    _screenDimmed = false;
    
    // Initialize SPI mutex for shared bus with SD card
    spiMutexInit();
    Serial.println("LCD: SPI mutex initialized");

    // Initialize LVGL
    Serial.println("LCD: Initializing LVGL...");
    lv_init();

#if defined(BOARD_ESP32_S3_TOUCH)
    // ESP32-S3: Allocate full screen buffer (240x320 = 76,800 pixels = 153,600 bytes)
    // Full buffer with direct mode = simplest, fastest, no tearing
    uint32_t bufSize = 240 * 320;
    uint32_t bufBytes = bufSize * sizeof(lv_color_t);
    
    // Try PSRAM first (preferred for ESP32-S3 with PSRAM)
    s_buf = (lv_color_t*)heap_caps_malloc(bufBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_buf) {
        // Fallback to internal RAM
        s_buf = (lv_color_t*)heap_caps_malloc(bufBytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    if (!s_buf) {
        // Last resort: try default heap
        s_buf = (lv_color_t*)heap_caps_malloc(bufBytes, MALLOC_CAP_8BIT);
    }
    
    if (!s_buf) {
        Serial.printf("ERROR: Failed to allocate LVGL display buffer (%d KB)!\n", bufBytes / 1024);
        return false;
    }
    
    Serial.printf("LCD: Allocated %d KB display buffer (full-screen)\n", bufBytes / 1024);
    
    // Report memory usage after buffer allocation
    uint32_t freeHeap = ESP.getFreeHeap();
    uint32_t totalHeap = ESP.getHeapSize();
    Serial.printf("LCD: Free heap after buffer: %u KB / %u KB (%.1f%% used)\n",
                  freeHeap / 1024, totalHeap / 1024, 
                  ((totalHeap - freeHeap) * 100.0f) / totalHeap);
    
    // Initialize LVGL display buffer (full screen for smooth performance)
    lv_disp_draw_buf_init(&s_drawBuf, s_buf, NULL, bufSize);
#else
    // Other boards: Use static buffer (60 lines for smooth scrolling)
    lv_disp_draw_buf_init(&s_drawBuf, s_buf, NULL, 240 * 60);
#endif

    // Initialize display driver
    lv_disp_drv_init(&s_dispDrv);
    s_dispDrv.hor_res = 240;
    s_dispDrv.ver_res = 320;
    s_dispDrv.flush_cb = dispFlush;
    s_dispDrv.draw_buf = &s_drawBuf;
    s_dispDrv.user_data = this;
#if defined(BOARD_ESP32_S3_TOUCH)
    // Enable direct mode for full-screen buffer (LVGL renders directly, we copy once)
    s_dispDrv.direct_mode = true;
#endif
    lv_disp_drv_register(&s_dispDrv);
    
    Serial.println("LCD: LVGL display registered");

#if defined(BOARD_ESP32_S3_TOUCH)
    // Initialize touch controller (CST820 on I2C)
    Serial.println("LCD: Initializing CST820 touch...");
    touch = new CST820(LCD_I2C_SDA, LCD_I2C_SCL, LCD_TOUCH_RST, LCD_TOUCH_INT);
    touch->begin();
    
    lv_indev_drv_init(&s_indevDrv);
    s_indevDrv.type = LV_INDEV_TYPE_POINTER;
    s_indevDrv.read_cb = touchpadRead;
    s_indevDrv.user_data = this;
    lv_indev_drv_register(&s_indevDrv);
    Serial.println("LCD: Touch initialized");
#endif

    // Create UI
    Serial.println("LCD: Creating UI...");
    createUI();
    
    // Report memory usage after UI creation
    uint32_t freeHeapAfterUI = ESP.getFreeHeap();
    uint32_t minFreeHeap = ESP.getMinFreeHeap();
    Serial.printf("LCD: Free heap after UI: %u KB (min ever: %u KB)\n",
                  freeHeapAfterUI / 1024, minFreeHeap / 1024);
    if (freeHeapAfterUI < 50000) {
        Serial.println("LCD: WARNING - Low free heap! System may be unstable.");
    }

#if defined(BOARD_ESP32_S3_TOUCH)
    // Force initial screen refresh for ESP32-S3-Touch
    lv_obj_invalidate(lv_scr_act());
#endif

    Serial.println("\n====================================");
    Serial.println("LCD UI: Setup complete!");
    Serial.println("====================================\n");

    return true;
}

void FpvLcdUI::uiTask(void* parameter) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(parameter);
    if (!ui) {
        vTaskDelete(NULL);
        return;
    }
    
    // Wait a bit before starting LVGL loop to ensure everything is initialized
    vTaskDelay(pdMS_TO_TICKS(500));
    
    // Main LVGL event loop
    while (true) {
        // Process cross-core data updates (safe: we're on core 0)
        ui->processRssiUpdate();
        ui->processLapUpdate();
        ui->processBandChannelUpdate();
        ui->processThresholdUpdate();
        ui->processBatteryUpdate();
        ui->processRaceTimingUpdate();
        
        // Tick countdown/finish overlays
        if (ui->_countdownActive) ui->updateCountdown();
        if (ui->_finishActive) ui->updateFinish();
        ui->processBootOverlay();
        // Process display requests from web (countdown, STOPPED overlay)
        if (ui->_requestCountdown) {
            bool trigger = ui->_requestCountdownTriggerStart;
            ui->_requestCountdown = false;
            ui->startCountdown(trigger);
        }
        if (ui->_requestShowFinish) {
            ui->_requestShowFinish = false;
            ui->showFinish();
        }
        
        lv_timer_handler();

#if defined(BOARD_ESP32_S3_TOUCH)
        // ESP32-S3: Manual full screen blit (direct mode). LCD and SD share SPI.
        // Use short timeout (80ms) always so the UI task never blocks long - prevents scroll/touch
        // freezes when SD holds the mutex. We may skip a blit during SD I/O; next frame will draw.
        static uint32_t lastBlitMs = 0;
        uint32_t now = millis();
        bool recentlyTouched = (now - ui->_lastTouchTime) < 350;
        bool shouldBlit = recentlyTouched || (now - lastBlitMs) >= 50;
        TickType_t blitTimeout = pdMS_TO_TICKS(80);

        if (shouldBlit && ui->gfx && FpvLcdUI::s_buf) {
            if (spiMutexTake(blitTimeout)) {
                ui->gfx->draw16bitBeRGBBitmap(0, 0, (uint16_t*)FpvLcdUI::s_buf, 240, 320);
                spiMutexGive();
                lastBlitMs = now;
            }
        }
#endif

        vTaskDelay(pdMS_TO_TICKS(4));  // 250 Hz loop: more responsive scroll/touch; actual FPS limited by blit
    }
}

void FpvLcdUI::dispFlush(lv_disp_drv_t* disp, const lv_area_t* area, lv_color_t* color_p) {
#if defined(BOARD_ESP32_S3_TOUCH)
    // For ESP32-S3 with direct mode, we don't flush here - it's done in the task loop
    lv_disp_flush_ready(disp);
#else
    // For other boards, flush normally
    FpvLcdUI* instance = static_cast<FpvLcdUI*>(disp->user_data);
    if (!instance) {
        lv_disp_flush_ready(disp);
        return;
    }
    
    uint32_t w = (area->x2 - area->x1 + 1);
    uint32_t h = (area->y2 - area->y1 + 1);
    
    // TFT_eSPI code would go here for non-S3 boards
    
    lv_disp_flush_ready(disp);
#endif
}

void FpvLcdUI::touchpadRead(lv_indev_drv_t* indev_driver, lv_indev_data_t* data) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(indev_driver->user_data);
    if (!ui || !ui->touch) {
        data->state = LV_INDEV_STATE_REL;
        return;
    }
    // Block all touch until boot overlay is dismissed (prevents interaction during startup)
    if (ui->_bootOverlayActive) {
        data->state = LV_INDEV_STATE_REL;
        return;
    }
    // Throttle touch reads to ~200Hz for smoother swipe gestures
    static unsigned long lastTouchRead = 0;
    static lv_indev_data_t lastData = {0};
    unsigned long now = millis();
    
    if (now - lastTouchRead < 5) {  // 5ms = 200Hz (was 10ms = 100Hz)
        *data = lastData;
        return;
    }
    lastTouchRead = now;
    
    uint16_t touchX, touchY;
    uint8_t gesture;
    
    bool touched = ui->touch->getTouch(&touchX, &touchY, &gesture);
    
    if (touched) {
        data->state = LV_INDEV_STATE_PR;
        data->point.x = touchX;
        data->point.y = touchY;
        
        // Wake screen on touch
        ui->_lastTouchTime = now;
        if (ui->_screenDimmed) {
            ui->_screenDimmed = false;
            ui->updateScreenBrightness();
        }
    } else {
        data->state = LV_INDEV_STATE_REL;
    }
    
    lastData = *data;
}

void FpvLcdUI::createUI() {
    // Create tabview with NO tab bar (iOS style swipe pages)
    tabview = lv_tabview_create(lv_scr_act(), LV_DIR_TOP, 0);  // 0 = no tab bar
    lv_obj_set_style_bg_color(tabview, lv_color_hex(0x000000), 0);
    
    // Optimize tabview animation for smoother/faster swiping
    lv_obj_set_style_anim_time(tabview, 200, 0);  // 200ms transition (default is 300ms)
    
    // Create four pages
    tab_racing = lv_tabview_add_tab(tabview, "");
    tab_pilot = lv_tabview_add_tab(tabview, "");
    tab_calib = lv_tabview_add_tab(tabview, "");
    tab_system = lv_tabview_add_tab(tabview, "");
    
    // Style pages and disable horizontal scrolling
    lv_obj_set_style_bg_color(tab_racing, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_color(tab_pilot, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_color(tab_calib, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_color(tab_system, lv_color_hex(0x000000), 0);
    
    // Racing tab: full screen so header/content % heights resolve (6% / 94%)
    lv_obj_set_size(tab_racing, 240, 320);
    // Other tabs: content-based height, scroll vertically
    lv_obj_set_size(tab_pilot, 240, LV_SIZE_CONTENT);
    lv_obj_set_size(tab_calib, 240, LV_SIZE_CONTENT);
    lv_obj_set_size(tab_system, 240, LV_SIZE_CONTENT);
    
    // Racing tab: allow all directions so gestures can be properly delegated
    lv_obj_set_scroll_dir(tab_racing, LV_DIR_ALL);
    lv_obj_set_scroll_dir(tab_pilot, LV_DIR_VER);
    lv_obj_set_scroll_dir(tab_calib, LV_DIR_VER);
    lv_obj_set_scroll_dir(tab_system, LV_DIR_VER);
    
    // Remove ALL padding to use full screen height
    lv_obj_set_style_pad_all(tab_racing, 0, 0);
    lv_obj_set_style_pad_all(tab_pilot, 0, 0);
    lv_obj_set_style_pad_all(tab_calib, 0, 0);
    lv_obj_set_style_pad_all(tab_system, 0, 0);
    
    // Create content
    createRacingTab();
    createPilotTab();
    createCalibTab();
    createSystemTab();

    // Boot overlay: "FPVGate" + "Booting..." until main calls setBootComplete() after SD/bootstrap
    lv_obj_t* scr = lv_scr_act();
    if (scr) {
        boot_overlay = lv_obj_create(scr);
        lv_obj_set_size(boot_overlay, 240, 320);
        lv_obj_set_pos(boot_overlay, 0, 0);
        lv_obj_set_style_bg_color(boot_overlay, lv_color_hex(0x000000), 0);
        lv_obj_set_style_bg_opa(boot_overlay, LV_OPA_80, 0);
        lv_obj_set_style_border_width(boot_overlay, 0, 0);
        lv_obj_set_style_pad_all(boot_overlay, 0, 0);
        lv_obj_clear_flag(boot_overlay, LV_OBJ_FLAG_SCROLLABLE);
        lv_obj_move_foreground(boot_overlay);
        boot_title_label = lv_label_create(boot_overlay);
        lv_label_set_text(boot_title_label, "FPVGate");
        lv_obj_set_style_text_font(boot_title_label, &lv_font_montserrat_32, 0);
        lv_obj_set_style_text_color(boot_title_label, lv_color_hex(0xffffff), 0);
        lv_obj_set_style_text_align(boot_title_label, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_style_bg_opa(boot_title_label, LV_OPA_TRANSP, 0);
        lv_obj_align(boot_title_label, LV_ALIGN_CENTER, 0, -24);
        boot_label = lv_label_create(boot_overlay);
        lv_label_set_text(boot_label, "Booting...");
        lv_obj_set_style_text_font(boot_label, &lv_font_montserrat_32, 0);
        lv_obj_set_style_text_color(boot_label, lv_color_hex(0x00aaff), 0);
        lv_obj_set_style_text_align(boot_label, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_style_bg_opa(boot_label, LV_OPA_TRANSP, 0);
        lv_obj_align(boot_label, LV_ALIGN_CENTER, 0, 24);
        _bootOverlayActive = true;
    }

    // Force layout so scroll extent and hit-testing are correct (fixes scroll + touch in racing tab)
    lv_obj_update_layout(lv_scr_act());
}

void FpvLcdUI::createRacingTab() {
    lv_obj_t *scr = tab_racing;

    // Tab: flex column so header + content stack; full size
    lv_obj_set_layout(scr, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(scr, 0, 0);
    lv_obj_set_style_pad_column(scr, 0, 0);

    // === FIXED HEADER: fixed height so flex gives content a definite viewport (scroll works) ===
    lv_obj_t *header_bar = lv_obj_create(scr);
    lv_obj_set_width(header_bar, lv_pct(100));
    lv_obj_set_height(header_bar, 20);
    lv_obj_set_style_bg_color(header_bar, lv_color_hex(0x0d0d0d), 0);
    lv_obj_set_style_border_width(header_bar, 0, 0);
    lv_obj_set_style_pad_all(header_bar, 4, 0);
    lv_obj_clear_flag(header_bar, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_layout(header_bar, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(header_bar, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(header_bar, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    lv_obj_t *title_label = lv_label_create(header_bar);
    lv_label_set_text(title_label, "FPVGate");
    lv_obj_set_style_text_font(title_label, &lv_font_montserrat_12, 0);
    lv_obj_set_style_text_color(title_label, lv_color_hex(0x888888), 0);
    lv_obj_set_style_bg_opa(title_label, LV_OPA_TRANSP, 0);

    // Battery group (icon + label) on the right
    lv_obj_t *battery_wrap = lv_obj_create(header_bar);
    lv_obj_set_size(battery_wrap, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(battery_wrap, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(battery_wrap, 0, 0);
    lv_obj_set_style_pad_all(battery_wrap, 0, 0);
    lv_obj_set_layout(battery_wrap, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(battery_wrap, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(battery_wrap, 4, 0);

    battery_icon = lv_obj_create(battery_wrap);
    lv_obj_set_size(battery_icon, 20, 12);
    lv_obj_set_style_bg_color(battery_icon, lv_color_hex(0x888888), 0);
    lv_obj_set_style_border_width(battery_icon, 1, 0);
    lv_obj_set_style_border_color(battery_icon, lv_color_hex(0xffffff), 0);
    lv_obj_set_style_radius(battery_icon, 2, 0);
    lv_obj_set_style_pad_all(battery_icon, 1, 0);
    lv_obj_clear_flag(battery_icon, LV_OBJ_FLAG_SCROLLABLE);

    battery_label = lv_label_create(battery_wrap);
    lv_label_set_text(battery_label, "---");
    lv_obj_set_style_text_font(battery_label, &lv_font_montserrat_12, 0);
    lv_obj_set_style_text_color(battery_label, lv_color_hex(0x888888), 0);
    lv_obj_set_style_bg_opa(battery_label, LV_OPA_TRANSP, 0);

    // === SCROLLABLE CONTENT: flex_grow(1) = take remaining space (300px); gives stable viewport for scroll ===
    lv_obj_t *content = lv_obj_create(scr);
    lv_obj_set_width(content, lv_pct(100));
    lv_obj_set_flex_grow(content, 1);
    lv_obj_set_style_bg_color(content, lv_color_hex(0x000000), 0);
    lv_obj_set_style_border_width(content, 0, 0);
    lv_obj_set_style_pad_all(content, 0, 0);
    lv_obj_set_scroll_dir(content, LV_DIR_VER);
    // Allow horizontal gestures to chain to parent for tab swiping
    lv_obj_add_flag(content, LV_OBJ_FLAG_SCROLL_ONE);
    lv_obj_add_event_cb(content, racingScrollBeginEvent, LV_EVENT_SCROLL_BEGIN, NULL);

    // Inner: flex column, full width. Explicit height so scroll extent > viewport (scroll works, buttons reachable).
    lv_obj_t *inner = lv_obj_create(content);
    lv_obj_set_width(inner, lv_pct(100));
    lv_obj_set_height(inner, 720);
    lv_obj_set_style_bg_color(inner, lv_color_hex(0x000000), 0);
    lv_obj_set_style_border_width(inner, 0, 0);
    lv_obj_set_style_pad_all(inner, 8, 0);
    lv_obj_set_style_pad_row(inner, 8, 0);
    lv_obj_clear_flag(inner, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_layout(inner, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(inner, LV_FLEX_FLOW_COLUMN);

    // === RSSI BOX: full width, fixed height (chart needs stable size) ===
    lv_obj_t *rssi_box = lv_obj_create(inner);
    lv_obj_set_width(rssi_box, lv_pct(100));
    lv_obj_set_height(rssi_box, 65);
    lv_obj_set_style_bg_color(rssi_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_color(rssi_box, lv_color_hex(0x00ff00), 0);
    lv_obj_set_style_border_width(rssi_box, 2, 0);
    lv_obj_set_style_pad_all(rssi_box, 0, 0);
    lv_obj_clear_flag(rssi_box, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *rssi_title = lv_label_create(rssi_box);
    lv_label_set_text(rssi_title, "RSSI");
    lv_obj_set_style_text_color(rssi_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(rssi_title, &lv_font_montserrat_14, 0);
    lv_obj_set_style_bg_opa(rssi_title, LV_OPA_TRANSP, 0);
    lv_obj_set_style_pad_all(rssi_title, 0, 0);
    lv_obj_set_pos(rssi_title, 10, 5);

    rssi_label = lv_label_create(rssi_box);
    lv_label_set_text(rssi_label, "0");
    lv_obj_set_style_text_font(rssi_label, &lv_font_montserrat_32, 0);
    lv_obj_set_style_text_color(rssi_label, lv_color_hex(0x00ff00), 0);
    lv_obj_set_style_bg_opa(rssi_label, LV_OPA_TRANSP, 0);
    lv_obj_set_style_pad_all(rssi_label, 0, 0);
    lv_obj_set_pos(rssi_label, 10, 25);

    // RSSI Graph (more width now that battery is in header: 75 to 215)
    rssi_chart = lv_chart_create(rssi_box);
    lv_obj_set_size(rssi_chart, 140, 45);
    lv_obj_set_pos(rssi_chart, 75, 10);
    lv_chart_set_type(rssi_chart, LV_CHART_TYPE_LINE);
    lv_chart_set_range(rssi_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 255);
    lv_chart_set_point_count(rssi_chart, 30);
    lv_chart_set_div_line_count(rssi_chart, 0, 0);
    lv_obj_set_style_size(rssi_chart, 0, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(rssi_chart, lv_color_hex(0x0a0a0a), 0);
    lv_obj_set_style_border_width(rssi_chart, 1, 0);
    lv_obj_set_style_border_color(rssi_chart, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(rssi_chart, 2, 0);

    rssi_series = lv_chart_add_series(rssi_chart, lv_color_hex(0x00ff00), LV_CHART_AXIS_PRIMARY_Y);
    lv_obj_set_style_line_width(rssi_chart, 2, LV_PART_ITEMS);

    // Add area fill under the line
    lv_obj_set_style_bg_opa(rssi_chart, LV_OPA_50, LV_PART_ITEMS);  // 50% opacity fill
    lv_obj_set_style_bg_color(rssi_chart, lv_color_hex(0x00ff00), LV_PART_ITEMS);

    // Initialize with zeros
    for (int i = 0; i < 30; i++) {
        rssi_series->y_points[i] = 0;
    }
    lv_chart_refresh(rssi_chart);

    // Threshold lines overlaid on racing RSSI chart
    // Enter threshold line (blue)
    rssi_enter_line = lv_line_create(rssi_box);
    lv_obj_set_style_line_width(rssi_enter_line, 1, 0);
    lv_obj_set_style_line_color(rssi_enter_line, lv_color_hex(0x0099ff), 0);
    lv_obj_set_style_line_dash_width(rssi_enter_line, 3, 0);
    lv_obj_set_style_line_dash_gap(rssi_enter_line, 2, 0);

    // Initialize with default points (chart is at 75,10 with size 140x45)
    rssi_enter_points[0].x = 77;
    rssi_enter_points[0].y = 32;  // Middle of chart (10 + 22)
    rssi_enter_points[1].x = 213;
    rssi_enter_points[1].y = 32;
    lv_line_set_points(rssi_enter_line, rssi_enter_points, 2);

    // Exit threshold line (red)
    rssi_exit_line = lv_line_create(rssi_box);
    lv_obj_set_style_line_width(rssi_exit_line, 1, 0);
    lv_obj_set_style_line_color(rssi_exit_line, lv_color_hex(0xff0000), 0);
    lv_obj_set_style_line_dash_width(rssi_exit_line, 3, 0);
    lv_obj_set_style_line_dash_gap(rssi_exit_line, 2, 0);

    // Initialize with default points
    rssi_exit_points[0].x = 77;
    rssi_exit_points[0].y = 37;  // Slightly below enter line
    rssi_exit_points[1].x = 213;
    rssi_exit_points[1].y = 37;
    lv_line_set_points(rssi_exit_line, rssi_exit_points, 2);

    // === TIMING ROW: Race Time + Lap Time (full width, 50% each) ===
    lv_obj_t *timing_row = lv_obj_create(inner);
    lv_obj_set_width(timing_row, lv_pct(100));
    lv_obj_set_height(timing_row, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(timing_row, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(timing_row, 0, 0);
    lv_obj_set_style_pad_all(timing_row, 0, 0);
    lv_obj_set_style_pad_column(timing_row, 10, 0);
    lv_obj_set_layout(timing_row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(timing_row, LV_FLEX_FLOW_ROW);

    lv_obj_t *race_time_box = lv_obj_create(timing_row);
    lv_obj_set_height(race_time_box, 55);
    lv_obj_set_flex_grow(race_time_box, 1);
    lv_obj_set_style_bg_color(race_time_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(race_time_box, 1, 0);
    lv_obj_set_style_border_color(race_time_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(race_time_box, 0, 0);
    lv_obj_clear_flag(race_time_box, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *race_time_title = lv_label_create(race_time_box);
    lv_label_set_text(race_time_title, "Race Time");
    lv_obj_set_style_text_color(race_time_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(race_time_title, &lv_font_montserrat_12, 0);
    lv_obj_set_style_bg_opa(race_time_title, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(race_time_title, 5, 3);

    race_time_label = lv_label_create(race_time_box);
    lv_label_set_text(race_time_label, "0:00.0");
    lv_obj_set_style_text_font(race_time_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(race_time_label, lv_color_hex(0xffffff), 0);
    lv_obj_set_style_bg_opa(race_time_label, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(race_time_label, 10, 25);

    lv_obj_t *current_lap_box = lv_obj_create(timing_row);
    lv_obj_set_height(current_lap_box, 55);
    lv_obj_set_flex_grow(current_lap_box, 1);
    lv_obj_set_style_bg_color(current_lap_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(current_lap_box, 1, 0);
    lv_obj_set_style_border_color(current_lap_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(current_lap_box, 0, 0);
    lv_obj_clear_flag(current_lap_box, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *current_lap_title = lv_label_create(current_lap_box);
    lv_label_set_text(current_lap_title, "Lap Time");
    lv_obj_set_style_text_color(current_lap_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(current_lap_title, &lv_font_montserrat_12, 0);
    lv_obj_set_style_bg_opa(current_lap_title, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(current_lap_title, 5, 3);

    current_lap_label = lv_label_create(current_lap_box);
    lv_label_set_text(current_lap_label, "0:00.0");
    lv_obj_set_style_text_font(current_lap_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(current_lap_label, lv_color_hex(0x00aaff), 0);
    lv_obj_set_style_bg_opa(current_lap_label, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(current_lap_label, 10, 25);

    // === LAP COUNT & STATUS ROW ===
    lv_obj_t *lap_status_row = lv_obj_create(inner);
    lv_obj_set_width(lap_status_row, lv_pct(100));
    lv_obj_set_height(lap_status_row, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(lap_status_row, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(lap_status_row, 0, 0);
    lv_obj_set_style_pad_all(lap_status_row, 0, 0);
    lv_obj_set_style_pad_column(lap_status_row, 10, 0);
    lv_obj_set_layout(lap_status_row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(lap_status_row, LV_FLEX_FLOW_ROW);

    lv_obj_t *lap_box = lv_obj_create(lap_status_row);
    lv_obj_set_height(lap_box, 55);
    lv_obj_set_flex_grow(lap_box, 1);
    lv_obj_set_style_bg_color(lap_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(lap_box, 1, 0);
    lv_obj_set_style_border_color(lap_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(lap_box, 0, 0);
    lv_obj_clear_flag(lap_box, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *lap_title = lv_label_create(lap_box);
    lv_label_set_text(lap_title, "Laps");
    lv_obj_set_style_text_color(lap_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(lap_title, &lv_font_montserrat_12, 0);
    lv_obj_set_style_bg_opa(lap_title, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(lap_title, 5, 3);

    lap_count_label = lv_label_create(lap_box);
    lv_label_set_text(lap_count_label, "0");
    lv_obj_set_style_text_font(lap_count_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(lap_count_label, lv_color_hex(0xffffff), 0);
    lv_obj_set_style_bg_opa(lap_count_label, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(lap_count_label, 35, 20);

    lv_obj_t *status_box = lv_obj_create(lap_status_row);
    lv_obj_set_height(status_box, 55);
    lv_obj_set_flex_grow(status_box, 1);
    lv_obj_set_style_bg_color(status_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(status_box, 1, 0);
    lv_obj_set_style_border_color(status_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(status_box, 0, 0);
    lv_obj_clear_flag(status_box, LV_OBJ_FLAG_SCROLLABLE);
    
    status_label = lv_label_create(status_box);
    lv_label_set_text(status_label, "READY");
    lv_obj_set_style_text_font(status_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(status_label, lv_color_hex(0x00ff00), 0);
    lv_obj_set_style_bg_opa(status_label, LV_OPA_TRANSP, 0);
    lv_obj_center(status_label);
    
    // === FASTEST LAP ROW ===
    lv_obj_t *fastest_row = lv_obj_create(inner);
    lv_obj_set_width(fastest_row, lv_pct(100));
    lv_obj_set_height(fastest_row, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(fastest_row, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(fastest_row, 0, 0);
    lv_obj_set_style_pad_all(fastest_row, 0, 0);
    lv_obj_set_style_pad_column(fastest_row, 10, 0);
    lv_obj_set_layout(fastest_row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(fastest_row, LV_FLEX_FLOW_ROW);

    lv_obj_t *fastest_lap_box = lv_obj_create(fastest_row);
    lv_obj_set_height(fastest_lap_box, 48);
    lv_obj_set_flex_grow(fastest_lap_box, 1);
    lv_obj_set_style_bg_color(fastest_lap_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(fastest_lap_box, 1, 0);
    lv_obj_set_style_border_color(fastest_lap_box, lv_color_hex(0xffaa00), 0);
    lv_obj_set_style_pad_all(fastest_lap_box, 0, 0);
    lv_obj_clear_flag(fastest_lap_box, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *fastest_lap_title = lv_label_create(fastest_lap_box);
    lv_label_set_text(fastest_lap_title, "Fastest");
    lv_obj_set_style_text_color(fastest_lap_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(fastest_lap_title, &lv_font_montserrat_12, 0);
    lv_obj_set_style_bg_opa(fastest_lap_title, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(fastest_lap_title, 5, 2);

    fastest_lap_label = lv_label_create(fastest_lap_box);
    lv_label_set_text(fastest_lap_label, "--:--");
    lv_obj_set_style_text_font(fastest_lap_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(fastest_lap_label, lv_color_hex(0xffaa00), 0);
    lv_obj_set_style_bg_opa(fastest_lap_label, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(fastest_lap_label, 8, 20);

    lv_obj_t *fastest_3_box = lv_obj_create(fastest_row);
    lv_obj_set_height(fastest_3_box, 48);
    lv_obj_set_flex_grow(fastest_3_box, 1);
    lv_obj_set_style_bg_color(fastest_3_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(fastest_3_box, 1, 0);
    lv_obj_set_style_border_color(fastest_3_box, lv_color_hex(0xff6600), 0);
    lv_obj_set_style_pad_all(fastest_3_box, 0, 0);
    lv_obj_clear_flag(fastest_3_box, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t *fastest_3_title = lv_label_create(fastest_3_box);
    lv_label_set_text(fastest_3_title, "Best 3");
    lv_obj_set_style_text_color(fastest_3_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(fastest_3_title, &lv_font_montserrat_12, 0);
    lv_obj_set_style_bg_opa(fastest_3_title, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(fastest_3_title, 5, 2);

    fastest_3_label = lv_label_create(fastest_3_box);
    lv_label_set_text(fastest_3_label, "--:--");
    lv_obj_set_style_text_font(fastest_3_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(fastest_3_label, lv_color_hex(0xff6600), 0);
    lv_obj_set_style_bg_opa(fastest_3_label, LV_OPA_TRANSP, 0);
    lv_obj_set_pos(fastest_3_label, 8, 20);

    // === BUTTONS (full width) ===
    start_btn = lv_btn_create(inner);
    lv_obj_set_width(start_btn, lv_pct(100));
    lv_obj_set_height(start_btn, 40);
    lv_obj_set_style_bg_color(start_btn, lv_color_hex(0x00aa00), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(start_btn, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_pad_all(start_btn, 0, 0);
    
    lv_obj_t *start_label = lv_label_create(start_btn);
    lv_label_set_text(start_label, "START RACE");
    lv_obj_set_style_text_font(start_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_bg_opa(start_label, LV_OPA_TRANSP, 0);
    lv_obj_center(start_label);
    lv_obj_add_event_cb(start_btn, startBtnEvent, LV_EVENT_CLICKED, this);
    
    // Stop button (initially hidden, full width)
    stop_btn = lv_btn_create(inner);
    lv_obj_set_width(stop_btn, lv_pct(100));
    lv_obj_set_height(stop_btn, 40);
    lv_obj_set_style_bg_color(stop_btn, lv_color_hex(0xaa0000), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(stop_btn, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_pad_all(stop_btn, 0, 0);
    lv_obj_add_flag(stop_btn, LV_OBJ_FLAG_HIDDEN);  // Hidden by default
    
    lv_obj_t *stop_label = lv_label_create(stop_btn);
    lv_label_set_text(stop_label, "STOP");
    lv_obj_set_style_text_font(stop_label, &lv_font_montserrat_16, 0);
    lv_obj_set_style_bg_opa(stop_label, LV_OPA_TRANSP, 0);
    lv_obj_center(stop_label);
    lv_obj_add_event_cb(stop_btn, stopBtnEvent, LV_EVENT_CLICKED, this);
    
    // Clear button (below start button, may require scroll)
    clear_btn = lv_btn_create(inner);
    lv_obj_set_width(clear_btn, lv_pct(100));
    lv_obj_set_height(clear_btn, 36);
    lv_obj_set_style_bg_color(clear_btn, lv_color_hex(0x555555), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(clear_btn, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_pad_all(clear_btn, 0, 0);
    
    lv_obj_t *clear_label = lv_label_create(clear_btn);
    lv_label_set_text(clear_label, "CLEAR");
    lv_obj_set_style_text_font(clear_label, &lv_font_montserrat_14, 0);
    lv_obj_set_style_bg_opa(clear_label, LV_OPA_TRANSP, 0);
    lv_obj_center(clear_label);
    lv_obj_add_event_cb(clear_btn, clearBtnEvent, LV_EVENT_CLICKED, this);
    
    // Lap times section (full width; header label centered)
    lv_obj_t *lap_times_header_wrap = lv_obj_create(inner);
    lv_obj_set_width(lap_times_header_wrap, lv_pct(100));
    lv_obj_set_height(lap_times_header_wrap, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_opa(lap_times_header_wrap, LV_OPA_TRANSP, 0);
    lv_obj_set_style_border_width(lap_times_header_wrap, 0, 0);
    lv_obj_set_style_pad_all(lap_times_header_wrap, 0, 0);
    lv_obj_t *lap_times_header = lv_label_create(lap_times_header_wrap);
    lv_label_set_text(lap_times_header, "--- LAP TIMES ---");
    lv_obj_set_style_text_color(lap_times_header, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(lap_times_header, &lv_font_montserrat_14, 0);
    lv_obj_set_style_bg_opa(lap_times_header, LV_OPA_TRANSP, 0);
    lv_obj_center(lap_times_header);

    lap_times_box = lv_obj_create(inner);
    lv_obj_set_width(lap_times_box, lv_pct(100));
    lv_obj_set_height(lap_times_box, 120);  // Visible area; content taller for scroll
    lv_obj_set_style_bg_color(lap_times_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(lap_times_box, 1, 0);
    lv_obj_set_style_border_color(lap_times_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(lap_times_box, 8, 0);
    lv_obj_add_flag(lap_times_box, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(lap_times_box, LV_DIR_VER);
    lv_obj_set_flex_flow(lap_times_box, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(lap_times_box, 2, 0);
    
    for (int i = 0; i < LAP_TIMES_LABELS; i++) {
        lap_times_labels[i] = lv_label_create(lap_times_box);
        lv_label_set_text(lap_times_labels[i], "");
        lv_obj_set_style_text_font(lap_times_labels[i], &lv_font_montserrat_14, 0);
        lv_obj_set_style_text_color(lap_times_labels[i], lv_color_hex(0xaaaaaa), 0);
        lv_obj_set_width(lap_times_labels[i], lv_pct(100));
    }
}

void FpvLcdUI::createPilotTab() {
    lv_obj_t *scr = tab_pilot;
    
    // System selector (Analog / DJI / HDZero / WalkSnail)
    lv_obj_t *system_box = lv_obj_create(scr);
    lv_obj_set_size(system_box, 220, 78);
    lv_obj_set_pos(system_box, 10, 5);
    lv_obj_set_style_bg_color(system_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(system_box, 1, 0);
    lv_obj_set_style_border_color(system_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(system_box, 8, 0);
    lv_obj_clear_flag(system_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *system_title = lv_label_create(system_box);
    lv_label_set_text(system_title, "System");
    lv_obj_set_style_text_color(system_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(system_title, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(system_title, 5, 5);
    
    lv_obj_t *system_prev = lv_btn_create(system_box);
    lv_obj_set_size(system_prev, 40, 35);
    lv_obj_set_pos(system_prev, 10, 28);
    lv_obj_set_style_bg_color(system_prev, lv_color_hex(0x444444), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_t *system_prev_lbl = lv_label_create(system_prev);
    lv_label_set_text(system_prev_lbl, "<");
    lv_obj_center(system_prev_lbl);
    lv_obj_add_event_cb(system_prev, systemPrevEvent, LV_EVENT_CLICKED, this);
    
    system_label = lv_label_create(system_box);
    lv_label_set_text(system_label, "Analog");
    lv_obj_set_style_text_font(system_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(system_label, lv_color_hex(0xff8800), 0);
    lv_obj_set_pos(system_label, 62, 28);
    
    lv_obj_t *system_next = lv_btn_create(system_box);
    lv_obj_set_size(system_next, 40, 35);
    lv_obj_set_pos(system_next, 160, 28);
    lv_obj_set_style_bg_color(system_next, lv_color_hex(0x444444), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_t *system_next_lbl = lv_label_create(system_next);
    lv_label_set_text(system_next_lbl, ">");
    lv_obj_center(system_next_lbl);
    lv_obj_add_event_cb(system_next, systemNextEvent, LV_EVENT_CLICKED, this);
    
    // Band selector
    lv_obj_t *band_box = lv_obj_create(scr);
    lv_obj_set_size(band_box, 220, 78);
    lv_obj_set_pos(band_box, 10, 93);
    lv_obj_set_style_bg_color(band_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(band_box, 1, 0);
    lv_obj_set_style_border_color(band_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(band_box, 8, 0);
    lv_obj_clear_flag(band_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *band_title = lv_label_create(band_box);
    lv_label_set_text(band_title, "Band");
    lv_obj_set_style_text_color(band_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(band_title, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(band_title, 5, 5);
    
    lv_obj_t *band_prev = lv_btn_create(band_box);
    lv_obj_set_size(band_prev, 40, 35);
    lv_obj_set_pos(band_prev, 10, 28);
    lv_obj_set_style_bg_color(band_prev, lv_color_hex(0x444444), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_t *band_prev_lbl = lv_label_create(band_prev);
    lv_label_set_text(band_prev_lbl, "<");
    lv_obj_center(band_prev_lbl);
    lv_obj_add_event_cb(band_prev, bandPrevEvent, LV_EVENT_CLICKED, this);
    
    band_label = lv_label_create(band_box);
    lv_label_set_text(band_label, "R");
    lv_obj_set_style_text_font(band_label, &lv_font_montserrat_32, 0);
    lv_obj_set_style_text_color(band_label, lv_color_hex(0x00aaff), 0);
    lv_obj_set_pos(band_label, 90, 25);
    
    lv_obj_t *band_next = lv_btn_create(band_box);
    lv_obj_set_size(band_next, 40, 35);
    lv_obj_set_pos(band_next, 160, 28);
    lv_obj_set_style_bg_color(band_next, lv_color_hex(0x444444), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_t *band_next_lbl = lv_label_create(band_next);
    lv_label_set_text(band_next_lbl, ">");
    lv_obj_center(band_next_lbl);
    lv_obj_add_event_cb(band_next, bandNextEvent, LV_EVENT_CLICKED, this);
    
    // Channel selector
    lv_obj_t *channel_box = lv_obj_create(scr);
    lv_obj_set_size(channel_box, 220, 78);
    lv_obj_set_pos(channel_box, 10, 181);
    lv_obj_set_style_bg_color(channel_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(channel_box, 1, 0);
    lv_obj_set_style_border_color(channel_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(channel_box, 8, 0);
    lv_obj_clear_flag(channel_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *channel_title = lv_label_create(channel_box);
    lv_label_set_text(channel_title, "Channel");
    lv_obj_set_style_text_color(channel_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(channel_title, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(channel_title, 5, 5);
    
    lv_obj_t *channel_prev = lv_btn_create(channel_box);
    lv_obj_set_size(channel_prev, 40, 35);
    lv_obj_set_pos(channel_prev, 10, 28);
    lv_obj_set_style_bg_color(channel_prev, lv_color_hex(0x444444), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_t *channel_prev_lbl = lv_label_create(channel_prev);
    lv_label_set_text(channel_prev_lbl, "<");
    lv_obj_center(channel_prev_lbl);
    lv_obj_add_event_cb(channel_prev, channelPrevEvent, LV_EVENT_CLICKED, this);
    
    channel_label = lv_label_create(channel_box);
    lv_label_set_text(channel_label, "1");
    lv_obj_set_style_text_font(channel_label, &lv_font_montserrat_32, 0);
    lv_obj_set_style_text_color(channel_label, lv_color_hex(0x00aaff), 0);
    lv_obj_set_pos(channel_label, 90, 25);
    
    lv_obj_t *channel_next = lv_btn_create(channel_box);
    lv_obj_set_size(channel_next, 40, 35);
    lv_obj_set_pos(channel_next, 160, 28);
    lv_obj_set_style_bg_color(channel_next, lv_color_hex(0x444444), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_t *channel_next_lbl = lv_label_create(channel_next);
    lv_label_set_text(channel_next_lbl, ">");
    lv_obj_center(channel_next_lbl);
    lv_obj_add_event_cb(channel_next, channelNextEvent, LV_EVENT_CLICKED, this);
    
    // Frequency display
    lv_obj_t *freq_box = lv_obj_create(scr);
    lv_obj_set_size(freq_box, 220, 62);
    lv_obj_set_pos(freq_box, 10, 269);
    lv_obj_set_style_bg_color(freq_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(freq_box, 1, 0);
    lv_obj_set_style_border_color(freq_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(freq_box, 8, 0);
    lv_obj_clear_flag(freq_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *freq_title = lv_label_create(freq_box);
    lv_label_set_text(freq_title, "Frequency");
    lv_obj_set_style_text_color(freq_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(freq_title, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(freq_title, 5, 5);
    
    freq_label = lv_label_create(freq_box);
    lv_label_set_text(freq_label, "5658 MHz");
    lv_obj_set_style_text_font(freq_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(freq_label, lv_color_hex(0xffffff), 0);
    lv_obj_set_pos(freq_label, 60, 25);
}

void FpvLcdUI::createCalibTab() {
    lv_obj_t *scr = tab_calib;
    
    // Title
    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, "RSSI Calibration");
    lv_obj_set_style_text_font(title, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(title, lv_color_hex(0xffffff), 0);
    lv_obj_set_pos(title, 50, 5);
    
    // Current RSSI display
    lv_obj_t *rssi_box = lv_obj_create(scr);
    lv_obj_set_size(rssi_box, 220, 50);
    lv_obj_set_pos(rssi_box, 10, 30);
    lv_obj_set_style_bg_color(rssi_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(rssi_box, 2, 0);
    lv_obj_set_style_border_color(rssi_box, lv_color_hex(0x00ff00), 0);
    lv_obj_clear_flag(rssi_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *rssi_title = lv_label_create(rssi_box);
    lv_label_set_text(rssi_title, "Current RSSI:");
    lv_obj_set_style_text_font(rssi_title, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(rssi_title, lv_color_hex(0x888888), 0);
    lv_obj_set_pos(rssi_title, 10, 5);
    
    calib_rssi_label = lv_label_create(rssi_box);
    lv_label_set_text(calib_rssi_label, "0");
    lv_obj_set_style_text_font(calib_rssi_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(calib_rssi_label, lv_color_hex(0x00ff00), 0);
    lv_obj_set_pos(calib_rssi_label, 160, 10);
    
    // Large RSSI chart
    calib_chart = lv_chart_create(scr);
    lv_obj_set_size(calib_chart, 220, 160);
    lv_obj_set_pos(calib_chart, 10, 90);
    lv_chart_set_type(calib_chart, LV_CHART_TYPE_LINE);
    lv_chart_set_range(calib_chart, LV_CHART_AXIS_PRIMARY_Y, 0, 255);
    lv_chart_set_point_count(calib_chart, 50);
    lv_chart_set_div_line_count(calib_chart, 5, 10);
    lv_obj_set_style_size(calib_chart, 0, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(calib_chart, lv_color_hex(0x0a0a0a), 0);
    lv_obj_set_style_border_width(calib_chart, 2, 0);
    lv_obj_set_style_border_color(calib_chart, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(calib_chart, 5, 0);
    
    calib_series = lv_chart_add_series(calib_chart, lv_color_hex(0x00ff00), LV_CHART_AXIS_PRIMARY_Y);
    lv_obj_set_style_line_width(calib_chart, 2, LV_PART_ITEMS);
    
    // Add area fill under the line
    lv_obj_set_style_bg_opa(calib_chart, LV_OPA_50, LV_PART_ITEMS);  // 50% opacity fill
    lv_obj_set_style_bg_color(calib_chart, lv_color_hex(0x00ff00), LV_PART_ITEMS);
    
    // Initialize with zeros
    for (int i = 0; i < 50; i++) {
        calib_series->y_points[i] = 0;
    }
    lv_chart_refresh(calib_chart);
    
    // Threshold lines overlaid on chart
    // Enter threshold line (blue)
    calib_enter_line = lv_line_create(scr);
    lv_obj_set_style_line_width(calib_enter_line, 2, 0);
    lv_obj_set_style_line_color(calib_enter_line, lv_color_hex(0x0099ff), 0);
    lv_obj_set_style_line_dash_width(calib_enter_line, 5, 0);
    lv_obj_set_style_line_dash_gap(calib_enter_line, 3, 0);
    
    // Initialize with default points at middle of chart
    calib_enter_points[0].x = 15;
    calib_enter_points[0].y = 170;  // Middle of chart (90 + 80)
    calib_enter_points[1].x = 225;
    calib_enter_points[1].y = 170;
    lv_line_set_points(calib_enter_line, calib_enter_points, 2);
    
    // Exit threshold line (red)
    calib_exit_line = lv_line_create(scr);
    lv_obj_set_style_line_width(calib_exit_line, 2, 0);
    lv_obj_set_style_line_color(calib_exit_line, lv_color_hex(0xff0000), 0);
    lv_obj_set_style_line_dash_width(calib_exit_line, 5, 0);
    lv_obj_set_style_line_dash_gap(calib_exit_line, 3, 0);
    
    // Initialize with default points at middle of chart
    calib_exit_points[0].x = 15;
    calib_exit_points[0].y = 180;  // Slightly below enter line
    calib_exit_points[1].x = 225;
    calib_exit_points[1].y = 180;
    lv_line_set_points(calib_exit_line, calib_exit_points, 2);
    
    // Threshold controls with interactive buttons
    lv_obj_t *threshold_box = lv_obj_create(scr);
    lv_obj_set_size(threshold_box, 220, 140);
    lv_obj_set_pos(threshold_box, 10, 259);
    lv_obj_set_style_bg_color(threshold_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(threshold_box, 1, 0);
    lv_obj_set_style_border_color(threshold_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(threshold_box, 8, 0);
    lv_obj_clear_flag(threshold_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *threshold_title = lv_label_create(threshold_box);
    lv_label_set_text(threshold_title, "Thresholds");
    lv_obj_set_style_text_font(threshold_title, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(threshold_title, lv_color_hex(0x888888), 0);
    lv_obj_set_pos(threshold_title, 5, 2);
    
    // Enter threshold row
    lv_obj_t *enter_row_label = lv_label_create(threshold_box);
    lv_label_set_text(enter_row_label, "Enter");
    lv_obj_set_style_text_color(enter_row_label, lv_color_hex(0x00cc00), 0);
    lv_obj_set_style_text_font(enter_row_label, &lv_font_montserrat_12, 0);
    lv_obj_set_pos(enter_row_label, 5, 24);
    
    lv_obj_t *enter_prev = lv_btn_create(threshold_box);
    lv_obj_set_size(enter_prev, 50, 40);
    lv_obj_set_pos(enter_prev, 5, 40);
    lv_obj_set_style_bg_color(enter_prev, lv_color_hex(0x333333), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(enter_prev, 6, 0);
    lv_obj_t *enter_prev_lbl = lv_label_create(enter_prev);
    lv_label_set_text(enter_prev_lbl, LV_SYMBOL_MINUS);
    lv_obj_set_style_text_font(enter_prev_lbl, &lv_font_montserrat_16, 0);
    lv_obj_center(enter_prev_lbl);
    lv_obj_add_event_cb(enter_prev, enterDecEvent, LV_EVENT_CLICKED, this);
    
    threshold_enter_label = lv_label_create(threshold_box);
    calib_enter_value = threshold_enter_label;  // Reuse same pointer
    lv_label_set_text(threshold_enter_label, "120");
    lv_obj_set_style_text_font(threshold_enter_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(threshold_enter_label, lv_color_hex(0x00ff00), 0);
    lv_obj_set_pos(threshold_enter_label, 80, 44);
    
    lv_obj_t *enter_next = lv_btn_create(threshold_box);
    lv_obj_set_size(enter_next, 50, 40);
    lv_obj_set_pos(enter_next, 148, 40);
    lv_obj_set_style_bg_color(enter_next, lv_color_hex(0x333333), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(enter_next, 6, 0);
    lv_obj_t *enter_next_lbl = lv_label_create(enter_next);
    lv_label_set_text(enter_next_lbl, LV_SYMBOL_PLUS);
    lv_obj_set_style_text_font(enter_next_lbl, &lv_font_montserrat_16, 0);
    lv_obj_center(enter_next_lbl);
    lv_obj_add_event_cb(enter_next, enterIncEvent, LV_EVENT_CLICKED, this);
    
    // Exit threshold row
    lv_obj_t *exit_row_label = lv_label_create(threshold_box);
    lv_label_set_text(exit_row_label, "Exit");
    lv_obj_set_style_text_color(exit_row_label, lv_color_hex(0xff5500), 0);
    lv_obj_set_style_text_font(exit_row_label, &lv_font_montserrat_12, 0);
    lv_obj_set_pos(exit_row_label, 5, 88);
    
    lv_obj_t *exit_prev = lv_btn_create(threshold_box);
    lv_obj_set_size(exit_prev, 50, 40);
    lv_obj_set_pos(exit_prev, 5, 102);
    lv_obj_set_style_bg_color(exit_prev, lv_color_hex(0x333333), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(exit_prev, 6, 0);
    lv_obj_t *exit_prev_lbl = lv_label_create(exit_prev);
    lv_label_set_text(exit_prev_lbl, LV_SYMBOL_MINUS);
    lv_obj_set_style_text_font(exit_prev_lbl, &lv_font_montserrat_16, 0);
    lv_obj_center(exit_prev_lbl);
    lv_obj_add_event_cb(exit_prev, exitDecEvent, LV_EVENT_CLICKED, this);
    
    threshold_exit_label = lv_label_create(threshold_box);
    calib_exit_value = threshold_exit_label;  // Reuse same pointer
    lv_label_set_text(threshold_exit_label, "100");
    lv_obj_set_style_text_font(threshold_exit_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(threshold_exit_label, lv_color_hex(0xff5500), 0);
    lv_obj_set_pos(threshold_exit_label, 80, 106);
    
    lv_obj_t *exit_next = lv_btn_create(threshold_box);
    lv_obj_set_size(exit_next, 50, 40);
    lv_obj_set_pos(exit_next, 148, 102);
    lv_obj_set_style_bg_color(exit_next, lv_color_hex(0x333333), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_radius(exit_next, 6, 0);
    lv_obj_t *exit_next_lbl = lv_label_create(exit_next);
    lv_label_set_text(exit_next_lbl, LV_SYMBOL_PLUS);
    lv_obj_set_style_text_font(exit_next_lbl, &lv_font_montserrat_16, 0);
    lv_obj_center(exit_next_lbl);
    lv_obj_add_event_cb(exit_next, exitIncEvent, LV_EVENT_CLICKED, this);
}

void FpvLcdUI::createSystemTab() {
    lv_obj_t *scr = tab_system;
    
    // Title
    lv_obj_t *title = lv_label_create(scr);
    lv_label_set_text(title, "System Settings");
    lv_obj_set_style_text_font(title, &lv_font_montserrat_16, 0);
    lv_obj_set_style_text_color(title, lv_color_hex(0xffffff), 0);
    lv_obj_set_pos(title, 55, 5);
    
    // Brightness slider
    lv_obj_t *brightness_box = lv_obj_create(scr);
    lv_obj_set_size(brightness_box, 220, 65);
    lv_obj_set_pos(brightness_box, 10, 40);
    lv_obj_set_style_bg_color(brightness_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(brightness_box, 1, 0);
    lv_obj_set_style_border_color(brightness_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(brightness_box, 8, 0);
    lv_obj_clear_flag(brightness_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *brightness_title = lv_label_create(brightness_box);
    lv_label_set_text(brightness_title, "Brightness");
    lv_obj_set_style_text_color(brightness_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(brightness_title, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(brightness_title, 5, 5);
    
    brightness_slider = lv_slider_create(brightness_box);
    lv_obj_set_size(brightness_slider, 140, 12);
    lv_obj_set_pos(brightness_slider, 10, 35);
    lv_slider_set_range(brightness_slider, 10, 100);
    lv_slider_set_value(brightness_slider, 100, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(brightness_slider, lv_color_hex(0x444444), LV_PART_MAIN);
    lv_obj_set_style_bg_color(brightness_slider, lv_color_hex(0xffaa00), LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(brightness_slider, lv_color_hex(0xffffff), LV_PART_KNOB);
    lv_obj_set_style_pad_all(brightness_slider, 8, LV_PART_KNOB);  // Larger touch target
    lv_obj_add_event_cb(brightness_slider, brightnessSliderEvent, LV_EVENT_VALUE_CHANGED, this);
    
    brightness_label = lv_label_create(brightness_box);
    lv_label_set_text(brightness_label, "100%");
    lv_obj_set_style_text_font(brightness_label, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(brightness_label, lv_color_hex(0xffaa00), 0);
    lv_obj_set_pos(brightness_label, 162, 32);
    
    // Battery voltage display
    lv_obj_t *battery_box = lv_obj_create(scr);
    lv_obj_set_size(battery_box, 220, 65);
    lv_obj_set_pos(battery_box, 10, 115);
    lv_obj_set_style_bg_color(battery_box, lv_color_hex(0x1a1a1a), 0);
    lv_obj_set_style_border_width(battery_box, 1, 0);
    lv_obj_set_style_border_color(battery_box, lv_color_hex(0x333333), 0);
    lv_obj_set_style_pad_all(battery_box, 8, 0);
    lv_obj_clear_flag(battery_box, LV_OBJ_FLAG_SCROLLABLE);
    
    lv_obj_t *battery_title = lv_label_create(battery_box);
    lv_label_set_text(battery_title, "Battery Voltage");
    lv_obj_set_style_text_color(battery_title, lv_color_hex(0x888888), 0);
    lv_obj_set_style_text_font(battery_title, &lv_font_montserrat_14, 0);
    lv_obj_set_pos(battery_title, 5, 5);
    
    battery_voltage_label = lv_label_create(battery_box);
    lv_label_set_text(battery_voltage_label, "---V");
    lv_obj_set_style_text_font(battery_voltage_label, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(battery_voltage_label, lv_color_hex(0x00ff00), 0);
    lv_obj_set_pos(battery_voltage_label, 70, 28);
}

// Shorten scroll throw animation so it finishes in fewer frames (feels snappier with slow blit)
void FpvLcdUI::racingScrollBeginEvent(lv_event_t* e) {
    lv_anim_t* a = (lv_anim_t*)lv_event_get_param(e);
    if (a) lv_anim_set_time(a, 100);
}

// Button event callbacks (called from UI task on core 0)
void FpvLcdUI::startBtnEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui && !ui->_countdownActive) {
        // Disable start button during countdown
        if (ui->start_btn) lv_obj_add_state(ui->start_btn, LV_STATE_DISABLED);
        ui->startCountdown();
    }
}

void FpvLcdUI::stopBtnEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (!ui) return;
    // Cancel countdown if active
    if (ui->_countdownActive) {
        ui->stopCountdown();
        if (ui->start_btn) lv_obj_clear_state(ui->start_btn, LV_STATE_DISABLED);
        return;
    }
    // Otherwise stop the race and show finish overlay
    ui->showFinish();
    // Show start button, hide stop button
    if (ui->start_btn) lv_obj_clear_flag(ui->start_btn, LV_OBJ_FLAG_HIDDEN);
    if (ui->stop_btn) lv_obj_add_flag(ui->stop_btn, LV_OBJ_FLAG_HIDDEN);
    ui->_stopRequested = true;
}

void FpvLcdUI::clearBtnEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_clearRequested = true;
}

void FpvLcdUI::systemPrevEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_systemDelta = -1;
}

void FpvLcdUI::systemNextEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_systemDelta = 1;
}

void FpvLcdUI::bandPrevEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_bandDelta = -1;
}

void FpvLcdUI::bandNextEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_bandDelta = 1;
}

void FpvLcdUI::channelPrevEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_channelDelta = -1;
}

void FpvLcdUI::channelNextEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_channelDelta = 1;
}

void FpvLcdUI::enterDecEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_enterDelta = -5;
}

void FpvLcdUI::enterIncEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_enterDelta = 5;
}

void FpvLcdUI::exitDecEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_exitDelta = -5;
}

void FpvLcdUI::exitIncEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (ui) ui->_exitDelta = 5;
}

void FpvLcdUI::brightnessSliderEvent(lv_event_t* e) {
    FpvLcdUI* ui = static_cast<FpvLcdUI*>(lv_event_get_user_data(e));
    if (!ui || !ui->brightness_slider) return;
    
    uint8_t val = (uint8_t)lv_slider_get_value(ui->brightness_slider);
    ui->_userBrightness = val;
    ui->updateScreenBrightness();
    
    if (ui->brightness_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d%%", val);
        lv_label_set_text(ui->brightness_label, buf);
    }
}

// Consume button requests from main loop (core 1)
bool FpvLcdUI::consumeStartRequest() {
    if (_startRequested) { _startRequested = false; return true; }
    return false;
}

bool FpvLcdUI::consumeStopRequest() {
    if (_stopRequested) { _stopRequested = false; return true; }
    return false;
}

bool FpvLcdUI::consumeClearRequest() {
    if (_clearRequested) { _clearRequested = false; return true; }
    return false;
}

int8_t FpvLcdUI::consumeSystemDelta() {
    int8_t d = _systemDelta;
    if (d != 0) _systemDelta = 0;
    return d;
}

int8_t FpvLcdUI::consumeBandDelta() {
    int8_t d = _bandDelta;
    if (d != 0) _bandDelta = 0;
    return d;
}

int8_t FpvLcdUI::consumeChannelDelta() {
    int8_t d = _channelDelta;
    if (d != 0) _channelDelta = 0;
    return d;
}

int8_t FpvLcdUI::consumeEnterDelta() {
    int8_t d = _enterDelta;
    if (d != 0) _enterDelta = 0;
    return d;
}

int8_t FpvLcdUI::consumeExitDelta() {
    int8_t d = _exitDelta;
    if (d != 0) _exitDelta = 0;
    return d;
}

// Thread-safe: called from loop() on core 1, sets display values for UI task
void FpvLcdUI::setBandChannelDisplay(uint8_t systemIdx, uint8_t bandIdx, uint8_t channelIdx, uint16_t freqMhz) {
    _pendingSystemIdx = systemIdx;
    _pendingBandIdx = bandIdx;
    _pendingChannelIdx = channelIdx;
    _pendingFreqMhz = freqMhz;
    _bandChannelDirty = true;
}

// Thread-safe: called from loop() on core 1
void FpvLcdUI::setThresholdDisplay(uint8_t enterRssi, uint8_t exitRssi) {
    _pendingEnterRssi = enterRssi;
    _pendingExitRssi = exitRssi;
    _thresholdDirty = true;
}

// Thread-safe: called from loop() on core 1. Only stores value; LVGL update is done in UI task.
void FpvLcdUI::setBatteryDisplay(uint16_t voltage) {
    _pendingBatteryVoltage = voltage;
    _batteryDirty = true;
}

// Called from UI task on core 0 only - applies pending battery voltage to LVGL
void FpvLcdUI::processBatteryUpdate() {
    if (!_batteryDirty) return;
    _batteryDirty = false;

    uint16_t voltage = _pendingBatteryVoltage;
    if (!battery_label || !battery_icon) return;

    // Calculate percentage from voltage (3.0V = 0%, 4.2V = 100%)
    int16_t percentage = map(voltage, 30, 42, 0, 100);
    if (percentage < 0) percentage = 0;
    if (percentage > 100) percentage = 100;

    char buf[8];
    snprintf(buf, sizeof(buf), "%d%%", percentage);
    lv_label_set_text(battery_label, buf);

    uint32_t color;
    if (percentage > 60) {
        color = 0x00ff00;
    } else if (percentage > 20) {
        color = 0xffaa00;
    } else {
        color = 0xff0000;
    }
    lv_obj_set_style_text_color(battery_label, lv_color_hex(color), 0);

    uint16_t width = map(percentage, 0, 100, 3, 20);
    if (width < 3) width = 3;
    lv_obj_set_width(battery_icon, width);
    lv_obj_set_style_bg_color(battery_icon, lv_color_hex(color), 0);

    if (battery_voltage_label) {
        char voltageBuf[16];
        float volts = voltage / 10.0f;
        snprintf(voltageBuf, sizeof(voltageBuf), "%.2fV", volts);
        lv_label_set_text(battery_voltage_label, voltageBuf);
        lv_obj_set_style_text_color(battery_voltage_label, lv_color_hex(color), 0);
    }
}

// Thread-safe: called from loop() on core 1, just stores the value
void FpvLcdUI::updateRSSI(uint8_t rssi) {
    _pendingRssi = rssi;
}

// Thread-safe: called from loop() on core 1
void FpvLcdUI::addLap(uint32_t lapTimeMs) {
    // Shift buffer down to make room for new lap
    uint8_t count = _lapCount;
    uint8_t stored = (count < MAX_DISPLAY_LAPS) ? count : MAX_DISPLAY_LAPS;
    for (int i = stored; i > 0; i--) {
        _lapBuffer[i < MAX_DISPLAY_LAPS ? i : MAX_DISPLAY_LAPS - 1] = _lapBuffer[i - 1];
    }
    _lapBuffer[0] = lapTimeMs;  // Newest lap at index 0
    _lapCount = count + 1;
    _lapsDirty = true;
}

// Thread-safe: called from loop() on core 1
void FpvLcdUI::clearLaps() {
    _lapCount = 0;
    for (int i = 0; i < MAX_DISPLAY_LAPS; i++) {
        _lapBuffer[i] = 0;
    }
    _lapsDirty = true;
}

// Called from UI task on core 0 only - safe to touch LVGL objects
void FpvLcdUI::processRssiUpdate() {
    uint8_t rssi = _pendingRssi;
    
    // Update racing tab RSSI with threshold highlighting
    if (rssi_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", rssi);
        lv_label_set_text(rssi_label, buf);
        
        // Highlight when above enter threshold
        uint8_t enterThreshold = _pendingEnterRssi;
        if (rssi >= enterThreshold) {
            // Above enter threshold - highlight in orange
            lv_obj_set_style_text_color(rssi_label, lv_color_hex(0xff8800), 0);
        } else {
            // Below threshold - normal green
            lv_obj_set_style_text_color(rssi_label, lv_color_hex(0x00ff00), 0);
        }
    }
    
    // Update racing tab chart with threshold-aware coloring
    if (rssi_chart && rssi_series) {
        uint32_t now = millis();
        if (now - _lastGraphUpdate >= 100) {  // Update chart at 10Hz
            _lastGraphUpdate = now;
            
            // Change series color based on threshold crossing
            uint8_t enterThreshold = _pendingEnterRssi;
            if (rssi >= enterThreshold) {
                // Above enter threshold - change to orange
                lv_chart_set_series_color(rssi_chart, rssi_series, lv_color_hex(0xff8800));
            } else {
                // Below threshold - normal green
                lv_chart_set_series_color(rssi_chart, rssi_series, lv_color_hex(0x00ff00));
            }
            
            lv_chart_set_next_value(rssi_chart, rssi_series, rssi);
        }
    }
    
    // Update calibration tab RSSI with threshold highlighting
    if (calib_rssi_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", rssi);
        lv_label_set_text(calib_rssi_label, buf);
        
        // Highlight when above enter threshold
        uint8_t enterThreshold = _pendingEnterRssi;
        if (rssi >= enterThreshold) {
            // Above enter threshold - highlight in orange
            lv_obj_set_style_text_color(calib_rssi_label, lv_color_hex(0xff8800), 0);
        } else {
            // Below threshold - normal green
            lv_obj_set_style_text_color(calib_rssi_label, lv_color_hex(0x00ff00), 0);
        }
    }
    
    // Update calibration tab chart with threshold-aware coloring
    if (calib_chart && calib_series) {
        static uint32_t lastCalibUpdate = 0;
        uint32_t now = millis();
        if (now - lastCalibUpdate >= 100) {  // Update chart at 10Hz
            lastCalibUpdate = now;
            
            // Change series color based on threshold crossing
            uint8_t enterThreshold = _pendingEnterRssi;
            if (rssi >= enterThreshold) {
                // Above enter threshold - change to orange
                lv_chart_set_series_color(calib_chart, calib_series, lv_color_hex(0xff8800));
            } else {
                // Below threshold - normal green
                lv_chart_set_series_color(calib_chart, calib_series, lv_color_hex(0x00ff00));
            }
            
            lv_chart_set_next_value(calib_chart, calib_series, rssi);
        }
    }
}

// Called from UI task on core 0 only
void FpvLcdUI::processLapUpdate() {
    if (!_lapsDirty) return;
    _lapsDirty = false;
    
    uint8_t totalLaps = _lapCount;
    uint8_t displayed = (totalLaps < MAX_DISPLAY_LAPS) ? totalLaps : MAX_DISPLAY_LAPS;
    
    // Update lap counter
    if (lap_count_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", totalLaps);
        lv_label_set_text(lap_count_label, buf);
    }
    
    // Update lap time labels: full list, newest first (Lap N, Lap N-1, ...)
    for (int i = 0; i < MAX_DISPLAY_LAPS; i++) {
        if (!lap_times_labels[i]) continue;
        if (i < displayed) {
            uint32_t ms = _lapBuffer[i];
            uint32_t secs = ms / 1000;
            uint32_t frac = ms % 1000;
            uint8_t lapNum = totalLaps - i;  // Most recent = highest number
            char buf[32];
            snprintf(buf, sizeof(buf), "Lap %d: %lu.%03lus", lapNum, (unsigned long)secs, frac);
            lv_label_set_text(lap_times_labels[i], buf);
            lv_obj_set_style_text_color(lap_times_labels[i],
                i == 0 ? lv_color_hex(0x00ff00) : lv_color_hex(0xaaaaaa), 0);
            lv_obj_clear_flag(lap_times_labels[i], LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_label_set_text(lap_times_labels[i], "");
            lv_obj_add_flag(lap_times_labels[i], LV_OBJ_FLAG_HIDDEN);
        }
    }
}

// Called from UI task on core 0 only
void FpvLcdUI::processBandChannelUpdate() {
    if (!_bandChannelDirty) return;
    _bandChannelDirty = false;
    
    uint8_t systemIdx = _pendingSystemIdx;
    uint8_t bandIdx = _pendingBandIdx;
    uint8_t channelIdx = _pendingChannelIdx;
    uint16_t freq = _pendingFreqMhz;
    
    // Update system label
    if (system_label) {
        static const char* systemNames[] = { "Analog", "DJI", "HDZero", "WalkSnail" };
        if (systemIdx < 4) {
            lv_label_set_text(system_label, systemNames[systemIdx]);
        }
    }
    
    // Update band label
    if (band_label) {
        static const char* bandNames[] = {
            "A", "B", "E", "F", "R", "L",
            "v1-25", "v1-25CE", "v1-50", "O3-20", "O3-20CE",
            "O3-40", "O3-40CE", "O3-R", "R", "E",
            "F", "CE", "R", "25", "25CE", "50"
        };
        if (bandIdx < 22) {
            lv_label_set_text(band_label, bandNames[bandIdx]);
        } else {
            lv_label_set_text(band_label, "?");
        }
    }
    
    // Update channel label
    if (channel_label) {
        char buf[4];
        snprintf(buf, sizeof(buf), "%d", channelIdx + 1);
        lv_label_set_text(channel_label, buf);
    }
    
    // Update frequency label
    if (freq_label) {
        char buf[16];
        snprintf(buf, sizeof(buf), "%d MHz", freq);
        lv_label_set_text(freq_label, buf);
    }
}

// Called from UI task on core 0 only
void FpvLcdUI::processThresholdUpdate() {
    if (!_thresholdDirty) return;
    _thresholdDirty = false;
    
    uint8_t enter = _pendingEnterRssi;
    uint8_t exit_val = _pendingExitRssi;
    
    // Update pilot tab threshold labels
    if (threshold_enter_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", enter);
        lv_label_set_text(threshold_enter_label, buf);
    }
    
    if (threshold_exit_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", exit_val);
        lv_label_set_text(threshold_exit_label, buf);
    }
    
    // Update calibration tab threshold displays
    if (calib_enter_value) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", enter);
        lv_label_set_text(calib_enter_value, buf);
    }
    
    if (calib_exit_value) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", exit_val);
        lv_label_set_text(calib_exit_value, buf);
    }
    
    // Update racing tab threshold lines
    // Chart is at (75, 10) with size (140, 45), with 2px padding
    const int16_t racing_chart_x = 75;
    const int16_t racing_chart_y = 10;
    const int16_t racing_chart_w = 140;
    const int16_t racing_chart_h = 45;
    const int16_t racing_pad = 2;
    const int16_t racing_inner_h = racing_chart_h - (2 * racing_pad);
    
    if (rssi_enter_line) {
        // Map enter threshold (0-255) to chart Y position (inverted: high RSSI = top)
        int16_t y_pos = racing_chart_y + racing_pad + racing_inner_h - (enter * racing_inner_h / 255);
        
        rssi_enter_points[0].x = racing_chart_x + racing_pad;
        rssi_enter_points[0].y = y_pos;
        rssi_enter_points[1].x = racing_chart_x + racing_chart_w - racing_pad;
        rssi_enter_points[1].y = y_pos;
        lv_line_set_points(rssi_enter_line, rssi_enter_points, 2);
    }
    
    if (rssi_exit_line) {
        // Map exit threshold (0-255) to chart Y position (inverted: high RSSI = top)
        int16_t y_pos = racing_chart_y + racing_pad + racing_inner_h - (exit_val * racing_inner_h / 255);
        
        rssi_exit_points[0].x = racing_chart_x + racing_pad;
        rssi_exit_points[0].y = y_pos;
        rssi_exit_points[1].x = racing_chart_x + racing_chart_w - racing_pad;
        rssi_exit_points[1].y = y_pos;
        lv_line_set_points(rssi_exit_line, rssi_exit_points, 2);
    }
    
    // Update calibration chart threshold lines
    // Chart is at (10, 90) with size (220, 160), with 5px padding
    // Y range is 0-255 RSSI, chart inner area is approximately 150px high
    const int16_t chart_x = 10;
    const int16_t chart_y = 90;
    const int16_t chart_w = 220;
    const int16_t chart_h = 160;
    const int16_t pad = 5;
    const int16_t inner_h = chart_h - (2 * pad);
    
    if (calib_enter_line) {
        // Map enter threshold (0-255) to chart Y position (inverted: high RSSI = top)
        int16_t y_pos = chart_y + pad + inner_h - (enter * inner_h / 255);
        
        calib_enter_points[0].x = chart_x + pad;
        calib_enter_points[0].y = y_pos;
        calib_enter_points[1].x = chart_x + chart_w - pad;
        calib_enter_points[1].y = y_pos;
        lv_line_set_points(calib_enter_line, calib_enter_points, 2);
    }
    
    if (calib_exit_line) {
        // Map exit threshold (0-255) to chart Y position (inverted: high RSSI = top)
        int16_t y_pos = chart_y + pad + inner_h - (exit_val * inner_h / 255);
        
        calib_exit_points[0].x = chart_x + pad;
        calib_exit_points[0].y = y_pos;
        calib_exit_points[1].x = chart_x + chart_w - pad;
        calib_exit_points[1].y = y_pos;
        lv_line_set_points(calib_exit_line, calib_exit_points, 2);
    }
}

void FpvLcdUI::updateBandChannel(uint8_t band, uint8_t channel) {
    if (band_label && channel_label) {
        const char* bands[] = {"A", "B", "E", "F", "R", "L"};
        if (band < 6) {
            lv_label_set_text(band_label, bands[band]);
        }
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", channel + 1);
        lv_label_set_text(channel_label, buf);
    }
}

void FpvLcdUI::updateFrequency(uint16_t freq) {
    if (freq_label) {
        char buf[16];
        snprintf(buf, sizeof(buf), "%d MHz", freq);
        lv_label_set_text(freq_label, buf);
    }
}

void FpvLcdUI::updateThreshold(uint8_t enter_rssi, uint8_t exit_rssi) {
    if (threshold_enter_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", enter_rssi);
        lv_label_set_text(threshold_enter_label, buf);
    }
    if (threshold_exit_label) {
        char buf[8];
        snprintf(buf, sizeof(buf), "%d", exit_rssi);
        lv_label_set_text(threshold_exit_label, buf);
    }
}

void FpvLcdUI::updateLapTimes(float* lapTimes, uint8_t lapCount) {
    for (int i = 0; i < LAP_TIMES_LABELS && i < lapCount; i++) {
        if (lap_times_labels[i]) {
            char buf[32];
            snprintf(buf, sizeof(buf), "Lap %d: %.2fs", i + 1, lapTimes[i]);
            lv_label_set_text(lap_times_labels[i], buf);
            lv_obj_clear_flag(lap_times_labels[i], LV_OBJ_FLAG_HIDDEN);
        }
    }
    for (int i = lapCount; i < LAP_TIMES_LABELS; i++) {
        if (lap_times_labels[i]) {
            lv_label_set_text(lap_times_labels[i], "");
            lv_obj_add_flag(lap_times_labels[i], LV_OBJ_FLAG_HIDDEN);
        }
    }
}

void FpvLcdUI::updateBattery(uint8_t percentage, float voltage) {
    if (battery_label) {
        char buf[16];
        snprintf(buf, sizeof(buf), "%d%%", percentage);
        lv_label_set_text(battery_label, buf);
    }
}

void FpvLcdUI::updateStatus(const char* status) {
    if (status_label) {
        lv_label_set_text(status_label, status);
    }
}

// Thread-safe: called from main (core 1). Only store values; LVGL update is done in UI task (core 0).
void FpvLcdUI::updateRaceTime(uint32_t raceTimeMs) {
    _pendingRaceTimeMs = raceTimeMs;
    _raceTimingDirty = true;
}

void FpvLcdUI::updateCurrentLapTime(uint32_t lapTimeMs) {
    _pendingCurrentLapTimeMs = lapTimeMs;
    _raceTimingDirty = true;
}

void FpvLcdUI::updateFastestLap(uint32_t lapTimeMs) {
    _pendingFastestLapMs = lapTimeMs;
    _raceTimingDirty = true;
}

void FpvLcdUI::updateFastest3Laps(uint32_t totalTimeMs) {
    _pendingFastest3LapsMs = totalTimeMs;
    _raceTimingDirty = true;
}

// Called from UI task on core 0 only - applies pending race timing to LVGL (avoids core 1 touching LVGL).
void FpvLcdUI::processRaceTimingUpdate() {
    if (!_raceTimingDirty) return;
    _raceTimingDirty = false;

    uint32_t raceTimeMs = _pendingRaceTimeMs;
    uint32_t currentLapMs = _pendingCurrentLapTimeMs;
    uint32_t fastestMs = _pendingFastestLapMs;
    uint32_t fastest3Ms = _pendingFastest3LapsMs;

    if (race_time_label) {
        uint32_t totalSeconds = raceTimeMs / 1000;
        uint32_t minutes = totalSeconds / 60;
        uint32_t seconds = totalSeconds % 60;
        uint32_t tenths = (raceTimeMs % 1000) / 100;
        char buf[16];
        snprintf(buf, sizeof(buf), "%u:%02u.%u", minutes, seconds, tenths);
        lv_label_set_text(race_time_label, buf);
    }
    if (current_lap_label) {
        uint32_t totalSeconds = currentLapMs / 1000;
        uint32_t minutes = totalSeconds / 60;
        uint32_t seconds = totalSeconds % 60;
        uint32_t tenths = (currentLapMs % 1000) / 100;
        char buf[16];
        snprintf(buf, sizeof(buf), "%u:%02u.%u", minutes, seconds, tenths);
        lv_label_set_text(current_lap_label, buf);
    }
    if (fastest_lap_label) {
        if (fastestMs == 0 || fastestMs == UINT32_MAX) {
            lv_label_set_text(fastest_lap_label, "--:--");
        } else {
            uint32_t totalSeconds = fastestMs / 1000;
            uint32_t minutes = totalSeconds / 60;
            uint32_t seconds = totalSeconds % 60;
            uint32_t tenths = (fastestMs % 1000) / 100;
            char buf[16];
            snprintf(buf, sizeof(buf), "%u:%02u.%u", minutes, seconds, tenths);
            lv_label_set_text(fastest_lap_label, buf);
        }
    }
    if (fastest_3_label) {
        if (fastest3Ms == 0 || fastest3Ms == UINT32_MAX) {
            lv_label_set_text(fastest_3_label, "--:--");
        } else {
            uint32_t avgTimeMs = fastest3Ms / 3;
            uint32_t totalSeconds = avgTimeMs / 1000;
            uint32_t minutes = totalSeconds / 60;
            uint32_t seconds = totalSeconds % 60;
            uint32_t tenths = (avgTimeMs % 1000) / 100;
            char buf[16];
            snprintf(buf, sizeof(buf), "%u:%02u.%u", minutes, seconds, tenths);
            lv_label_set_text(fastest_3_label, buf);
        }
    }
}

void FpvLcdUI::updateScreenBrightness() {
    uint8_t pwm_value = map(_userBrightness, 10, 100, 25, 255);
    analogWrite(LCD_BL, pwm_value);
}

// Consume buzzer beep request (called from loop() on core 1)
uint16_t FpvLcdUI::consumeBuzzerBeep() {
    uint16_t ms = _pendingBuzzerMs;
    if (ms != 0) _pendingBuzzerMs = 0;
    return ms;
}

// === Countdown overlay methods ===

void FpvLcdUI::startCountdown(bool triggerStartWhenComplete) {
    if (_countdownActive) return;
    
    _countdownTriggersStart = triggerStartWhenComplete;
#ifdef HAS_I2S_AUDIO
    if (g_audioAnnouncer) g_audioAnnouncer->announceCountdown();
#endif
    Serial.println("LCD: Starting 10-second countdown");
    _countdownActive = true;
    _countdownValue = 10;
    _startingInFivePlayed = false;
    _lastBeepValue = -1;
    _countdownStartTime = millis();
    
    // Create fullscreen overlay on the top layer so it's always above tabview/scroll and stays visible
    lv_obj_t* top = lv_layer_top();
    if (!top) {
        Serial.println("[LCD] ERROR: No top layer for countdown overlay!");
        _countdownActive = false;
        return;
    }
    countdown_overlay = lv_obj_create(top);
    lv_obj_set_size(countdown_overlay, 240, 320);
    lv_obj_set_pos(countdown_overlay, 0, 0);
    lv_obj_set_style_bg_color(countdown_overlay, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_opa(countdown_overlay, LV_OPA_80, 0);
    lv_obj_set_style_border_width(countdown_overlay, 0, 0);
    lv_obj_set_style_pad_all(countdown_overlay, 0, 0);
    lv_obj_clear_flag(countdown_overlay, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_move_foreground(countdown_overlay);
    
    // Large centered countdown number
    countdown_label = lv_label_create(countdown_overlay);
    lv_label_set_text(countdown_label, "10");
    lv_obj_set_style_text_font(countdown_label, &lv_font_montserrat_32, 0);
    lv_obj_set_style_text_color(countdown_label, lv_color_hex(0xff7b00), 0);  // Orange
    lv_obj_set_style_text_align(countdown_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_bg_opa(countdown_label, LV_OPA_TRANSP, 0);
    lv_obj_align(countdown_label, LV_ALIGN_CENTER, 0, 0);
    
    // Request first beep (150ms short beep)
    _pendingBuzzerMs = 150;
}

void FpvLcdUI::updateCountdown() {
    if (!_countdownActive) return;
    
    uint32_t elapsed = millis() - _countdownStartTime;
    
    // Calculate expected value: 10, 9, ..., 1, GO! (1s each, GO! for 600ms)
    int expectedValue;
    if (elapsed < 1000) expectedValue = 10;
    else if (elapsed < 2000) expectedValue = 9;
    else if (elapsed < 3000) expectedValue = 8;
    else if (elapsed < 4000) expectedValue = 7;
    else if (elapsed < 5000) expectedValue = 6;
    else if (elapsed < 6000) expectedValue = 5;
    else if (elapsed < 7000) expectedValue = 4;
    else if (elapsed < 8000) expectedValue = 3;
    else if (elapsed < 9000) expectedValue = 2;
    else if (elapsed < 10000) expectedValue = 1;
    else if (elapsed < 10600) expectedValue = 0;  // GO!
    else {
        // Countdown complete; optionally fire start (LCD button flow; web flow is visual-only)
        stopCountdown();
        if (start_btn) {
            lv_obj_clear_state(start_btn, LV_STATE_DISABLED);
            lv_obj_add_flag(start_btn, LV_OBJ_FLAG_HIDDEN);  // Hide start button
        }
        if (stop_btn) lv_obj_clear_flag(stop_btn, LV_OBJ_FLAG_HIDDEN);  // Show stop button
        if (_countdownTriggersStart) {
            _startRequested = true;  // Core 1 picks this up and calls ws.triggerStart()
            Serial.println("LCD: Countdown complete, starting race");
        }
        return;
    }
    
    // Update display when value changes
    if (expectedValue != _countdownValue) {
        _countdownValue = expectedValue;
        
        if (countdown_label) {
            if (expectedValue == 0) {
                lv_label_set_text(countdown_label, "GO!");
                lv_obj_set_style_text_color(countdown_label, lv_color_hex(0x00ff88), 0);  // Green
                lv_obj_align(countdown_label, LV_ALIGN_CENTER, 0, 0);
                if (_lastBeepValue != 0) {
                    _pendingBuzzerMs = 400;  // Longer beep for GO!
                    _lastBeepValue = 0;
                }
            } else {
                char buf[4];
                snprintf(buf, sizeof(buf), "%d", expectedValue);
                lv_label_set_text(countdown_label, buf);
                lv_obj_set_style_text_color(countdown_label, lv_color_hex(0xff7b00), 0);  // Orange
                lv_obj_align(countdown_label, LV_ALIGN_CENTER, 0, 0);
                // "Starting in less than 5" only once, when we actually hit the 5-second mark
                if (expectedValue == 5 && elapsed >= 5000 && !_startingInFivePlayed) {
                    _startingInFivePlayed = true;
#ifdef HAS_I2S_AUDIO
                    if (g_audioAnnouncer) g_audioAnnouncer->announceStartingInFive();
#endif
                }
                if (_lastBeepValue != expectedValue) {
                    _pendingBuzzerMs = 150;  // Short beep per count
                    _lastBeepValue = expectedValue;
                }
            }
            lv_obj_invalidate(countdown_label);
        }
    }
}

void FpvLcdUI::stopCountdown() {
    if (!_countdownActive) return;
    
    _countdownActive = false;
    
    if (countdown_label) {
        lv_obj_del(countdown_label);
        countdown_label = nullptr;
    }
    if (countdown_overlay) {
        lv_obj_del(countdown_overlay);
        countdown_overlay = nullptr;
    }
}

// === Finish overlay methods ===

void FpvLcdUI::showFinish() {
    if (_finishActive) return;
    
    Serial.println("LCD: Showing STOPPED overlay");
    _finishActive = true;
    _finishStartTime = millis();
    
    // Create fullscreen semi-transparent overlay on the main screen (not the tab)
    lv_obj_t* scr = lv_scr_act();
    if (!scr) {
        Serial.println("[LCD] ERROR: No screen available for finish overlay!");
        _finishActive = false;
        return;
    }
    finish_overlay = lv_obj_create(scr);
    lv_obj_set_size(finish_overlay, 240, 320);
    lv_obj_set_pos(finish_overlay, 0, 0);
    lv_obj_set_style_bg_color(finish_overlay, lv_color_hex(0x000000), 0);
    lv_obj_set_style_bg_opa(finish_overlay, LV_OPA_80, 0);
    lv_obj_set_style_border_width(finish_overlay, 0, 0);
    lv_obj_set_style_pad_all(finish_overlay, 0, 0);
    lv_obj_clear_flag(finish_overlay, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_move_foreground(finish_overlay);
    
    // Large centered "STOPPED" text
    finish_label = lv_label_create(finish_overlay);
    lv_label_set_text(finish_label, "STOPPED");
    lv_obj_set_style_text_font(finish_label, &lv_font_montserrat_32, 0);
    lv_obj_set_style_text_color(finish_label, lv_color_hex(0xff4444), 0);  // Red
    lv_obj_set_style_text_align(finish_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_bg_opa(finish_label, LV_OPA_TRANSP, 0);
    lv_obj_align(finish_label, LV_ALIGN_CENTER, 0, 0);
}

void FpvLcdUI::updateFinish() {
    if (!_finishActive) return;
    
    if (millis() - _finishStartTime >= FINISH_DISPLAY_DURATION) {
        stopFinish();
    }
}

void FpvLcdUI::stopFinish() {
    if (!_finishActive) return;
    
    _finishActive = false;
    
    if (finish_label) {
        lv_obj_del(finish_label);
        finish_label = nullptr;
    }
    if (finish_overlay) {
        lv_obj_del(finish_overlay);
        finish_overlay = nullptr;
    }
}

void FpvLcdUI::setBootComplete() {
    _bootComplete = true;
}

void FpvLcdUI::requestCountdown(bool triggerStartOnComplete) {
    _requestCountdownTriggerStart = triggerStartOnComplete;
    _requestCountdown = true;
}

void FpvLcdUI::requestShowFinish() {
    _requestShowFinish = true;
}

void FpvLcdUI::processBootOverlay() {
    if (!_bootComplete || !_bootOverlayActive) return;
    _bootOverlayActive = false;  // allow touch immediately (touchpadRead checks this)
    if (boot_overlay) {
        // Move to back instead of delete/hide: keeps LVGL tree intact so display + touch keep working.
        // Tabview is now on top for drawing and hit-testing.
        lv_obj_move_background(boot_overlay);
        lv_obj_invalidate(lv_scr_act());
    }
}

#endif // ENABLE_LCD_UI
