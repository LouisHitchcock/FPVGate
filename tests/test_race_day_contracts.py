import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from race_day_contracts import RaceJournal, deterministic_timing, live_counts, saved_counts_complete


class RaceDayContractsTests(unittest.TestCase):
    def test_fixed_phase_explicitly_disables_calibration_and_threshold_lowering(self):
        config = {'TIMING': {'calibrationMode': 1, 'startThreshLowerAmount': 20,
                             'startThreshLowerDuration': 5, 'unrelated': 'keep'}}
        deterministic_timing(config)
        self.assertEqual(config['TIMING'], {'calibrationMode': 0,
                         'startThreshLowerAmount': 0, 'startThreshLowerDuration': 0,
                         'unrelated': 'keep'})

    def test_ownership_survives_restart_and_threshold_or_clock_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'journal.json'
            journal = RaceJournal(path, {100, 200})
            journal.claim_running(50)  # Older wall clock is not a reason to reject it.
            restored = RaceJournal(path, {100, 200})
            self.assertTrue(restored.owns(50))
            self.assertFalse(restored.owns(100))
            self.assertFalse(restored.owns(999))
            for bad in [0, -1, True, '50', 100, 200]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    restored.claim_running(bad)
            path.write_text(json.dumps([100]))
            with self.assertRaises(ValueError):
                RaceJournal(path, {100})

    def test_counts_include_first_crossing_and_exclude_deleted(self):
        payload = {'current': {'node_index': [
            {'laps': [{'lap_number': 0}, {'deleted': True}, {'lap_number': 1}]},
            *[{'laps': []} for _ in range(7)]]}}
        self.assertEqual(live_counts(payload), [2, 0, 0, 0, 0, 0, 0, 0])
        self.assertIsNone(live_counts({}))

    def test_partial_save_is_not_complete_and_duplicates_are_not_accepted(self):
        complete = [{'node_index': slot, 'deleted': False} for slot in range(8) for _ in range(4)]
        self.assertFalse(saved_counts_complete([], 8, 4))
        self.assertFalse(saved_counts_complete(complete[:3], 8, 4))
        self.assertFalse(saved_counts_complete(complete[:-1], 8, 4))
        self.assertTrue(saved_counts_complete(complete, 8, 4))
        self.assertFalse(saved_counts_complete(complete + [complete[0]], 8, 4))
        self.assertTrue(saved_counts_complete(complete + [{'node_index': 0, 'deleted': True}], 8, 4))


if __name__ == '__main__':
    unittest.main()
