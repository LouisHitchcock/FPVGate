#include "eventdirector.h"
#include <ArduinoJson.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <new>

namespace {
constexpr const char* TMP = "/event-commit.tmp";
constexpr const char* SESSION = "/event-session.json";
constexpr const char* SESSION_TMP = "/event-session.tmp";

// Bound configuration memory independently of the accumulated results. Old
// result bodies are validated and copied through a 1 KB window, never loaded
// as one JsonDocument (the DevKitC shipping board has no PSRAM).
class Budget : public ArduinoJson::Allocator {
    size_t used_ = 0;
public:
    void* allocate(size_t bytes) override {
        if (bytes > 48u * 1024u - used_) return nullptr;
        auto p = static_cast<size_t*>(std::malloc(bytes + sizeof(size_t)));
        if (!p) return nullptr;
        *p = bytes; used_ += bytes; return p + 1;
    }
    void deallocate(void* ptr) override {
        if (!ptr) return;
        auto p = static_cast<size_t*>(ptr) - 1;
        used_ -= *p; std::free(p);
    }
    void* reallocate(void* ptr, size_t bytes) override {
        if (!ptr) return allocate(bytes);
        auto p = static_cast<size_t*>(ptr) - 1;
        const size_t old = *p;
        if (bytes > 48u * 1024u - (used_ - old)) return nullptr;
        auto q = static_cast<size_t*>(std::realloc(p, bytes + sizeof(size_t)));
        if (!q) return nullptr;
        used_ = used_ - old + bytes; *q = bytes; return q + 1;
    }
};

class Reader {
    Storage& storage_; const char* path_; size_t end_, pos_, start_ = 0, count_ = 0;
    // Deserialization nests several range readers. Keep their buffers off the
    // ESP32 loop task's small stack and fail cleanly if allocation is refused.
    std::unique_ptr<uint8_t[]> buffer_{new (std::nothrow) uint8_t[1024]};
public:
    bool ok = true;
    Reader(Storage& storage, const char* path, size_t start, size_t end)
        : storage_(storage), path_(path), end_(end), pos_(start) {}
    size_t position() const { return pos_; }
    int peek() {
        if (!buffer_) { ok = false; return -1; }
        if (pos_ >= end_) return -1;
        if (!count_ || pos_ < start_ || pos_ >= start_ + count_) {
            start_ = pos_;
            const size_t wanted = std::min(size_t(1024), end_ - pos_);
            count_ = storage_.readBinaryRange(path_, pos_, buffer_.get(), wanted);
            if (count_ != wanted) { ok = false; return -1; }
        }
        return buffer_[pos_ - start_];
    }
    int read() { int c = peek(); if (c >= 0) ++pos_; return c; }
    size_t readBytes(char* out, size_t n) {
        size_t got = 0; int c;
        while (got < n && (c = read()) >= 0) out[got++] = static_cast<char>(c);
        return got;
    }
    void space() { while (peek() == ' ' || peek() == '\n' || peek() == '\r' || peek() == '\t') read(); }
    bool value() {
        space(); const int first = peek();
        if (first < 0) return false;
        bool quoted = false, escape = false;
        char stack[32]; size_t depth = 0;
        if (first != '"' && first != '{' && first != '[') {
            size_t n = 0;
            while (peek() >= 0 && peek() != ',' && peek() != '}' && peek() != ']' &&
                   peek() != ' ' && peek() != '\r' && peek() != '\n' && peek() != '\t') { read(); ++n; }
            return n > 0 && ok;
        }
        while (peek() >= 0) {
            const char c = static_cast<char>(read());
            if (quoted) {
                if (escape) escape = false;
                else if (c == '\\') escape = true;
                else if (c == '"') { quoted = false; if (!depth) return true; }
            } else if (c == '"') quoted = true;
            else if (c == '{' || c == '[') {
                if (depth == sizeof(stack)) return false;
                stack[depth++] = c;
            } else if (c == '}' || c == ']') {
                if (!depth || stack[depth - 1] != (c == '}' ? '{' : '[')) return false;
                if (!--depth) return true;
            }
        }
        return false;
    }
};

class Writer {
    Storage& storage_; uint8_t buffer_[1024]; size_t count_ = 0, total_ = 0;
public:
    bool ok;
    explicit Writer(Storage& storage) : storage_(storage), ok(storage.writeBinaryFile(TMP, nullptr, 0)) {}
    bool flush() {
        if (ok && count_) ok = storage_.appendBinaryFile(TMP, buffer_, count_);
        count_ = 0; return ok;
    }
    size_t write(uint8_t c) {
        if (!ok || ++total_ > EventDirector::MAX_BYTES) { ok = false; return 0; }
        buffer_[count_++] = c;
        if (count_ == sizeof(buffer_)) flush();
        return ok ? 1 : 0;
    }
    size_t write(const uint8_t* data, size_t n) {
        size_t written = 0;
        while (written < n && write(data[written])) ++written;
        return written;
    }
    void key(const char* name) {
        JsonDocument value; value.set(name); serializeJson(value, *this); write(':');
    }
    bool copy(Storage& storage, const char* path, size_t begin, size_t end) {
        Reader input(storage, path, begin, end);
        for (int c; (c = input.read()) >= 0 && ok;) write(static_cast<uint8_t>(c));
        return input.ok && ok;
    }
};

struct Field { std::string key; size_t start, end; };
bool managedKey(const std::string& key) {
    return key == "version" || key == "name" || key == "nextId" || key == "pilots" ||
        key == "groups" || key == "formats" || key == "active" || key == "schedule" || key == "gateRevision";
}

class EventJson {
    Storage& storage_; const char* path_;
    Budget budget_;
    std::vector<Field> fields_;
public:
    JsonDocument meta{&budget_};
    size_t raceBegin = 0, raceEnd = 0, raceCount = 0;
    uint32_t largestId = 0;
    bool recorded = false;
    explicit EventJson(Storage& storage, const char* path) : storage_(storage), path_(path) {}
    bool load(uint32_t timestamp = 0) {
        size_t bytes = 0;
        if (!storage_.fileSize(path_, bytes) || !bytes || bytes > EventDirector::MAX_BYTES) return false;
        Reader input(storage_, path_, 0, bytes);
        input.space(); if (input.read() != '{') return false;
        input.space();
        while (input.peek() != '}') {
            if (fields_.size() >= 64 || input.peek() != '"') return false;
            const size_t start = input.position();
            if (!input.value() || input.position() - start > 128) return false;
            Reader keyInput(storage_, path_, start, input.position());
            JsonDocument key;
            if (deserializeJson(key, keyInput) || !key.is<const char*>()) return false;
            const std::string name = key.as<const char*>();
            if (std::any_of(fields_.begin(), fields_.end(), [&](const Field& f) { return f.key == name; })) return false;
            input.space(); if (input.read() != ':') return false;
            input.space(); const size_t begin = input.position();
            if (!input.value()) return false;
            const size_t end = input.position();
            fields_.push_back({name, begin, end});
            Reader value(storage_, path_, begin, end);
            JsonDocument part(&budget_);
            if (name == "races") {
                Reader races(storage_, path_, begin, end);
                if (races.read() != '[') return false;
                raceBegin = races.position(); raceEnd = end - 1;
                races.space();
                while (races.peek() != ']') {
                    const size_t rowStart = races.position();
                    if (races.peek() != '{' || !races.value()) return false;
                    Reader row(storage_, path_, rowStart, races.position());
                    JsonDocument filter;
                    filter["id"] = true; filter["timestamp"] = true;
                    if (deserializeJson(part, row, DeserializationOption::Filter(filter))) return false;
                    if (!part["id"].is<uint32_t>() || !part["timestamp"].is<uint32_t>()) return false;
                    largestId = std::max(largestId, part["id"].as<uint32_t>());
                    if (timestamp && part["timestamp"].as<uint32_t>() == timestamp) recorded = true;
                    ++raceCount;
                    races.space();
                    if (races.peek() == ']') break;
                    if (races.read() != ',') return false;
                    races.space(); if (races.peek() == ']') return false;
                }
            } else if (managedKey(name)) {
                if (deserializeJson(part, value)) return false;
                meta[name].set(part.as<JsonVariantConst>());
            } else {
                JsonDocument filter; filter.set(false);
                if (deserializeJson(part, value, DeserializationOption::Filter(filter))) return false;
            }
            if (meta.overflowed()) return false;
            input.space();
            if (input.peek() == '}') break;
            if (input.read() != ',') return false;
            input.space(); if (input.peek() == '}') return false;
        }
        if (input.read() != '}') return false;
        input.space();
        return input.ok && input.peek() < 0 && meta["version"] == 3 &&
            meta["pilots"].is<JsonArray>() && meta["groups"].is<JsonArray>() &&
            meta["formats"].is<JsonArray>() && meta["schedule"].is<JsonObject>();
    }
    bool write(JsonVariantConst appended = JsonVariantConst()) {
        Writer out(storage_);
        out.write('{'); bool comma = false, haveRaces = false;
        for (const auto& field : fields_) {
            if (comma) out.write(',');
            comma = true;
            out.key(field.key.c_str());
            if (field.key == "races") {
                haveRaces = true; out.write('[');
                if (!out.copy(storage_, path_, raceBegin, raceEnd)) return false;
                if (!appended.isNull()) { if (raceCount) out.write(','); serializeJson(appended, out); }
                out.write(']');
            } else if (managedKey(field.key)) serializeJson(meta[field.key], out);
            else if (!out.copy(storage_, path_, field.start, field.end)) return false;
        }
        // Persist newly introduced managed fields, including nextId/active in
        // older or minimal v3 documents, rather than silently dropping updates.
        for (JsonPair field : meta.as<JsonObject>()) {
            if (std::any_of(fields_.begin(), fields_.end(), [&](const Field& f) { return f.key == field.key().c_str(); })) continue;
            if (comma) out.write(',');
            comma = true;
            out.key(field.key().c_str()); serializeJson(field.value(), out);
        }
        if (!haveRaces && !appended.isNull()) {
            out.write(','); out.key("races"); out.write('[');
            serializeJson(appended, out); out.write(']');
        }
        out.write('}');
        return !meta.overflowed() && out.flush() && storage_.replaceFileSafely(TMP, EventDirector::PATH);
    }
};

JsonObject find(JsonArray array, uint32_t id) {
    for (JsonObject value : array) if (value["id"].as<uint32_t>() == id) return value;
    return JsonObject();
}

// Validate all fields before changing a single live setting.
bool validHeat(JsonDocument& meta, JsonObject active) {
    if (!active["groupId"].is<uint32_t>() || !active["groupId"].as<uint32_t>() ||
        (!active["step"].isNull() && (!active["step"].is<uint32_t>() || active["step"].as<uint32_t>() == UINT32_MAX))) return false;
    JsonObject group = find(meta["groups"], active["groupId"] | 0u);
    JsonObject format = find(meta["formats"], group["formatId"] | 0u);
    JsonArray seats = active["seats"];
    const double minLap = format["minLapS"] | 0.0;
    const double heat = format["timeLimitS"] | 0.0;
    const int laps = format["maxLaps"] | -1;
    if (group.isNull() || format.isNull() || seats.isNull() || !seats.size() || seats.size() > 8 ||
        !std::isfinite(minLap) || minLap < .1 || minLap > 20 || !std::isfinite(heat) || heat < 0 || heat > 1800 ||
        laps < 0 || laps > 63 || (format["countdown"] | 1) < 0 || (format["countdown"] | 1) > 1) return false;
    bool tuned = false;
    for (size_t i = 0; i < seats.size(); ++i) {
        if (seats[i].isNull()) continue;
        if (!seats[i].is<uint32_t>()) return false;
        const uint32_t id = seats[i].as<uint32_t>();
        for (size_t j = 0; j < i; ++j) if (seats[j] == id) return false;
        JsonObject pilot = find(meta["pilots"], id);
        if (pilot.isNull()) return false;
        const std::string key = std::to_string(id);
        const int frequency = group["overrides"][key].isNull() ? (pilot["freq"] | 0) : group["overrides"][key].as<int>();
        if (frequency && (frequency < 5180 || frequency > 5917)) return false;
        tuned |= frequency != 0;
        const int enter = pilot["enter"] | 120, exit = pilot["exit"] | 100;
        if (enter < 0 || enter > 255 || exit < 0 || exit > 255 || (enter && exit >= enter)) return false;
    }
    return tuned;
}

void applyHeat(Config& config, JsonDocument& meta, JsonObject active) {
    JsonObject group = find(meta["groups"], active["groupId"] | 0u);
    JsonObject format = find(meta["formats"], group["formatId"] | 0u);
    JsonArray seats = active["seats"];
    config.setRaceLimits(format["maxLaps"], (uint16_t)std::lround(format["minLapS"].as<double>() * 10),
                         (uint8_t)std::lround(format["timeLimitS"].as<double>() / 30));
    config.setRaceCountdownMode(format["countdown"] | 1);
    config.setC5PilotCount(static_cast<uint8_t>(seats.size()));
    for (uint8_t slot = 0; slot < 8; ++slot) {
        JsonObject pilot = seats[slot].isNull() ? JsonObject() : find(meta["pilots"], seats[slot].as<uint32_t>());
        const std::string key = std::to_string(seats[slot] | 0u);
        uint16_t frequency = pilot.isNull() ? 0 : group["overrides"][key].isNull() ? (pilot["freq"] | 0u) : group["overrides"][key].as<uint16_t>();
        const int enter = pilot["enter"] | 0;
        config.setC5Profile(slot, frequency, enter ? enter : config.getC5EnterRssi(slot),
            enter ? (pilot["exit"] | (enter - 1)) : config.getC5ExitRssi(slot));
        const char* color = pilot["color"] | "#0080ff";
        config.setC5PilotIdentity(slot, pilot["name"] | "", pilot["phonetic"] | "",
            static_cast<uint32_t>(std::strtoul(color[0] == '#' ? color + 1 : color, nullptr, 16)), !pilot.isNull());
    }
}

// Find one scheduled step without allocating an expanded heat-order array.
uint32_t scheduledGroup(JsonDocument& meta, uint32_t wanted) {
    uint32_t pos = 0;
    for (JsonObject block : meta["schedule"]["blocks"].as<JsonArray>()) {
        const int times = std::max(1, std::min(50, block["times"] | 1));
        JsonArray ids = block["groupIds"];
        if (ids.isNull()) continue;
        if (strcmp(block["kind"] | "rotate", "each") == 0) {
            for (JsonVariant id : ids) if (!find(meta["groups"], id.as<uint32_t>()).isNull())
                for (int n = 0; n < times; ++n) if (pos++ == wanted) return id.as<uint32_t>();
        } else for (int n = 0; n < times; ++n)
            for (JsonVariant id : ids) if (!find(meta["groups"], id.as<uint32_t>()).isNull() && pos++ == wanted) return id.as<uint32_t>();
    }
    return 0;
}

bool journal(Storage& storage, JsonDocument& snapshot) {
    std::string text; serializeJson(snapshot, text);
    return text.size() <= 8192 && storage.writeBinaryFile(SESSION_TMP,
        reinterpret_cast<const uint8_t*>(text.data()), text.size()) && storage.replaceFileSafely(SESSION_TMP, SESSION);
}
}

