#!/usr/bin/env python3
"""Offline replay of identical RSSI through the production S3 and C5 USB code.

No serial ports, RF, running RH servers or firmware changes. Build the gate
simulator with tests/native/build_rh_timing_sim.sh and the C5 endpoint with:
g++ -std=c++17 -O1 -I <C5MK>/multipilot/src <C5MK>/multipilot/src/rh_usb.cpp
    <C5MK>/multipilot/test/test_rh_usb.cpp -o .pio/hosttest/c5_rh_usb.exe
"""
import argparse
import json
import math
from pathlib import Path
import random
import statistics
import subprocess


def trace(shape, seed=7):
    rng = random.Random(seed)
    for ms in range(1000, 4000):
        x = ms - 2400
        if shape == 'triangle':
            bump = max(0, 1 - abs(x)/180)
        elif shape == 'gaussian':
            bump = math.exp(-0.5*(x/110)**2)
        elif shape == 'ripples':
            bump = math.exp(-0.5*(x/150)**2) * (1 - .14*abs(math.sin(x/17)))
        elif shape == 'competing_peaks':
            # One crossing with a narrow high peak and a slightly lower broad
            # peak. Extra smoothing can change which one wins, not just add a
            # constant filter delay. This is a constructed regression fixture.
            bump = (160*math.exp(-0.5*(x/180)**2)
                    + 13*math.exp(-0.5*((x+20)/2)**2)
                    + 8*math.exp(-0.5*((x-20)/15)**2))/170
        else:
            raise ValueError(shape)
        noise = rng.gauss(0, 1.4) if shape == 'ripples' else 0
        yield ms, max(4, min(1016, round((32+170*bump+noise)*4)))


def gate_pass(executable, samples):
    lines = []
    for ms, value in samples:
        lines.append(f'sample {ms*1000} 0 {value}')
        if ms % 50 == 0:
            lines.append(f'poll {ms*1000}')
    lines.append(f'poll {(samples[-1][0]+500)*1000}')
    completed = subprocess.run([str(executable)], input='\n'.join(lines)+'\n',
                               text=True, capture_output=True, check=True)
    passes = [json.loads(line.split(' ',1)[1]) for line in completed.stdout.splitlines()
              if line.startswith('rhPass ')]
    if len(passes) != 1:
        raise RuntimeError(f'Expected one S3 crossing, got {passes}')
    return passes[0]['levelUs']/1000


def usb_pass(executable, samples):
    process = subprocess.Popen([str(executable), '--bridge'], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, text=True)
    def request(line):
        process.stdin.write(line+'\n')
        process.stdin.flush()
        reply = process.stdout.readline()
        if not reply:
            raise RuntimeError('C5 simulator exited')
        return bytes.fromhex(reply)
    def feed(ms, *data):
        return request(f'feed {ms} ' + bytes(data).hex(' '))
    try:
        # Seat 0 is selected by default. Same thresholds as the S3 simulator.
        feed(1000, 0x71, 140, 140)
        feed(1000, 0x72, 110, 110)
        passes, last = [], None
        for ms, value in samples:
            request(f'sample {ms} 0 {value}')
            if ms % 10:
                continue
            stats = feed(ms, 0x05)
            if last is not None and stats[0] != last:
                passes.append(ms-int.from_bytes(stats[1:3], 'big'))
            last = stats[0]
        if len(passes) != 1:
            raise RuntimeError(f'Expected one USB crossing, got {passes}')
        return passes[0]
    finally:
        process.stdin.close()
        process.wait(timeout=5)
        process.stdout.close()


def summarize_run(path):
    summary = json.loads((path/'summary.json').read_text())
    paired = []
    details = []
    for heat in summary['heats']:
        folder = path/f"heat-{heat['heat']:03d}"
        aio = json.loads((folder/'race.json').read_text())
        usb = json.loads((folder/'usb-race.json').read_text())
        def values(snapshot):
            start = snapshot['race'][0]['start_time']
            return [[start+r['lap_time_stamp']/1000 for r in snapshot['laps']
                     if r['node_index']==node and r['source']==0 and not r['deleted']]
                    for node in range(4)]
        a, u = values(aio), values(usb)
        if any(len(v)!=10 for v in a+u):
            raise ValueError('Incomplete heat: '+str(folder))
        delta = [statistics.median((u[n][i]-a[n][i])*1000 for n in range(4)) for i in range(10)]
        paired.extend(delta)
        details.append({'heat':heat['heat'], 'median_usb_minus_aio_ms':statistics.median(delta),
                        'worst_absolute_ms':max(map(abs,delta))})
    return {'crossings':len(paired), 'median_usb_minus_aio_ms':statistics.median(paired),
            'mean_usb_minus_aio_ms':statistics.mean(paired), 'scatter_ms':statistics.pstdev(paired),
            'worst_absolute_ms':max(map(abs,paired)), 'heats':details,
            'limits':'Different receiver boards/RF coupling. This does not isolate transport latency or absolute RF accuracy.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gate-sim', type=Path, default=Path('.pio/hosttest/rh_timing_sim.exe'))
    parser.add_argument('--usb-sim', type=Path, default=Path('.pio/hosttest/c5_rh_usb.exe'))
    parser.add_argument('--run', type=Path)
    args = parser.parse_args()
    rows = []
    for shape in ['triangle','gaussian','ripples','competing_peaks']:
        samples = list(trace(shape))
        gate = gate_pass(args.gate_sim.resolve(), samples)
        usb = usb_pass(args.usb_sim.resolve(), samples)
        rows.append({'shape':shape, 'gate_peak_ms':gate, 'usb_peak_ms':usb,
                     'gate_minus_usb_ms':gate-usb})
    output = {'identical_input_production_replay':rows,
              'limits':'Synthetic replay isolates software differences; not a physical RF accuracy measurement.'}
    if args.run:
        output['overnight'] = summarize_run(args.run)
    print(json.dumps(output,indent=2))


if __name__ == '__main__':
    main()
