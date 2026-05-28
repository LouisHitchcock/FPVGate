#include "racehistory.h"
#include <algorithm>
#include <time.h>
#include "debug.h"

RaceHistory::RaceHistory() : storage(nullptr) {
}

bool RaceHistory::init(Storage* storageBackend) {
    storage = storageBackend;
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }
    
    // Create races directory if it doesn't exist
    storage->mkdir("/races");
    return true;
}

bool RaceHistory::saveRace(const RaceSession& race) {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null in saveRace!\\n");
        return false;
    }
    // Ensure /races exists on whichever backend is currently active
    storage->mkdir(RACES_DIR);
    // Generate filename from timestamp: DDMMYY-HrMinSec.json
    time_t timestamp = race.timestamp;
    struct tm timeinfo;
    localtime_r(&timestamp, &timeinfo);
    
    char filename[32];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.json", &timeinfo);
    String filepath = String(RACES_DIR) + "/" + String(filename);
    
    // Create JSON for single race
    JsonDocument doc;
    JsonObject raceObj = doc.to<JsonObject>();
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
    raceObj["notes"] = race.notes;
    raceObj["trackId"] = race.trackId;
    raceObj["trackName"] = race.trackName;
    raceObj["totalDistance"] = race.totalDistance;
    raceObj["syncMode"] = race.syncMode;
    
    JsonArray lapsArray = raceObj["lapTimes"].to<JsonArray>();
    for (uint32_t lap : race.lapTimes) {
        lapsArray.add(lap);
    }
    
    // Multi-pilot support
    if (!race.pilots.empty()) {
        JsonArray pilotsArray = raceObj["pilots"].to<JsonArray>();
        for (const auto& pilot : race.pilots) {
            JsonObject pilotObj = pilotsArray.add<JsonObject>();
            pilotObj["name"] = pilot.name;
            pilotObj["callsign"] = pilot.callsign;
            pilotObj["color"] = pilot.color;
            pilotObj["fastestLap"] = pilot.fastestLap;
            pilotObj["isLocal"] = pilot.isLocal;
            JsonArray pilotLaps = pilotObj["lapTimes"].to<JsonArray>();
            for (uint32_t lap : pilot.lapTimes) {
                pilotLaps.add(lap);
            }
        }
    }
    
    String json;
    serializeJson(doc, json);
    
    DEBUG("Saving race JSON: totalDistance=%.2f, syncMode=%d, pilots=%d\n", race.totalDistance, race.syncMode, race.pilots.size());
    DEBUG("JSON content: %s\n", json.c_str());
    
    bool success = storage->writeFile(filepath, json);
    if (success) {
        DEBUG("Saved race to %s (%d bytes)\n", filepath.c_str(), json.length());
        Serial.printf("[Race] Saved to SD: %s (%u laps)\n", filepath.c_str(), (unsigned)race.lapTimes.size());
        
        // Add to in-memory list
        races.insert(races.begin(), race);
        if (races.size() > MAX_RACES) {
            races.resize(MAX_RACES);
        }
    } else {
        DEBUG("Failed to save race to %s\n", filepath.c_str());
        Serial.printf("[Race] Failed to save to %s\n", filepath.c_str());
    }
    
    return success;
}


