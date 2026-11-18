import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from race_day_health import gate_failure, phase_failure, phase_schedule
from race_day_contracts import validate_candidate_identity


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.baseline = {'system': {'heapLow': 70000},
                         'storage': {'sdAvailable': True, 'boot': 4, 'writeFailures': 0, 'lost': 0},
                         'receiver': {'c5': {'online': True, 'version': '1.2.6'}}}

    def test_all_known_qualification_faults_stop_even_when_races_pass(self):
        for section, key, value in [('system', 'heapLow', 39999),
                                    ('storage', 'sdAvailable', False),
                                    ('storage', 'boot', 5),
                                    ('storage', 'writeFailures', 1),
                                    ('storage', 'lost', 1)]:
            sample = copy.deepcopy(self.baseline)
            sample[section][key] = value
            self.assertTrue(gate_failure('aio', sample, self.baseline, '1.2.6'))
        for key, value in [('online', False), ('version', '1.2.5')]:
            sample = copy.deepcopy(self.baseline)
            sample['receiver']['c5'][key] = value
            self.assertTrue(gate_failure('aio', sample, self.baseline, '1.2.6'))

    def test_floor_boundary_and_valid_sample(self):
        self.baseline['system']['heapLow'] = 40000
        self.assertIsNone(gate_failure('aio', self.baseline, self.baseline, '1.2.6'))

    def test_ethernet_driver_error_is_not_hidden_by_successful_races(self):
        sample = copy.deepcopy(self.baseline)
        sample['system']['ethernet'] = {'w5500': {'txTimeout': 1}}
        self.assertTrue(gate_failure('eth', sample, self.baseline, '1.2.6'))

    def test_any_lane_or_monitor_failure_prevents_promotion(self):
        self.assertFalse(phase_failure({'PASS': 5}, 0))
        for counts, code, stop in [({'FAIL': 1}, 0, False), ({'ERROR': 1}, 0, False),
                                   ({'PASS': 5}, 0, True), ({'PASS': 5}, 1, False)]:
            self.assertTrue(phase_failure(counts, code, stop))

    def test_mixed_matrix_requires_explicit_receiver_version(self):
        gate = {'board': 'FPVGateC5MKAIO', 'version': '1.9.0-rc.5'}
        receiver = {'c5': {'board': 'xiaoc5', 'version': '1.2.6', 'online': True}}
        validate_candidate_identity('aio', gate, receiver, '1.2.6')
        with self.assertRaises(ValueError):
            validate_candidate_identity('aio', gate, receiver, '1.2.5')
        receiver['c5']['board'] = 'c5zero'
        with self.assertRaises(ValueError):
            validate_candidate_identity('aio', gate, receiver, '1.2.6')


class ScheduleTests(unittest.TestCase):
    def test_three_hour_gate_run_has_no_extra_rehearsal(self):
        self.assertEqual(phase_schedule(0, 10800), [('soak', 10800)])
        self.assertEqual(sum(n for _, n in phase_schedule(0, 10800)), 3 * 60 * 60)

    def test_existing_rehearsal_behavior_is_preserved(self):
        self.assertEqual(phase_schedule(600, 28800), [('rehearsal', 600), ('overnight', 28800)])
        for rehearsal, duration in [(-1, 60), (0, 0), (0, -1)]:
            with self.assertRaises(ValueError):
                phase_schedule(rehearsal, duration)
