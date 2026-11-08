"""USB staging is CPU-owned; preserve all slots and fail cleanly if RAM is exhausted."""
from pathlib import Path
import shutil,subprocess,tempfile,unittest
ROOT=Path(__file__).resolve().parents[1]
class UsbPacketPoolTests(unittest.TestCase):
 def test_external_pool_fallback_allocation_failure_and_exact_frame_copy(self):
  source=(ROOT/'lib/USBNET/usbnet.cpp').read_text()
  packet=source[source.index('struct Packet {'):source.index('struct SendAttempt {')]
  pool=source[source.index('static constexpr size_t TX_POOL_FRAMES'):source.index('static SendAttempt txAttempt;')]
  start=source.index('extern "C" uint16_t tud_network_xmit_cb(')
  callback=source[start:source.index('\n}',start)+2]
  harness=r'''
#include <cstdlib>
#include <cstring>
#include <cassert>
#include <cstdint>
#define CFG_TUD_NET_MTU 1514
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
bool external=true, failFallback=false;
int externalCalls=0, internalCalls=0;
void* heap_caps_malloc(size_t n,int caps) {
 assert(caps==(MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
 ++externalCalls;return external ? std::malloc(n) : nullptr;
}
void* fallbackMalloc(size_t n) {++internalCalls;return failFallback ? nullptr : std::malloc(n);}
#define malloc fallbackMalloc
'''+packet+pool+r'''
#undef malloc
'''+callback+r'''
int main() {
 for(bool mode:{true,false}) {
  external=mode;
  assert(allocateTxPackets() && txPoolExternal==mode);
  auto* original=txPackets; int calls=externalCalls;
  assert(allocateTxPackets() && txPackets==original && externalCalls==calls);
  assert(TX_POOL_FRAMES==9 && txPoolFrames==(mode ? 24u : 9u));
  for(size_t i=0;i<txPoolFrames;++i) {
   txPackets[i].length=CFG_TUD_NET_MTU;
   memset(txPackets[i].bytes,(int)i,CFG_TUD_NET_MTU);
  }
  for(size_t i=0;i<txPoolFrames;++i) {
   uint8_t endpoint[CFG_TUD_NET_MTU];
   assert(tud_network_xmit_cb(endpoint,&txPackets[i],CFG_TUD_NET_MTU)==CFG_TUD_NET_MTU);
   for(auto byte:endpoint) assert(byte==i);
  }
  std::free(txPackets);txPackets=nullptr;txPoolExternal=false;
 }
 external=false;failFallback=true;
 assert(!allocateTxPackets() && !txPackets && !txPoolExternal);
 assert(internalCalls==2 && externalCalls==3);
}
'''
  harness=harness.replace('#include <cstdint>','#include <cstdint>\n#include <initializer_list>')
  with tempfile.TemporaryDirectory(prefix='fpvgate-usb-pool-') as tmp:
   p=Path(tmp);(p/'test.cpp').write_text(harness)
   subprocess.run([shutil.which('g++'),'--std=c++17',str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True)
   subprocess.run([str(p/'test.exe')],check=True)