bool RaceHistory::loadRaces() {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }

    // Ensure /races exists on whichever backend is currently active
    storage->mkdir(RACES_DIR);
    
    races.clear();
    
    // List all JSON files in races directory
    std::vector<String> files;
    if (!storage->listDir(RACES_DIR, files)) {
        DEBUG("Races directory does not exist or is empty\n");
        return true;
    }
    
    // Load each race file
    int fileCount = 0;
    for (const String& filename : files) {
        if (!filename.endsWith(".json")) {
            continue;
        }
        
        String filepath = String(RACES_DIR) + "/" + filename;
        String json;
        if (!storage->readFile(filepath, json)) {
            DEBUG("Failed to read %s\n", filepath.c_str());
            continue;
        }
        
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, json);
        if (error) {
            DEBUG("Failed to parse %s: %s\n", filepath.c_str(), error.c_str());
            continue;
        }
        
        RaceSession race;
        race.timestamp = doc["timestamp"];
        race.fastestLap = doc["fastestLap"];
        race.medianLap = doc["medianLap"];
        race.best3LapsTotal = doc["best3LapsTotal"];
        race.name = doc["name"] | "";
        race.tag = doc["tag"] | "";
        race.pilotName = doc["pilotName"] | "";
        race.pilotCallsign = doc["pilotCallsign"] | "";
        race.frequency = doc["frequency"] | 0;
        race.band = doc["band"] | "";
        race.channel = doc["channel"] | 0;
        race.notes = doc["notes"] | "";
        race.trackId = doc["trackId"] | 0;
        race.trackName = doc["trackName"] | "";
        race.totalDistance = doc["totalDistance"] | 0.0f;
        race.syncMode = doc["syncMode"] | 0;
        
        JsonArray lapsArray = doc["lapTimes"];
        for (uint32_t lap : lapsArray) {
            race.lapTimes.push_back(lap);
        }
        
        // Load pilots array if present
        if (!doc["pilots"].isNull()) {
            JsonArray pilotsArray = doc["pilots"];
            for (JsonObject pilotObj : pilotsArray) {
                PilotData pilot;
                pilot.name = pilotObj["name"] | "";
                pilot.callsign = pilotObj["callsign"] | "";
                pilot.color = pilotObj["color"] | 0x0080FF;
                pilot.fastestLap = pilotObj["fastestLap"] | 0;
                pilot.isLocal = pilotObj["isLocal"] | false;
                JsonArray pilotLaps = pilotObj["lapTimes"];
                for (uint32_t lap : pilotLaps) {
                    pilot.lapTimes.push_back(lap);
                }
                race.pilots.push_back(pilot);
            }
        }
        
        races.push_back(race);
        fileCount++;
        
        // Yield to other tasks every 10 files to prevent watchdog timeout
        // and reduce SPI mutex contention with LCD
        if (fileCount % 10 == 0) {
            vTaskDelay(pdMS_TO_TICKS(1));
        }
    }
    
    DEBUG("Loaded %d races from individual files\n", races.size());
    return true;
}

bool RaceHistory::deleteRace(uint32_t timestamp) {
    // Find and delete the file
    time_t ts = timestamp;
    struct tm timeinfo;
    localtime_r(&ts, &timeinfo);
    
    char filename[32];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.json", &timeinfo);
    String filepath = String(RACES_DIR) + "/" + String(filename);
    
    bool fileDeleted = storage->deleteFile(filepath);
    
    // Remove from in-memory list
    auto it = std::remove_if(races.begin(), races.end(),
        [timestamp](const RaceSession& r) { return r.timestamp == timestamp; });
    
    if (it != races.end()) {
        races.erase(it, races.end());
        return fileDeleted;
    }
    
    return false;
}

bool RaceHistory::updateRace(uint32_t timestamp, const String& name, const String& tag, float totalDistance, const String& notes) {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null in updateRace!\n");
        return false;
    }
    // Update in-memory race
    RaceSession* targetRace = nullptr;
    for (auto& race : races) {
        if (race.timestamp == timestamp) {
            race.name = name;
            race.tag = tag;
            if (totalDistance >= 0.0f) {
                race.totalDistance = totalDistance;
            }
            race.notes = notes;
            targetRace = &race;
            break;
        }
    }
    
    if (!targetRace) {
        return false;
    }
    
    // Regenerate file with updated data
    time_t ts = timestamp;
    struct tm timeinfo;
    localtime_r(&ts, &timeinfo);
    
    char filename[32];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.json", &timeinfo);
    String filepath = String(RACES_DIR) + "/" + String(filename);
    
    // Create JSON
    JsonDocument doc;
    JsonObject raceObj = doc.to<JsonObject>();
    raceObj["timestamp"] = targetRace->timestamp;
    raceObj["fastestLap"] = targetRace->fastestLap;
    raceObj["medianLap"] = targetRace->medianLap;
    raceObj["best3LapsTotal"] = targetRace->best3LapsTotal;
    raceObj["name"] = targetRace->name;
    raceObj["tag"] = targetRace->tag;
    raceObj["pilotName"] = targetRace->pilotName;
    raceObj["pilotCallsign"] = targetRace->pilotCallsign;
    raceObj["frequency"] = targetRace->frequency;
    raceObj["band"] = targetRace->band;
    raceObj["channel"] = targetRace->channel;
    raceObj["notes"] = targetRace->notes;
    raceObj["trackId"] = targetRace->trackId;
    raceObj["trackName"] = targetRace->trackName;
    raceObj["totalDistance"] = targetRace->totalDistance;
    
    JsonArray lapsArray = raceObj["lapTimes"].to<JsonArray>();
    for (uint32_t lap : targetRace->lapTimes) {
        lapsArray.add(lap);
    }
    
    String json;
    serializeJson(doc, json);
    
    return storage->writeFile(filepath, json);
}

