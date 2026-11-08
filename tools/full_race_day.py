"""Fail-fast three-lane rehearsal and overnight race-day qualification controller."""
import argparse
import concurrent.futures
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time

import requests
from race_day_acceptance import atomic, REPO, CODE
from race_day_contracts import validate_candidate_identity
from race_day_retry_policy import read_json_retry
from race_day_health import gate_failure, phase_failure, phase_schedule

BOARDS = {'aio': 'http://192.168.7.1', 'eth': 'http://192.168.0.65'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def get(base, path, readiness=False):
    for attempt in range(20 if readiness else 1):
        response = requests.get(base + path, timeout=5)
        if response.status_code != 503 or not readiness:
            break
        time.sleep(.15)
    response.raise_for_status()
    return response.json()


def digest_tree(path):
    digest = hashlib.sha256()
    for file in sorted(path.rglob('*')):
        if file.is_file() and '__pycache__' not in file.parts:
            digest.update(file.relative_to(path).as_posix().encode())
            digest.update(file.read_bytes())
    return digest.hexdigest()


def main():
    global BOARDS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--seconds', type=int, default=28800)
    parser.add_argument('--rehearsal', type=int, default=600)
    parser.add_argument('--native-port', default='COM29')
    parser.add_argument('--no-asset-stress', action='store_true', help='Diagnostic UART isolation; not full-load qualification')
    parser.add_argument('--skip-native-usb', action='store_true', help='Run only selected gate lanes')
    parser.add_argument('--boards', nargs='+', choices=['aio', 'eth'], default=['aio', 'eth'])
    parser.add_argument('--aio-version', default='1.2.6')
    parser.add_argument('--aio-image', type=Path, help='Record an explicitly installed diagnostic AIO application')
    parser.add_argument('--eth-version', default='1.2.5')
    parser.add_argument('--eth-image', type=Path)
    parser.add_argument('--native-version', default='1.2.6')
    parser.add_argument('--config-template', required=True, type=Path)
    args = parser.parse_args()
    BOARDS = {label: BOARDS[label] for label in args.boards}
    assert args.seconds > 0 and args.rehearsal >= 0
    root = args.out.resolve()
    assert not root.exists(), 'Use a fresh run directory'
    root.mkdir(parents=True)
    state = {'status': 'PREFLIGHT', 'startedUTC': now(), 'controllerPid': os.getpid(),
             'durationSeconds': args.seconds, 'rehearsalSeconds': args.rehearsal,
             'boards': list(BOARDS), 'nativePort': None if args.skip_native_usb else args.native_port,
             'nativeUsbEnabled': not args.skip_native_usb, 'assetStressEnabled': not args.no_asset_stress,
             'receiverVersions': {'aio': args.aio_version, 'eth': args.eth_version, 'usb': args.native_version},
             'stimulus': 'Injected gate crossings through real RH plugin; physical RF accuracy excluded' + ('; standalone USB lane excluded' if args.skip_native_usb else '; RH manual USB-lane laps')}
    state_path = root / 'controller.json'
    state_lock = threading.RLock()

    def save():
        with state_lock:
            atomic(state_path, state)

    save()
    baseline = {}
    awake = False
    active = []
    monitors = []
    health_stop = threading.Event()
    stop_paths = []
    phase_lock = threading.Lock()

    def signal(reason):
        with phase_lock:
            if not state.get('firstFailure'):
                state['firstFailure'] = {'utc': now(), 'reason': reason}
                save()
            for path in stop_paths:
                if not path.exists():
                    atomic(path, state['firstFailure'])

    def sample(label):
        base = BOARDS[label]
        return {'utc': now(), 'system': get(base, '/api/system/info'),
                'storage': get(base, '/api/log/status'), 'receiver': get(base, '/api/c5/update')}

    def watch(label, phase):
        initial = baseline[label]
        version = state['receiverVersions'][label]
        serial_target = root / (phase + '-' + label + '-health.jsonl')
        with serial_target.open('a', encoding='utf-8') as file:
            while not health_stop.is_set():
                try:
                    value = sample(label)
                    file.write(json.dumps(value) + '\n')
                    file.flush()
                    problem = gate_failure(label, value, initial, version)
                    if problem:
                        signal(problem)
                        return
                except Exception as error:
                    file.write(json.dumps({'utc': now(), 'error': repr(error)}) + '\n')
                    file.flush()
                    signal(label + ' health monitor: ' + repr(error))
                    return
                health_stop.wait(1)

    def serial_log(label, port, phase):
        import serial
        try:
            connection = serial.Serial(port=None, baudrate=115200, timeout=.3)
            connection.dtr = True
            connection.rts = False
            connection.port = port
            connection.open()
            with connection, (root / (phase + '-' + label + '-serial.log')).open('ab') as file:
                while not health_stop.is_set():
                    chunk = connection.read(8192)
                    if chunk:
                        file.write(chunk)
                        file.flush()
        except Exception as error:
            signal(label + ' serial logger failed: ' + repr(error))

    def receiver_stream(label, phase):
        baseline_counts = None
        last_log = 0
        kind = ''
        try:
            with requests.get(BOARDS[label] + '/events', headers={'Accept': 'text/event-stream'},
                              stream=True, timeout=(5, 5)) as response, (
                                  root / (phase + '-' + label + '-receiver.jsonl')).open('a') as file:
                response.raise_for_status()
                for line in response.iter_lines(chunk_size=128, decode_unicode=True):
                    if health_stop.is_set():
                        return
                    if line.startswith('event:'):
                        kind = line[6:].strip()
                    elif line.startswith('data:') and kind == 'c5Rssi':
                        data = json.loads(line[5:])
                        if baseline_counts is None:
                            baseline_counts = data.copy()
                        for key in ('seqGaps', 'queueDrops', 'badRecords', 'uartFifoOverflows',
                                    'uartBufferFull', 'uartFrameErrors', 'uartParityErrors', 'uartBreaks'):
                            if data.get(key, 0) > baseline_counts.get(key, 0):
                                signal(label + ': C5 ' + key + ' increased')
                        if not data.get('on'):
                            signal(label + ': C5 telemetry offline')
                        if time.monotonic() - last_log >= 1:
                            file.write(json.dumps({'utc': now(), **data}) + '\n')
                            file.flush()
                            last_log = time.monotonic()
                if not health_stop.is_set():
                    signal(label + ': receiver event stream ended')
        except Exception as error:
            if not health_stop.is_set():
                signal(label + ': receiver stream failed: ' + repr(error))

    def launch(command, name):
        with (root / (name + '-console.log')).open('ab') as out, (root / (name + '-error.log')).open('ab') as err:
            return subprocess.Popen(command, cwd=REPO, stdin=subprocess.DEVNULL, stdout=out,
                                    stderr=err, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    def evidence_snapshot(phase):
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            for label, value in zip(BOARDS, pool.map(sample, BOARDS)):
                atomic(root / (phase + '-' + label + '-snapshot.json'), value)
                for name, path in [('recent-log', '/api/log/recent')]:
                    try:
                        response = requests.get(BOARDS[label] + path, timeout=5)
                        response.raise_for_status()
                        (root / (phase + '-' + label + '-' + name + '.txt')).write_bytes(response.content)
                    except Exception as error:
                        atomic(root / (phase + '-' + label + '-capture-error.json'), {'error': repr(error)})

    try:
        if os.name == 'nt':
            awake = bool(ctypes.windll.kernel32.SetThreadExecutionState(0x80000001))
            assert awake, 'Could not keep Windows awake'
        state['gateCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
        state['pluginCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=CODE / 'fpvgate-rh-plugin-release', text=True).strip()
        state['pluginTreeSHA256'] = digest_tree(CODE / 'fpvgate-rh-plugin-release/custom_plugins/fpvgate')
        state['c5SourceCommit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=CODE / 'FPVGateC5MK-release-1.2.6', text=True).strip()
        (root / 'gate-dirty.patch').write_bytes(subprocess.check_output(['git', 'diff'], cwd=REPO))
        snapshot = root / 'source'
        for directory in ['tools', 'src', 'targets', 'lib/C5LINK', 'lib/RACEHISTORY', 'lib/WEBSERVER', 'scripts']:
            shutil.copytree(REPO / directory, snapshot / directory,
                            ignore=shutil.ignore_patterns('__pycache__'), dirs_exist_ok=True)
        shutil.copytree(CODE / 'fpvgate-rh-plugin-release/custom_plugins/fpvgate', snapshot / 'plugin',
                        ignore=shutil.ignore_patterns('__pycache__'))
        state['availableBuilds'] = {}
        for label in BOARDS:
            board = {'aio': 'FPVGateC5MKAIO', 'eth': 'WaveshareS3ETH'}[label]
            override = getattr(args, label + '_image')
            image = override.resolve() if override else REPO / '.pio/build' / board / 'firmware.bin'
            raw = image.read_bytes()
            state['availableBuilds'][board] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                                            'note': 'Local build identity; running device is recorded independently'}
            target = root / 'images' / board
            target.mkdir(parents=True)
            shutil.copy2(image, target / 'firmware.bin')
        for label, base in BOARDS.items():
            value = sample(label)
            validate_candidate_identity(label, value['system'], value['receiver'], state['receiverVersions'][label])
            assert value['storage']['sdAvailable'], label + ': SD unavailable'
            race = get(base, '/api/c5/race')
            assert not race['running'] and not race['busy'], label + ': gate busy'
            baseline[label] = value
            target = root / 'baseline' / label
            target.mkdir(parents=True)
            for name, path in [('config', '/config'), ('history', '/races'), ('event', '/api/event'), ('tracks', '/tracks')]:
                atomic(target / (name + '.json'), get(base, path, readiness=True))
            history = json.loads((target / 'history.json').read_text())
            details = target / 'race-details'
            details.mkdir()
            for race in history['races']:
                stamp = race['timestamp']
                atomic(details / (str(stamp) + '.json'), get(base, '/races/downloadOne?timestamp=' + str(stamp), readiness=True))
        atomic(root / 'initial-health.json', baseline)
        save()
        for phase, seconds in phase_schedule(args.rehearsal, args.seconds):
            active.clear()
            monitors.clear()
            stop_paths[:] = [root / (phase + '-gates.stop.json'), root / (phase + '-usb.stop.json')]
            state.update(status='RUNNING', phase=phase, phaseStartedUTC=now(), firstFailure=None)
            save()
            for label, base in BOARDS.items():
                atomic(root / (phase + '-' + label + '-before-heap-reset.json'), get(base, '/api/system/info?resetHeapLow'))
            common = ['--seconds', str(seconds), '--config-template', str(args.config_template.resolve())]
            provenance = [part for label in BOARDS if getattr(args, label + '_image') for part in ['--' + label + '-image', str(getattr(args, label + '_image').resolve())]]
            gates = launch([sys.executable, '-u', 'tools/race_day_acceptance.py', *common, *provenance,
                            *(['--no-asset-stress'] if args.no_asset_stress else []),
                            '--aio-receiver-version', args.aio_version, '--eth-receiver-version', args.eth_version,
                            '--lap-interval', '1.2', '--between-heats', '2', '--boards', *BOARDS,
                            '--out', str(root / (phase + '-gates'))], phase + '-gates')
            lane_processes = {'gates': gates}
            if not args.skip_native_usb:
                lane_processes['usb'] = launch([sys.executable, '-u', 'tools/race_day_native_usb.py', *common,
                              '--port', args.native_port, '--version', args.native_version,
                              '--out', str(root / (phase + '-usb'))], phase + '-usb')
            active.extend(lane_processes.values())
            state['processes'] = {name: process.pid for name, process in lane_processes.items()}
            save()
            for label, base in BOARDS.items():
                monitor = launch([sys.executable, '-u', 'tools/gate_accept_probe.py', base.split('://')[1],
                                  '--monitor', '--fresh-interval', '1', '--seconds', str(seconds + 900),
                                  '--until-pid', str(gates.pid), '--out', str(root / (phase + '-network-' + label + '.json'))],
                                 phase + '-network-' + label)
                monitors.append(monitor)
            health_stop.clear()
            threads = [threading.Thread(target=watch, args=(label, phase), daemon=True) for label in BOARDS]
            threads += [threading.Thread(target=receiver_stream, args=(label, phase), daemon=True) for label in BOARDS]
            threads += [threading.Thread(target=serial_log, args=(label, port, phase), daemon=True)
                        for label, port in [('aio', 'COM23'), ('eth', 'COM42')] if label in BOARDS]
            for thread in threads:
                thread.start()
            captured_failure = False
            while any(process.poll() is None for process in active):
                for label, process in lane_processes.items():
                    summary = root / (phase + '-' + label) / 'summary.json'
                    if summary.exists():
                        counts = read_json_retry(summary)['counts']
                        if phase_failure(counts, process.poll()):
                            signal(label + ': lane failed; see summary and console')
                    elif process.poll() is not None:
                        signal(label + ': lane exited without summary')
                if gates.poll() is None:
                    for label, monitor in zip(BOARDS, monitors):
                        failures = root / (phase + '-network-' + label + '.failures.jsonl')
                        if failures.exists() and failures.stat().st_size:
                            signal(label + ': network monitor failed; see ' + failures.name)
                        if monitor.poll() is not None:
                            signal(label + ': network monitor exited early')
                if state.get('firstFailure') and not captured_failure:
                    captured_failure = True
                    try:
                        evidence_snapshot(phase + '-first-failure')
                    except Exception as error:
                        atomic(root / (phase + '-failure-capture-error.json'), {'error': repr(error)})
                time.sleep(.25)
            health_stop.set()
            for thread in threads:
                thread.join(8)
            for monitor in monitors:
                try:
                    monitor.wait(10)
                except subprocess.TimeoutExpired:
                    monitor.terminate()
                    signal('Network monitor did not finish')
            results = {}
            for label, process in lane_processes.items():
                path = root / (phase + '-' + label) / 'summary.json'
                summary = json.loads(path.read_text()) if path.exists() else {'counts': {'ERROR': 1}}
                results[label] = {'exitCode': process.returncode, 'counts': summary['counts']}
            state[phase + 'Result'] = results
            save()
            if state.get('firstFailure') or any(phase_failure(result['counts'], result['exitCode']) for result in results.values()):
                state.update(status='FAILED', finishedUTC=now())
                save()
                break
            evidence_snapshot(phase + '-finished')
        else:
            state.update(status='COMPLETED', finishedUTC=now())
            save()
    except BaseException as error:
        signal('Controller: ' + repr(error))
        state.update(status='ERROR', error=repr(error), finishedUTC=now())
        save()
        # Do not orphan races on a controller exception. Lanes receive their stop
        # files and retain ownership until their own restoration has completed.
        for process in active:
            try:
                process.wait(timeout=900)
            except subprocess.TimeoutExpired:
                state['restorationIncomplete'] = True
                save()
        raise
    finally:
        health_stop.set()
        if awake:
            ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
    return 0 if state['status'] == 'COMPLETED' else 1


if __name__ == '__main__':
    sys.exit(main())
