#include "trackmanager.h"
#include <algorithm>
#include <time.h>
#include "debug.h"

TrackManager::TrackManager() : storage(nullptr) {
}

bool TrackManager::init(Storage* storageBackend) {
    storage = storageBackend;
    if (!storage) {
        DEBUG("TrackManager: Storage backend is null!\n");
        return false;
    }
    
    // Create tracks directory if it doesn't exist
    storage->mkdir(TRACKS_DIR);
    storage->mkdir(TRACK_IMAGES_DIR);
    
    return loadTracks();
}

String TrackManager::generateFilename(uint32_t trackId) {
    time_t timestamp = trackId;
    struct tm timeinfo;
    localtime_r(&timestamp, &timeinfo);
    
    char filename[32];
    strftime(filename, sizeof(filename), "%d%m%y-%H%M%S.json", &timeinfo);
    return String(TRACKS_DIR) + "/" + String(filename);
}

bool TrackManager::createTrack(const Track& track) {
    String filepath = generateFilename(track.trackId);
    
    // Create JSON for single track
    JsonDocument doc;
    JsonObject trackObj = doc.to<JsonObject>();
    trackObj["trackId"] = track.trackId;
    trackObj["name"] = track.name;
    trackObj["tags"] = track.tags;
    trackObj["distance"] = track.distance;
    trackObj["notes"] = track.notes;
    trackObj["imagePath"] = track.imagePath;
    
    String json;
    serializeJson(doc, json);
    
    bool success = storage->writeFile(filepath, json);
    if (success) {
        DEBUG("Saved track to %s (%d bytes)\n", filepath.c_str(), json.length());
        
        // Add to in-memory list
        tracks.insert(tracks.begin(), track);
        if (tracks.size() > MAX_TRACKS) {
            tracks.resize(MAX_TRACKS);
        }
    } else {
        DEBUG("Failed to save track to %s\n", filepath.c_str());
    }
    
    return success;
}

bool TrackManager::loadTracks() {
    if (!storage) {
        DEBUG("TrackManager: Storage backend is null!\n");
        return false;
    }
    
    tracks.clear();
    
    // List all JSON files in tracks directory
    std::vector<String> files;
    if (!storage->listDir(TRACKS_DIR, files)) {
        DEBUG("Tracks directory does not exist or is empty\n");
        return true;
    }
    
    // Load each track file
    for (const String& filename : files) {
        if (!filename.endsWith(".json")) {
            continue;
        }
        
        String filepath = String(TRACKS_DIR) + "/" + filename;
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
        
        Track track;
        track.trackId = doc["trackId"];
        track.name = doc["name"] | "";
        track.tags = doc["tags"] | "";
        track.distance = doc["distance"] | 0.0f;
        track.notes = doc["notes"] | "";
        track.imagePath = doc["imagePath"] | "";
        
        tracks.push_back(track);
    }
    
    // Sort by trackId (newest first)
    std::sort(tracks.begin(), tracks.end(), 
        [](const Track& a, const Track& b) { return a.trackId > b.trackId; });
    
    // Keep only MAX_TRACKS
    if (tracks.size() > MAX_TRACKS) {
        tracks.resize(MAX_TRACKS);
    }
    
    DEBUG("Loaded %d tracks from individual files\n", tracks.size());
    return true;
}

bool TrackManager::deleteTrack(uint32_t trackId) {
    String filepath = generateFilename(trackId);
    
    // Delete track image if it exists
    deleteTrackImage(trackId);
    
    bool fileDeleted = storage->deleteFile(filepath);
    
    // Remove from in-memory list
    auto it = std::remove_if(tracks.begin(), tracks.end(),
        [trackId](const Track& t) { return t.trackId == trackId; });
    
    if (it != tracks.end()) {
        tracks.erase(it, tracks.end());
        return fileDeleted;
    }
    
    return false;
}

