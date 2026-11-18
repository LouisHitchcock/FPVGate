"""Real subprocess fault injection; no board or scope connections are made."""
import contextlib,io,json,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from race_day_watchdog import supervise
from watch_retry_race_day import matching_test_processes

WORKER=r'''
import json,pathlib,subprocess,sys,time
root=pathlib.Path(sys.argv[1]);generation=pathlib.Path(sys.argv[2]);deadline=float(sys.argv[3]);mode=sys.argv[4]
generation.mkdir();counter=root/'count.txt';n=int(counter.read_text())+1 if counter.exists() else 1;counter.write_text(str(n));(generation/'result.txt').write_text('generation '+str(n))
if mode=='crash' and n<3:
 (generation/'supervisor.json').write_text(json.dumps({'status':'ERROR','error':'Injected status-file failure'}));raise PermissionError('injected worker failure')
if mode=='stall' and n==1:time.sleep(10)
if mode=='orphan' and n==1:
 script="import pathlib,time; p=pathlib.Path("+repr(str(root))+ "); end=time.monotonic()+5; (p/'orphan-active').write_text('1');\nwhile time.monotonic()<end and not (p/'stop-orphan').exists():time.sleep(.02)\n(p/'orphan-restored').write_text('1')"
 subprocess.Popen([sys.executable,'-c',script],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,stdin=subprocess.DEVNULL)
 raise RuntimeError('Injected crash with active child')
if mode=='orphan' and n>1:
 assert (root/'orphan-restored').exists(),'Overlapping replacement before cleanup'
 (root/'cleanup-before-restart').write_text('yes')
while time.monotonic()<deadline:
 print('@@FPVGATE_HEARTBEAT '+json.dumps({'progressAgeSeconds':0}),flush=True);time.sleep(.03)
(generation/'supervisor.json').write_text(json.dumps({'status':'WINDOW_COMPLETE'}))
'''

class WatchdogFaultTests(unittest.TestCase):
 def run_fixture(self,mode,seconds=2.5,broken_status=False):
  folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);base=Path(folder.name);deadline=time.monotonic()+seconds
  def command(generation):return [sys.executable,'-u','-c',WORKER,str(base),str(generation),str(deadline),mode]
  def cleanup(generation,reason):
   if mode=='orphan' and not (base/'orphan-restored').exists():
    (base/'stop-orphan').write_text('1');return False
   return True
  with contextlib.redirect_stdout(io.StringIO()):
   if broken_status:
    with patch('race_day_watchdog.write_json_atomic',side_effect=PermissionError('watchdog status locked')):
     result=supervise(command,cleanup,base/'watchdog',deadline,heartbeat_timeout=.4,retry_delay=.01,cleanup_grace=3)
   else:result=supervise(command,cleanup,base/'watchdog',deadline,heartbeat_timeout=.4,retry_delay=.01,cleanup_grace=3)
  events=[json.loads(x) for x in (base/'watchdog/events.jsonl').read_text().splitlines()]
  return base,result,events
 def test_worker_crashes_are_logged_restarted_and_old_results_retained(self):
  base,result,events=self.run_fixture('crash')
  self.assertEqual(result['status'],'WINDOW_ENDED');self.assertGreaterEqual(result['restarts'],2)
  self.assertEqual((base/'watchdog/generation-001/result.txt').read_text(),'generation 1')
  self.assertEqual((base/'watchdog/generation-002/result.txt').read_text(),'generation 2')
  self.assertTrue(any(x['kind']=='WORKER_EXIT' and not x['expected'] for x in events))
  self.assertTrue(list((base/'watchdog/alerts').glob('WORKER_EXIT-*.json')))
  self.assertTrue(all(x['startedMonotonic']<result['deadlineMonotonic'] for x in result['generations']))
 def test_stalled_process_is_restarted(self):
  _,result,events=self.run_fixture('stall')
  self.assertGreaterEqual(result['restarts'],1)
  self.assertTrue(any(x['kind']=='WORKER_STALLED' for x in events))
 def test_status_file_failure_does_not_disable_watchdog_recovery(self):
  _,result,events=self.run_fixture('crash',broken_status=True)
  self.assertEqual(result['status'],'WINDOW_ENDED');self.assertGreaterEqual(result['restarts'],2)
  self.assertTrue(any(x['kind']=='STATUS_WRITE_ERROR' for x in events))
 def test_orphan_cleanup_precedes_replacement(self):
  base,result,_=self.run_fixture('orphan',seconds=3.5)
  self.assertEqual((base/'cleanup-before-restart').read_text(),'yes')
  self.assertEqual(result['status'],'WINDOW_ENDED')
 def test_expired_window_launches_no_worker(self):
  with tempfile.TemporaryDirectory() as folder,contextlib.redirect_stdout(io.StringIO()):
   result=supervise(lambda p:self.fail('launched after deadline'),lambda p,r:True,Path(folder)/'logs',time.monotonic()-1)
   self.assertEqual(result['generations'],[])
 def test_process_matching_never_adopts_sibling_or_unrelated_process(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder)/'generation-001'
   rows=[{'ProcessId':1,'CommandLine':f'python full_race_day.py --out "{p / "attempt-002"}" --seconds 50'},
         {'ProcessId':2,'CommandLine':f'python full_race_day.py --out "{p}-other/attempt-002"'},
         {'ProcessId':3,'CommandLine':f'python unrelated.py --out "{p}"'}]
   self.assertEqual([x['ProcessId'] for x in matching_test_processes(p,rows)],[1])
