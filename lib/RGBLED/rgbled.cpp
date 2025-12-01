#ifdef ESP32S3

#include "rgbled.h"
#include "debug.h"

#define PULSE_SPEED 5
#define FLASH_DURATION_MS 200
#define COUNTDOWN_PHASE_MS 1000  // 1 second per phase (Red, Yellow, Green)

void RgbLed::init() {
    // GPIO5 for external NeoPixel strip - must be compile-time constant for FastLED template
    FastLED.addLeds<WS2812, 5, GRB>(leds, NUM_LEDS);
    FastLED.setBrightness(80); // Medium-high brightness
    // Initialize all LEDs to off
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = CRGB::Black;
    }
    FastLED.show();
    DEBUG("RGB LED initialized on GPIO5 with %d LEDs\n", NUM_LEDS);
}

void RgbLed::handleRgbLed(uint32_t currentTimeMs) {
    // Check if we need to re-enable LEDs after temporary disable
    if (temporarilyDisabled && currentTimeMs >= disableUntilMs) {
        temporarilyDisabled = false;
        if (inRace) {
            // Resume at 50% brightness during race
            FastLED.setBrightness(savedBrightness / 2);
        }
        restoreSavedState();
        DEBUG("RGB LED: Re-enabled after delay\n");
    }
    
    // If temporarily disabled, keep LEDs off
    if (temporarilyDisabled) {
        return;
    }
    
    // Handle countdown sequence - priority, no latency
    if (isCountdown) {
        updateCountdown(currentTimeMs);
        return;
    }
    
    // Handle flash timeout - priority, check immediately for race events
    if (isFlashing && (currentTimeMs - flashStartMs) > flashDuration) {
        if (flashesRemaining > 0) {
            // More flashes to do - toggle between on and off
            flashesRemaining--;
            flashStartMs = currentTimeMs;
            CRGB color = (flashesRemaining % 2 == 0) ? flashColor : CRGB::Black;
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = color;
            }
            FastLED.show();
        } else {
            isFlashing = false;
            // If we're entering a temporarily disabled period, turn LEDs off
            if (temporarilyDisabled) {
                for (int i = 0; i < NUM_LEDS; i++) {
                    leds[i] = CRGB::Black;
                }
                FastLED.show();
            } else {
                restoreSavedState();  // Restore previous state after flash
            }
        }
    }
    
    // Update animations
    updateAnimation(currentTimeMs);
}

void RgbLed::setStatus(rgb_status_e status) {
    // Don't override an active flash or countdown
    if (isFlashing || isCountdown) {
        return;
    }
    
    DEBUG("RGB LED: Setting status to %d\n", status);
    currentStatus = status;
    applyStatus();
}

void RgbLed::startCountdown() {
    // Deprecated - now just flash green and go to cyan
    flashGreen();
}

void RgbLed::flashGreen() {
    saveCurrentState();  // Save current state before event
    savedBrightness = FastLED.getBrightness();
    
    // Flash green for race start
    isFlashing = true;
    flashStartMs = millis();
    flashDuration = 300;  // 300ms flash
    flashesRemaining = 0; // Single flash
    flashColor = CRGB::Green;
    currentMode = RGB_SOLID;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = flashColor;
    }
    FastLED.show();
    
    // Schedule: After flash ends (300ms), disable LEDs for 3 seconds
    temporarilyDisabled = true;
    disableUntilMs = millis() + 300 + 3000; // flash duration + 3 seconds
    inRace = true;
    DEBUG("RGB LED: Race start flash, will disable for 3s then resume at 50%% brightness\n");
}

void RgbLed::flashLap() {
    saveCurrentState();  // Save current state before event
    
    // Save current brightness and set to maximum for bright flash
    uint8_t currentBrightness = FastLED.getBrightness();
    FastLED.setBrightness(255); // Full brightness for bright white flash
    
    isFlashing = true;
    flashStartMs = millis();
    flashDuration = FLASH_DURATION_MS;
    flashesRemaining = 0; // Single flash
    flashColor = CRGB::White;
    currentMode = RGB_SOLID;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = flashColor;
    }
    FastLED.show();
    
    // Schedule brightness restore after flash
    // Note: brightness will be restored in restoreSavedState() based on inRace flag
    DEBUG("RGB LED: Bright white lap flash at full brightness\n");
}