void EventDirector::begin(Config* config, Storage* storage, RaceHistory* history) {
    config_ = config; storage_ = storage; history_ = history;
}
bool EventDirector::fail(const char* message, int status) { error_ = message; errorStatus_ = status; return false; }
std::shared_ptr<EventDirector::Lease> EventDirector::lease() {
    bool expected = false;
    if (!locked_.compare_exchange_strong(expected, true)) { fail("Event storage busy; retry", 503); return {}; }
    return std::make_shared<Lease>(this);
}
std::shared_ptr<EventDirector::Lease> EventDirector::readLease() {
    auto lock = lease();
    if (!lock || !recover()) return {};
    return lock;
}
std::shared_ptr<EventDirector::Lease> EventDirector::editLease() {
    auto lock = readLease();
    if (!lock) return {};
    if (active_) { fail("Stop and save the event race before editing", 409); return {}; }
    return lock;
}

bool EventDirector::commitUpload(uint32_t& revision) {
    EventJson incoming(*storage_, UPLOAD);
    if (!incoming.load()) return fail("Invalid event JSON, schema or configuration budget exceeded", 400);
    uint32_t currentRevision = 0;
    if (storage_->exists(PATH)) {
        size_t bytes = 0;
        if (!storage_->fileSize(PATH, bytes) || bytes > MAX_BYTES) return fail("Saved event cannot be read", 409);
        Reader current(*storage_, PATH, 0, bytes);
        JsonDocument old, filter; filter["gateRevision"] = true;
        if (deserializeJson(old, current, DeserializationOption::Filter(filter)) || !current.ok)
            return fail("Saved event cannot be read; preserve it before recovery", 409);
        currentRevision = old["gateRevision"] | 0u;
    }
    if ((incoming.meta["gateRevision"] | 0u) != currentRevision)
        return fail("Event changed on the gate; reload before editing", 409);
    if (currentRevision == UINT32_MAX) return fail("Event revision exhausted", 409);
    incoming.meta["gateRevision"] = revision = currentRevision + 1;
    if (!incoming.write()) return fail("Event write failed; previous document retained");
    changed_ = true;
    error_ = ""; return true;
}

