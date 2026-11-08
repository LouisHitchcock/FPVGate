"""Queued SSE data must keep byte identity and partial-write accounting in either RAM mode."""
from pathlib import Path
import importlib.util,subprocess,shutil,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
class EventDataTests(unittest.TestCase):
 def test_external_fallback_ownership_and_real_partial_writes(self):
  source=(ROOT/'.pio/libdeps/FPVGateC5MKAIO/ESPAsyncWebServer/src/AsyncEventSource.cpp').read_text()
  start=source.index('size_t AsyncEventSourceMessage::write(');method=source[start:source.index('\n}',start)+2]
  with tempfile.TemporaryDirectory(prefix='fpvgate-event-data-') as tmp:
   p=Path(tmp);(p/'esp_heap_caps.h').write_text('''
#include <cstdlib>
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
extern bool external;
inline void* heap_caps_malloc(size_t n,int) {return external ? std::malloc(n) : nullptr;}
''')
   harness=r'''
#define ESP32
#include <algorithm>
#include <memory>
#include <string>
#include <cassert>
#include "event_data.h"
#define ASYNC_WRITE_FLAG_COPY 1
bool external=true;
using AsyncEvent_SharedData_t=std::shared_ptr<FpvEventData>;
struct AsyncClient {
 std::string bytes;
 bool canSend(){return true;}
 size_t space(){return 7;}
 size_t add(const char* data,size_t n,int flag) {
  assert(flag==ASYNC_WRITE_FLAG_COPY);n=std::min(n,size_t(3));bytes.append(data,n);return n;
 }
};
struct AsyncEventSourceMessage {
 AsyncEvent_SharedData_t _data;size_t _sent=0;
 size_t write(AsyncClient*);
};
'''+method+r'''
int main(){
 for(bool mode:{true,false}) {
  external=mode;
  std::string expected="event:lap\r\ndata: {\"pilot\":7,\"time\":1234}\r\n\r\n";
  auto shared=std::make_shared<FpvEventData>(expected);
  expected[0]='X';assert(shared->c_str()[0]=='e');expected[0]='e';
  AsyncEventSourceMessage a{shared},b{shared};AsyncClient left,right;
  shared.reset();
  while(a._sent<expected.size() || b._sent<expected.size()) {a.write(&left);b.write(&right);}
  assert(left.bytes==expected && right.bytes==expected);
  FpvEventData binary("a\0b",3);assert(binary.length()==3 && binary.c_str()[2]=='b');
  assert(binary.concat("cd",2) && binary.length()==5 && binary.c_str()[5]==0);
  assert(!binary.concat(nullptr,1) && binary.length()==5);
  assert(!binary.concat("x",SIZE_MAX) && binary.length()==5);
 }
}
'''
   (p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++'),'-std=c++17','-I',str(p),'-I',str(ROOT/'scripts/support'),str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)

 def test_pinned_message_patch_is_idempotent_and_refuses_unknown_layout(self):
  spec=importlib.util.spec_from_file_location('event_patch',ROOT/'scripts/patch_async_sse_modern.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  with tempfile.TemporaryDirectory(prefix='fpvgate-event-patch-') as tmp:
   root=Path(tmp);src=root/'deps/board/ESPAsyncWebServer/src';src.mkdir(parents=True)
   header=src/'AsyncEventSource.h';source=src/'AsyncEventSource.cpp'
   header.write_text('using AsyncEvent_SharedData_t = std::shared_ptr<String>;\nstd::make_shared<String>(data, len);')
   source.write_text('std::make_shared<String>(generateEventMessage(x));\nstd::make_shared<String>(generateEventMessage(y));')
   class Env:
    def subst(self,value):return {'$PROJECT_LIBDEPS_DIR':str(root/'deps'),'$PIOENV':'board','$PROJECT_DIR':str(ROOT)}[value]
   module.patch_event_memory(Env());changed=(header.read_text(),source.read_text())
   module.patch_event_memory(Env());self.assertEqual(changed,(header.read_text(),source.read_text()))
   self.assertIn('std::shared_ptr<FpvEventData>',changed[0])
   self.assertEqual(changed[1].count('std::make_shared<FpvEventData>'),2)
   source.write_text('new layout')
   with self.assertRaises(RuntimeError):module.patch_event_memory(Env())
