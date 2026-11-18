"""Exercise production save/delete against a full 50-record history index."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class HistoryRetentionTests(unittest.TestCase):
    def test_deleting_new_race_restores_visibility_of_all_existing_records(self):
        source = (ROOT / 'lib/RACEHISTORY/racehistory.cpp').read_text(encoding='utf-8')
        save = source[source.index('bool RaceHistory::saveRace('):source.index('bool RaceHistory::loadRaces(')]
        delete = source[source.index('bool RaceHistory::deleteRace('):source.index('bool RaceHistory::updateRace(')]
        prefix = r'''
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <set>
#include <string>
#include <vector>
#define DEBUG(...) ((void)0)
#define RACES_DIR "/races"
constexpr size_t MAX_RACES=50;
using String=std::string;
struct HistoryLock{};
struct RaceRssiMeta {bool hasHistory=false;unsigned sampleCount=0;};
struct RaceSession {uint32_t timestamp=0;std::vector<uint32_t>lapTimes;RaceRssiMeta rssiMeta;};
struct Storage {
 std::set<String> files;
 void mkdir(const char*){}
 bool deleteFile(const String& file){return files.erase(file)>0;}
};
String raceFilePathForTimestamp(uint32_t stamp){return std::to_string(stamp);}
struct RaceRssiRecorder {
 bool hasPending(){return false;}
 bool attachToRace(uint32_t,RaceRssiMeta&){return false;}
 static void readMetaFromFile(Storage*,const String&,RaceRssiMeta&){}
 static String sidecarPathForTimestamp(uint32_t stamp){return std::to_string(stamp)+".rssi";}
};
struct SerialType {template<class...T>void printf(const char*,T...) {}} Serial;
struct RaceHistory {
 Storage* storage=nullptr;RaceRssiRecorder* rssiRecorder=nullptr;std::vector<RaceSession>races;
 bool saveRace(const RaceSession&);bool deleteRace(uint32_t);
 bool writeRaceFile(const RaceSession&r){storage->files.insert(raceFilePathForTimestamp(r.timestamp));return true;}
 void deleteSidecar(const RaceSession&){}
};
'''
        main = r'''
int main(){
 Storage disk;RaceHistory history;history.storage=&disk;
 for(unsigned i=1;i<=MAX_RACES;i++){
  RaceSession race;race.timestamp=i;history.races.push_back(race);disk.files.insert(std::to_string(i));
 }
 RaceSession next;next.timestamp=1000;assert(history.saveRace(next));
 assert(history.races.size()==MAX_RACES+1);
 assert(history.deleteRace(1000));assert(history.races.size()==MAX_RACES);
 for(unsigned i=1;i<=MAX_RACES;i++){
  assert(std::any_of(history.races.begin(),history.races.end(),[&](const RaceSession&r){return r.timestamp==i;}));
  assert(disk.files.count(std::to_string(i))==1);
 }
}
'''
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-retention-') as directory:
            path = Path(directory)
            (path / 'test.cpp').write_text(prefix + save + delete + main)
            exe = path / 'test.exe'
            subprocess.run([compiler, '-std=c++17', str(path / 'test.cpp'), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True, timeout=10)


if __name__ == '__main__':
    unittest.main()
