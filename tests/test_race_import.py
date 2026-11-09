"""Run production import/serialization with real ArduinoJson and a fake disk."""
from pathlib import Path
import shutil,subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
class RaceImportTests(unittest.TestCase):
 def test_legacy_multi_pilot_duplicates_validation_order_and_write_failure(self):
  source=(ROOT/'lib/RACEHISTORY/racehistory.cpp').read_text()
  header=(ROOT/'lib/RACEHISTORY/racehistory.h').read_text()
  rssi=(ROOT/'lib/RACEHISTORY/race_rssi_recorder.h').read_text()
  structs=header[header.index('struct PilotData {'):header.index('class RaceHistory {')]
  meta=rssi[rssi.index('struct RaceRssiMeta {'):rssi.index('// Incremental JSON writer')]
  write=source[source.index('void RaceHistory::writeRaceObject('):source.index('bool RaceHistory::writeRaceFile(')]
  methods=source[source.index('bool RaceHistory::fromJsonString('):]
  harness=r"""
#include <ArduinoJson.h>
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <ctime>
#include <string>
#include <vector>
#include "history_snapshot.h"
using String=std::string;
#define RACE_RSSI_INTERVAL_MS 20
#define DEBUG(...) ((void)0)
"""+meta+r"""
struct RaceRssiRecorder { static String sidecarBasenameForTimestamp(uint32_t t){return std::to_string(t)+".rssi";} };
"""+structs+r"""
struct HistoryLock {};
HistorySnapshotAllocator snapshotAllocator;
struct RaceHistory {
 std::vector<RaceSession> races;
 RaceRssiRecorder* rssiRecorder=nullptr;
 uint32_t failTimestamp=0;unsigned writes=0, metadataWrites=0;
 bool writeRaceFile(const RaceSession& r){++metadataWrites;return r.timestamp!=failTimestamp;}
 bool fromJsonString(const String&);
 bool fromJson(JsonVariant);
 void writeRaceObject(JsonObject,const RaceSession&)const;
 void readRssiMeta(JsonObject,RaceSession&)const;
 bool saveRace(const RaceSession& r){assert(!rssiRecorder);++writes;if(r.timestamp==failTimestamp)return false;races.insert(races.begin(),r);return true;}
};
"""+write+methods+r"""
int main(){
 RaceHistory h;RaceRssiRecorder recorder;h.rssiRecorder=&recorder;
 assert(h.fromJsonString(R"({"races":[{"timestamp":10,"lapTimes":[0,12000,13000],"name":"Legacy","pilotName":"Ann","notes":"old","trackName":"Track","syncMode":0}]})"));
 assert(h.races[0].lapTimes.size()==3&&h.races[0].pilotName=="Ann"&&h.races[0].trackName=="Track");
 JsonDocument backup;backup["importedAt"]=2000000000u;auto entries=backup["races"].to<JsonArray>();
 for(unsigned t=100;t<124;++t){
  auto race=entries.add<JsonObject>();race["timestamp"]=t;race["syncMode"]=3;race["minLapMs"]=1000;
  auto pilots=race["pilots"].to<JsonArray>();
  for(unsigned slot=0;slot<8;++slot){auto p=pilots.add<JsonObject>();p["slot"]=slot;p["name"]="Pilot";p["frequency"]=5658+slot;p["enter"]=104;p["exit"]=93;p["isLocal"]=(slot==0);auto laps=p["lapTimes"].to<JsonArray>();for(unsigned lap=0;lap<120;++lap)laps.add(12345+lap);}
 }
 String text;serializeJson(backup,text);assert(text.size()>16384);
 assert(h.fromJson(backup.as<JsonVariant>()));assert(h.rssiRecorder==&recorder&&h.races.size()==25);
 const auto& race=h.races.front();assert(race.timestamp==123&&race.syncMode==3&&race.pilots.size()==8);
 assert(race.pilots[7].slot==7&&race.pilots[7].frequency==5665&&race.pilots[7].enter==104&&race.pilots[7].exit==93&&race.pilots[7].lapTimes.size()==120&&race.pilots[7].lapTimes.back()==12464);
 unsigned writes=h.writes;assert(h.fromJsonString(text));assert(h.writes==writes); // duplicates never add another record
 assert(h.races.front().importedAt==2000000000u);
 backup["importedAt"]=2000000060u;backup["races"][0]["pilots"][0]["name"]="Must not overwrite";
 assert(h.fromJson(backup.as<JsonVariant>()));assert(h.metadataWrites==24&&h.races.front().importedAt==2000000060u);
 assert(h.races.back().timestamp==10&&h.races[23].pilots[0].name=="Pilot");
 JsonDocument exported;h.writeRaceObject(exported.to<JsonObject>(),race);
 assert(exported["pilots"][7]["lapTimes"][119].as<unsigned>()==12464);
 assert(exported["pilots"][7]["slot"].as<int>()==7);assert(exported["importedAt"].as<uint32_t>()==2000000060u);
 RaceHistory invalid;
 for(const char* input:{"{}","[]","{\"races\":{}}","{\"races\":[null]}","{\"races\":[{\"timestamp\":0}]}","{\"races\":[{\"timestamp\":1},{\"timestamp\":2,\"pilots\":[null]}]}"})assert(!invalid.fromJsonString(input));
 assert(invalid.writes==0);assert(invalid.fromJsonString("{\"races\":[]}"));
 RaceHistory failing;failing.rssiRecorder=&recorder;failing.failTimestamp=2;
 assert(!failing.fromJsonString(R"({"races":[{"timestamp":1},{"timestamp":2},{"timestamp":3}]})"));
 assert(failing.writes==2&&failing.races.size()==1&&failing.rssiRecorder==&recorder);
}
"""
  with tempfile.TemporaryDirectory(prefix='fpvgate-import-') as tmp:
   p=Path(tmp);(p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++'),'-std=c++17',f'-I{ROOT/"lib/RACEHISTORY"}',f'-I{ROOT/".pio/libdeps/FPVGateC5MKAIO/ArduinoJson/src"}',str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True,capture_output=True)
   subprocess.run([str(p/'test.exe')],check=True,capture_output=True,timeout=15)
