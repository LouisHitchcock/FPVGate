"""Exercise the real DHCP timer with event/loop interleaving and clock wrap."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class EthernetTimeoutTests(unittest.TestCase):
    def test_timeout_boundaries_and_event_race(self):
        checks = r'''
#include <cassert>
#include "ethnet_timeout.h"
int main() {
    assert(!ethnetDhcpExpired(3950, 3959, 45000)); // failed boot: stale loop clock
    assert(!ethnetDhcpExpired(3959, 3959, 45000));
    assert(!ethnetDhcpExpired(48958, 3959, 45000));
    assert(ethnetDhcpExpired(48959, 3959, 45000));
    assert(ethnetDhcpExpired(60000, 3959, 45000));
    assert(!ethnetDhcpExpired(0xffffffffu, 2, 45000)); // event across wrap
    assert(!ethnetDhcpExpired(2, 0xffffffffu, 45000)); // loop across wrap
    assert(ethnetDhcpExpired(45000, 0xffffffffu, 45000));
}
'''
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-eth-timeout-') as tmp:
            source, binary = Path(tmp) / 'test.cpp', Path(tmp) / 'test.exe'
            source.write_text(checks)
            subprocess.run([compiler, '-std=c++17', f'-I{ROOT / "lib/ETHNET"}',
                            str(source), '-o', str(binary)], check=True, capture_output=True)
            subprocess.run([str(binary)], check=True, capture_output=True)
            # The identical event ordering must fail against the old unsigned
            # check, rather than merely passing a test that never exposed it.
            source.write_text(checks.replace('#include "ethnet_timeout.h"',
                '#include <cstdint>\n'
                'bool ethnetDhcpExpired(uint32_t now, uint32_t stamp, uint32_t timeout) '
                '{ return (now - stamp) >= timeout; }'))
            subprocess.run([compiler, '-std=c++17', str(source), '-o', str(binary)],
                           check=True, capture_output=True)
            self.assertNotEqual(subprocess.run([str(binary)], capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
