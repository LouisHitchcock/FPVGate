#ifndef RACEHISTORY_H
#define RACEHISTORY_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>
#include "storage.h"

#define MAX_RACES 50
#define RACES_DIR "/races"
#define MAX_PILOTS 6

// Pilot data for multi-pilot races
struct PilotData {
    String name;
    String callsign;
    uint32_t color;  // RGB color as 0xRRGGBB
    std::vector<uint32_t> lapTimes;
    uint32_t fastestLap;
    bool isLocal;  // True if this is the local pilot on this device
};

struct RaceSession {
    uint32_t timestamp;
    std::vector<uint32_t> lapTimes;  // Legacy: single pilot lap times
    uint32_t fastestLap;
    uint32_t medianLap;
    uint32_t best3LapsTotal;
    String name;
    String tag;
    String pilotName;      // Legacy: single pilot name
    String pilotCallsign;  // Legacy: single pilot callsign
    uint16_t frequency;
    String band;
    uint8_t channel;
    uint32_t trackId;
    String trackName;
    float totalDistance;
    
    // Multi-pilot support
    uint8_t syncMode;  // 0=personal, 1=master, 2=slave
    std::vector<PilotData> pilots;  // Empty for legacy single-pilot races
};

class RaceHistory {
   public:
    RaceHistory();
    bool init(Storage* storage);
    bool saveRace(const RaceSession& race);
    bool loadRaces();
    bool deleteRace(uint32_t timestamp);
    bool updateRace(uint32_t timestamp, const String& name, const String& tag, float totalDistance = -1.0f);
    bool updateLaps(uint32_t timestamp, const std::vector<uint32_t>& newLapTimes);
    bool clearAll();
    String toJsonString();
    bool fromJsonString(const String& json);
    const std::vector<RaceSession>& getRaces();
    size_t getRaceCount() const { return races.size(); }

   private:
    std::vector<RaceSession> races;
    Storage* storage;
};

#endif