bool EventDirector::prepare(RaceSession& race) {
    auto lock = readLease();
    if (!lock) return false;
    snapshot_.clear();
    if (!config_->getEventMode() || !storage_->exists(PATH)) return true;
    EventJson event(*storage_, PATH);
    if (!event.load()) return fail("Event cannot be read; open Event to check its data", 400);
    if ((event.meta["schedule"]["reviewRaceId"] | 0u) != 0)
        return fail("Confirm the saved Event results before starting another race", 409);
    JsonObject active = event.meta["active"];
    if (active.isNull()) return true; // Event mode may be on without a loaded heat.
    if (!validHeat(event.meta, active)) return fail("Loaded heat has invalid pilots, channels or race limits", 400);
    JsonObject group = find(event.meta["groups"], active["groupId"]);
    JsonObject format = find(event.meta["formats"], group["formatId"]);
    JsonDocument snapshot;
    snapshot["timestamp"] = race.timestamp;
    snapshot["revision"] = event.meta["gateRevision"] | 0u;
    snapshot["groupId"] = group["id"];
    snapshot["step"] = active["step"];
    snapshot["seats"] = active["seats"];
    snapshot["format"] = format;
    snapshot["eventName"] = event.meta["name"] | "Event";
    snapshot["groupName"] = group["name"] | "Group";
    if (snapshot.overflowed() || !journal(*storage_, snapshot)) return fail("Cannot persist loaded heat snapshot");
    serializeJson(snapshot, snapshot_);
    active_ = true;
    applyHeat(*config_, event.meta, active);
    changed_ = true;
    race.tag = event.meta["name"] | "Event";
    race.name = group["name"] | "Group";
    if (!active["step"].isNull()) race.name = String("Heat ") + String(active["step"].as<int>() + 1) + " - " + race.name;
    error_ = ""; return true;
}

