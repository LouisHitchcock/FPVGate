// Host stand-in for Config: the C5 settings C5MultiPilot reads.
#pragma once
#include <stdint.h>

class Config {
public:
    uint16_t frequency[8] = {5658};
    uint8_t enter = 140, exit = 110;
    uint16_t getC5Frequency(uint8_t pilot) const { return pilot < 8 ? frequency[pilot] : 0; }
    uint8_t getC5RaceMask() const { return 0x01; }
    uint8_t getC5EnterRssi(uint8_t) const { return enter; }
    uint8_t getC5ExitRssi(uint8_t) const { return exit; }
    uint32_t getMinLapMs() const { return 3000; }
};
