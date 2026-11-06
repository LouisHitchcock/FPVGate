#include "eventdirector.h"
#include "c5racecontrol.h"
#include <ArduinoJson.h>
#include <cassert>
#include <iostream>

uint64_t g_nowUs = 1000000;
int historyWrites = 0;
RaceHistory::RaceHistory() : storage(nullptr), rssiRecorder(nullptr) {}
const std::vector<RaceSession>& RaceHistory::getRaces() { return races; }
uint32_t RaceHistory::latestTimestamp() const { return races.empty() ? 0 : races.front().timestamp; }
bool RaceHistory::saveRace(const RaceSession& race) { ++historyWrites; races.insert(races.begin(), race); return true; }
bool RaceHistory::getRaceByTimestamp(uint32_t timestamp, RaceSession& out) const {
    for (const auto& race : races) if (race.timestamp == timestamp) { out = race; return true; }
    return false;
}

const char* example = R"JSON({"version":3,"name":"Club","nextId":100,"pilots":[
 {"id":1,"name":"Ann","freq":5658,"enter":120,"exit":100,"color":"#123456"},
 {"id":2,"name":"Bea","freq":5695,"enter":130,"exit":110},
 {"id":3,"name":"Cal","freq":5732,"enter":140,"exit":100}],
 "groups":[{"id":10,"name":"A","formatId":20,"pilotIds":[1],"overrides":{}},
 {"id":11,"name":"B","formatId":20,"pilotIds":[2,3],"overrides":{"3":5769}}],
 "formats":[{"id":20,"name":"One lap","maxLaps":1,"minLapS":2,"timeLimitS":30,"countdown":1,"win":"first_to"}],
 "active":{"groupId":10,"seats":[1,null,null,null,null,null,null,null],"step":0},
 "schedule":{"blocks":[{"kind":"rotate","groupIds":[10,11],"times":2}],"pos":0,"auto":true},
 "races":[],"extension":{"quoted":"text with } ] and \\\" races","values":[1,2]}})JSON";

struct Fixture {
    Config config; Storage storage; RaceHistory history;
    C5Link link; C5MultiPilot detector; LapTimer timer; EventDirector event; C5RaceControl control;
    Fixture() {
        historyWrites = 0; config.eventMode = 1; config.raceMask = 1;
        put(EventDirector::PATH, example);
        detector.begin(&config, &link);
        event.begin(&config, &storage, &history);
        control.begin(&config, &timer, &detector, &history); control.setEvents(&event);
    }
    void put(const char* path, const std::string& text) {
        assert(storage.writeBinaryFile(path, reinterpret_cast<const uint8_t*>(text.data()), text.size()));
    }
    JsonDocument json(const char* path = EventDirector::PATH) {
        JsonDocument doc;
        assert(storage.exists(path));
        const auto& bytes = storage.files[path];
        assert(!deserializeJson(doc, bytes.data(), bytes.size()));
        return doc;
    }
    void start() { assert(control.requestStart(1792840000)); control.update(); assert(control.status().running); }
    void pass(uint8_t slot, uint32_t ms = 5000) {
        g_nowUs += (uint64_t)ms * 1000;
        assert(detector.requestManualLap(slot)); detector.update(millis()); control.update();
    }
    void finish() { pass(0, 1000); pass(0); }
};