void RgbLed::flashReset() {
    saveCurrentState();  // Save current state before event
    
    // Flash red 3 times for race end
    isFlashing = true;
    flashStartMs = millis();
    flashDuration = 200;  // 200ms per flash phase
    flashesRemaining = 5; // 3 flashes = 6 phases (on-off-on-off-on-off)
    flashColor = CRGB::Red;
    currentMode = RGB_SOLID;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = flashColor;
    }
    FastLED.show();
    
    // Schedule: After flashes end (200*6=1200ms), disable LEDs for 3 seconds
    temporarilyDisabled = true;
    disableUntilMs = millis() + (200 * 6) + 3000; // all flash phases + 3 seconds
    inRace = false;
    
    // Restore normal brightness when re-enabling
    FastLED.setBrightness(savedBrightness);
    DEBUG("RGB LED: Race end flash, will disable for 3s then resume at normal brightness\n");
}

void RgbLed::off() {
    currentStatus = STATUS_OFF;
    currentMode = RGB_OFF;
    targetColor = CRGB::Black;
    isCountdown = false;
    isFlashing = false;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = CRGB::Black;
    }
    FastLED.show();
}

void RgbLed::setColor(CRGB color, rgb_mode_e mode) {
    targetColor = color;
    currentMode = mode;
    if (mode == RGB_SOLID) {
        for (int i = 0; i < NUM_LEDS; i++) {
            leds[i] = color;
        }
        FastLED.show();
    }
}

void RgbLed::setBrightness(uint8_t brightness) {
    FastLED.setBrightness(brightness);
    FastLED.show();
}

void RgbLed::updateCountdown(uint32_t currentTimeMs) {
    uint32_t elapsed = currentTimeMs - countdownStartMs;
    uint32_t phaseTime = elapsed / COUNTDOWN_PHASE_MS;
    
    if (phaseTime != countdownPhase && phaseTime < 3) {
        countdownPhase = phaseTime;
        
        // Update color based on phase
        CRGB color;
        switch (countdownPhase) {
            case 0:  // RED
                color = CRGB::Red;
                break;
            case 1:  // YELLOW
                color = CRGB::Yellow;
                break;
            case 2:  // GREEN
                color = CRGB::Green;
                break;
        }
        for (int i = 0; i < NUM_LEDS; i++) {
            leds[i] = color;
        }
        FastLED.show();
    }
    
    // After 3 seconds (3 phases), countdown is done
    if (elapsed >= (COUNTDOWN_PHASE_MS * 3)) {
        isCountdown = false;
        setStatus(STATUS_RACE_RUNNING);
    }
}

void RgbLed::applyStatus() {
    switch (currentStatus) {
        case STATUS_BOOTING:
            targetColor = CRGB::Blue;
            currentMode = RGB_PULSE;
            break;
        
        case STATUS_USER_CONNECTED:
            targetColor = CRGB::Green;
            currentMode = RGB_SOLID;
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = targetColor;
            }
            FastLED.show();
            break;
        
        case STATUS_RACE_RUNNING:
            targetColor = CRGB::Cyan;
            currentMode = RGB_SOLID;
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = targetColor;
            }
            FastLED.show();
            break;
        
        case STATUS_RACE_END:
            targetColor = CRGB::Blue;
            currentMode = RGB_SOLID;
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = targetColor;
            }
            FastLED.show();
            break;
        
        case STATUS_BATTERY_ALARM:
            targetColor = CRGB::Red;
            currentMode = RGB_FLASH;
            break;
        
        case STATUS_RACE_RESET:
        case STATUS_OFF:
        default:
            off();
            break;
    }
}

void RgbLed::updateRainbowWave() {
    // Create rainbow wave effect - both LEDs same color
    CRGB color = CHSV(rainbowHue, 255, 255);
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    rainbowHue += rainbowSpeed;
    FastLED.show();
}

