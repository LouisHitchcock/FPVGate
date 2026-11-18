"""HTTP metadata allocation must retain ownership and no-PSRAM behavior."""
from pathlib import Path
import importlib.util
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WebObjectTests(unittest.TestCase):
    def test_virtual_delete_and_derived_size_on_external_and_fallback_heaps(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            (p / 'esp_heap_caps.h').write_text('''
#include <cstdlib>
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
extern bool external;
extern int calls;
extern size_t requested;
inline void* heap_caps_malloc(size_t bytes, int) {
 ++calls; requested=bytes; return external ? std::malloc(bytes) : nullptr;
}
''')
            (p / 'test.cpp').write_text('''
#include "web_object.h"
#include <cassert>
#include <memory>
#include <initializer_list>
bool external=true; int calls=0; size_t requested=0; int destroyed=0;
struct Response : FpvWebObject { virtual ~Response() {} };
struct FileResponse : Response {
 unsigned char data[1024];
 FileResponse(){data[0]=17;data[1023]=99;}
 ~FileResponse(){assert(data[0]==17 && data[1023]==99);++destroyed;}
};
int main(){
 for(bool mode : {true,false}) {
  external=mode;
  { std::unique_ptr<Response> r(new FileResponse); assert(r);
#ifdef ESP32
    assert(requested==sizeof(FileResponse));
#endif
  }
  { std::unique_ptr<Response> r(new(std::nothrow) FileResponse); assert(r); }
 }
 assert(destroyed==4);
#ifdef ESP32
 assert(calls==4);
#else
 assert(calls==0);
#endif
}
''')
            compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
            for flags in [[], ['-DESP32']]:
                command = [compiler, '-std=c++17', *flags, f'-I{p}', f'-I{ROOT / "scripts/support"}', str(p / 'test.cpp'), '-o', str(p / 'test.exe')]
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                subprocess.run([str(p / 'test.exe')], check=True, capture_output=True)

    def test_patch_is_idempotent_and_refuses_unrecognized_classes(self):
        spec = importlib.util.spec_from_file_location('web_patch', ROOT / 'scripts/patch_async_sse_modern.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)
            header = p / 'deps/board/ESPAsyncWebServer/src/ESPAsyncWebServer.h'
            header.parent.mkdir(parents=True)
            header.write_text('#include <Arduino.h>\nclass AsyncWebServerRequest {};\nclass AsyncWebServerResponse {};\n')
            class Env:
                def subst(self, value):
                    return {'$PROJECT_LIBDEPS_DIR': str(p / 'deps'), '$PIOENV': 'board', '$PROJECT_DIR': str(ROOT)}[value]
            module.patch_web_object_memory(Env())
            changed = header.read_text()
            self.assertEqual(changed.count(': public FpvWebObject'), 2)
            module.patch_web_object_memory(Env())
            self.assertEqual(changed, header.read_text())
            header.write_text('#include <Arduino.h>\nclass ChangedRequest {};\n')
            with self.assertRaises(RuntimeError):
                module.patch_web_object_memory(Env())
