"""A link stamp newer than the caller's clock reading must not read as lost."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TIMEOUT = 15000

CHECKS = r'''
#include <cassert>
#include <cstdint>
int main(){
 const uint32_t T=15000;
 assert(!linked(5000,0,T));                     // never linked
 assert(linked(5000,5000,T));                   // same reading
 assert(linked(5000,4000,T));                   // ordinary age
 assert(!linked(20000,5000,T));                 // expired exactly at the timeout
 assert(!linked(400000,5000,T));                // long expired
 assert(linked(5000,5001,T));                   // handler stamped after the caller's reading
 assert(linked(5000,5003,T));                   // and a few ms later
 assert(linked(4294967295u,1u,T));              // stamp past the millis() wrap
 assert(linked(1u,4294967295u,T));              // reading past the wrap
 assert(!linked(20000u,4294967295u - 20000u,T));// expired across the wrap
}
'''
BEFORE = ('static bool linked(uint32_t now,uint32_t stamp,uint32_t timeout)'
          '{return stamp && (now-stamp)<timeout;}\n')
AFTER = ('#include "rhlink.h"\n'
         'static bool linked(uint32_t now,uint32_t stamp,uint32_t timeout)'
         '{return rhLinkCurrent(now,stamp,timeout);}\n')


class RhLinkTests(unittest.TestCase):
    def build_and_run(self, directory, label, helper):
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        source = directory / f'{label}.cpp'
        binary = directory / f'{label}.exe'
        # The compiler requires the declarations before the checks that use them.
        source.write_text('#include <cstdint>\n' + helper + CHECKS)
        subprocess.run([compiler, '-std=c++17', f'-I{ROOT / "lib/WEBSERVER"}', str(source), '-o', str(binary)],
                       check=True, capture_output=True, text=True)
        return subprocess.run([str(binary)], capture_output=True, text=True)

    def test_previous_check_fails_and_current_check_passes(self):
        with tempfile.TemporaryDirectory(prefix='fpvgate-rhlink-') as name:
            directory = Path(name)
            self.assertNotEqual(self.build_and_run(directory, 'before', BEFORE).returncode, 0)
            after = self.build_and_run(directory, 'after', AFTER)
            self.assertEqual(after.returncode, 0, after.stderr)

    def test_webserver_uses_the_shared_check(self):
        header = (ROOT / 'lib/WEBSERVER/webserver.h').read_text(encoding='utf-8')
        self.assertIn('rhLinkCurrent(nowMs, rhLinkMs_, RH_LINK_TIMEOUT_MS)', header)


if __name__ == '__main__':
    unittest.main()
