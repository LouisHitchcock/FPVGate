#ifndef RACEHISTORY_H
#define RACEHISTORY_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <vector>

#define MAX_RACES 50
#define RACES_FILE "/races.json"

struct RaceSession {
    uint32_t timestamp;
    std::vector<uint32_t> lapTimes;
    uint32_t fastestLap;
    uint32_t medianLap;
    uint32_t best3LapsTotal;
    String name;
    String tag;
};

class RaceHistory {
   public:
    RaceHistory();
    bool init();
    bool saveRace(const RaceSession& race);
    bool loadRaces();
    bool deleteRace(uint32_t timestamp);
    bool updateRace(uint32_t timestamp, const String& name, const String& tag);
    bool clearAll();
    String toJsonString();
    bool fromJsonString(const String& json);
    const std::vector<RaceSession>& getRaces() const { return races; }
    size_t getRaceCount() const { return races.size(); }

   private:
    bool saveToFile();
    bool loadFromFile();
    std::vector<RaceSession> races;
};

#endif
