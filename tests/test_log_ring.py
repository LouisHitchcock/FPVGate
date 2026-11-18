"""The crash-surviving log ring (lib/DEBUG/logring.h), compiled and run on the PC."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

CHECKS = r'''
#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include "logring.h"
using namespace logring;
static Ring r;
static std::string recentText() { static char out[RING_BYTES + 1]; recent(r, out, sizeof(out)); return out; }
int main() {
  // Power-on memory is not mistaken for a log; a sealed ring is.
  memset(&r, 0xA5, sizeof(r));
  assert(!valid(r));
  reset(r);
  assert(valid(r) && r.head == 0 && unsaved(r) == 0);

  // Lines come back in order.
  append(r, "[1] one\n", 8);
  append(r, "[2] two\n", 8);
  assert(recentText() == "[1] one\n[2] two\n");
  char buf[64]; size_t n = copyFrom(r, r.saved, buf, sizeof(buf));
  assert(n == 16 && std::string(buf, n) == "[1] one\n[2] two\n");

  // Saving marks bytes done; only newer text is unsaved.
  r.saved += 8; seal(r);
  assert(valid(r) && unsaved(r) == 8);

  // A reset keeps the ring: it stays valid and appends continue after the old text.
  Ring copy = r;
  assert(valid(copy));
  append(copy, "[0] boot\n", 9);
  assert(unsaved(copy) == 17);

  // Wrapping: older bytes are overwritten, counted as lost, and saved moves past them.
  reset(r);
  std::string line(100, 'x'); line[99] = '\n';
  const int lines = RING_BYTES / 100 + 20;   // more than the ring holds
  for (int i = 0; i < lines; ++i) append(r, line.c_str(), line.size());
  assert(valid(r));
  assert(r.head == (uint32_t)lines * 100 && unsaved(r) == RING_BYTES && r.lost == (uint32_t)lines * 100 - RING_BYTES);
  n = copyFrom(r, r.saved, buf, sizeof(buf));
  assert(n == sizeof(buf));

  // The newest text starts at a whole line after a wrap.
  std::string text = recentText();
  assert(!text.empty() && text.size() % 100 == 0 && text.back() == '\n');
  assert(text.size() == (RING_BYTES / 100) * 100);

  // Asking for less than the ring holds still returns whole lines.
  char small[250]; recent(r, small, sizeof(small));
  assert(std::string(small).size() == 200);

  // Positions keep working across uint32 wrap.
  reset(r); r.head = r.saved = 0xFFFFFFF0u; seal(r);
  append(r, "[9] across the wrap\n", 20);
  assert(valid(r) && unsaved(r) == 20);
  n = copyFrom(r, r.saved, buf, sizeof(buf));
  assert(std::string(buf, n) == "[9] across the wrap\n");

  // A position already overwritten copies nothing rather than stale bytes.
  reset(r);
  for (int i = 0; i < lines; ++i) append(r, line.c_str(), line.size());
  assert(copyFrom(r, 0, buf, sizeof(buf)) == 0);
  std::puts("ring OK");
}
'''

# The logger this replaced kept a std::vector and erased from its front with no
# lock while several tasks logged. Its own header is the evidence.
OLD_LOGGER_UNSAFE = ('buffer.erase(buffer.begin())', 'std::vector<LogEntry> buffer')


class LogRingTests(unittest.TestCase):
    def test_ring_keeps_order_survives_reset_and_wraps_safely(self):
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-logring-') as name:
            source = Path(name) / 'ring.cpp'
            binary = Path(name) / 'ring.exe'
            source.write_text(CHECKS)
            subprocess.run([compiler, '-std=c++17', '-Wall', '-Werror', f'-I{ROOT / "lib/DEBUG"}', str(source),
                            '-o', str(binary)], check=True, capture_output=True, text=True)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('ring OK', result.stdout)

    def test_logger_uses_the_locked_ring_not_an_unlocked_vector(self):
        header = (ROOT / 'lib/DEBUG/debuglogger.h').read_text(encoding='utf-8')
        source = (ROOT / 'lib/DEBUG/debuglogger.cpp').read_text(encoding='utf-8')
        for unsafe in OLD_LOGGER_UNSAFE:
            self.assertNotIn(unsafe, header + source)
        self.assertIn('__NOINIT_ATTR logring::Ring ring', source)
        self.assertIn('portENTER_CRITICAL(&ringMux)', source)
        # Saving never falls back to the board's flash.
        self.assertIn('if (!storage_->isSDAvailable()) return;', source)

    def test_saving_to_the_card_is_off_unless_the_flag_file_exists(self):
        source = (ROOT / 'lib/DEBUG/debuglogger.cpp').read_text(encoding='utf-8')
        header = (ROOT / 'lib/DEBUG/debuglogger.h').read_text(encoding='utf-8')
        self.assertIn('volatile bool sdEnabled_ = false;', header)
        self.assertIn('sdEnabled_ = storage_->exists(ENABLED_PATH);', source)


if __name__ == '__main__':
    unittest.main()
