#include "audio.h"

#ifdef HAS_I2S_AUDIO

#include "debug.h"
#include "storage.h"
#include <SD.h>
#include <cmath>

struct VoiceDirectoryConfig {
    const char* key;
    const char* primaryDir;
    const char* legacyDir;
};

// Voice directory mapping (matches data/audio-announcer.js canonical-first behavior)
static const VoiceDirectoryConfig voiceDirectoryConfigs[] = {
    {"default", "voice_default_en", "sounds_default"},
    {"rachel", "voice_rachel_en", "sounds_rachel"},
    {"adam", "voice_adam_en", "sounds_adam"},
    {"antoni", "voice_antoni_en", "sounds_antoni"},
    {"matilda", "voice_matilda_en", "sounds_matilda"},
    {"de", "voice_german_de", "voice_de"},
    {"es", "voice_spanish_es", "voice_es"},
    {"fr", "voice_french_fr", "voice_fr"},
    {"webspeech", "voice_default_en", "sounds_default"},
    {nullptr, nullptr, nullptr}
};

static const char* normalizeVoiceSelection(const char* voiceName) {
    if (!voiceName || !voiceName[0]) return "default";

    if (strcmp(voiceName, "piper") == 0) return "default";

    if (strcmp(voiceName, "german") == 0 || strcmp(voiceName, "voice_de") == 0 || strcmp(voiceName, "voice_german_de") == 0) return "de";
    if (strcmp(voiceName, "spanish") == 0 || strcmp(voiceName, "voice_es") == 0 || strcmp(voiceName, "voice_spanish_es") == 0) return "es";
    if (strcmp(voiceName, "french") == 0 || strcmp(voiceName, "voice_fr") == 0 || strcmp(voiceName, "voice_french_fr") == 0) return "fr";

    if (strcmp(voiceName, "voice_default_en") == 0) return "default";
    if (strcmp(voiceName, "voice_rachel_en") == 0) return "rachel";
    if (strcmp(voiceName, "voice_adam_en") == 0) return "adam";
    if (strcmp(voiceName, "voice_antoni_en") == 0) return "antoni";
    if (strcmp(voiceName, "voice_matilda_en") == 0) return "matilda";

    for (int i = 0; voiceDirectoryConfigs[i].key != nullptr; i++) {
        if (strcmp(voiceName, voiceDirectoryConfigs[i].key) == 0) {
            return voiceName;
        }
    }

    return "default";
}

static const VoiceDirectoryConfig* getVoiceDirectoryConfig(const char* voiceName) {
    const char* normalized = normalizeVoiceSelection(voiceName);
    for (int i = 0; voiceDirectoryConfigs[i].key != nullptr; i++) {
        if (strcmp(voiceDirectoryConfigs[i].key, normalized) == 0) {
            return &voiceDirectoryConfigs[i];
        }
    }
    return nullptr;
}

static bool voiceDirectoryExists(const char* dir) {
    if (!dir) return false;
    char checkPath[64];
    snprintf(checkPath, sizeof(checkPath), "/%s", dir);
    return SD.exists(checkPath);
}

static const char* resolveVoiceDirectory(const char* voiceName) {
    const VoiceDirectoryConfig* config = getVoiceDirectoryConfig(voiceName);
    if (!config) return nullptr;

    if (voiceDirectoryExists(config->primaryDir)) return config->primaryDir;
    if (voiceDirectoryExists(config->legacyDir)) return config->legacyDir;

    // Last-resort fallback to default voice
    const VoiceDirectoryConfig* defaultConfig = getVoiceDirectoryConfig("default");
    if (!defaultConfig) return nullptr;
    if (voiceDirectoryExists(defaultConfig->primaryDir)) return defaultConfig->primaryDir;
    if (voiceDirectoryExists(defaultConfig->legacyDir)) return defaultConfig->legacyDir;

    return nullptr;
}

// ---------- Init ----------

void AudioAnnouncer::init(Config* config, Storage* storage) {
    conf = config;
    stor = storage;

    if (!stor || !stor->isSDAvailable()) {
        DEBUG("[Audio] SD card not available, speaker disabled\n");
        initialized = false;
        return;
    }

    // Determine voice directory from config (canonical-first with legacy fallback)
    const char* selectedVoice = conf->getSelectedVoice();
    const char* resolvedDir = resolveVoiceDirectory(selectedVoice);
    if (!resolvedDir) {
        DEBUG("[Audio] No compatible voice directories found on SD (selectedVoice=%s), speaker disabled\n", selectedVoice ? selectedVoice : "null");
        initialized = false;
        return;
    }
    strlcpy(voiceDir, resolvedDir, sizeof(voiceDir));

    // Init I2S output
    audioOut = new AudioOutputI2S(0);
    audioOut->SetPinout(PIN_I2S_BCLK, PIN_I2S_LRC, PIN_I2S_DOUT);
    audioOut->SetGain(volume);

    // Clear queue
    clearQueue();

    initialized = true;
    enabled = conf->getSpeakerEnabled();
    DEBUG("[Audio] Speaker initialized (selectedVoice: %s, voiceDir: %s, enabled: %d)\n", selectedVoice, voiceDir, enabled);
}

