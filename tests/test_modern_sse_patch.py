"""A disconnect must not clear the client while a sender holds its lock."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sse_patch', ROOT / 'scripts/patch_async_sse_modern.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


class ModernSseTests(unittest.TestCase):
    def test_disconnect_waits_for_inflight_sender(self):
        prefix = r'''
#include <atomic>
#include <cassert>
#include <chrono>
#include <mutex>
#include <thread>
namespace asyncsrv {using lock_guard_type=std::lock_guard<std::recursive_mutex>;}
struct AsyncEventSourceClient;
struct Server {void _handleDisconnect(AsyncEventSourceClient*){}}
server;
struct AsyncEventSourceClient {
 std::recursive_mutex _lockmq;
 void* _client=(void*)1;
 Server* _server=&server;
 void _onDisconnect();
};
'''
        main = r'''
int main() {
 AsyncEventSourceClient client; std::atomic<bool> entered{false}, finished{false};
 std::unique_lock<std::recursive_mutex> sender(client._lockmq);
 std::thread disconnect([&]{entered=true;client._onDisconnect();finished=true;});
 while(!entered)std::this_thread::yield();
 std::this_thread::sleep_for(std::chrono::milliseconds(100));
 bool clearedDuringSend=finished.load();
 sender.unlock();disconnect.join();
 assert(!clearedDuringSend && client._client==nullptr);
}
'''
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-sse-') as directory:
            path = Path(directory)
            for label, body in [('before', patch.OLD_DISCONNECT), ('after', patch.NEW_DISCONNECT)]:
                source = path / (label + '.cpp')
                source.write_text(prefix + body + main)
                exe = path / (label + '.exe')
                subprocess.run([compiler, '-std=c++17', '-pthread', str(source), '-o', str(exe)], check=True)
                result = subprocess.run([str(exe)], timeout=10)
                self.assertEqual(result.returncode == 0, label == 'after')

    def test_complete_patch_is_idempotent_and_changed_source_fails_closed(self):
        original = patch.OLD_DISCONNECT + '\n' + patch.OLD_DESTRUCTOR
        updated = patch.patch_text(original)
        self.assertEqual(patch.patch_text(updated), updated)
        with self.assertRaises(ValueError):
            patch.patch_text(original.replace('_client = nullptr;', '_client = changed;'))


if __name__ == '__main__':
    unittest.main()
