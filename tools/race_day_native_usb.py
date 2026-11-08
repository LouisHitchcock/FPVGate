"""Real C5 USB/RH polling and explicitly manual RH race-day persistence checks."""
import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

import race_day_acceptance as bench
from race_day_contracts import live_counts, saved_counts_complete, deterministic_timing
from race_day_stop import watch_stop_file


def console(c5_root, port, command):
    result = subprocess.run(
        [sys.executable, str(c5_root / 'multipilot/tools/mp.py'), '--port', port,
         'cmd', command, '--wait', '1'], capture_output=True, text=True,
        timeout=15, check=True)
    return result.stdout


def native_heat(rh, index, count, interval):
    for slot, frequency in enumerate(bench.FREQ):
        rh.emit('set_frequency', {'node': slot, 'band': 'R', 'channel': slot + 1,
                                  'frequency': frequency if slot < count else 0})
        rh.emit('set_enter_at_level', {'node': slot, 'enter_at_level': 250})
        rh.emit('set_exit_at_level', {'node': slot, 'exit_at_level': 240})
    before = rh.read('select coalesce(max(id),0) as id from saved_race_meta')[0]['id']
    rh.status.clear()
    rh.live.clear()
    rh.emit('stage_race')
    bench.wait(lambda: rh.status.get('race_status') == 1, 20)
    inputs = []
    for crossing in range(4):
        if crossing:
            time.sleep(interval)
        for slot in range(count):
            inputs.append({'slot': slot, 'crossing': crossing, 'host': time.perf_counter(),
                           'stimulus': 'RH simulate_lap; RF detector bypassed'})
            bench.atomic(bench.ROOT / f'inputs-{index:04d}.json', inputs)
            rh.emit('simulate_lap', {'node': slot})

    def delivered():
        rh.sio.emit('load_data', {'load_types': ['current_laps']})
        counts = live_counts(rh.live)
        if counts and (any(value > 4 for value in counts[:count]) or any(counts[count:])):
            raise AssertionError(('Unexpected native lane laps', counts))
        return counts is not None and counts == [4] * count + [0] * (8 - count)

    bench.wait(delivered, 20)
    rh.emit('stop_race')
    bench.wait(lambda: rh.status.get('race_status') == 2, 20)
    rh.saving = True
    rh.emit('save_laps')
    bench.wait(lambda: rh.read('select coalesce(max(id),0) as id from saved_race_meta')[0]['id'] > before, 30)
    race_id = rh.read('select max(id) as id from saved_race_meta')[0]['id']
    bench.wait(lambda: rh.status.get('race_status') == 0 and saved_counts_complete(
        rh.read('select node_index,deleted from saved_race_lap where race_id=?', (race_id,)), count, 4), 30)
    rh.saving = False
    laps = rh.read('select * from saved_race_lap where race_id=? order by node_index,lap_time_stamp', (race_id,))
    assert len(rh.read('select id from saved_pilot_race where race_id=?', (race_id,))) == count
    assert rh.read('select count(*) as n from saved_race_meta where id>?', (before,))[0]['n'] == 1
    bench.atomic(bench.ROOT / f'saved-{index:04d}.json', {
        'race': rh.read('select * from saved_race_meta where id=?', (race_id,)),
        'laps': laps, 'inputs': inputs, 'heartbeat': rh.beats,
        'stimulus': 'Real native C5 USB polling; saved laps are RH manual simulation, not RF'})
    bench.record('usb', 'native-usb-rh-manual-race-save', 'PASS', heat=index,
                 pilots=count, passes=len(laps), rhRaceId=race_id,
                 stimulus='RH simulate_lap while real C5 USB polling continues; RF bypassed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--seconds', type=float, required=True)
    parser.add_argument('--port', required=True)
    parser.add_argument('--version', default='1.2.6')
    parser.add_argument('--config-template', type=Path, required=True)
    parser.add_argument('--c5-root', type=Path, default=bench.CODE / 'FPVGateC5MK-release-1.2.6')
    parser.add_argument('--rh-source', type=Path, default=bench.CODE / 'rotorHazard/RotorHazard-4.5.1')
    args = parser.parse_args()
    assert args.seconds > 0
    bench.ROOT = args.out.resolve()
    assert not bench.ROOT.exists(), 'Use fresh evidence'
    bench.ROOT.mkdir(parents=True)
    bench.RH_SERVER = args.rh_source.resolve() / 'src/server'
    baseline = console(args.c5_root, args.port, 'status')
    (bench.ROOT / 'baseline-console.txt').write_text(baseline)
    assert f'firmware {args.version}+c5zero' in baseline, baseline
    assert 'scan on' in baseline and 'node idle:' in baseline, 'Standalone scanner must be idle, not owned by another host'
    config = json.loads(args.config_template.read_text(encoding='utf-8'))
    config.pop('FPVGate', None)
    config['GENERAL'].update(HTTP_PORT=5063, SERIAL_PORTS=[args.port], MOCK_NODES=0)
    config['SECRETS'] = {'ADMIN_USERNAME': 'race-day', 'ADMIN_PASSWORD': secrets.token_urlsafe(24)}
    deterministic_timing(config)
    data = bench.ROOT / 'rh-usb'
    data.mkdir()
    bench.atomic(data / 'config.json', config)
    rh = bench.RH(SimpleNamespace(label='usb', base=''))
    stop_file = bench.ROOT.parent / (bench.ROOT.name + '.stop.json')
    threading.Thread(target=watch_stop_file, args=(stop_file, bench.STOP,
        lambda reason: bench.record('usb', 'external-stop', 'FAIL', reason=reason)), daemon=True).start()
    failed = False
    completed = False
    index = 0
    heartbeat = {'time': time.monotonic(), 'count': 0}
    health_stop = threading.Event()

    def on_heartbeat(payload):
        rh.beats.update(payload)
        heartbeat['time'] = time.monotonic()
        heartbeat['count'] += 1

    def health():
        with (bench.ROOT / 'heartbeat.jsonl').open('a') as file:
            while not health_stop.wait(1):
                row = {'utc': bench.now(), 'age': time.monotonic() - heartbeat['time'],
                       'count': heartbeat['count'], 'heartbeat': dict(rh.beats)}
                file.write(json.dumps(row) + '\n')
                file.flush()
                levels = rh.beats.get('current_rssi', [])
                if row['age'] > 5 or len(levels) != 8 or rh.process.poll() is not None:
                    bench.record('usb', 'native-heartbeat', 'FAIL', age=row['age'], nodes=len(levels))
                    return

    try:
        rh.start()
        rh.sio.on('heartbeat', on_heartbeat)
        heartbeat['time'] = time.monotonic()
        watcher = threading.Thread(target=health, daemon=True)
        watcher.start()
        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline and not bench.STOP.is_set():
            index += 1
            native_heat(rh, index, [1, 2, 4, 8][(index - 1) % 4], 1.2)
            if bench.STOP.is_set():
                break
            if index % 8 == 0:
                saved = rh.read('select count(*) as n from saved_race_meta')[0]['n']
                # A planned RH restart has its own bounded readiness checks.
                health_stop.set()
                watcher.join(3)
                rh.start()
                rh.sio.on('heartbeat', on_heartbeat)
                heartbeat['time'] = time.monotonic()
                health_stop.clear()
                watcher = threading.Thread(target=health, daemon=True)
                watcher.start()
                assert rh.read('select count(*) as n from saved_race_meta')[0]['n'] == saved
                bench.record('usb', 'native-rh-reconnect-database-preserved', 'PASS', savedRaces=saved)
            bench.STOP.wait(2)
        completed = time.monotonic() >= deadline and index > 0 and not bench.STOP.is_set()
    except BaseException as error:
        failed = True
        import traceback
        bench.record('usb', 'native-lane', 'ERROR', error=repr(error), traceback=traceback.format_exc())
    finally:
        health_stop.set()
        try:
            if rh.sio and rh.status.get('race_status') == 1:
                rh.emit('stop_race')
                bench.wait(lambda: rh.status.get('race_status') == 2, 15)
        finally:
            rh.stop()
        try:
            # The ASCII console releases native RH mode before applying scan on.
            restored = console(args.c5_root, args.port, 'scan on')
            restored += console(args.c5_root, args.port, 'status')
            (bench.ROOT / 'restored-console.txt').write_text(restored)
            assert 'scan on' in restored and f'firmware {args.version}+c5zero' in restored
            for line in baseline.splitlines()[:3]:
                assert line in restored, ('Native settings changed', line)
            bench.record('usb', 'native-scanner-restored', 'PASS')
        except Exception as error:
            failed = True
            bench.record('usb', 'native-restoration', 'ERROR', error=repr(error))
        failed = failed or any(row['status'] in ('FAIL', 'ERROR') for row in bench.RESULTS)
        bench.STOP.set()
        bench.record('usb', 'terminal', 'PASS' if completed and not failed else 'FAIL',
                     completedDuration=completed, heats=index, heartbeats=heartbeat['count'])
    return 0 if completed and not failed else 1


if __name__ == '__main__':
    sys.exit(main())