bool RaceHistory::updateLaps(uint32_t timestamp, const std::vector<uint32_t>& newLapTimes) {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null in updateLaps!\n");
        return false;
    }
    // Validate lap times
    if (newLapTimes.empty()) {
        DEBUG("Cannot update race with empty lap times\n");
        return false;
    }
    
    // Find the race in memory
    RaceSession* targetRace = nullptr;
    for (auto& race : races) {
        if (race.timestamp == timestamp) {
            targetRace = &race;
            break;
        }
    }
    
    if (!targetRace) {
        DEBUG("Race with timestamp %u not found\n", timestamp);
        return false;
    }
    
    // Update lap times
    targetRace->lapTimes = newLapTimes;
    
    // Recalculate statistics
    // Fastest lap
    targetRace->fastestLap = *std::min_element(newLapTimes.begin(), newLapTimes.end());
    
    // Median lap
    std::vector<uint32_t> sorted = newLapTimes;
    std::sort(sorted.begin(), sorted.end());
    size_t mid = sorted.size() / 2;
    if (sorted.size() % 2 == 0) {
        targetRace->medianLap = (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
        targetRace->medianLap = sorted[mid];
    }
    
    // Best 3 laps total
    if (newLapTimes.size() >= 3) {
        targetRace->best3LapsTotal = sorted[0] + sorted[1] + sorted[2];
    } else {
        targetRace->best3LapsTotal = 0;
        for (uint32_t lap : sorted) {
            targetRace->best3LapsTotal += lap;
        }
    }
    
    // Write updated race to file
    time_t ts = timestamp;
    struct tm timeinfo;
    localtime_r(&ts, &timeinfo);
    
    char filename[32];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.json", &timeinfo);
    String filepath = String(RACES_DIR) + "/" + String(filename);
    
    // Create JSON
    JsonDocument doc;
    JsonObject raceObj = doc.to<JsonObject>();
    raceObj["timestamp"] = targetRace->timestamp;
    raceObj["fastestLap"] = targetRace->fastestLap;
    raceObj["medianLap"] = targetRace->medianLap;
    raceObj["best3LapsTotal"] = targetRace->best3LapsTotal;
    raceObj["name"] = targetRace->name;
    raceObj["tag"] = targetRace->tag;
    raceObj["pilotName"] = targetRace->pilotName;
    raceObj["pilotCallsign"] = targetRace->pilotCallsign;
    raceObj["frequency"] = targetRace->frequency;
    raceObj["band"] = targetRace->band;
    raceObj["channel"] = targetRace->channel;
    raceObj["notes"] = targetRace->notes;
    raceObj["trackId"] = targetRace->trackId;
    raceObj["trackName"] = targetRace->trackName;
    raceObj["totalDistance"] = targetRace->totalDistance;
    
    JsonArray lapsArray = raceObj["lapTimes"].to<JsonArray>();
    for (uint32_t lap : targetRace->lapTimes) {
        lapsArray.add(lap);
    }
    
    String json;
    serializeJson(doc, json);
    
    bool success = storage->writeFile(filepath, json);
    if (success) {
        DEBUG("Updated laps for race %u\n", timestamp);
    }
    return success;
}

bool RaceHistory::clearAll() {
    // Delete all race files
    std::vector<String> files;
    if (storage->listDir(RACES_DIR, files)) {
        for (const String& filename : files) {
            if (filename.endsWith(".json")) {
                String filepath = String(RACES_DIR) + "/" + filename;
                storage->deleteFile(filepath);
            }
        }
    }
    
    races.clear();
    return true;
}