// ---------- Main Loop Handler ----------

void AudioAnnouncer::handleAudio() {
    if (!initialized) return;

    // Update enabled state from config
    enabled = conf->getSpeakerEnabled();

    // Update voice directory if changed (canonical-first with legacy fallback)
    const char* selectedVoice = conf->getSelectedVoice();
    const char* resolvedDir = resolveVoiceDirectory(selectedVoice);
    if (resolvedDir && strcmp(voiceDir, resolvedDir) != 0) {
        strlcpy(voiceDir, resolvedDir, sizeof(voiceDir));
        DEBUG("[Audio] Voice changed to: %s (selectedVoice=%s)\n", voiceDir, selectedVoice);
    }

    if (!enabled) {
        if (playing) {
            stopCurrent();
            clearQueue();
        }
        return;
    }

    // Drive current playback
    if (playing && mp3) {
        if (mp3->isRunning()) {
            if (!mp3->loop()) {
                mp3->stop();
                playing = false;
                DEBUG("[Audio] Playback finished\n");
            }
        } else {
            playing = false;
        }
    }

    // If not playing, try next in queue
    if (!playing && queueCount > 0) {
        playNext();
    }
}

// ---------- Queue Management ----------

void AudioAnnouncer::enqueue(const char* path) {
    if (queueCount >= AUDIO_QUEUE_SIZE) {
        DEBUG("[Audio] Queue full, dropping: %s\n", path);
        return;
    }
    strlcpy(queue[queueTail], path, AUDIO_PATH_MAX);
    queueTail = (queueTail + 1) % AUDIO_QUEUE_SIZE;
    queueCount++;
}

bool AudioAnnouncer::dequeue(char* path) {
    if (queueCount == 0) return false;
    strlcpy(path, queue[queueHead], AUDIO_PATH_MAX);
    queueHead = (queueHead + 1) % AUDIO_QUEUE_SIZE;
    queueCount--;
    return true;
}

void AudioAnnouncer::clearQueue() {
    queueHead = 0;
    queueTail = 0;
    queueCount = 0;
}

// ---------- Playback Control ----------

void AudioAnnouncer::playNext() {
    char path[AUDIO_PATH_MAX];
    if (!dequeue(path)) return;

    // Clean up previous playback objects
    stopCurrent();

    // Check file exists
    if (!SD.exists(path)) {
        DEBUG("[Audio] File not found: %s\n", path);
        return;
    }

    src = new AudioFileSourceSD(path);
    mp3 = new AudioGeneratorMP3();

    if (!mp3->begin(src, audioOut)) {
        DEBUG("[Audio] Failed to start: %s\n", path);
        delete mp3;
        mp3 = nullptr;
        delete src;
        src = nullptr;
        return;
    }

    playing = true;
    DEBUG("[Audio] Playing: %s\n", path);
}

void AudioAnnouncer::stopCurrent() {
    if (mp3) {
        if (mp3->isRunning()) {
            mp3->stop();
        }
        delete mp3;
        mp3 = nullptr;
    }
    if (src) {
        delete src;
        src = nullptr;
    }
    playing = false;
}

// ---------- Path Builder ----------

void AudioAnnouncer::buildPath(char* dest, size_t destSize, const char* filename) {
    snprintf(dest, destSize, "/%s/%s", voiceDir, filename);
}

// ---------- Race Event Announcements ----------

void AudioAnnouncer::announceCountdown() {
    if (!isEnabled()) return;

    clearQueue();  // Clear any pending announcements
    countdownPlayed = true;

    // Only "arm your quad" at start; "starting in less than 5" plays at 5s via announceStartingInFive()
    char path[AUDIO_PATH_MAX];
    buildPath(path, sizeof(path), "arm_your_quad.mp3");
    enqueue(path);
}

void AudioAnnouncer::announceStartingInFive() {
    if (!isEnabled()) return;

    char path[AUDIO_PATH_MAX];
    buildPath(path, sizeof(path), "starting_tone.mp3");
    enqueue(path);
}

void AudioAnnouncer::announceRaceStart() {
    if (!isEnabled()) return;

    lapCount = 0;  // Reset lap counter for new race
    lapHistoryCount = 0;  // Clear lap history
    memset(lapHistory, 0, sizeof(lapHistory));

    if (!countdownPlayed) {
        // Fallback: countdown wasn't triggered separately (old WebUI),
        // play the full countdown + beep sequence now
        clearQueue();
        char path[AUDIO_PATH_MAX];
        buildPath(path, sizeof(path), "arm_your_quad.mp3");
        enqueue(path);
        buildPath(path, sizeof(path), "starting_tone.mp3");
        enqueue(path);
    }
    countdownPlayed = false;  // Reset for next race

    // Play the start beep (like the website's 880Hz tone)
    char beepPath[AUDIO_PATH_MAX];
    buildPath(beepPath, sizeof(beepPath), "beep.mp3");
    enqueue(beepPath);
}