void RgbLed::updateAnimation(uint32_t currentTimeMs) {
    // Throttle updates to reduce CPU usage - BUT NOT for race events
    // Race events (flashing) bypass this throttle entirely via direct FastLED.show()
    // Reduced to 10ms for more responsive animations (was 20ms)
    if (currentTimeMs - lastUpdateMs < 10) {
        return;
    }
    lastUpdateMs = currentTimeMs;
    
    // Handle error blinking
    if (currentMode == RGB_ERROR_BLINK) {
        updateErrorBlink(currentTimeMs);
        return;
    }
    
    switch (currentMode) {
        case RGB_RAINBOW_WAVE:
            updateRainbowWave();
            break;
        
        case RGB_SPARKLE:
            updateSparkle();
            break;
        
        case RGB_BREATHING:
            updateBreathing();
            break;
        
        case RGB_CHASE:
            updateChase();
            break;
        
        case RGB_FIRE:
            updateFire();
            break;
        
        case RGB_OCEAN:
            updateOcean();
            break;
        
        case RGB_POLICE:
            updatePolice();
            break;
        
        case RGB_STROBE:
            updateStrobe();
            break;
        
        case RGB_COMET:
            updateComet();
            break;
        
        case RGB_PULSE: {
            // Smooth pulsing effect - speed controlled by effectSpeed
            uint8_t pulseSpeed = constrain(effectSpeed, 1, 10);
            if (pulseDirection) {
                pulseValue += pulseSpeed;
                if (pulseValue >= 255) {
                    pulseValue = 255;
                    pulseDirection = false;
                }
            } else {
                if (pulseValue < pulseSpeed) {
                    pulseValue = 0;
                    pulseDirection = true;
                } else {
                    pulseValue -= pulseSpeed;
                }
            }
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = targetColor;
                leds[i].nscale8(pulseValue);
            }
            FastLED.show();
            break;
        }
        
        case RGB_FLASH: {
            // Fast on/off flashing
            static bool flashState = false;
            flashState = !flashState;
            CRGB color = flashState ? targetColor : CRGB::Black;
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = color;
            }
            FastLED.show();
            break;
        }
        
        case RGB_SOLID:
        case RGB_OFF:
        case RGB_COUNTDOWN:
        default:
            // No animation needed
            break;
    }
}

void RgbLed::setManualColor(uint32_t colorHex) {
    uint8_t r = (colorHex >> 16) & 0xFF;
    uint8_t g = (colorHex >> 8) & 0xFF;
    uint8_t b = colorHex & 0xFF;
    targetColor = CRGB(r, g, b);
    currentMode = RGB_SOLID;
    currentStatus = STATUS_OFF;
    savedMode = RGB_SOLID;
    savedColor = targetColor;
    
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = targetColor;
    }
    FastLED.show();
    DEBUG("RGB LED: Manual color set to #%06X\n", colorHex);
}

void RgbLed::setFadeColor(uint32_t colorHex) {
    uint8_t r = (colorHex >> 16) & 0xFF;
    uint8_t g = (colorHex >> 8) & 0xFF;
    uint8_t b = colorHex & 0xFF;
    fadeColor = CRGB(r, g, b);
    DEBUG("RGB LED: Fade color set to #%06X\n", colorHex);
    
    // If currently using COLOR_FADE preset, apply immediately
    if (currentPreset == PRESET_COLOR_FADE) {
        targetColor = fadeColor;
    }
}

void RgbLed::setStrobeColor(uint32_t colorHex) {
    uint8_t r = (colorHex >> 16) & 0xFF;
    uint8_t g = (colorHex >> 8) & 0xFF;
    uint8_t b = colorHex & 0xFF;
    strobeColor = CRGB(r, g, b);
    DEBUG("RGB LED: Strobe color set to #%06X\n", colorHex);
}

void RgbLed::setManualMode(rgb_mode_e mode) {
    currentMode = mode;
    currentStatus = STATUS_OFF;
    savedMode = mode;
    
    if (mode == RGB_RAINBOW_WAVE) {
        rainbowHue = 0;
        DEBUG("RGB LED: Rainbow wave enabled\n");
    } else if (mode == RGB_OFF) {
        off();
    }
}

