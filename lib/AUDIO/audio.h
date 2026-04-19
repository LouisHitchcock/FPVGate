#ifndef AUDIO_H
#define AUDIO_H

#include <Arduino.h>
#include "config.h"

#ifdef HAS_I2S_AUDIO

#include "AudioFileSourceSD.h"
#include "AudioGeneratorMP3.h"
#include "AudioOutputI2S.h"

#define AUDIO_QUEUE_SIZE 16
#define AUDIO_PATH_MAX 64

class Storage;  // Forward declaration

class AudioAnnouncer {
   public:
    void init(Config* config, Storage* storage);
    void handleAudio();  // Call from main loop - drives non-blocking playback

    // Race event announcements
    void announceCountdown();       // Pre-race: arm_your_quad only (call at countdown start)
    void announceStartingInFive();  // "Starting on the tone in less than five" (call when countdown shows 5)
    void announceRaceStart();       // Actual race start: resets lap counter
    void announceRaceStop();
    void announceRaceComplete();

    // Lap announcement (formats based on config lapFormat)
    // lapNumber is auto-tracked; reset on announceRaceStart()
    void announceLap(uint32_t lapTimeMs);

    // Volume control (0.0 - 1.0)
    void setVolume(float gain);
    float getVolume() { return volume; }

    // Enable/disable
    void setEnabled(bool en);
    bool isEnabled() { return enabled && initialized; }

    // Status
    bool isPlaying() { return playing; }
    bool isInitialized() { return initialized; }

   private:
    Config* conf = nullptr;
    Storage* stor = nullptr;
    AudioOutputI2S* audioOut = nullptr;
    AudioGeneratorMP3* mp3 = nullptr;
    AudioFileSourceSD* src = nullptr;

    // Playback queue
    char queue[AUDIO_QUEUE_SIZE][AUDIO_PATH_MAX];
    uint8_t queueHead = 0;
    uint8_t queueTail = 0;
    uint8_t queueCount = 0;

    bool initialized = false;
    bool enabled = true;
    bool playing = false;
    bool countdownPlayed = false;  // Tracks if countdown was triggered separately
    float volume = 1.0f;
    uint8_t lapCount = 0;  // Auto-tracked, reset on race start

    // Lap history for consecutive-lap modes (2-lap, 3-lap)
    static const uint8_t LAP_HISTORY_SIZE = 4;
    float lapHistory[LAP_HISTORY_SIZE];  // Recent lap times in seconds
    uint8_t lapHistoryCount = 0;

    // Voice directory (e.g. "sounds_matilda")
    char voiceDir[32];

    // Queue management
    void enqueue(const char* path);
    bool dequeue(char* path);
    void clearQueue();

    // Start playing next file from queue
    void playNext();
    void stopCurrent();

    // Helper: build full path from filename
    void buildPath(char* dest, size_t destSize, const char* filename);

    // Number speech helpers
    void queueNumber(int n);
    void queueLapTime(float time);

    // Gate 1 announcement
    void announceGate1(float lapTimeSec);
};

#endif // HAS_I2S_AUDIO
#endif // AUDIO_H
