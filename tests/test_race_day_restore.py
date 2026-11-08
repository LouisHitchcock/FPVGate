"""Unknown saved records must be preserved without blocking config restoration."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('acceptance', ROOT / 'tools/race_day_acceptance.py')
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class EvidenceWriteTests(unittest.TestCase):
    def test_transient_rename_refusal_is_retried_without_losing_the_write(self):
        real = acceptance.os.replace
        refusals = [PermissionError(13, 'Access is denied'), PermissionError(13, 'Access is denied')]

        def flaky(source, target):
            if refusals:
                raise refusals.pop()
            real(source, target)

        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'journal.json'
            with patch.object(acceptance.os, 'replace', flaky), patch.object(acceptance.time, 'sleep'):
                acceptance.atomic(target, {'value': 1})
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), {'value': 1})
            self.assertEqual(refusals, [])

    def test_lasting_rename_refusal_still_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'journal.json'
            refused = Mock(side_effect=PermissionError(13, 'Access is denied'))
            with patch.object(acceptance.os, 'replace', refused), patch.object(acceptance.time, 'sleep'):
                with self.assertRaises(PermissionError):
                    acceptance.atomic(target, {'value': 1})
            self.assertEqual(refused.call_count, 50)


class LaneShutdownTests(unittest.TestCase):
    def test_waits_for_a_busy_lane_even_when_joins_return_early_or_are_interrupted(self):
        import threading
        import time as clock
        lane = threading.Thread(target=clock.sleep, args=(1.0,), name='aio')
        lane.start()
        real_join = lane.join
        calls = []

        def cut_short(timeout=None):
            calls.append(timeout)
            if len(calls) == 1:
                raise KeyboardInterrupt
            return None  # returns immediately, as an interrupted wait can

        lane.join = cut_short
        started = clock.monotonic()
        stuck = acceptance.wait_for_lanes([lane], limit=10)
        self.assertEqual(stuck, [])
        self.assertGreaterEqual(clock.monotonic() - started, 0.9)
        self.assertTrue(acceptance.STOP.is_set())
        acceptance.STOP.clear()
        real_join()

    def test_reports_a_lane_still_running_at_the_limit(self):
        import threading
        import time as clock
        lane = threading.Thread(target=clock.sleep, args=(2.0,), name='eth')
        lane.start()
        self.assertEqual(acceptance.wait_for_lanes([lane], limit=0.3), ['eth'])
        lane.join()


class RestorationTests(unittest.TestCase):
    def test_unknown_result_is_not_deleted_and_configuration_is_still_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            gate = acceptance.Gate.__new__(acceptance.Gate)
            gate.label = 'test'
            gate.out = Path(directory)
            (gate.out / 'baseline').mkdir()
            event = {'gateRevision': 3, 'name': 'original'}
            (gate.out / 'baseline/event.json').write_text(json.dumps(event))
            gate.baseline = {'eventMode': 0, 'minLap': 20}
            gate.old_ids = {100}
            gate.created = set()
            gate.journal = Mock()
            gate.journal.owns.return_value = False
            gate.stopped = Mock()
            calls = []

            def call(path, body=None):
                calls.append((path, body))
                if path == '/races':
                    return {'races': [{'timestamp': 100}, {'timestamp': 200}]}
                if path.startswith('/races/downloadOne'):
                    return {'races': [{'timestamp': 200, 'pilots': []}]}
                if path == '/config':
                    return gate.baseline
                if path == '/api/event':
                    return event
                return {}

            gate.call = call
            with patch.object(acceptance, 'record'):
                with self.assertRaisesRegex(AssertionError, 'Unclassified result preserved'):
                    gate.restore()
            self.assertIn(('/config', gate.baseline), calls)
            self.assertFalse(any(path == '/races/delete' for path, _ in calls))
            self.assertTrue((gate.out / 'cleanup-preserved-200.json').exists())


if __name__ == '__main__':
    unittest.main()


class StartRefusalTests(unittest.TestCase):
    def test_explicit_start_refusal_fails_without_polling_until_timeout(self):
        gate = object.__new__(acceptance.Gate)
        gate.state = Mock(return_value={'running': False, 'busy': False, 'error': 'Configuration could not be saved'})
        with self.assertRaisesRegex(RuntimeError, 'Gate refused Start: Configuration'):
            gate.wait_started()
        self.assertEqual(gate.state.call_count, 1)

    def test_busy_start_waits_but_running_state_finishes(self):
        gate = object.__new__(acceptance.Gate)
        gate.state = Mock(side_effect=[{'running': False, 'busy': True, 'error': ''}, {'running': True, 'busy': False, 'error': ''}])
        with patch.object(acceptance.time, 'sleep'):
            self.assertTrue(gate.wait_started()['running'])