void RgbLed::setRainbowWave(uint8_t speed) {
    rainbowSpeed = speed;
    effectSpeed = speed;
    currentMode = RGB_RAINBOW_WAVE;
    currentStatus = STATUS_OFF;
    savedMode = RGB_RAINBOW_WAVE;
    rainbowHue = 0;
    DEBUG("RGB LED: Rainbow wave enabled (speed=%d)\n", speed);
}

void RgbLed::setEffectSpeed(uint8_t speed) {
    effectSpeed = constrain(speed, 1, 20);
    rainbowSpeed = effectSpeed;
    DEBUG("RGB LED: Effect speed set to %d\n", effectSpeed);
}

void RgbLed::saveCurrentState() {
    // Save current state before event (flash, countdown, etc.)
    if (!isFlashing && !isCountdown) {
        savedMode = currentMode;
        savedColor = targetColor;
    }
}

void RgbLed::restoreSavedState() {
    // Restore brightness based on race state
    if (inRace) {
        // During race: use 50% brightness
        FastLED.setBrightness(savedBrightness / 2);
    } else {
        // Not in race: use normal brightness
        FastLED.setBrightness(savedBrightness);
    }
    
    // Restore state after event
    if (manualOverride) {
        applyPreset(currentPreset);
        return;
    }
    
    currentMode = savedMode;
    targetColor = savedColor;
    
    if (currentMode == RGB_SOLID) {
        for (int i = 0; i < NUM_LEDS; i++) {
            leds[i] = targetColor;
        }
        FastLED.show();
    } else if (currentMode == RGB_OFF) {
        off();
    }
}

void RgbLed::celebrateLap(uint8_t lapNumber) {
    saveCurrentState();
    // Quick rainbow flash sequence
    CRGB colors[] = {CRGB::Red, CRGB::Orange, CRGB::Yellow, CRGB::Green, CRGB::Blue};
    for (int c = 0; c < 5; c++) {
        for (int i = 0; i < NUM_LEDS; i++) {
            leds[i] = colors[c];
        }
        FastLED.show();
        delay(50);
    }
    restoreSavedState();
}

void RgbLed::celebrateRaceEnd(bool newRecord) {
    saveCurrentState();
    if (newRecord) {
        // Gold sparkle effect for new record
        for (int loop = 0; loop < 20; loop++) {
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = (random(0, 3) == 0) ? CRGB(255, 215, 0) : CRGB::Black;
            }
            FastLED.show();
            delay(100);
        }
    } else {
        // Green pulse for race completion
        for (int brightness = 0; brightness < 255; brightness += 5) {
            for (int i = 0; i < NUM_LEDS; i++) {
                leds[i] = CRGB(0, brightness, 0);
            }
            FastLED.show();
            delay(10);
        }
        delay(500);
    }
    restoreSavedState();
}

void RgbLed::showErrorCode(uint8_t errorCode) {
    DEBUG("RGB LED: Showing error code %d\n", errorCode);
    errorBlinkCount = errorCode;
    errorBlinksRemaining = errorCode * 2; // On + off = 2 blinks per code
    errorBlinkTime = millis();
    currentMode = RGB_ERROR_BLINK;
}

