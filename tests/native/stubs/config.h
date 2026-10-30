// Host Config: explicit per-test settings for both native simulations.
#pragma once
#include "Arduino.h"
class Config {
public:
    uint8_t radio = 2, maxLaps = 0, raceMask = 3, heat = 0;
    uint8_t enter = 120, exit = 100;
    uint32_t minLap = 2000;
    uint16_t frequencies[8] = {5658, 5695};
    const char* names[8] = {"Ann", "Bea", "Cal", "Dee", "Eli", "Flo", "Gus", "Hal"};
    std::string assignedNames[8];
    uint8_t eventMode = 0, countdown = 1, pilotCount = 2;
    uint8_t getEventMode() { return eventMode; }
    bool setRaceLimits(uint8_t laps, uint16_t tenths, uint8_t blocks) {
        if (laps > 63 || tenths < 1 || tenths > 200 || blocks > 60) return false;
        maxLaps = laps; minLap = tenths * 100; heat = blocks; return true;
    }
    void setRaceCountdownMode(uint8_t mode) { countdown = mode; }
    void setC5PilotCount(uint8_t count) { pilotCount = count; }
    void setC5Profile(uint8_t slot, uint16_t freq, uint8_t, uint8_t) { frequencies[slot] = freq; }
    void setC5PilotIdentity(uint8_t slot, const char* name, const char*, uint32_t, bool races) {
        assignedNames[slot] = name; names[slot] = assignedNames[slot].c_str();
        if (races) raceMask |= 1 << slot; else raceMask &= ~(1 << slot);
    }
    uint8_t getReceiverRadio() { return radio; }
    uint8_t getMaxLaps() { return maxLaps; }
    uint8_t getC5RaceMask() { return raceMask; }
    uint32_t getMinLapMs() { return minLap; }
    uint8_t getMaxHeatTime30s() { return heat; }
    uint16_t getC5Frequency(uint8_t i) { return i < 8 ? frequencies[i] : 0; }
    uint8_t getC5EnterRssi(uint8_t) { return enter; }
    uint8_t getC5ExitRssi(uint8_t) { return exit; }
    const char* getC5PilotName(uint8_t i) { return names[i]; }
    const char* getC5PilotPhonetic(uint8_t i) { return names[i]; }
    uint32_t getC5PilotColor(uint8_t i) { return 0x8000ff + i; }
};