bool EventDirector::complete(const RaceSession& race) {
    auto lock = lease();
    return lock && finish(race);
}
bool EventDirector::finish(const RaceSession& race) {
    if (snapshot_.empty()) return true;
    JsonDocument snapshot;
    if (deserializeJson(snapshot, snapshot_) || snapshot["timestamp"].as<uint32_t>() != race.timestamp)
        return fail("Event snapshot does not match race");
    EventJson event(*storage_, PATH);
    if (!event.load(race.timestamp)) return fail("Cannot read event while recording result");
    if (!event.recorded) {
        const uint32_t revision = event.meta["gateRevision"] | 0u;
        if (revision != snapshot["revision"].as<uint32_t>() || revision == UINT32_MAX)
            return fail("Event changed during the race; result retained for recovery", 409);
        JsonDocument result;
        if (event.largestId >= UINT32_MAX - 1) return fail("Event result ID exhausted");
        uint32_t id = std::max(event.meta["nextId"] | 1u, event.largestId + 1);
        if (!id || id == UINT32_MAX) return fail("Event result ID exhausted");
        result["id"] = id; event.meta["nextId"] = id + 1;
        result["groupId"] = snapshot["groupId"];
        result["step"] = snapshot["step"];
        result["timestamp"] = race.timestamp;
        result["formatId"] = snapshot["format"]["id"];
        result["format"] = snapshot["format"]; // immutable scoring rules
        result["gateManaged"] = true;
        if (event.meta["schedule"]["requireReview"] | false)
            event.meta["schedule"]["reviewRaceId"] = id;
        JsonArray results = result["results"].to<JsonArray>();
        for (const auto& pilot : race.pilots) {
            if (pilot.slot < 0 || pilot.slot >= 8 || snapshot["seats"][pilot.slot].isNull()) return fail("Event pilot mapping missing");
            JsonObject row = results.add<JsonObject>();
            row["pilotId"] = snapshot["seats"][pilot.slot]; row["slot"] = pilot.slot;
            row["freq"] = pilot.frequency; row["name"] = pilot.name.c_str(); row["phonetic"] = pilot.callsign.c_str(); row["color"] = pilot.color;
            JsonArray laps = row["laps"].to<JsonArray>();
            for (uint32_t lap : pilot.lapTimes) laps.add(lap);
        }
        if (!snapshot["step"].isNull()) {
            uint32_t next = snapshot["step"].as<uint32_t>() + 1;
            // A skipped heat remains in the visible schedule, without a result.
            bool skipped;
            do {
                skipped = false;
                for (JsonVariant value : event.meta["schedule"]["skipped"].as<JsonArray>()) {
                    if (value.as<uint32_t>() == next) { ++next; skipped = true; break; }
                }
            } while (skipped);
            event.meta["schedule"]["pos"] = next;
            if ((event.meta["schedule"]["auto"] | true) && !(event.meta["schedule"]["reviewRaceId"] | 0u)) {
                const uint32_t groupId = scheduledGroup(event.meta, next);
                if (groupId) {
                    JsonObject group = find(event.meta["groups"], groupId);
                    JsonObject active = event.meta["active"].to<JsonObject>();
                    active["groupId"] = groupId; active["step"] = next;
                    JsonArray seats = active["seats"].to<JsonArray>();
                    for (JsonVariant pid : group["pilotIds"].as<JsonArray>()) { if (seats.size() == 8) break; seats.add(pid); }
                    // Save the completed result even if the next heat is invalid.
                    if (!validHeat(event.meta, active)) event.meta["active"] = nullptr;
                } else event.meta["active"] = nullptr; // Schedule exhausted: do not replay the last heat.
            }
        }
        event.meta["gateRevision"] = revision + 1;
        if (result.overflowed() || !event.write(result.as<JsonVariantConst>())) return fail("Event result write failed; retry Stop");
    }
    JsonObject active = event.meta["active"];
    if (!active.isNull() && validHeat(event.meta, active)) applyHeat(*config_, event.meta, active);
    if (!storage_->deleteFile(SESSION)) return fail("Event result saved; snapshot cleanup failed, retry Stop");
    snapshot_.clear(); active_ = false; error_ = "";
    changed_ = true;
    return true;
}

