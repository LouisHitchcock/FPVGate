"""Run the exact driver handshake against a card rejecting its first CMD0."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sd_patch', ROOT / 'scripts/patch_sd_warm_reset.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)

HARNESS = r'''
#include <cassert>
#include <cstddef>
struct Card { int ssPin; } instance, *card=&instance;
int pdrv=0, GO_IDLE_STATE=0, LOW=0;
int responses[2], commands=0, elapsed=0, deselects=0;
void digitalWrite(int,int) {}
bool sdWait(int,int) { return true; }
int sdCommand(int,int,int,void*) { return responses[commands++]; }
void sdDeselectCard(int) { ++deselects; }
void delay(int ms) { elapsed+=ms; }
void log_w(const char*) {}
int run() {
HANDSHAKE
return 0;
unknown_card: return 1;
}
void setup(int first,int second) {
 responses[0]=first;responses[1]=second;commands=elapsed=deselects=0;
}
int main() {
 setup(7,1);
 assert(run()==0); // card rejects first reset, settles, then enters idle
 assert(commands==2 && elapsed==40 && deselects==2);
 setup(1,1); assert(run()==0); // ordinary cold/ready card
 setup(1,7); assert(run()!=0); // second reset must succeed; never fake success
}
'''


class SdWarmResetTests(unittest.TestCase):
    def test_real_handshake_before_and_after(self):
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-sd-reset-') as tmp:
            for name, handshake, passed in [('old', patch.OLD, False), ('patched', patch.NEW, True)]:
                source, binary = Path(tmp) / (name+'.cpp'), Path(tmp) / (name+'.exe')
                source.write_text(HARNESS.replace('HANDSHAKE', handshake))
                subprocess.run([compiler, '-std=c++17', str(source), '-o', str(binary)], check=True, capture_output=True)
                result = subprocess.run([str(binary)], capture_output=True)
                self.assertEqual(result.returncode == 0, passed, result.stderr)

    def test_exact_patch_idempotence_and_unknown_driver_refusal(self):
        text = 'before\n'+patch.OLD+'after\n'
        changed = patch.patch_source(text)
        self.assertIn(patch.NEW, changed)
        self.assertEqual(patch.patch_source(changed), changed)
        with self.assertRaises(RuntimeError):
            patch.patch_source('different framework source')

    def test_build_copy_does_not_modify_installed_framework(self):
        class Node:
            def __init__(self, path): self.path = path
            def get_abspath(self): return str(self.path)
        class Env:
            def __init__(self, path): self.path = path
            def subst(self, value): return str(self.path)
            def File(self, value): return Path(value)
        with tempfile.TemporaryDirectory(prefix='fpvgate-sd-copy-') as tmp:
            root=Path(tmp); original=root/'SD/src/sd_diskio.cpp'
            original.parent.mkdir(parents=True)
            text='#include "sd_diskio.h"\n'+patch.OLD
            original.write_text(text)
            generated=patch.replace_sd_source(Env(root/'build'),Node(original))
            self.assertEqual(original.read_text(),text)
            self.assertIn(patch.NEW,generated.read_text())
            self.assertNotEqual(generated,original)


if __name__ == '__main__':
    unittest.main()
