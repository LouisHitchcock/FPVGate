"""Exercise HTTP/SSE normal closes and RSTs while checking gate clock continuity."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import socket
import struct
import threading
import time
from urllib.parse import urlsplit

import requests


def run(base, seconds, history_json=False, capture_dir=None):
    host = urlsplit(base)
    deadline = time.monotonic() + seconds
    lock = threading.Lock()
    counts = {'sseCloses': 0, 'assetReads': 0, 'abruptCloses': 0, 'clockProbes': 0,
              'historyReads': 0, 'historyMaxBytes': 0, 'invalidHistoryResponses': 0}
    errors = []

    def failure(error):
        with lock:
            errors.append(repr(error))

    def worker(index):
        paths = ['/script.js', '/event.js', '/c5-multipilot.js']
        while time.monotonic() < deadline:
            try:
                with requests.get(base + ('/events' if index % 2 else '/api/rh/events'),
                                  headers={'Accept': 'text/event-stream'},
                                  stream=True, timeout=5) as response:
                    response.raise_for_status()
                with lock:
                    counts['sseCloses'] += 1
                with requests.get(base + paths[index % len(paths)], stream=True, timeout=5) as response:
                    response.raise_for_status()
                    data = response.raw.read(decode_content=False)
                    if response.headers.get('Content-Length'):
                        assert len(data) == int(response.headers['Content-Length'])
                with lock:
                    counts['assetReads'] += 1
                if history_json:
                    response = requests.get(base + '/races/download', timeout=10)
                    response.raise_for_status()
                    with lock:
                        counts['historyMaxBytes'] = max(counts['historyMaxBytes'], len(response.content))
                    try:
                        assert isinstance(response.json()['races'], list)
                    except (ValueError, KeyError, AssertionError):
                        with lock:
                            counts['invalidHistoryResponses'] += 1
                        if capture_dir:
                            stem = capture_dir / f'invalid-history-{index}-{time.time_ns()}'
                            stem.with_suffix('.bin').write_bytes(response.content)
                            stem.with_suffix('.json').write_text(json.dumps(dict(response.headers), indent=2))
                        raise
                    with lock:
                        counts['historyReads'] += 1
                with socket.create_connection((host.hostname, host.port or 80), timeout=5) as connection:
                    connection.sendall((f'GET /script.js HTTP/1.1\r\nHost: {host.netloc}\r\n'
                                        'Connection: keep-alive\r\n\r\n').encode('ascii'))
                    connection.recv(256)
                    # Windows uses unsigned shorts for linger, POSIX uses ints.
                    connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER,
                                          struct.pack('HH' if __import__('os').name == 'nt' else 'ii', 1, 0))
                with lock:
                    counts['abruptCloses'] += 1
            except Exception as error:
                failure(error)
            time.sleep(.05)

    before = requests.get(base + '/api/rh/clock', timeout=5).json()['us']
    previous = before
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(worker, i) for i in range(4)]
        while time.monotonic() < deadline:
            try:
                response = requests.get(base + '/api/rh/clock', timeout=5)
                response.raise_for_status()
                current = response.json()['us']
                assert current >= previous, 'Gate clock reset during stress'
                previous = current
                with lock:
                    counts['clockProbes'] += 1
            except Exception as error:
                failure(error)
            time.sleep(.5)
        for future in futures:
            future.result()
    return {'status': 'FAIL' if errors else 'PASS', 'base': base, 'seconds': seconds,
            'counts': counts, 'errors': errors, 'startUs': before, 'lastUs': previous}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--seconds', type=float, default=60)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--history-json', action='store_true')
    args = parser.parse_args()
    report = run(args.base.rstrip('/'), args.seconds, args.history_json, args.output.parent)
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    raise SystemExit(report['status'] != 'PASS')
