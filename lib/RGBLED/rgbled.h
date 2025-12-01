#pragma once

#ifdef ESP32S3

#include <Arduino.h>
#include <FastLED.h>

#define NUM_LEDS 2

typedef enum {
    RGB_OFF,
    RGB_SOLID,
    RGB_PULSE,
    RGB_FLASH,
    RGB_COUNTDOWN,
    RGB_RAINBOW_WAVE,
    RGB_SPARKLE,
    RGB_BREATHING,
    RGB_CHASE,
    RGB_ERROR_BLINK,
    RGB_FIRE,
    RGB_OCEAN,
    RGB_POLICE,
    RGB_STROBE,
    RGB_COMET
} rgb_mode_e;

typedef enum {
    PRESET_OFF = 0,
    PRESET_SOLID_COLOUR,    // User-defined solid color
    PRESET_RAINBOW,
    PRESET_COLOR_FADE,      // Pulsing version of custom color
    PRESET_FIRE,            // Warm flickering fire effect
    PRESET_OCEAN,           // Cool blue/cyan waves
    PRESET_POLICE,          // Red/Blue alternating (customizable)
    PRESET_STROBE,          // Fast flashing (customizable color)
    PRESET_COMET,           // Shooting star effect
    PRESET_PILOT_COLOUR     // Uses pilot color (set via /led/color)
} led_preset_e;

typedef enum {
    STATUS_BOOTING,          // Blue pulse - system booting/AP launching
    STATUS_USER_CONNECTED,   // Green solid - user connected to web interface
    STATUS_RACE_COUNTDOWN,   // Red->Yellow->Green traffic light sequence
    STATUS_RACE_RUNNING,     // Cyan solid - race in progress
    STATUS_LAP_FLASH,        // White flash - new lap detected
    STATUS_RACE_END,         // Blue solid - race ended
    STATUS_RACE_RESET,       // Off - race reset
    STATUS_BATTERY_ALARM,    // Red flash - low battery
    STATUS_OFF
} rgb_status_e;

class RgbLed {
   public:
    void init();
    void handleRgbLed(uint32_t currentTimeMs);
    
    // Status-based methods
    void setStatus(rgb_status_e status);
    void startCountdown();  // Start 3-2-1 countdown (deprecated, now just flashes green)
    void flashGreen();      // Flash green once for race start
    void flashLap();        // Flash white for lap detection
    void flashReset();      // Flash red 3 times for race reset
    void off();
    
    // Race event effects
    void celebrateLap(uint8_t lapNumber);     // Animated effect for lap completion
    void celebrateRaceEnd(bool newRecord);    // Big celebration for race end
    void showErrorCode(uint8_t errorCode);    // Blink error code pattern
    
    // Direct color control
    void setColor(CRGB color, rgb_mode_e mode = RGB_SOLID);
    void setBrightness(uint8_t brightness);
    
    // Manual control methods
    void setManualColor(uint32_t colorHex);  // RGB as 0xRRGGBB
    void setFadeColor(uint32_t colorHex);    // Set color for COLOR_FADE preset
    void setStrobeColor(uint32_t colorHex);  // Set color for STROBE preset
    void setManualMode(rgb_mode_e mode);
    void setRainbowWave(uint8_t speed = 5);
    void setEffectSpeed(uint8_t speed);      // Set animation speed (1-20)
    void enableIdleRainbow(bool enable) { idleRainbowEnabled = enable; }
    rgb_mode_e getCurrentMode() const { return currentMode; }
    CRGB getCurrentColor() const { return targetColor; }
    
    // Preset system
    void setPreset(led_preset_e preset);
    void enableManualOverride(bool enable) { manualOverride = enable; }
    bool isManualOverride() const { return manualOverride; }

   private:
    CRGB leds[NUM_LEDS];
    rgb_status_e currentStatus = STATUS_OFF;
    rgb_mode_e currentMode = RGB_OFF;
    CRGB targetColor = CRGB::Black;
    
    // Animation state
    uint32_t lastUpdateMs = 0;
    uint32_t flashStartMs = 0;
    uint8_t pulseValue = 0;
    bool pulseDirection = true;
    
    // Flash parameters
    bool isFlashing = false;
    uint32_t flashDuration = 0;
    uint8_t flashCount = 0;        // For multi-flash (reset)
    uint8_t flashesRemaining = 0;  // Flashes left to do
    CRGB flashColor = CRGB::White; // Color to flash
    
    // Countdown state
    bool isCountdown = false;
    uint32_t countdownStartMs = 0;
    uint8_t countdownPhase = 0;  // 0=red, 1=yellow, 2=green, 3=done
    
    // Animation speed and state
    uint8_t rainbowHue = 0;
    uint8_t rainbowSpeed = 5;
    uint8_t effectSpeed = 5;         // Global effect speed (1-20)
    uint8_t firePhase = 0;           // Fire effect phase
    uint8_t oceanPhase = 0;          // Ocean effect phase
    bool policeState = false;        // Police effect state
    uint8_t cometPos = 0;            // Comet position
    bool idleRainbowEnabled = false;
    rgb_mode_e savedMode = RGB_OFF;  // Mode to return to after events
    CRGB savedColor = CRGB::Black;   // Color to return to after events
    
    // Manual override and presets
    bool manualOverride = false;
    led_preset_e currentPreset = PRESET_RAINBOW;
    CRGB fadeColor = CRGB::Blue;      // Color for COLOR_FADE preset
    CRGB strobeColor = CRGB::White;   // Color for STROBE preset
    
    // Error code state
    uint8_t errorBlinkCount = 0;
    uint8_t errorBlinksRemaining = 0;
    uint32_t errorBlinkTime = 0;
    
    // Race timeline control
    bool temporarilyDisabled = false;
    uint32_t disableUntilMs = 0;
    uint8_t savedBrightness = 80;
    bool inRace = false;
    
    void updateAnimation(uint32_t currentTimeMs);
    void updateCountdown(uint32_t currentTimeMs);
    void updateRainbowWave();
    void updateSparkle();
    void updateBreathing();
    void updateChase();
    void updateFire();
    void updateOcean();
    void updatePolice();
    void updateStrobe();
    void updateComet();
    void updateErrorBlink(uint32_t currentTimeMs);
    void applyStatus();
    void applyPreset(led_preset_e preset);
    void saveCurrentState();
    void restoreSavedState();
};

#endif // ESP32S3
