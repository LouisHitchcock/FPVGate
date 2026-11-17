"""Run production history I/O against slow operations and a task watchdog."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = r'''
#include <cassert>
#include <string>
#include <vector>
struct String:std::string {
 using std::string::string;
 String(std::string s):std::string(s){}
 bool endsWith(const char* s)const {std::string suffix(s);return size()>=suffix.size() && compare(size()-suffix.size(),suffix.size(),suffix)==0;}
};
String operator+(String a,const char* b){a.append(b);return a;}
String operator+(String a,const String& b){a.append(b);return a;}
constexpr int ESP_OK=0;
unsigned clockMs=0,lastFeed=0,feeds=0,deletes=0,writes=0,deleteMs=100;
bool subscribed=true,watchdogFired=false;
void elapsed(unsigned n){clockMs+=n;if(subscribed && clockMs-lastFeed>5000)watchdogFired=true;}
int esp_task_wdt_status(void*){return subscribed?ESP_OK:1;}
void esp_task_wdt_reset(){++feeds;lastFeed=clockMs;}
void vTaskDelay(unsigned n){elapsed(n);}
#define pdMS_TO_TICKS(n) (n)
#define RACES_DIR "/races"
struct HistoryLock{};
struct RaceSession {unsigned timestamp=1;};
struct JsonObject {};
int snapshotAllocator;
struct JsonDocument {explicit JsonDocument(int*){} template<class T>T to(){return {};}};
void serializeJson(JsonDocument&,String& out){out.assign("{}");}
String raceFilePathForTimestamp(unsigned t){return String(std::to_string(t));}
struct Storage {
 std::vector<String> names;
 bool failWrites=false;
 bool listDir(const char*,std::vector<String>& out){out=names;return true;}
 bool deleteFile(const String&){++deletes;elapsed(deleteMs);return true;}
 bool writeFile(const String&,const String&){++writes;elapsed(deleteMs);return !failWrites;}
};
struct RaceHistory {
 Storage* storage;std::vector<int> races{1,2};bool clearAll();bool writeRaceFile(const RaceSession&);
 void writeRaceObject(JsonObject,const RaceSession&)const{}
};
PRODUCTION
void reset(bool watched,unsigned operationMs){clockMs=lastFeed=feeds=deletes=writes=0;watchdogFired=false;subscribed=watched;deleteMs=operationMs;}
int main(){
 Storage storage;
 for(int i=0;i<60;++i){storage.names.push_back(String(std::to_string(i)+".json"));storage.names.push_back(String(std::to_string(i)+".rssi"));}
 storage.names.push_back("notes.txt");
 RaceHistory history{&storage};
 reset(true,100);assert(history.clearAll());
 // 12 seconds of real progress must not time out the calling task.
 if(watchdogFired)return 10;
 assert(deletes==120 && feeds==120 && history.races.empty());
 // Calls from an unregistered task must not try to feed an absent watchdog.
 reset(false,100);assert(history.clearAll());assert(feeds==0 && deletes==120);
 // Reporting progress after an operation must not mask a hung operation.
 storage.names={"stuck.json"};reset(true,6000);history.clearAll();assert(watchdogFired);
 // A 91-record backup import also spans multiple seconds in one HTTP event.
 reset(true,100);RaceSession race;
 for(int i=0;i<91;++i)assert(history.writeRaceFile(race));
 if(watchdogFired)return 20;
 assert(writes==91 && feeds==91);
 reset(false,100);assert(history.writeRaceFile(race));assert(feeds==0);
 reset(true,6000);history.writeRaceFile(race);assert(watchdogFired);
 storage.failWrites=true;reset(true,100);assert(!history.writeRaceFile(race));
}
'''


class HistoryClearWatchdogTests(unittest.TestCase):
    def test_batches_report_progress_but_stuck_operations_still_time_out(self):
        text = (ROOT / 'lib/RACEHISTORY/racehistory.cpp').read_text(encoding='utf-8')
        start = text.index('bool RaceHistory::clearAll(')
        body = text[start:text.index('const std::vector<RaceSession>& RaceHistory::getRaces(', start)]
        start = text.index('bool RaceHistory::writeRaceFile(')
        write = text[start:text.index('void RaceHistory::deleteSidecar(', start)]
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        feed = 'if (esp_task_wdt_status(nullptr) == ESP_OK) esp_task_wdt_reset();'
        self.assertIn(feed, body)
        self.assertIn(feed, write)
        with tempfile.TemporaryDirectory(prefix='fpvgate-clear-watchdog-') as folder:
            variants = [('yield-only-clear', write + body.replace(feed, ''), 10),
                        ('yield-only-import', write.replace(feed, '') + body, 20),
                        ('progress', write + body, 0)]
            for label, implementation, expected in variants:
                source, binary = Path(folder) / (label + '.cpp'), Path(folder) / (label + '.exe')
                source.write_text(HARNESS.replace('PRODUCTION', implementation), encoding='utf-8')
                subprocess.run([compiler, '-std=c++17', str(source), '-o', str(binary)], check=True, capture_output=True)
                result = subprocess.run([str(binary)], capture_output=True)
                self.assertEqual(result.returncode, expected, result.stderr)
