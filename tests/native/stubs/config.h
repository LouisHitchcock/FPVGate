#pragma once
#include "Arduino.h"
class Config {
public:
    uint8_t radio = 2, maxLaps = 0, raceMask = 3, heat = 0;
    uint32_t minLap = 2000;
    uint16_t frequencies[8] = {5658, 5695};
    const char* names[8] = {"Ann", "Bea", "Cal", "Dee", "Eli", "Flo", "Gus", "Hal"};
    uint8_t getReceiverRadio() { return radio; }
    uint8_t getMaxLaps() { return maxLaps; }
    uint8_t getC5RaceMask() { return raceMask; }
    uint32_t getMinLapMs() { return minLap; }
    uint8_t getMaxHeatTime30s() { return heat; }
    uint16_t getC5Frequency(uint8_t i) { return frequencies[i]; }
    uint8_t getC5EnterRssi(uint8_t) { return 120; }
    uint8_t getC5ExitRssi(uint8_t) { return 100; }
    const char* getC5PilotName(uint8_t i) { return names[i]; }
    const char* getC5PilotPhonetic(uint8_t i) { return names[i]; }
    uint32_t getC5PilotColor(uint8_t i) { return 0x8000ff + i; }
};
