from pathlib import Path
import importlib.util
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ResponseBufferTests(unittest.TestCase):
    def test_pinned_dependency_patch_is_idempotent_and_rejects_unknown_layout(self):
        spec=importlib.util.spec_from_file_location('network_patch',ROOT/'scripts/patch_async_sse_modern.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='fpvgate-response-patch-') as tmp:
            root=Path(tmp);src=root/'deps/board/ESPAsyncWebServer/src';src.mkdir(parents=True)
            header=src/'WebResponseImpl.h';source=src/'WebResponses.cpp'
            header.write_text('#include <vector>\n#define ASYNC_RESPONCE_BUFF_SIZE CONFIG_LWIP_TCP_MSS * 2\nstd::unique_ptr<std::array<uint8_t, ASYNC_RESPONCE_BUFF_SIZE> > _send_buffer;')
            source.write_text('auto p = new (std::nothrow) std::array<uint8_t, ASYNC_RESPONCE_BUFF_SIZE>;')
            class Env:
                def subst(self,value):return {'$PROJECT_LIBDEPS_DIR':str(root/'deps'),'$PIOENV':'board','$PROJECT_DIR':str(ROOT)}[value]
            module.patch_response_memory(Env());changed=(header.read_text(),source.read_text())
            module.patch_response_memory(Env());self.assertEqual(changed,(header.read_text(),source.read_text()))
            self.assertIn('FpvResponseBuffer',changed[0]);self.assertIn('FpvResponseBuffer',changed[1])
            self.assertIn('CONFIG_LWIP_TCP_MSS // FPVGate one-segment',changed[0])
            header.write_text('unknown layout')
            with self.assertRaises(RuntimeError):module.patch_response_memory(Env())

    def test_external_allocation_and_no_psram_fallback(self):
        with tempfile.TemporaryDirectory(prefix='fpvgate-response-') as tmp:
            p=Path(tmp)
            (p/'esp_heap_caps.h').write_text('''
#include <cstdlib>
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
extern bool external;
extern int attempts;
inline void* heap_caps_malloc(size_t size,int caps) {
 ++attempts;return external ? std::malloc(size) : nullptr;
}
''')
            (p/'test.cpp').write_text('''
#define ESP32
#include <cassert>
#include <memory>
#include "response_buffer.h"
bool external=true;int attempts=0;
int main() {
 for(bool mode:{true,false}) {
  external=mode;
  std::unique_ptr<FpvResponseBuffer<2872>> buffer(new(std::nothrow) FpvResponseBuffer<2872>);
  assert(buffer && buffer->size()==2872);
  buffer->fill(0xA5);assert(buffer->front()==0xA5 && buffer->back()==0xA5);
 } // delete must match allocation in both modes
 assert(attempts==2);
}
''')
            compiler=shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
            subprocess.run([compiler,'-std=c++17',f'-I{p}',f'-I{ROOT/"scripts/support"}',str(p/'test.cpp'),'-o',str(p/'test.exe')],check=True,capture_output=True)
            subprocess.run([str(p/'test.exe')],check=True,capture_output=True)
