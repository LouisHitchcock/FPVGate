import sys
from pathlib import Path
import tempfile
import threading
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from race_day_stop import watch_stop_file


class StopSignalTests(unittest.TestCase):
    def test_monitor_signal_stops_once_and_preserves_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'run.stop.json';stop=threading.Event();reasons=[]
            worker=threading.Thread(target=watch_stop_file,args=(path,stop,reasons.append,0.01));worker.start()
            path.write_text('network monitor failed')
            self.assertTrue(stop.wait(1));worker.join(1)
            self.assertFalse(worker.is_alive());self.assertEqual(reasons,['network monitor failed'])

    def test_normal_shutdown_needs_no_stop_file(self):
        stop=threading.Event();stop.set();reasons=[]
        watch_stop_file('nonexistent-file',stop,reasons.append)
        self.assertEqual(reasons,[])