bool EventDirector::cancel() {
    auto lock = lease();
    if (!lock) return false;
    if (!snapshot_.empty() && !storage_->deleteFile(SESSION)) return fail("Cannot clear empty event session");
    snapshot_.clear(); active_ = false;
    return true;
}

bool EventDirector::recover() {
    if (!storage_->recoverFile(PATH) || !storage_->recoverFile(SESSION)) return fail("Event file recovery failed");
    if (active_ || !storage_->exists(SESSION)) return true;
    size_t bytes = 0;
    if (!storage_->fileSize(SESSION, bytes) || !bytes || bytes > 8192) return fail("Invalid event recovery snapshot");
    Reader input(*storage_, SESSION, 0, bytes);
    JsonDocument snapshot;
    if (deserializeJson(snapshot, input) || !input.ok || !snapshot["timestamp"].is<uint32_t>()) return fail("Cannot read event recovery snapshot");
    RaceSession race;
    if (!history_->getRaceByTimestamp(snapshot["timestamp"], race)) {
        // A reboot during racing loses the unsaved race, as before. Never
        // fabricate an event result from the old detector/config state.
        if (!storage_->deleteFile(SESSION)) return fail("Cannot clear interrupted event session");
        return true;
    }
    snapshot_.clear(); serializeJson(snapshot, snapshot_);
    return finish(race);
}

void EventDirector::update() {
    if (!storage_ || active_ || millis() - checkedAt_ < 1000) return;
    checkedAt_ = millis();
    auto lock = lease();
    if (lock) recover();
}