int main() {
    {
        Fixture f; f.start();
        assert(f.storage.exists("/event-session.json"));
        assert(!f.event.editLease()); assert(f.event.errorStatus() == 409);
        { auto read = f.event.readLease(); assert(read); }
        f.finish();
        auto doc = f.json();
        assert(doc["races"].size() == 1 && doc["schedule"]["pos"] == 1);
        assert(doc["active"]["groupId"] == 11 && doc["active"]["step"] == 1);
        assert(doc["races"][0]["results"][0]["pilotId"] == 1);
        assert(doc["races"][0]["results"][0]["laps"].size() == 2);
        assert(doc["races"][0]["format"]["win"] == "first_to");
        assert(doc["extension"]["values"].size() == 2);
        assert(f.config.frequencies[0] == 5695 && f.config.frequencies[1] == 5769);
        assert(f.config.frequencies[2] == 0 && f.config.raceMask == 3);
        assert(!f.control.status().eventFailed && f.control.status().eventManaged);
        assert(!f.storage.exists("/event-session.json"));
        assert(historyWrites == 1 && f.history.getRaces()[0].tag == "Club");
        f.control.requestStop(); f.control.update();
        assert(f.json()["races"].size() == 1 && historyWrites == 1);
        // A second race binds the newly loaded pilots, not the old slot owner.
        f.start(); f.pass(0, 1000); f.pass(1, 1000); f.pass(0); f.pass(1);
        doc = f.json();
        assert(doc["races"].size() == 2 && doc["schedule"]["pos"] == 2);
        assert(doc["races"][1]["results"][0]["pilotId"] == 2);
        assert(doc["active"]["groupId"] == 10);
    }
    {
        Fixture f; f.start(); f.storage.failReplace = true; f.finish();
        assert(f.control.status().eventFailed && f.control.status().saveFailed);
        assert(f.control.status().savedTimestamp && !f.control.requestClear());
        assert(!f.control.requestStart() && historyWrites == 1);
        assert(f.json()["races"].size() == 0);
        f.storage.failReplace = false;
        f.control.requestStop(); f.control.update();
        assert(!f.control.status().saveFailed && historyWrites == 1);
        assert(f.json()["races"].size() == 1);
    }
    {
        Fixture f; f.start(); f.storage.failReplace = true; f.finish();
        f.storage.failReplace = false;
        EventDirector rebooted; rebooted.begin(&f.config, &f.storage, &f.history);
        g_nowUs += 2000000; rebooted.update();
        assert(f.json()["races"].size() == 1 && historyWrites == 1);
        assert(f.config.frequencies[0] == 5695);
        assert(!f.storage.exists("/event-session.json"));
    }
    {
        Fixture f; f.start(); f.storage.failDelete = true; f.finish();
        assert(f.control.status().eventFailed && f.json()["races"].size() == 1);
        f.storage.failDelete = false;
        f.control.requestStop(); f.control.update();
        assert(f.json()["races"].size() == 1 && f.json()["schedule"]["pos"] == 1);
        assert(historyWrites == 1 && !f.control.status().saveFailed);
    }
    {
        Fixture f; f.start();
        auto reader = f.event.readLease(); assert(reader);
        f.finish(); assert(f.control.status().eventFailed);
        reader.reset(); f.control.requestStop(); f.control.update();
        assert(!f.control.status().saveFailed && historyWrites == 1);
    }
    {
        Fixture f; f.start(); f.finish();
        const auto original = f.storage.files[EventDirector::PATH];
        f.put(EventDirector::UPLOAD, example); uint32_t revision = 0;
        auto edit = f.event.editLease(); assert(edit);
        assert(!f.event.commitUpload(revision) && f.event.errorStatus() == 409);
        assert(f.storage.files[EventDirector::PATH] == original);
        auto current = f.json(); current["name"] = "Renamed";
        std::string text; serializeJson(current, text); f.put(EventDirector::UPLOAD, text);
        assert(f.event.commitUpload(revision) && revision == 2);
        assert(f.json()["name"] == "Renamed" && f.json()["races"].size() == 1);
    }
    {
        Fixture f;
        auto doc = f.json(); doc["schedule"]["auto"] = false;
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish();
        doc = f.json(); assert(doc["active"]["groupId"] == 10 && doc["schedule"]["pos"] == 1);
        assert(f.config.frequencies[0] == 5658);
    }
    {
        Fixture f; auto doc = f.json(); doc["active"]["step"] = nullptr;
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish();
        assert(f.json()["schedule"]["pos"] == 0 && f.json()["races"].size() == 1);
    }
    {
        Fixture f; f.start(); f.control.requestStop(); f.control.update();
        assert(f.json()["races"].size() == 0 && historyWrites == 0);
        assert(!f.storage.exists("/event-session.json"));
    }
    {
        Fixture f; auto doc = f.json(); doc["formats"][0]["maxLaps"] = 64;
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        assert(f.control.requestStart()); f.control.update();
        assert(!f.control.status().running && strlen(f.control.status().error));
        assert(f.timer.starts == 0 && !f.storage.exists("/event-session.json"));
    }
    {
        Fixture f; for (auto& frequency : f.config.frequencies) frequency = 0; f.config.raceMask = 0;
        f.start(); assert(f.config.frequencies[0] == 5658 && f.config.raceMask == 1);
        f.finish(); assert(f.json()["races"].size() == 1);
    }
    {
        Fixture f; f.storage.failWrite = true;
        assert(f.control.requestStart()); f.control.update();
        assert(!f.control.status().running && f.timer.starts == 0);
        assert(f.json()["races"].size() == 0 && historyWrites == 0);
    }
    {
        Fixture f; auto doc = f.json();
        doc["schedule"]["blocks"][0]["groupIds"].as<JsonArray>().remove(1);
        doc["schedule"]["blocks"][0]["times"] = 1;
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish();
        assert(f.json()["active"].isNull() && f.json()["schedule"]["pos"] == 1);
        assert(f.json()["races"].size() == 1);
    }
    {
        Fixture f; auto doc = f.json();
        doc["schedule"]["blocks"][0]["kind"] = "each";
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish(); assert(f.json()["active"]["groupId"] == 10);
        f.start(); f.finish(); assert(f.json()["active"]["groupId"] == 11);
    }
    {
        Fixture f; auto doc = f.json(); doc["pilots"][1]["freq"] = 9999;
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish();
        assert(f.json()["races"].size() == 1 && f.json()["active"].isNull());
    }
    {
        Fixture f; auto doc = f.json(); doc.remove("nextId");
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish(); assert(f.json()["nextId"] == 2);
    }
    {
        Fixture f; f.start(); // Reboot before history is saved must not invent a result.
        EventDirector rebooted; rebooted.begin(&f.config, &f.storage, &f.history);
        g_nowUs += 2000000; rebooted.update();
        assert(!f.storage.exists("/event-session.json") && f.json()["races"].size() == 0);
    }
    {
        Fixture f;
        const auto original = f.storage.files[EventDirector::PATH];
        for (const std::string& invalid : {std::string("{\"version\":3,\"version\":3}"), std::string("{broken"), std::string(512 * 1024 + 1, ' ')}) {
            f.put(EventDirector::UPLOAD, invalid); uint32_t revision;
            auto edit = f.event.editLease(); assert(edit);
            assert(!f.event.commitUpload(revision));
            assert(f.storage.files[EventDirector::PATH] == original);
        }
    }
    {
        Fixture f; auto doc = f.json();
        // Large old results never need to coexist in the firmware JSON heap.
        JsonArray races = doc["races"].as<JsonArray>();
        for (int i = 0; i < 300; ++i) {
            JsonObject race = races.add<JsonObject>(); race["id"] = 1000 + i; race["timestamp"] = 1000 + i;
            JsonArray rows = race["results"].to<JsonArray>();
            JsonArray laps = rows.add<JsonObject>()["laps"].to<JsonArray>();
            for (int n = 0; n < 64; ++n) laps.add(12345678);
        }
        std::string text; serializeJson(doc, text); assert(text.size() > 150000);
        f.put(EventDirector::PATH, text); f.start(); f.finish();
        doc = f.json(); assert(doc["races"].size() == 301 && doc["races"][0]["results"][0]["laps"].size() == 64);
        assert(doc["races"][300]["id"] == 1300);
    }
    {
        Fixture f; auto doc = f.json(); doc["schedule"]["requireReview"] = true;
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish();
        doc = f.json();
        assert(doc["schedule"]["reviewRaceId"] == doc["races"][0]["id"]);
        assert(doc["active"]["groupId"] == 10 && doc["schedule"]["pos"] == 1);
        assert(f.config.frequencies[0] == 5658); // not advanced before review
        assert(f.control.requestStart()); f.control.update();
        assert(!f.control.status().running && f.timer.starts == 1);
        assert(strstr(f.control.status().error, "Confirm"));
        EventDirector rebooted; rebooted.begin(&f.config, &f.storage, &f.history);
        g_nowUs += 2000000; rebooted.update();
        assert(f.json()["schedule"]["reviewRaceId"] == doc["races"][0]["id"]);
        doc["schedule"]["reviewRaceId"] = nullptr;
        doc["active"]["groupId"] = 11; doc["active"]["step"] = 1;
        doc["active"]["seats"][0] = 2; doc["active"]["seats"][1] = 3;
        text.clear(); serializeJson(doc, text); f.put(EventDirector::UPLOAD, text);
        { auto edit = f.event.editLease(); assert(edit); uint32_t revision; assert(f.event.commitUpload(revision)); }
        f.start(); assert(f.config.frequencies[0] == 5695 && f.timer.starts == 2);
    }
    {
        Fixture f; auto doc = f.json(); doc["schedule"]["skipped"].to<JsonArray>().add(1);
        std::string text; serializeJson(doc, text); f.put(EventDirector::PATH, text);
        f.start(); f.finish();
        assert(f.json()["schedule"]["pos"] == 2 && f.json()["active"]["step"] == 2);
        assert(f.json()["races"].size() == 1); // no invented result for skipped heat
    }
    std::cout << "PASS: browser-free Event results/progression, result review, skipped heats, frozen identities/formats, streaming history, revisions, retry and reboot recovery\n";
}
