"""Compile production history serialization and verify immutable response ownership."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class HistorySnapshotTests(unittest.TestCase):
    def test_snapshot_matches_history_and_survives_later_edits(self):
        source = (ROOT/'lib/RACEHISTORY/racehistory.cpp').read_text()
        methods = source[source.index('bool RaceHistory::tryToJsonString('):source.index('bool RaceHistory::fromJsonString(')]
        harness = r'''
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include "history_snapshot.h"
using String=std::string;
constexpr size_t MAX_RACES=50;
bool busy=false;
struct HistoryLock { bool acquired; HistoryLock(int):acquired(!busy){} };
HistorySnapshotAllocator snapshotAllocator;
struct RaceSession { unsigned timestamp;std::string name; };
struct RaceHistory {
 std::vector<RaceSession>races;
 bool tryToJsonString(String&);
 bool tryToJsonSnapshot(std::shared_ptr<char>&,size_t&,uint32_t=0,bool=false);
 void writeHistoryDocument(JsonDocument&)const;
 void writeRaceObject(JsonObject out,const RaceSession&r)const {
  out["timestamp"]=r.timestamp;out["name"]=r.name;
 }
};
''' + methods + r'''
int main() {
 RaceHistory history;
 for(unsigned i=0;i<51;i++)history.races.push_back({i,"quote\" slash\\ newline\n"});
 String original;assert(history.tryToJsonString(original));
 std::shared_ptr<char> snapshot;size_t length=0;
 assert(history.tryToJsonSnapshot(snapshot,length));
 assert(length==original.size() && std::string(snapshot.get(),length)==original);
 JsonDocument parsed;assert(!deserializeJson(parsed,snapshot.get(),length));
 assert(parsed["races"].size()==50 && history.races.size()==51);
 // Cursor pages include older records while keeping the legacy response capped.
 RaceHistory pages;for(unsigned i=100;i>0;--i)pages.races.push_back({i,"pilot"});
 std::shared_ptr<char> page;size_t count=0;assert(pages.tryToJsonSnapshot(page,count,0,true));
 JsonDocument first;assert(!deserializeJson(first,page.get(),count));assert(first["races"].size()==50&&first["hasMore"].as<bool>()&&first["nextBefore"].as<unsigned>()==51);
 pages.races.insert(pages.races.begin(),{101,"new during pagination"}); // cursor cannot shift or duplicate old records
 assert(pages.tryToJsonSnapshot(page,count,51,true));JsonDocument second;assert(!deserializeJson(second,page.get(),count));
 assert(second["races"].size()==50&&!second["hasMore"].as<bool>()&&second["races"][0]["timestamp"].as<unsigned>()==50&&second["races"][49]["timestamp"].as<unsigned>()==1);
 assert(pages.tryToJsonSnapshot(page,count,1,true));JsonDocument empty;assert(!deserializeJson(empty,page.get(),count));assert(empty["races"].size()==0&&!empty["hasMore"].as<bool>());
 history.races.clear(); // immutable in-flight response must remain complete
 assert(std::string(snapshot.get(),length)==original);
 busy=true;assert(!history.tryToJsonSnapshot(snapshot,length));
 assert(!snapshot && length==0); // cannot accidentally serve a stale snapshot
 busy=false;assert(history.tryToJsonSnapshot(snapshot,length));
 assert(std::string(snapshot.get(),length)=="{\"races\":[]}");
 void* data=snapshotAllocator.allocate(32);assert(data);
 data=snapshotAllocator.reallocate(data,64);assert(data);
 assert(snapshotAllocator.reallocate(data,0)==nullptr);
}
'''
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-history-snapshot-') as name:
            path=pathlib.Path(name);(path/'test.cpp').write_text(harness)
            subprocess.run([compiler,'-std=c++17',f'-I{ROOT/"lib/RACEHISTORY"}',
                            f'-I{ROOT/".pio/libdeps/FPVGateC5MKAIO/ArduinoJson/src"}',
                            str(path/'test.cpp'),'-o',str(path/'test.exe')],check=True,capture_output=True)
            subprocess.run([str(path/'test.exe')],check=True,capture_output=True)
