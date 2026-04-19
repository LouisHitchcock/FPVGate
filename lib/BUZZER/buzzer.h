#include <Arduino.h>

#pragma once

/** Named sounds — frequencies tuned for MLT-8530 (~2.7 kHz resonance); table lives in buzzer.cpp */
enum BuzzerCue : uint8_t {
    BUZZER_CUE_NONE = 0,
    BUZZER_CUE_LOW_BATTERY,    // two short chirps
    BUZZER_CUE_RACE_START,     // rising triplet (~race go)
    BUZZER_CUE_RACE_STOP,      // descending
    BUZZER_CUE_LAP,            // single short tick
    BUZZER_CUE_COUNTDOWN_TICK, // higher ping per number
    BUZZER_CUE_COUNTDOWN_GO,   // brighter double for "GO!"
    BUZZER_CUE_CALIB_START,
    BUZZER_CUE_CALIB_STOP,
    BUZZER_CUE_WEB_CHIRP,      // web UI ack
};

typedef enum {
    BUZZER_IDLE,
    BUZZER_PLAYING,
} buzzer_state_e;

class Buzzer {
   public:
    struct ToneSeg {
        uint16_t freq_hz;
        uint16_t ms;
    };

    void init(uint8_t pin, bool inverted);
    void handleBuzzer(uint32_t currentTimeMs);
    /// Legacy: one tone at default PWM frequency for \a timeMs.
    void beep(uint32_t timeMs);
    void setVolume(uint8_t volume);  // 0-100 percentage
    /// Passive: multi-segment tone; active: one long beep (~sum of segment times).
    void playCue(BuzzerCue cue);

   private:
    void silenceOutput();
    void applyPwmFrequency(uint32_t hz);
    void startPlaying(const ToneSeg* segments, uint8_t count);
    void startSegmentAt(uint32_t nowMs);

    buzzer_state_e buzzerState = BUZZER_IDLE;
    uint8_t buzzerPin = 0;
    uint8_t initialState = LOW;
    uint32_t segmentStartMs = 0;
    uint8_t volume = 100;
    bool usePWM = false;

    static constexpr uint8_t kMaxSegments = 8;
    ToneSeg segmentBuf[kMaxSegments];
    const ToneSeg* segmentPtr = nullptr;
    uint8_t segmentCount = 0;
    uint8_t segmentIndex = 0;
};