void AudioAnnouncer::announceRaceStop() {
    if (!isEnabled()) return;

    clearQueue();  // Stop announcement takes priority

    char path[AUDIO_PATH_MAX];
    buildPath(path, sizeof(path), "race_stopped.mp3");
    enqueue(path);
}

void AudioAnnouncer::announceRaceComplete() {
    if (!isEnabled()) return;

    char path[AUDIO_PATH_MAX];
    buildPath(path, sizeof(path), "race_complete.mp3");
    enqueue(path);
}

// ---------- Gate 1 Announcement ----------

void AudioAnnouncer::announceGate1(float lapTimeSec) {
    // Play "gate_1.mp3" for the first crossing (hole shot)
    char path[AUDIO_PATH_MAX];
    buildPath(path, sizeof(path), "gate_1.mp3");
    if (SD.exists(path)) {
        enqueue(path);
    }
    // Then speak the time
    queueLapTime(lapTimeSec);
}

// ---------- Lap Announcement ----------

void AudioAnnouncer::announceLap(uint32_t lapTimeMs) {
    if (!isEnabled()) {
        DEBUG("[Audio] announceLap skipped: not enabled (init=%d, en=%d)\n", initialized, enabled);
        return;
    }

    lapCount++;
    float lapTimeSec = lapTimeMs / 1000.0f;
    uint8_t lapNumber = lapCount;

    // Store in lap history
    if (lapHistoryCount < LAP_HISTORY_SIZE) {
        lapHistory[lapHistoryCount] = lapTimeSec;
        lapHistoryCount++;
    } else {
        for (uint8_t i = 0; i < LAP_HISTORY_SIZE - 1; i++) {
            lapHistory[i] = lapHistory[i + 1];
        }
        lapHistory[LAP_HISTORY_SIZE - 1] = lapTimeSec;
    }

    DEBUG("[Audio] Lap %d, time %.2fs\n", lapNumber, lapTimeSec);

    // Gate 1 (first crossing / hole shot)
    if (lapNumber == 1) {
        announceGate1(lapTimeSec);
        return;
    }

    // Actual lap number (Gate 1 doesn't count as a lap)
    uint8_t actualLap = lapNumber - 1;
    DEBUG("[Audio] Announcing lap %d (crossing %d)\n", actualLap, lapNumber);

    // Lap N + time (e.g. "Lap 1, 6.31")
    if (actualLap >= 1 && actualLap <= 50) {
        char filename[48];
        snprintf(filename, sizeof(filename), "lap_%d.mp3", actualLap);
        char lapPath[AUDIO_PATH_MAX];
        buildPath(lapPath, sizeof(lapPath), filename);
        if (SD.exists(lapPath)) {
            enqueue(lapPath);
        }
    }
    queueLapTime(lapTimeSec);
}

// ---------- Number Speech ----------

void AudioAnnouncer::queueNumber(int n) {
    if (n < 0 || n > 99) return;

    char filename[32];
    snprintf(filename, sizeof(filename), "num_%d.mp3", n);

    char path[AUDIO_PATH_MAX];
    buildPath(path, sizeof(path), filename);
    enqueue(path);
}

void AudioAnnouncer::queueLapTime(float time) {
    // Mirrors AudioTest's speakLapTime() and audio-announcer.js speakNumber()
    int whole = (int)time;
    int decimal = (int)round((time - whole) * 100);

    // Whole part (0-99)
    if (whole >= 0 && whole <= 99) {
        queueNumber(whole);
    }

    // "point"
    char pointPath[AUDIO_PATH_MAX];
    buildPath(pointPath, sizeof(pointPath), "point.mp3");
    enqueue(pointPath);

    // Decimal part - match audio-announcer.js behavior
    if (decimal >= 10) {
        // Two-digit decimal with no leading zero (e.g. .34 -> "thirty four")
        queueNumber(decimal);
    } else {
        // Leading zero (e.g. .03 -> "zero" "three")
        queueNumber(0);
        queueNumber(decimal);
    }
}

// ---------- Volume ----------

void AudioAnnouncer::setVolume(float gain) {
    volume = gain;
    if (volume < 0.0f) volume = 0.0f;
    if (volume > 1.0f) volume = 1.0f;
    if (audioOut) {
        audioOut->SetGain(volume);
    }
}

// ---------- Enable/Disable ----------

void AudioAnnouncer::setEnabled(bool en) {
    enabled = en;
    if (!en) {
        stopCurrent();
        clearQueue();
    }
}

#endif // HAS_I2S_AUDIO