const std::vector<RaceSession>& RaceHistory::getRaces() {
    return races;
}

String RaceHistory::toJsonString() {
    JsonDocument doc;  // 128KB - enough for ~50 races with multi-pilot data
    JsonArray racesArray = doc["races"].to<JsonArray>();
    
    // Limit output to MAX_RACES to avoid memory issues
    size_t racesToOutput = std::min(races.size(), (size_t)MAX_RACES);
    for (size_t i = 0; i < racesToOutput; i++) {
        const auto& race = races[i];
        JsonObject raceObj = racesArray.add<JsonObject>();
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
        raceObj["notes"] = race.notes;
        raceObj["trackId"] = race.trackId;
        raceObj["trackName"] = race.trackName;
        raceObj["totalDistance"] = race.totalDistance;
        raceObj["syncMode"] = race.syncMode;
        
        JsonArray lapsArray = raceObj["lapTimes"].to<JsonArray>();
        for (uint32_t lap : race.lapTimes) {
            lapsArray.add(lap);
        }
        
        // Include pilots array if present
        if (!race.pilots.empty()) {
            JsonArray pilotsArray = raceObj["pilots"].to<JsonArray>();
            for (const auto& pilot : race.pilots) {
                JsonObject pilotObj = pilotsArray.add<JsonObject>();
                pilotObj["name"] = pilot.name;
                pilotObj["callsign"] = pilot.callsign;
                pilotObj["color"] = pilot.color;
                pilotObj["fastestLap"] = pilot.fastestLap;
                pilotObj["isLocal"] = pilot.isLocal;
                JsonArray pilotLaps = pilotObj["lapTimes"].to<JsonArray>();
                for (uint32_t lap : pilot.lapTimes) {
                    pilotLaps.add(lap);
                }
            }
        }
    }
    
    String output;
    serializeJson(doc, output);
    return output;
}

bool RaceHistory::fromJsonString(const String& json) {
    JsonDocument doc;  // Increased for multi-pilot data
    DeserializationError error = deserializeJson(doc, json);
    
    if (error) {
        DEBUG("Failed to parse races JSON: %s\n", error.c_str());
        return false;
    }
    
    // Import races from JSON array
    JsonArray racesArray = doc["races"];
    int importedCount = 0;
    
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
        race.notes = raceObj["notes"] | "";
        race.trackId = raceObj["trackId"] | 0;
        race.trackName = raceObj["trackName"] | "";
        race.totalDistance = raceObj["totalDistance"] | 0.0f;
        race.syncMode = raceObj["syncMode"] | 0;
        
        JsonArray lapsArray = raceObj["lapTimes"];
        for (uint32_t lap : lapsArray) {
            race.lapTimes.push_back(lap);
        }
        
        // Import pilots array if present
        if (!raceObj["pilots"].isNull()) {
            JsonArray pilotsArray = raceObj["pilots"];
            for (JsonObject pilotObj : pilotsArray) {
                PilotData pilot;
                pilot.name = pilotObj["name"] | "";
                pilot.callsign = pilotObj["callsign"] | "";
                pilot.color = pilotObj["color"] | 0x0080FF;
                pilot.fastestLap = pilotObj["fastestLap"] | 0;
                pilot.isLocal = pilotObj["isLocal"] | false;
                JsonArray pilotLaps = pilotObj["lapTimes"];
                for (uint32_t lap : pilotLaps) {
                    pilot.lapTimes.push_back(lap);
                }
                race.pilots.push_back(pilot);
            }
        }
        
        // Check if race with this timestamp already exists
        bool exists = false;
        for (const auto& existingRace : races) {
            if (existingRace.timestamp == race.timestamp) {
                exists = true;
                break;
            }
        }
        
        // Save to individual file if it doesn't exist
        if (!exists && saveRace(race)) {
            importedCount++;
        }
    }
    
    // Reload all races to update in-memory list
    loadRaces();
    
    DEBUG("Imported %d races\n", importedCount);
    return true;
}

