"""Exercise production status configuration serialization beyond the old 256-byte limit."""
import pathlib,shutil,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class StatusConfigTests(unittest.TestCase):
 def test_complete_escaped_config_is_written_to_response(self):
  source=(ROOT/'lib/CONFIG/config.cpp').read_text()
  start=source.index('void Config::toJsonString(');end=source.index('\n}',start)+2
  method=source[start:end]
  header=(ROOT/'lib/CONFIG/config.h').read_text().replace('#include <AsyncJson.h>','').replace('private:','public:')
  json_path=next((ROOT/'.pio/libdeps').glob('*/ArduinoJson/src'))
  harness='''
#include <sstream>
#include <cstring>
#include <cassert>
#include <ArduinoJson.h>
#include "history_snapshot.h"
using AsyncResponseStream = std::ostringstream;
#define FPVGATE_C5MK_AIO 1
'''+header+'\n'+method+'''
int main() {
 Config c{};
 memset(c.conf.pilotName, 'x', sizeof(c.conf.pilotName)-1);
 memset(c.conf.ssid, 's', sizeof(c.conf.ssid)-1);
 memset(c.conf.password, 'p', sizeof(c.conf.password)-1);
 c.conf.pilotName[0]='"'; c.conf.pilotName[1]='\\\\';
 c.conf.frequency=5658;
 AsyncResponseStream response;
 c.toJsonString(response);
 const auto text=response.str();
 assert(text.size()>256);
 JsonDocument decoded;
 assert(!deserializeJson(decoded,text));
 assert(strcmp(decoded["name"].as<const char*>(),c.conf.pilotName)==0);
 assert(strcmp(decoded["ssid"].as<const char*>(),c.conf.ssid)==0);
 assert(strcmp(decoded["pwd"].as<const char*>(),c.conf.password)==0);
 assert(decoded["freq"].as<int>()==5658);
 assert(text.back()=='}');
}
'''
  with tempfile.TemporaryDirectory(prefix='fpvgate-status-') as temp:
   p=pathlib.Path(temp);(p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe','-std=c++17','-Wall','-Wextra','-I',str(json_path),'-I',str(ROOT/'lib/RACEHISTORY'),str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)
 def test_full_snapshot_matches_stream_and_owns_immutable_bytes(self):
  source=(ROOT/'lib/CONFIG/config.cpp').read_text()
  def method(signature):
   start=source.index(signature);depth=0
   for end in range(source.index('{',start),len(source)):
    if source[end]=='{':depth+=1
    elif source[end]=='}':
     depth-=1
     if depth==0:return source[start:end+1]
  header=(ROOT/'lib/CONFIG/config.h').read_text().replace('#include <AsyncJson.h>','').replace('private:','public:')
  json_path=next((ROOT/'.pio/libdeps').glob('*/ArduinoJson/src'))
  harness=r'''
#include <sstream>
#include <cstring>
#include <cassert>
#include <memory>
#include <ArduinoJson.h>
#include "history_snapshot.h"
using AsyncResponseStream = std::ostringstream;
#define FPVGATE_C5MK_AIO 1
#define DEBUG(...) ((void)0)
'''+header+r'''
class BatteryMonitor { public: uint16_t getBatteryVoltage() { return 123; } };
static void getBandChannelFromFreq(uint16_t,int8_t*,int8_t*) { assert(false); }
'''+'\n'.join(method(x) for x in ['void Config::writeConfigDocument(', 'void Config::toJson(', 'bool Config::tryToJsonSnapshot(', 'uint8_t Config::getRaceSyncMode(', 'uint8_t Config::getEventMode('])+r'''
int main() {
 Config c{}; BatteryMonitor battery;
 c.conf.frequency=5658; c.conf.bandIndex=2; c.conf.channelIndex=4;
 strcpy(c.conf.pilotName,"Original"); strcpy(c.conf.c5PilotName[7],"Pilot \"8\"");
 c.conf.c5Frequencies[7]=5917; c.conf.c5EnterRssi[7]=104; c.conf.c5ExitRssi[7]=93;
 std::shared_ptr<char> snapshot; size_t length=999;
 assert(c.tryToJsonSnapshot(snapshot,length,&battery));
 AsyncResponseStream stream; c.toJson(stream,&battery);
 const std::string original(snapshot.get(),length);
 assert(length>1500 && original==stream.str());
 strcpy(c.conf.pilotName,"Changed");
 assert(std::string(snapshot.get(),length)==original);
 JsonDocument decoded; assert(!deserializeJson(decoded,snapshot.get(),length));
 assert(decoded["c5Pilots"][7]["enterRssi"].as<int>()==104);
 assert(decoded["c5Pilots"][7]["frequency"].as<int>()==5917);
 assert(decoded["batteryVoltage"].as<float>()>12.29f);
}
'''
  with tempfile.TemporaryDirectory(prefix='fpvgate-config-snapshot-') as temp:
   p=pathlib.Path(temp);(p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe','-std=c++17','-I',str(json_path),'-I',str(ROOT/'lib/RACEHISTORY'),str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)
if __name__=='__main__':unittest.main()
