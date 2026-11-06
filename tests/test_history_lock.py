"""Compile production HistoryLock against a deterministic semaphore model."""
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class HistoryLockTests(unittest.TestCase):
    def test_busy_reader_does_not_release_writer_and_recursive_access_survives(self):
        source = (ROOT / 'lib/RACEHISTORY/racehistory.cpp').read_text()
        lock = source[source.index('struct HistoryLock {'):]
        lock = lock[:lock.index('\n};') + 3]
        harness = r'''
#include <cassert>
#include <cstdint>
using SemaphoreHandle_t = void*;
constexpr uint32_t portMAX_DELAY = 0xffffffffu;
constexpr int pdTRUE = 1;
SemaphoreHandle_t historyMutex = (void*)1;
bool otherOwner = false;
int depth = 0, gives = 0;
uint32_t lastWait = 99;
int xSemaphoreTakeRecursive(SemaphoreHandle_t, uint32_t wait) {
    lastWait = wait;
    if (otherOwner) return 0;
    ++depth; return pdTRUE;
}
void xSemaphoreGiveRecursive(SemaphoreHandle_t) {
    assert(!otherOwner && depth > 0); --depth; ++gives;
}
''' + lock + r'''
int main() {
    otherOwner = true;
    { HistoryLock busy(0); assert(!busy.acquired); assert(lastWait == 0); }
    assert(gives == 0 && depth == 0);
    otherOwner = false;
    { HistoryLock writer; assert(writer.acquired && lastWait == portMAX_DELAY);
      { HistoryLock recursiveReader(0); assert(recursiveReader.acquired && depth == 2); }
      assert(depth == 1);
    }
    assert(depth == 0 && gives == 2);
    historyMutex = nullptr;
    { HistoryLock beforeInit(0); assert(beforeInit.acquired); }
    assert(gives == 2);
}
'''
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-history-lock-') as directory:
            path = pathlib.Path(directory)
            (path / 'test.cpp').write_text(harness)
            subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror',
                            str(path / 'test.cpp'), '-o', str(path / 'test.exe')], check=True)
            subprocess.run([str(path / 'test.exe')], check=True)


if __name__ == '__main__':
    unittest.main()
