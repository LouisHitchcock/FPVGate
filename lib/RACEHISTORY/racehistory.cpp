#include "racehistory.h"
#include <LittleFS.h>
#include <algorithm>
#include "debug.h"

RaceHistory::RaceHistory() {
}

bool RaceHistory::init() {
    return loadFromFile();
}

bool RaceHistory::saveRace(const RaceSession& race) {
    // Add race to front of list (newest first)
    races.insert(races.begin(), race);
    
    // Keep only MAX_RACES
    if (races.size() > MAX_RACES) {
        races.resize(MAX_RACES);
    }
    
    return saveToFile();
}

bool RaceHistory::loadRaces() {
    return loadFromFile();
}

bool RaceHistory::deleteRace(uint32_t timestamp) {
    auto it = std::remove_if(races.begin(), races.end(),
        [timestamp](const RaceSession& r) { return r.timestamp == timestamp; });
    
    if (it != races.end()) {
        races.erase(it, races.end());
        return saveToFile();
    }
    return false;
}

bool RaceHistory::updateRace(uint32_t timestamp, const String& name, const String& tag) {
    for (auto& race : races) {
        if (race.timestamp == timestamp) {
            race.name = name;
            race.tag = tag;
            return saveToFile();
        }
    }
    return false;
}

bool RaceHistory::clearAll() {
    races.clear();
    return saveToFile();
}

String RaceHistory::toJsonString() {
    DynamicJsonDocument doc(32768);
    JsonArray racesArray = doc.createNestedArray("races");
    
    for (const auto& race : races) {
        JsonObject raceObj = racesArray.createNestedObject();
        raceObj["timestamp"] = race.timestamp;
        raceObj["fastestLap"] = race.fastestLap;
        raceObj["medianLap"] = race.medianLap;
        raceObj["best3LapsTotal"] = race.best3LapsTotal;
        raceObj["name"] = race.name;
        raceObj["tag"] = race.tag;
        
        JsonArray lapsArray = raceObj.createNestedArray("lapTimes");
        for (uint32_t lap : race.lapTimes) {
            lapsArray.add(lap);
        }
    }
    
    String output;
    serializeJson(doc, output);
    return output;
}

bool RaceHistory::fromJsonString(const String& json) {
    DynamicJsonDocument doc(32768);
    DeserializationError error = deserializeJson(doc, json);
    
    if (error) {
        DEBUG("Failed to parse races JSON: %s\n", error.c_str());
        return false;
    }
    
    // Don't clear - merge imported races with existing ones
    JsonArray racesArray = doc["races"];
    
    for (JsonObject raceObj : racesArray) {
        RaceSession race;
        race.timestamp = raceObj["timestamp"];
        race.fastestLap = raceObj["fastestLap"];
        race.medianLap = raceObj["medianLap"];
        race.best3LapsTotal = raceObj["best3LapsTotal"];
        race.name = raceObj["name"] | "";
        race.tag = raceObj["tag"] | "";
        
        JsonArray lapsArray = raceObj["lapTimes"];
        for (uint32_t lap : lapsArray) {
            race.lapTimes.push_back(lap);
        }
        
        // Check if race with this timestamp already exists
        bool exists = false;
        for (const auto& existingRace : races) {
            if (existingRace.timestamp == race.timestamp) {
                exists = true;
                break;
            }
        }
        
        // Only add if it doesn't exist (avoid duplicates)
        if (!exists) {
            races.push_back(race);
        }
    }
    
    // Sort by timestamp (newest first)
    std::sort(races.begin(), races.end(), 
        [](const RaceSession& a, const RaceSession& b) { return a.timestamp > b.timestamp; });
    
    // Keep only MAX_RACES
    if (races.size() > MAX_RACES) {
        races.resize(MAX_RACES);
    }
    
    return saveToFile();
}

bool RaceHistory::saveToFile() {
    File file = LittleFS.open(RACES_FILE, "w");
    if (!file) {
        DEBUG("Failed to open races file for writing\n");
        return false;
    }
    
    String json = toJsonString();
    size_t written = file.print(json);
    file.close();
    
    DEBUG("Saved %d races to file (%d bytes)\n", races.size(), written);
    return written > 0;
}

bool RaceHistory::loadFromFile() {
    if (!LittleFS.exists(RACES_FILE)) {
        DEBUG("Races file does not exist, starting fresh\n");
        races.clear();
        return true;
    }
    
    File file = LittleFS.open(RACES_FILE, "r");
    if (!file) {
        DEBUG("Failed to open races file for reading\n");
        return false;
    }
    
    String json = file.readString();
    file.close();
    
    DynamicJsonDocument doc(32768);
    DeserializationError error = deserializeJson(doc, json);
    
    if (error) {
        DEBUG("Failed to parse races file: %s\n", error.c_str());
        return false;
    }
    
    races.clear();
    JsonArray racesArray = doc["races"];
    
    for (JsonObject raceObj : racesArray) {
        RaceSession race;
        race.timestamp = raceObj["timestamp"];
        race.fastestLap = raceObj["fastestLap"];
        race.medianLap = raceObj["medianLap"];
        race.best3LapsTotal = raceObj["best3LapsTotal"];
        race.name = raceObj["name"] | "";
        race.tag = raceObj["tag"] | "";
        
        JsonArray lapsArray = raceObj["lapTimes"];
        for (uint32_t lap : lapsArray) {
            race.lapTimes.push_back(lap);
        }
        
        races.push_back(race);
    }
    
    DEBUG("Loaded %d races from file\n", races.size());
    return true;
}
