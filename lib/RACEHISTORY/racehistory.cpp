#include "racehistory.h"
#include <algorithm>
#include <time.h>
#include "debug.h"

RaceHistory::RaceHistory() : storage(nullptr), rssiRecorder(nullptr) {
}

bool RaceHistory::init(Storage* storageBackend) {
    storage = storageBackend;
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }
    
    storage->mkdir("/races");
    return true;
}

void RaceHistory::setRssiRecorder(RaceRssiRecorder* recorder) {
    rssiRecorder = recorder;
}

static String raceFilePathForTimestamp(uint32_t timestamp) {
    time_t ts = timestamp;
    struct tm timeinfo;
    localtime_r(&ts, &timeinfo);
    char filename[32];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.json", &timeinfo);
    return String(RACES_DIR) + "/" + String(filename);
}

void RaceHistory::writeRaceObject(JsonObject raceObj, const RaceSession& race) const {
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

    if (race.rssiMeta.hasHistory && race.rssiMeta.file.length() > 0) {
        JsonObject rh = raceObj["rssiHistory"].to<JsonObject>();
        rh["intervalMs"] = race.rssiMeta.intervalMs;
        rh["sampleCount"] = race.rssiMeta.sampleCount;
        rh["truncated"] = race.rssiMeta.truncated;
        rh["file"] = race.rssiMeta.file;
        raceObj["hasRssiHistory"] = true;
        raceObj["rssiSampleCount"] = race.rssiMeta.sampleCount;
        raceObj["rssiIntervalMs"] = race.rssiMeta.intervalMs;
    } else {
        raceObj["hasRssiHistory"] = false;
        raceObj["rssiSampleCount"] = 0;
        raceObj["rssiIntervalMs"] = 0;
    }
}

void RaceHistory::readRssiMeta(JsonObject raceObj, RaceSession& race) const {
    race.rssiMeta = RaceRssiMeta();
    if (!raceObj["rssiHistory"].isNull()) {
        JsonObject rh = raceObj["rssiHistory"].as<JsonObject>();
        race.rssiMeta.intervalMs = rh["intervalMs"] | RACE_RSSI_INTERVAL_MS;
        race.rssiMeta.sampleCount = rh["sampleCount"] | 0;
        race.rssiMeta.truncated = rh["truncated"] | false;
        race.rssiMeta.file = rh["file"] | "";
        race.rssiMeta.hasHistory = race.rssiMeta.file.length() > 0 && race.rssiMeta.sampleCount > 0;
    } else if (raceObj["hasRssiHistory"] | false) {
        race.rssiMeta.hasHistory = true;
        race.rssiMeta.sampleCount = raceObj["rssiSampleCount"] | 0;
        race.rssiMeta.intervalMs = raceObj["rssiIntervalMs"] | RACE_RSSI_INTERVAL_MS;
        race.rssiMeta.file = RaceRssiRecorder::sidecarBasenameForTimestamp(race.timestamp);
    }
}

bool RaceHistory::writeRaceFile(const RaceSession& race) {
    if (!storage) {
        return false;
    }
    JsonDocument doc;
    JsonObject raceObj = doc.to<JsonObject>();
    writeRaceObject(raceObj, race);
    String json;
    serializeJson(doc, json);
    String filepath = raceFilePathForTimestamp(race.timestamp);
    return storage->writeFile(filepath, json);
}

void RaceHistory::deleteSidecar(const RaceSession& race) {
    if (!storage) {
        return;
    }
    if (race.rssiMeta.file.length() > 0) {
        String path = race.rssiMeta.file.startsWith("/") ? race.rssiMeta.file : (String(RACES_DIR) + "/" + race.rssiMeta.file);
        storage->deleteFile(path);
    }
    // Also try canonical path from timestamp
    storage->deleteFile(RaceRssiRecorder::sidecarPathForTimestamp(race.timestamp));
}

bool RaceHistory::saveRace(const RaceSession& raceIn) {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null in saveRace!\n");
        return false;
    }
    storage->mkdir(RACES_DIR);

    RaceSession race = raceIn;

    // Attach pending RSSI capture from the just-finished race if present
    if (rssiRecorder && rssiRecorder->hasPending()) {
        RaceRssiMeta meta;
        if (rssiRecorder->attachToRace(race.timestamp, meta)) {
            race.rssiMeta = meta;
        }
    }

    bool success = writeRaceFile(race);
    if (success) {
        DEBUG("Saved race to %s\n", raceFilePathForTimestamp(race.timestamp).c_str());
        Serial.printf("[Race] Saved to SD: %s (%u laps, rssi=%u)\n",
                      raceFilePathForTimestamp(race.timestamp).c_str(),
                      (unsigned)race.lapTimes.size(),
                      (unsigned)race.rssiMeta.sampleCount);
        races.insert(races.begin(), race);
        if (races.size() > MAX_RACES) {
            // Delete sidecar for dropped race if we ever prune files later; for now only memory list
            races.resize(MAX_RACES);
        }
    } else {
        DEBUG("Failed to save race\n");
        Serial.printf("[Race] Failed to save race %u\n", race.timestamp);
    }

    return success;
}

