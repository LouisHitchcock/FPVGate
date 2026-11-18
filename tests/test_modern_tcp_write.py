"""Do not duplicate queued HTTP bytes when tcp_output transiently fails."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('network_patch', ROOT / 'scripts/patch_async_sse_modern.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


class AcceptedBytesTests(unittest.TestCase):
    def test_failed_output_does_not_cause_response_to_requeue_the_same_bytes(self):
        prefix = r'''
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <string>
struct AsyncClient {
 std::string queued; int outputs=0;
 size_t add(const char* data,size_t size,uint8_t){
  size_t accepted=std::min(size,size_t(3));queued.append(data,accepted);return accepted;
 }
 bool send(){return ++outputs!=1;}
 size_t write(const char*,size_t,uint8_t);
};
'''
        main = r'''
int main(){
 AsyncClient client; std::string payload="ABCDEF";size_t offset=0;
 for(int attempts=0;offset<payload.size() && attempts<10;attempts++)
  offset+=client.write(payload.data()+offset,payload.size()-offset,1);
 assert(offset==payload.size());assert(client.queued==payload);
 int prior=client.outputs;assert(client.write("",0,1)==0);assert(client.outputs==prior);
}
'''
        compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
        with tempfile.TemporaryDirectory(prefix='fpvgate-write-') as directory:
            path = Path(directory)
            for label, body in [('before', patch.OLD_WRITE), ('after', patch.NEW_WRITE)]:
                source = path / (label + '.cpp')
                source.write_text(prefix + body + main)
                exe = path / (label + '.exe')
                subprocess.run([compiler, '-std=c++17', str(source), '-o', str(exe)], check=True)
                result = subprocess.run([str(exe)], timeout=10)
                self.assertEqual(result.returncode == 0, label == 'after')

    def test_patch_is_idempotent_and_unknown_source_is_rejected(self):
        result = patch.patch_write(patch.OLD_WRITE)
        self.assertEqual(result, patch.patch_write(result))
        with self.assertRaises(ValueError):
            patch.patch_write('different upstream write()')


if __name__ == '__main__':
    unittest.main()
