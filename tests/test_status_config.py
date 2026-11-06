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
   subprocess.run([shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe','-std=c++17','-Wall','-Wextra','-I',str(json_path),str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)
if __name__=='__main__':unittest.main()
