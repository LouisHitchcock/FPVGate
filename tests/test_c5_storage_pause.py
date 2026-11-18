"""A storage write must wait for sender silence, and time out without wedging it."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StoragePauseTests(unittest.TestCase):
    def test_acknowledgment_timeout_offline_and_clock_rollover(self):
        source = (ROOT / 'lib/C5LINK/c5link.cpp').read_text()
        start = source.index('bool C5Link::pauseForStorage(')
        end = source.index('void C5Link::tuneNext()', start)
        methods = source[start:end].replace('C5Link::', 'Link::')
        harness = r'''
#include <cstdint>
#include <cassert>
static uint32_t tick=0, delays=0, acknowledgeAt=0;
static volatile bool* acknowledgment=nullptr;
uint32_t millis(){return tick;}
void vTaskDelay(int){++tick;++delays;if(acknowledgment && delays==acknowledgeAt)*acknowledgment=true;}
struct Link {
 void* port_=this; bool connected=true, update=false;
 volatile bool storagePauseReady_=false,storagePauseRequested_=false;
 bool online(uint32_t){return connected;}
 bool updating(){return update;}
 bool pauseForStorage(uint32_t timeoutMs=1500);
 void resumeAfterStorage();
};
''' + methods + r'''
int main(){
 Link live;acknowledgment=&live.storagePauseReady_;acknowledgeAt=20;
 assert(live.pauseForStorage(50));assert(delays==20 && live.storagePauseRequested_);
 live.resumeAfterStorage();assert(!live.storagePauseRequested_);
 Link missing;delays=0;acknowledgment=nullptr;
 assert(!missing.pauseForStorage(30));assert(delays==30 && !missing.storagePauseRequested_);
 Link wrap;tick=0xfffffff0u;delays=0;
 assert(!wrap.pauseForStorage(30));assert(delays==30 && !wrap.storagePauseRequested_);
 Link offline;offline.connected=false;delays=0;
 assert(offline.pauseForStorage());assert(delays==0 && !offline.storagePauseRequested_);
 Link update;update.update=true;
 assert(!update.pauseForStorage());assert(!update.storagePauseRequested_);
}
'''
        with tempfile.TemporaryDirectory(prefix='fpvgate-storage-pause-') as temp:
            path = Path(temp)
            (path / 'test.cpp').write_text(harness)
            compiler = shutil.which('g++') or 'C:/Strawberry/c/bin/g++.exe'
            subprocess.run([compiler, '-std=c++17', str(path / 'test.cpp'), '-o', str(path / 'test.exe')],
                           check=True, capture_output=True)
            subprocess.run([str(path / 'test.exe')], check=True, capture_output=True)
