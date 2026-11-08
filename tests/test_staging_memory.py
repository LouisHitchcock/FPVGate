"""Exercise production allocation blocks under PSRAM, fallback and OOM."""
from pathlib import Path
import shutil, subprocess, tempfile, unittest
ROOT = Path(__file__).resolve().parents[1]
class StagingMemory(unittest.TestCase):
 def test_event_budget_and_c5_staging(self):
  event=(ROOT/'lib/EVENTDIRECTOR/eventdirector.cpp').read_text()
  budget=event[event.index('class Budget :'):event.index('class Reader {')]
  c5=(ROOT/'lib/C5LINK/c5link.cpp').read_text()
  queue=c5[c5.index('    if (!sampleQueue_) {'):c5.index('    // Start the UART')]
  harness=r"""
#include <cstdlib>
#include <cstring>
#include <cassert>
#include <cstdint>
#include <initializer_list>
namespace ArduinoJson { struct Allocator { virtual void* allocate(size_t)=0;virtual void deallocate(void*)=0;virtual void* reallocate(void*,size_t)=0; }; }
#define ESP32 1
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define DEBUG(...) ((void)0)
bool external=true, fail=false;
int extCalls=0;
void* fallbackMalloc(size_t n){return fail?nullptr:std::malloc(n);}
void* fallbackRealloc(void* p,size_t n){return fail?nullptr:std::realloc(p,n);}
void* heap_caps_malloc(size_t n,int caps){assert(caps==3);++extCalls;return external&&!fail?std::malloc(n):nullptr;}
void* heap_caps_realloc(void* p,size_t n,int caps){assert(caps==3);++extCalls;return external&&!fail?std::realloc(p,n):nullptr;}
void* heap_caps_calloc(size_t n,size_t bytes,int caps){assert(caps==3);++extCalls;return external&&!fail?std::calloc(n,bytes):nullptr;}
void* fallbackCalloc(size_t n,size_t bytes){return fail?nullptr:std::calloc(n,bytes);}
namespace std { using ::fallbackMalloc; using ::fallbackRealloc; }
#define malloc fallbackMalloc
#define realloc fallbackRealloc
#define calloc fallbackCalloc
"""+budget+r"""
#undef malloc
#undef realloc
struct Queue {
 struct Sample { uint32_t t;uint16_t rssi; };
 static constexpr size_t SAMPLE_QUEUE_DEPTH=128, C5_MAX_PILOTS=8;
 Sample (*sampleQueue_)[SAMPLE_QUEUE_DEPTH]=nullptr;
 bool sampleQueueExternal_=false;
 void begin(){
"""+queue+r"""
 }
};
#undef calloc
int main(){
 for(bool mode:{true,false}){
  external=mode;Budget budget;
  auto p=static_cast<unsigned char*>(budget.allocate(1024));assert(p);memset(p,42,1024);
  p=static_cast<unsigned char*>(budget.reallocate(p,4096));assert(p);
  for(int i=0;i<1024;++i)assert(p[i]==42);
  assert(!budget.allocate(48*1024-4096+1));
  fail=true;assert(!budget.reallocate(p,8192));assert(p[0]==42);fail=false;
  budget.deallocate(p);p=static_cast<unsigned char*>(budget.allocate(48*1024));assert(p);
  assert(!budget.allocate(1));budget.deallocate(p);
  Queue q;q.begin();assert(q.sampleQueue_&&q.sampleQueueExternal_==mode);
  assert(sizeof(*q.sampleQueue_)*8==8192);
  auto bytes=reinterpret_cast<unsigned char*>(q.sampleQueue_);
  for(size_t i=0;i<8192;++i)assert(bytes[i]==0);
  auto old=q.sampleQueue_;int calls=extCalls;q.begin();assert(old==q.sampleQueue_&&calls==extCalls);
  std::free(q.sampleQueue_);
 }
 external=false;fail=true;Queue q;q.begin();assert(!q.sampleQueue_&&!q.sampleQueueExternal_);
 Budget budget;assert(!budget.allocate(1));
}
"""
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++'),'-std=c++17',str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)
