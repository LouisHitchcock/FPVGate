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