bool RaceHistory::loadRaces() {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null!\n");
        return false;
    }

    storage->mkdir(RACES_DIR);
    races.clear();

    std::vector<String> files;
    if (!storage->listDir(RACES_DIR, files)) {
        DEBUG("Races directory does not exist or is empty\n");
        return true;
    }

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

        readRssiMeta(doc.as<JsonObject>(), race);
        // Verify sidecar still exists
        if (race.rssiMeta.hasHistory) {
            String path = race.rssiMeta.file.startsWith("/") ? race.rssiMeta.file
                                                             : (String(RACES_DIR) + "/" + race.rssiMeta.file);
            if (!storage->exists(path)) {
                // Try timestamp canonical name
                path = RaceRssiRecorder::sidecarPathForTimestamp(race.timestamp);
                if (storage->exists(path)) {
                    race.rssiMeta.file = RaceRssiRecorder::sidecarBasenameForTimestamp(race.timestamp);
                } else {
                    race.rssiMeta = RaceRssiMeta();
                }
            }
        }

        races.push_back(race);
        fileCount++;

        if (fileCount % 10 == 0) {
            vTaskDelay(pdMS_TO_TICKS(1));
        }
    }

    DEBUG("Loaded %d races from individual files\n", races.size());
    return true;
}

bool RaceHistory::deleteRace(uint32_t timestamp) {
    String filepath = raceFilePathForTimestamp(timestamp);
    bool fileDeleted = storage->deleteFile(filepath);

    RaceSession removed;
    bool found = false;
    auto it = std::remove_if(races.begin(), races.end(),
        [timestamp, &removed, &found](const RaceSession& r) {
            if (r.timestamp == timestamp) {
                removed = r;
                found = true;
                return true;
            }
            return false;
        });

    if (it != races.end()) {
        races.erase(it, races.end());
        if (found) {
            deleteSidecar(removed);
        } else {
            storage->deleteFile(RaceRssiRecorder::sidecarPathForTimestamp(timestamp));
        }
        return fileDeleted;
    }

    storage->deleteFile(RaceRssiRecorder::sidecarPathForTimestamp(timestamp));
    return false;
}

bool RaceHistory::updateRace(uint32_t timestamp, const String& name, const String& tag, float totalDistance, const String& notes) {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null in updateRace!\n");
        return false;
    }
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

    return writeRaceFile(*targetRace);
}

bool RaceHistory::updateLaps(uint32_t timestamp, const std::vector<uint32_t>& newLapTimes) {
    if (!storage) {
        DEBUG("RaceHistory: Storage backend is null in updateLaps!\n");
        return false;
    }
    if (newLapTimes.empty()) {
        DEBUG("Cannot update race with empty lap times\n");
        return false;
    }

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

    targetRace->lapTimes = newLapTimes;
    targetRace->fastestLap = *std::min_element(newLapTimes.begin(), newLapTimes.end());

    std::vector<uint32_t> sorted = newLapTimes;
    std::sort(sorted.begin(), sorted.end());
    size_t mid = sorted.size() / 2;
    if (sorted.size() % 2 == 0) {
        targetRace->medianLap = (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
        targetRace->medianLap = sorted[mid];
    }

    if (newLapTimes.size() >= 3) {
        targetRace->best3LapsTotal = sorted[0] + sorted[1] + sorted[2];
    } else {
        targetRace->best3LapsTotal = 0;
        for (uint32_t lap : sorted) {
            targetRace->best3LapsTotal += lap;
        }
    }

    bool success = writeRaceFile(*targetRace);
    if (success) {
        DEBUG("Updated laps for race %u\n", timestamp);
    }
    return success;
}

bool RaceHistory::clearAll() {
    std::vector<String> files;
    if (storage->listDir(RACES_DIR, files)) {
        for (const String& filename : files) {
            if (filename.endsWith(".json") || filename.endsWith(".rssi")) {
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

bool RaceHistory::getRaceByTimestamp(uint32_t timestamp, RaceSession& out) const {
    for (const auto& race : races) {
        if (race.timestamp == timestamp) {
            out = race;
            return true;
        }
    }
    return false;
}

String RaceHistory::toJsonString() {
    JsonDocument doc;
    JsonArray racesArray = doc["races"].to<JsonArray>();

    size_t racesToOutput = std::min(races.size(), (size_t)MAX_RACES);
    for (size_t i = 0; i < racesToOutput; i++) {
        JsonObject raceObj = racesArray.add<JsonObject>();
        writeRaceObject(raceObj, races[i]);
    }

    String output;
    serializeJson(doc, output);
    return output;
}

bool RaceHistory::fromJsonString(const String& json) {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        DEBUG("Failed to parse races JSON: %s\n", error.c_str());
        return false;
    }

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

        readRssiMeta(raceObj, race);

        bool exists = false;
        for (const auto& existingRace : races) {
            if (existingRace.timestamp == race.timestamp) {
                exists = true;
                break;
            }
        }

        // Import without re-attaching pending recorder capture
        if (!exists) {
            RaceRssiRecorder* saved = rssiRecorder;
            rssiRecorder = nullptr;
            if (saveRace(race)) {
                importedCount++;
            }
            rssiRecorder = saved;
        }
    }

    DEBUG("Imported %d races\n", importedCount);
    return importedCount > 0 || racesArray.size() == 0;
}