void RgbLed::updateErrorBlink(uint32_t currentTimeMs) {
    if (currentTimeMs - errorBlinkTime < 300) return;
    
    errorBlinkTime = currentTimeMs;
    errorBlinksRemaining--;
    
    if (errorBlinksRemaining <= 0) {
        restoreSavedState();
        return;
    }
    
    // Toggle red on/off
    CRGB color = (errorBlinksRemaining % 2 == 0) ? CRGB::Red : CRGB::Black;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updateSparkle() {
    // Both LEDs sparkle together
    CRGB color;
    if (random(0, 10) == 0) {
        color = targetColor;
    } else {
        color = leds[0];
        color.nscale8(200); // Fade
    }
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updateBreathing() {
    static uint8_t breath = 0;
    static bool breathDir = true;
    
    if (breathDir) {
        breath += 2;
        if (breath >= 255) breathDir = false;
    } else {
        breath -= 2;
        if (breath == 0) breathDir = true;
    }
    
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = targetColor;
        leds[i].nscale8(breath);
    }
    FastLED.show();
}

void RgbLed::updateChase() {
    // Both LEDs chase together (on/off blinking)
    static bool chaseState = false;
    chaseState = !chaseState;
    CRGB color = chaseState ? targetColor : CRGB::Black;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updateFire() {
    // Fire effect - warm flickering
    firePhase += effectSpeed;
    uint8_t red = 200 + random(0, 56);    // 200-255
    uint8_t green = 50 + random(0, 100);   // 50-150  
    uint8_t blue = 0;
    
    CRGB color = CRGB(red, green, blue);
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updateOcean() {
    // Ocean effect - cool blue/cyan waves
    oceanPhase += effectSpeed;
    uint8_t wave = sin8(oceanPhase);
    
    CRGB color = CHSV(160 + (wave / 8), 255, 200 + (wave / 4)); // Blue-cyan range
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updatePolice() {
    // Police lights - red/blue alternating (slower for visibility)
    static uint8_t policeCounter = 0;
    policeCounter++;
    
    // Toggle every 20 frames for slower effect (was every frame)
    if (policeCounter >= (20 / effectSpeed)) {
        policeCounter = 0;
        policeState = !policeState;
    }
    
    CRGB color = policeState ? CRGB::Red : CRGB::Blue;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updateStrobe() {
    // Strobe effect - customizable color flashing (slower for visibility)
    static uint8_t strobeCounter = 0;
    static bool strobeState = false;
    strobeCounter++;
    
    // Toggle every 15 frames for slower effect (was every frame)
    if (strobeCounter >= (15 / effectSpeed)) {
        strobeCounter = 0;
        strobeState = !strobeState;
    }
    
    CRGB color = strobeState ? strobeColor : CRGB::Black;
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::updateComet() {
    // Comet effect - shooting star
    cometPos += effectSpeed;
    if (cometPos > 255) cometPos = 0;
    
    // Create a fading tail effect
    uint8_t brightness = cometPos > 200 ? 255 - (cometPos - 200) * 4 : 255;
    CRGB color = CRGB(brightness, brightness, brightness);
    
    for (int i = 0; i < NUM_LEDS; i++) {
        leds[i] = color;
    }
    FastLED.show();
}

void RgbLed::setPreset(led_preset_e preset) {
    currentPreset = preset;
    manualOverride = true;
    DEBUG("RGB LED: Setting preset %d\n", preset);
    applyPreset(preset);
}

void RgbLed::applyPreset(led_preset_e preset) {
    switch(preset) {
        case PRESET_OFF:
            off();
            break;
        case PRESET_SOLID_COLOUR:
            // Use currently set manual color (solid)
            currentMode = RGB_SOLID;
            for (int i = 0; i < NUM_LEDS; i++) leds[i] = targetColor;
            FastLED.show();
            break;
        case PRESET_RAINBOW:
            setRainbowWave(effectSpeed);
            break;
        case PRESET_COLOR_FADE:
            // Pulse the fade color (customizable)
            targetColor = fadeColor;
            currentMode = RGB_PULSE;
            break;
        case PRESET_FIRE:
            currentMode = RGB_FIRE;
            firePhase = 0;
            break;
        case PRESET_OCEAN:
            currentMode = RGB_OCEAN;
            oceanPhase = 0;
            break;
        case PRESET_POLICE:
            currentMode = RGB_POLICE;
            policeState = false;
            break;
        case PRESET_STROBE:
            // Use custom strobe color
            currentMode = RGB_STROBE;
            break;
        case PRESET_COMET:
            currentMode = RGB_COMET;
            cometPos = 0;
            break;
        case PRESET_PILOT_COLOUR:
            // Use currently set manual color (pilot color) as solid
            currentMode = RGB_SOLID;
            for (int i = 0; i < NUM_LEDS; i++) leds[i] = targetColor;
            FastLED.show();
            break;
    }
}

#endif // ESP32S3
