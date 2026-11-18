#!/usr/bin/env python3
"""Offline real-RH/C5-endpoint replay with explicit USB round-trip delays.

This does not patch a running RH server, access COM ports, or change firmware.
The optional first-read anchor exists only within this diagnostic process.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import random
import subprocess
from unittest.mock import Mock, patch


def run(args, anchor, delayed, quantization_case=False):
    os.environ['RH_SOURCE'] = str(args.rh_root)
    spec = importlib.util.spec_from_file_location('c5_usb_tests', args.c5_root/'multipilot/test/test_rh_usb.py')
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)

    class TimedSerial(fixture.SimSerial):
        def __init__(self):
            self.process = subprocess.Popen([str(args.usb_sim), '--bridge'], stdin=subprocess.PIPE,
                                            stdout=subprocess.PIPE, text=True)
            self.port = self.name = 'offline-c5-with-latency'
            self.baudrate = 115200
            self.now = 1000
            self.buffer = b''
            self.dtr = self.rts = None
            self.wall_us = 1000000
            self.last_command = None
            self.rng = random.Random(71)

        def write(self, data):
            self.last_command = data[0] if len(data) == 1 else None
            self.wall_us += 100 if delayed else 0
            self.now = self.wall_us//1000
            self.buffer += self.request(f'feed {self.now} ' + bytes(data).hex(' '))
            return len(data)

        def read(self, size):
            if delayed:
                # First reply is fast. RH's second read sees a variable return
                # delay; its ages still refer to the first command's snapshot.
                self.wall_us += 100 + (self.rng.randrange(1800) if self.last_command == 0x0e else 0)
            data, self.buffer = self.buffer[:size], self.buffer[size:]
            return data

        def clock(self):
            return 60 + self.wall_us/1e6

    serial = TimedSerial()
    helper_spec = importlib.util.spec_from_file_location('c5_clock_adapter', Path(__file__).with_name('rh_c5_usb_clock.py'))
    helper = importlib.util.module_from_spec(helper_spec)
    helper_spec.loader.exec_module(helper)
    undo = None
    try:
        with patch.object(fixture.serial_node.serial, 'Serial', return_value=serial), \
             patch.object(fixture.serial_node.gevent, 'sleep'), \
             patch.object(fixture.serial_node, 'monotonic', side_effect=serial.clock), \
             patch.object(fixture.RHInterface, 'Plugins', return_value=fixture.SimNodes()):
            config = Mock()
            config.get_item.return_value = [serial.port]
            interface = fixture.RHInterface.RHInterface(config=config)
            # The simulator normally advertises usb-dev/C5MK. Give the host
            # adapter the real release identity without changing endpoint code.
            for node in interface.nodes:
                node.firmware_proctype_str = 'c5zero'
                node.firmware_version_str = '1.2.4-rc.1'
            undo = helper.install(fixture.serial_node, anchor_first=anchor)
            for seat in range(1,8):
                interface.set_frequency(seat, 0)
            interface.set_enter_at_level(0, 140)
            interface.set_exit_at_level(0, 110)
            interface.pass_record_callback = Mock()
            interface.node_crossing_callback = Mock()
            interface.race_status = fixture.RHInterface.BaseHardwareInterface.RACE_STATUS_RACING
            node = interface.nodes[0]
            serial.wall_us = 1000000
            serial.now = 1000
            interface.update()
            centres = [2001.5] if quantization_case else [2000+1500*i for i in range(10)]
            end = 2451 if quantization_case else centres[-1]+1000
            for ms in range(1001, end):
                if quantization_case:
                    # A long, valid crossing with a four-sample maximum whose
                    # midpoint is a half-ms. Histories retain first/last ages;
                    # the live pass midpoint is truncated to an integer ms.
                    if ms < 1500:
                        level = 30
                    elif ms < 1900:
                        level = 30+(ms-1500)*150/400
                    elif ms < 2000:
                        level = 180
                    elif ms <= 2003:
                        level = 200
                    elif ms < 2100:
                        level = 180
                    else:
                        level = 30
                else:
                    level = 32 + sum(170*math.exp(-.5*((ms-centre)/120)**2) for centre in centres)
                serial.sample(0, round(level*4), ms)
                poll = ms in (1500,1900,2050,2450) if quantization_case else ms % 100 == 0
                if poll:
                    phase = (900 if ms == 2050 else 100 if ms == 2450 else 0) if quantization_case else ((ms*37)%1000 if delayed else 0)
                    serial.wall_us = ms*1000 + phase
                    interface.update()
            live = [call.args[1] for call in interface.pass_record_callback.call_args_list]
            recalculated = fixture.marshal_recalc(node.history_values, node.history_times, 140, 110)
            if len(live) != len(centres) or len(recalculated) != len(centres):
                raise AssertionError((len(live), len(recalculated)))
            errors = [(r-l)*1000 for r,l in zip(recalculated,live)]
            truth_errors = [(l-(60+c/1000))*1000 for l,c in zip(live,centres)]
            return {'anchor': 'first snapshot read' if anchor else 'stock RH second read',
                    'variable_io_delay': delayed, 'crossings':len(live),
                    'integer_age_quantization_case': quantization_case,
                    'live_recalc_errors_ms': errors, 'worst_live_recalc_ms':max(map(abs,errors)),
                    'known_trace_live_errors_ms':truth_errors,
                    'worst_known_trace_error_ms':max(map(abs,truth_errors))}
    finally:
        if undo is not None:
            undo()
        serial.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--c5-root', required=True, type=Path)
    parser.add_argument('--rh-root', required=True, type=Path)
    parser.add_argument('--usb-sim', type=Path, default=Path('.pio/hosttest/c5_rh_usb.exe'))
    args = parser.parse_args()
    args.usb_sim = args.usb_sim.resolve()
    print(json.dumps({'runs':[run(args,False,False),run(args,False,True),run(args,True,True),
                             run(args,True,False,quantization_case=True)],
                      'limits':'Synthetic serial I/O model, not a physical USB/camera measurement; host anchor is experimental and not installed.'},indent=2))


if __name__ == '__main__':
    main()
