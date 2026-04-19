#include "buzzer.h"
#include "config.h"

// LEDC channel for PWM passive buzzer (use channel 7 to avoid FastLED/RMT conflicts on older core)
#define BUZZER_LEDC_CHANNEL 7
#define BUZZER_LEDC_RESOLUTION 8  // 8-bit resolution (0-255)

#ifndef BUZZER_PASSIVE
#define BUZZER_PASSIVE 1
#endif
#ifndef BUZZER_PWM_FREQ_HZ
#define BUZZER_PWM_FREQ_HZ 2700  // Many passive EM buzzers (e.g. MLT-8530) are loudest near ~2.7 kHz
#endif

namespace {

// freq_hz == 0 = silent gap. Tuned around ~2.7 kHz for MLT-8530-class parts.
static const Buzzer::ToneSeg kLowBattery[] = {{2700, 70}, {0, 60}, {2700, 70}};
static const Buzzer::ToneSeg kRaceStart[] = {{2300, 80}, {2500, 80}, {2700, 340}};
static const Buzzer::ToneSeg kRaceStop[] = {{2700, 150}, {2400, 150}, {2100, 200}};
static const Buzzer::ToneSeg kLap[] = {{2700, 200}};
static const Buzzer::ToneSeg kCountdownTick[] = {{3100, 90}};
static const Buzzer::ToneSeg kCountdownGo[] = {{2700, 120}, {3300, 280}};
static const Buzzer::ToneSeg kCalibStart[] = {{2700, 280}};
static const Buzzer::ToneSeg kCalibStop[] = {{2200, 280}};
static const Buzzer::ToneSeg kWebChirp[] = {{2700, 120}};

static void getCueData(BuzzerCue cue, const Buzzer::ToneSeg** out, uint8_t* n) {
    *out = nullptr;
    *n = 0;
    switch (cue) {
        case BUZZER_CUE_LOW_BATTERY:
            *out = kLowBattery;
            *n = 3;
            break;
        case BUZZER_CUE_RACE_START:
            *out = kRaceStart;
            *n = 3;
            break;
        case BUZZER_CUE_RACE_STOP:
            *out = kRaceStop;
            *n = 3;
            break;
        case BUZZER_CUE_LAP:
            *out = kLap;
            *n = 1;
            break;
        case BUZZER_CUE_COUNTDOWN_TICK:
            *out = kCountdownTick;
            *n = 1;
            break;
        case BUZZER_CUE_COUNTDOWN_GO:
            *out = kCountdownGo;
            *n = 2;
            break;
        case BUZZER_CUE_CALIB_START:
            *out = kCalibStart;
            *n = 1;
            break;
        case BUZZER_CUE_CALIB_STOP:
            *out = kCalibStop;
            *n = 1;
            break;
        case BUZZER_CUE_WEB_CHIRP:
            *out = kWebChirp;
            *n = 1;
            break;
        default:
            break;
    }
}

}  // namespace

void Buzzer::init(uint8_t pin, bool inverted) {
    buzzerPin = pin;
    initialState = inverted ? HIGH : LOW;
    buzzerState = BUZZER_IDLE;
    volume = 100;
    segmentPtr = nullptr;
    segmentCount = 0;
    segmentIndex = 0;

#if BUZZER_PASSIVE
    usePWM = true;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(buzzerPin, BUZZER_PWM_FREQ_HZ, BUZZER_LEDC_RESOLUTION);
    ledcWrite(buzzerPin, 0);
#else
    ledcSetup(BUZZER_LEDC_CHANNEL, BUZZER_PWM_FREQ_HZ, BUZZER_LEDC_RESOLUTION);
    ledcAttachPin(buzzerPin, BUZZER_LEDC_CHANNEL);
    ledcWrite(BUZZER_LEDC_CHANNEL, 0);
#endif
#else
    usePWM = false;
    pinMode(buzzerPin, OUTPUT);
    digitalWrite(buzzerPin, initialState);
#endif
}

void Buzzer::setVolume(uint8_t vol) {
    if (vol > 100) vol = 100;
    volume = vol;
}

void Buzzer::silenceOutput() {
    if (usePWM) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
        ledcWrite(buzzerPin, 0);
#else
        ledcWrite(BUZZER_LEDC_CHANNEL, 0);
#endif
    } else {
        digitalWrite(buzzerPin, initialState);
    }
}

void Buzzer::applyPwmFrequency(uint32_t hz) {
#if BUZZER_PASSIVE
    if (!usePWM) return;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    /* ledcAttach() once in init(); re-attaching each segment exhausts timers (multi-freq cues e.g. 3100 Hz tick). */
    ledcChangeFrequency(buzzerPin, hz, BUZZER_LEDC_RESOLUTION);
#else
    ledcSetup(BUZZER_LEDC_CHANNEL, hz, BUZZER_LEDC_RESOLUTION);
    ledcAttachPin(buzzerPin, BUZZER_LEDC_CHANNEL);
#endif
    uint8_t duty = (volume * 127) / 100;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(buzzerPin, duty);
#else
    ledcWrite(BUZZER_LEDC_CHANNEL, duty);
#endif
#else
    (void)hz;
#endif
}

void Buzzer::startPlaying(const ToneSeg* segments, uint8_t count) {
    if (volume == 0 || segments == nullptr || count == 0 || count > kMaxSegments) return;

    for (uint8_t i = 0; i < count; i++) {
        segmentBuf[i] = segments[i];
    }
    segmentPtr = segmentBuf;
    segmentCount = count;
    segmentIndex = 0;
    buzzerState = BUZZER_PLAYING;
    startSegmentAt(millis());
}

void Buzzer::startSegmentAt(uint32_t nowMs) {
    segmentStartMs = nowMs;
    const ToneSeg& seg = segmentPtr[segmentIndex];
    if (seg.freq_hz == 0) {
        silenceOutput();
    } else if (usePWM) {
        applyPwmFrequency(seg.freq_hz);
    } else {
        digitalWrite(buzzerPin, !initialState);
    }
}

void Buzzer::beep(uint32_t timeMs) {
    if (timeMs == 0) return;
    if (timeMs > 65535) timeMs = 65535;
    ToneSeg one = {BUZZER_PWM_FREQ_HZ, static_cast<uint16_t>(timeMs)};
    startPlaying(&one, 1);
}

void Buzzer::playCue(BuzzerCue cue) {
    if (cue == BUZZER_CUE_NONE || volume == 0) return;

    const Buzzer::ToneSeg* p = nullptr;
    uint8_t n = 0;
    getCueData(cue, &p, &n);
    if (p == nullptr || n == 0) return;

    if (!usePWM) {
        uint32_t total = 0;
        for (uint8_t i = 0; i < n; i++) {
            total += p[i].ms;
        }
        if (total < 50) total = 50;
        if (total > 65535) total = 65535;
        ToneSeg one = {BUZZER_PWM_FREQ_HZ, static_cast<uint16_t>(total)};
        startPlaying(&one, 1);
        return;
    }
    startPlaying(p, n);
}

void Buzzer::handleBuzzer(uint32_t currentTimeMs) {
    if (buzzerState != BUZZER_PLAYING || segmentPtr == nullptr) return;

    if (currentTimeMs < segmentStartMs) return;

    const ToneSeg& seg = segmentPtr[segmentIndex];
    if ((currentTimeMs - segmentStartMs) < seg.ms) return;

    segmentIndex++;
    if (segmentIndex >= segmentCount) {
        silenceOutput();
        buzzerState = BUZZER_IDLE;
        segmentPtr = nullptr;
        segmentCount = 0;
        return;
    }
    startSegmentAt(currentTimeMs);
}
