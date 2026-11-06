"""Reproduce detached-client FIN dispatch using the pinned callback body."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recv_patch', ROOT / 'scripts/patch_async_tcp_recv.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)

# Rest of the pinned receive callback, after the replaceable prefix.
TAIL = r'''
  if (pb) {
    e->event = LWIP_TCP_RECV;
    e->recv.pcb = pcb;
    e->recv.pb = pb;
    e->recv.err = err;
  } else {
    e->event = LWIP_TCP_FIN;
    e->fin.pcb = pcb;
    e->fin.err = err;
    AsyncClient::_s_lwip_fin(e->arg, e->fin.pcb, e->fin.err);
  }
  if (!_send_async_event(&e)) {
    free((void*)(e));
  }
  return ERR_OK;
}
'''

HARNESS = r'''
#include <cassert>
#include <cstdlib>
#include <cstdint>
constexpr int8_t ERR_OK=0, ERR_MEM=-1;
constexpr int LWIP_TCP_RECV=1, LWIP_TCP_FIN=2;
struct tcp_pcb {};
struct pbuf { unsigned tot_len; };
struct lwip_event_packet_t {
 void* arg; int event;
 struct {tcp_pcb* pcb; pbuf* pb; int8_t err;} recv;
 struct {tcp_pcb* pcb; int8_t err;} fin;
};
bool failAllocation=false, failQueue=false;
int acked=0, freedBuffers=0, finCalls=0, queued=0, allocations=0;
void tcp_recved(tcp_pcb*, unsigned len) {acked+=len;}
void pbuf_free(pbuf*) {++freedBuffers;}
void* testMalloc(size_t n) {++allocations; return failAllocation?nullptr:std::malloc(n);}
struct AsyncClient {
 static void _s_lwip_fin(void* arg,tcp_pcb*,int8_t) {
  if(!arg) std::abort(); // The actual member call dereferences null this.
  ++finCalls;
 }
};
bool _send_async_event(lwip_event_packet_t** event) {
 if(failQueue) return false;
 ++queued; std::free(*event); return true;
}
#define malloc testMalloc
'''

MAIN = r'''
#undef malloc
int main() {
 tcp_pcb pcb; pbuf data{17}; int client;
 assert(_tcp_recv(nullptr,&pcb,nullptr,0)==ERR_OK);
 assert(finCalls==0 && queued==0 && allocations==0);
 assert(_tcp_recv(nullptr,&pcb,&data,0)==ERR_OK);
 assert(acked==17 && freedBuffers==1 && allocations==0);
 assert(_tcp_recv(&client,&pcb,nullptr,0)==ERR_OK);
 assert(finCalls==1 && queued==1);
 assert(_tcp_recv(&client,&pcb,&data,0)==ERR_OK);
 assert(queued==2 && freedBuffers==1);
 failAllocation=true;
 assert(_tcp_recv(&client,&pcb,&data,0)==ERR_MEM);
 assert(queued==2 && freedBuffers==1 && acked==17);
 failAllocation=false; failQueue=true;
 assert(_tcp_recv(&client,&pcb,&data,0)==ERR_OK);
 return 0;
}
'''


class ReceivePatchTests(unittest.TestCase):
    def test_original_crashes_and_patched_detached_callbacks_are_safe(self):
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-recv-') as directory:
            path = Path(directory)
            for label, callback in [('before', patch.OLD + TAIL),
                                    ('after', patch.patch_text(patch.OLD + TAIL))]:
                source = path / (label + '.cpp')
                source.write_text(HARNESS + callback + MAIN)
                exe = path / (label + '.exe')
                subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror',
                                str(source), '-o', str(exe)], check=True)
                result = subprocess.run([str(exe)])
                if label == 'before':
                    self.assertNotEqual(result.returncode, 0)
                else:
                    self.assertEqual(result.returncode, 0)

    def test_idempotent_and_unknown_source_rejected(self):
        updated = patch.patch_text(patch.OLD + TAIL)
        self.assertEqual(patch.patch_text(updated), updated)
        with self.assertRaises(ValueError):
            patch.patch_text('different upstream callback')
        with self.assertRaises(ValueError):
            patch.patch_text(updated.replace('if (!arg)', 'if (false)'))


if __name__ == '__main__':
    unittest.main()
