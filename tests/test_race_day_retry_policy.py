import sys,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from race_day_retry_policy import RetryBudget,classify_attempt
class RetryPolicyTests(unittest.TestCase):
 def test_retries_and_cleanup_never_extend_original_window(self):
  start=datetime(2026,11,7,14,47,33,tzinfo=timezone.utc)
  budget=RetryBudget.create(start,10800,start+timedelta(seconds=600),100)
  self.assertEqual(budget.deadline_utc,start+timedelta(hours=3))
  self.assertEqual(budget.attempt_seconds(100),10200)
  self.assertEqual(budget.attempt_seconds(140),10160)
  self.assertEqual(budget.attempt_seconds(200),10100)
  self.assertEqual(budget.attempt_seconds(10300),0)
  self.assertEqual(budget.attempt_seconds(20000),0)
 def test_expired_window_does_not_restart(self):
  start=datetime(2026,1,1,tzinfo=timezone.utc)
  self.assertEqual(RetryBudget.create(start,10,start+timedelta(seconds=11),5).attempt_seconds(5),0)
 def test_original_failure_is_not_relabelled_a_pass(self):
  failed={'status':'FAILED','firstFailure':{'reason':'seqGaps increased'}}
  self.assertEqual(classify_attempt(failed),'FAILED')
  self.assertEqual(classify_attempt(failed,scheduled_stop=True),'FAILED')
  self.assertEqual(classify_attempt({'firstFailure':{'reason':'gates: lane failed; see summary and console'}},scheduled_stop=True),'WINDOW_ENDED')
  self.assertEqual(classify_attempt({'status':'COMPLETED'}),'COMPLETED')
  self.assertEqual(classify_attempt({'status':'FAILED'},scheduled_stop=True),'WINDOW_ENDED')
 def test_invalid_budget_rejected(self):
  start=datetime.now(timezone.utc)
  with self.assertRaises(ValueError):RetryBudget.create(start,0,start,1)


class AtomicStatusTests(unittest.TestCase):
 def test_transient_windows_lock_keeps_last_good_file_until_retry_succeeds(self):
  import tempfile,json,os
  from unittest.mock import patch
  from race_day_retry_policy import write_json_atomic
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'status.json';path.write_text('{"attempt":1}')
   replace=os.replace;calls=[]
   def locked(source,target):
    calls.append(1)
    if len(calls)<3:
     self.assertEqual(json.loads(path.read_text()),{'attempt':1})
     raise PermissionError('simulated Windows reader lock')
    return replace(source,target)
   with patch('os.replace',side_effect=locked):
    write_json_atomic(path,{'attempt':2},retry_delay=0)
   self.assertEqual(len(calls),3)
   self.assertEqual(json.loads(path.read_text()),{'attempt':2})
 def test_persistent_lock_preserves_original_status_and_reports_error(self):
  import tempfile,json
  from unittest.mock import patch
  from race_day_retry_policy import write_json_atomic
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'status.json';path.write_text('{"attempt":1}')
   with patch('os.replace',side_effect=PermissionError('locked')):
    with self.assertRaises(PermissionError):write_json_atomic(path,{'attempt':2},attempts=3,retry_delay=0)
   self.assertEqual(json.loads(path.read_text()),{'attempt':1})
