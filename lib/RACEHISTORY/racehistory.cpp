#include "racehistory.h"
#include <algorithm>
#include "debug.h"

RaceHistory::RaceHistory() : storage(nullptr) {
}

bool RaceHistory::init(Storage* storageBackend) {
    storage = storageBackend;
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }
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
        raceObj["pilotName"] = race.pilotName;
        raceObj["pilotCallsign"] = race.pilotCallsign;
        raceObj["frequency"] = race.frequency;
        raceObj["band"] = race.band;
        raceObj["channel"] = race.channel;
        
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
        race.pilotName = raceObj["pilotName"] | "";
        race.pilotCallsign = raceObj["pilotCallsign"] | "";
        race.frequency = raceObj["frequency"] | 0;
        race.band = raceObj["band"] | "";
        race.channel = raceObj["channel"] | 0;
        
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
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }
    
    String json = toJsonString();
    bool success = storage->writeFile(RACES_FILE, json);
    
    if (success) {
        DEBUG("Saved %d races to file (%d bytes)\n", races.size(), json.length());
    }
    return success;
}

bool RaceHistory::loadFromFile() {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }
    
    if (!storage->exists(RACES_FILE)) {
        DEBUG("Races file does not exist, starting fresh\n");
        races.clear();
        return true;
    }
    
    String json;
    if (!storage->readFile(RACES_FILE, json)) {
        DEBUG("Failed to read races file\n");
        return false;
    }
    
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
        race.pilotName = raceObj["pilotName"] | "";
        race.pilotCallsign = raceObj["pilotCallsign"] | "";
        race.frequency = raceObj["frequency"] | 0;
        race.band = raceObj["band"] | "";
        race.channel = raceObj["channel"] | 0;
        
        JsonArray lapsArray = raceObj["lapTimes"];
        for (uint32_t lap : lapsArray) {
            race.lapTimes.push_back(lap);
        }
        
        races.push_back(race);
    }
    
    DEBUG("Loaded %d races from file\n", races.size());
    return true;
}
