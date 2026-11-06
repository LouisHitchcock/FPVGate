#pragma once
#include "trackmanager.h"
class LapTimer {
public:
    bool running = false;
    int starts = 0, stops = 0;
    uint32_t startMs = 0;
    Track track;
    void start() { ++starts; running = true; startMs = millis(); }
    void stop() { ++stops; running = false; }
    uint32_t getRaceStartMs() { return startMs; }
    Track* getSelectedTrack() { return &track; }
};