bool TrackManager::updateTrack(uint32_t trackId, const Track& updatedTrack) {
    // Update in-memory track
    Track* targetTrack = nullptr;
    for (auto& track : tracks) {
        if (track.trackId == trackId) {
            track.name = updatedTrack.name;
            track.tags = updatedTrack.tags;
            track.distance = updatedTrack.distance;
            track.notes = updatedTrack.notes;
            // Don't update imagePath here, use saveTrackImage for that
            targetTrack = &track;
            break;
        }
    }
    
    if (!targetTrack) {
        return false;
    }
    
    // Write updated track to file
    String filepath = generateFilename(trackId);
    
    JsonDocument doc;
    JsonObject trackObj = doc.to<JsonObject>();
    trackObj["trackId"] = targetTrack->trackId;
    trackObj["name"] = targetTrack->name;
    trackObj["tags"] = targetTrack->tags;
    trackObj["distance"] = targetTrack->distance;
    trackObj["notes"] = targetTrack->notes;
    trackObj["imagePath"] = targetTrack->imagePath;
    
    String json;
    serializeJson(doc, json);
    
    return storage->writeFile(filepath, json);
}

bool TrackManager::clearAll() {
    // Delete all track files
    std::vector<String> files;
    if (storage->listDir(TRACKS_DIR, files)) {
        for (const String& filename : files) {
            if (filename.endsWith(".json")) {
                String filepath = String(TRACKS_DIR) + "/" + filename;
                storage->deleteFile(filepath);
            }
        }
    }
    
    // Delete all track images
    std::vector<String> imageFiles;
    if (storage->listDir(TRACK_IMAGES_DIR, imageFiles)) {
        for (const String& filename : imageFiles) {
            String filepath = String(TRACK_IMAGES_DIR) + "/" + filename;
            storage->deleteFile(filepath);
        }
    }
    
    tracks.clear();
    return true;
}

String TrackManager::toJsonString() {
    JsonDocument doc;
    JsonArray tracksArray = doc["tracks"].to<JsonArray>();
    
    for (const auto& track : tracks) {
        JsonObject trackObj = tracksArray.add<JsonObject>();
        trackObj["trackId"] = track.trackId;
        trackObj["name"] = track.name;
        trackObj["tags"] = track.tags;
        trackObj["distance"] = track.distance;
        trackObj["notes"] = track.notes;
        trackObj["imagePath"] = track.imagePath;
    }
    
    String output;
    serializeJson(doc, output);
    return output;
}

Track* TrackManager::getTrackById(uint32_t trackId) {
    for (auto& track : tracks) {
        if (track.trackId == trackId) {
            return &track;
        }
    }
    return nullptr;
}

bool TrackManager::saveTrackImage(uint32_t trackId, const uint8_t* imageData, size_t imageSize) {
    if (!storage || imageSize == 0) {
        return false;
    }
    
    // Limit image size to 500KB
    if (imageSize > 512000) {
        DEBUG("Track image too large: %d bytes (max 500KB)\n", imageSize);
        return false;
    }
    
    String imagePath = String(TRACK_IMAGES_DIR) + "/" + String(trackId) + ".jpg";
    
    // Convert byte array to String for storage (not ideal but works with current storage API)
    String imageDataStr;
    imageDataStr.reserve(imageSize);
    for (size_t i = 0; i < imageSize; i++) {
        imageDataStr += (char)imageData[i];
    }
    
    bool success = storage->writeFile(imagePath, imageDataStr);
    if (success) {
        // Update track's imagePath
        Track* track = getTrackById(trackId);
        if (track) {
            track->imagePath = imagePath;
            updateTrack(trackId, *track);
        }
    }
    
    return success;
}

bool TrackManager::deleteTrackImage(uint32_t trackId) {
    String imagePath = String(TRACK_IMAGES_DIR) + "/" + String(trackId) + ".jpg";
    
    if (storage->exists(imagePath)) {
        return storage->deleteFile(imagePath);
    }
    
    return true;  // No image to delete is not an error
}

String TrackManager::getTrackImagePath(uint32_t trackId) {
    return String(TRACK_IMAGES_DIR) + "/" + String(trackId) + ".jpg";
}
