"""Offline regression tests; no hardware, running RH server or RF access."""
import importlib.util
import os
from pathlib import Path
import types
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'tools'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


clock = load('rh_c5_usb_clock')
timing = load('rh_timing_diagnostics')


class ClockAdapterTests(unittest.TestCase):
    def setUp(self):
        class Node:
            firmware_proctype_str = 'c5zero'
            firmware_version_str = '1.2.4-rc.1'
            index = 0
            fail = False

            def read_block(self, interface, command, size):
                self.io_request = 10 if command == 0x0d else 10.002
                self.io_response = self.io_request + .001
                return None if self.fail else bytearray([command]*size)
        self.module = types.SimpleNamespace(SerialNode=Node)
        self.node = Node()
        self.original = Node.read_block

    def test_default_only_observes_without_changing_timestamps(self):
        pairs = []
        self.addCleanup(clock.install(self.module, on_pair=pairs.append))
        self.node.read_block(None,0x0d,8)
        self.node.read_block(None,0x0e,8)
        self.assertEqual(self.node.io_request,10.002)
        self.assertEqual(len(pairs),1)
        self.assertFalse(pairs[0]['anchor_first'])

    def test_opt_in_uses_first_read_and_preserves_bytes(self):
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        result = self.node.read_block(None,0x0e,8)
        self.assertEqual(result,bytearray([0x0e]*8))
        self.assertEqual((self.node.io_request,self.node.io_response),(10,10.001))

    def test_rx5808_is_untouched(self):
        self.node.firmware_proctype_str = 'STM32'
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        self.node.read_block(None,0x0e,8)
        self.assertEqual(self.node.io_request,10.002)

    def test_other_c5_versions_are_not_assumed_to_freeze_on_first_read(self):
        self.node.firmware_version_str = '1.2.3'
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        self.node.read_block(None,0x0e,8)
        self.assertEqual(self.node.io_request,10.002)

    def test_failed_first_read_does_not_reuse_an_older_reference(self):
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        self.node.fail = True
        self.node.read_block(None,0x0d,8)
        self.node.fail = False
        self.node.read_block(None,0x0e,8)
        self.assertEqual(self.node.io_request,10.002)

    def test_failed_second_read_consumes_reference(self):
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        self.node.fail = True
        self.node.read_block(None,0x0e,8)
        self.node.fail = False
        self.node.read_block(None,0x0e,8)
        self.assertEqual(self.node.io_request,10.002)

    def test_undo_restores_original_method(self):
        undo = clock.install(self.module, anchor_first=True)
        undo()
        self.assertIs(self.module.SerialNode.read_block,self.original)

    def test_other_seats_inherit_identity_only_on_same_serial_object(self):
        self.node.serial = types.SimpleNamespace()
        other = self.module.SerialNode()
        other.firmware_proctype_str = ''
        other.serial = self.node.serial
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        self.node.read_block(None,0x0e,8)
        other.read_block(None,0x0d,8)
        other.read_block(None,0x0e,8)
        self.assertEqual(other.io_request,10)

    def test_identity_does_not_leak_to_another_receiver(self):
        self.node.serial = types.SimpleNamespace()
        other = self.module.SerialNode()
        other.firmware_proctype_str = ''
        other.serial = types.SimpleNamespace()
        self.addCleanup(clock.install(self.module, anchor_first=True))
        self.node.read_block(None,0x0d,8)
        self.node.read_block(None,0x0e,8)
        other.read_block(None,0x0d,8)
        other.read_block(None,0x0e,8)
        self.assertEqual(other.io_request,10.002)


@unittest.skipUnless((ROOT/'.pio/hosttest/rh_timing_sim.exe').exists() and
                     (ROOT/'.pio/hosttest/c5_rh_usb.exe').exists(),'Build both native simulators first')
class ProductionReplayTests(unittest.TestCase):
    def compare(self, shape):
        samples = list(timing.trace(shape))
        self.assertTrue(all(0 <= value <= 1023 for _,value in samples))
        return (timing.gate_pass(ROOT/'.pio/hosttest/rh_timing_sim.exe',samples),
                timing.usb_pass(ROOT/'.pio/hosttest/c5_rh_usb.exe',samples))

    def test_identical_triangle_has_extra_s3_delay(self):
        gate,usb = self.compare('triangle')
        self.assertEqual(usb,2400)
        self.assertEqual(gate-usb,2)

    def test_identical_gaussian_has_extra_s3_delay(self):
        gate,usb = self.compare('gaussian')
        self.assertEqual(gate-usb,2.5)

    def test_extra_filter_can_change_winning_peak(self):
        gate,usb = self.compare('competing_peaks')
        self.assertEqual(gate-usb,23)

    @unittest.skipUnless((ROOT/'.pio/hosttest/rh_timing_sim_no_ema.exe').exists(),
                         'Build the --no-s3-ema diagnostic simulator first')
    def test_diagnostic_bypass_matches_usb_for_all_replay_shapes(self):
        for shape in ('triangle', 'gaussian', 'ripples', 'competing_peaks'):
            with self.subTest(shape=shape):
                samples = list(timing.trace(shape))
                gate = timing.gate_pass(ROOT/'.pio/hosttest/rh_timing_sim_no_ema.exe', samples)
                usb = timing.usb_pass(ROOT/'.pio/hosttest/c5_rh_usb.exe', samples)
                self.assertEqual(gate, usb)


@unittest.skipUnless(os.environ.get('RH_SOURCE') and os.environ.get('C5_SOURCE') and
                     (ROOT/'.pio/hosttest/c5_rh_usb.exe').exists(),
                     'Set RH_SOURCE and C5_SOURCE and build the C5 simulator')
class RealRhPollingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        diagnostics = load('rh_usb_poll_diagnostics')
        args = types.SimpleNamespace(c5_root=Path(os.environ['C5_SOURCE']),
            rh_root=Path(os.environ['RH_SOURCE']), usb_sim=ROOT/'.pio/hosttest/c5_rh_usb.exe')
        cls.zero = diagnostics.run(args,False,False)
        cls.stock = diagnostics.run(args,False,True)
        cls.first = diagnostics.run(args,True,True)
        cls.quantized = diagnostics.run(args,True,False,quantization_case=True)

    def test_zero_latency_control_matches_known_trace(self):
        self.assertEqual(self.zero['crossings'],10)
        self.assertEqual(self.zero['worst_known_trace_error_ms'],0)

    def test_second_read_can_bias_live_timestamp_past_one_ms(self):
        self.assertGreater(self.stock['worst_known_trace_error_ms'],1)

    def test_c5_only_first_read_candidate_reduces_modeled_error(self):
        self.assertLess(self.first['worst_known_trace_error_ms'],self.stock['worst_known_trace_error_ms'])
        self.assertLessEqual(self.first['worst_live_recalc_ms'],1)
        self.assertEqual(self.first['crossings'],10)

    def test_integer_ages_can_exceed_one_ms_even_without_io_delay(self):
        self.assertEqual(self.quantized['crossings'],1)
        self.assertFalse(self.quantized['variable_io_delay'])
        self.assertEqual(self.quantized['anchor'],'first snapshot read')
        self.assertAlmostEqual(self.quantized['worst_live_recalc_ms'],1.3,places=6)


if __name__ == '__main__':
    unittest.main()
