"""Find out which paths to a gate fail while it is under connection bursts.

Measures three things at once, because they fail for different reasons:

  fresh   a new TCP connection and request, several times a second
  held    a request on one kept-alive connection, once a second
  ping    ICMP, once a second

Bursts repeat the acceptance harness's page-load shape: several new connections
at once, each fetching a startup asset. An interval where only "fresh" fails means
the gate is up but not accepting. Read-only: no settings, races or history change.

--monitor runs beside an acceptance run: no bursts, and neither /api/rh/clock nor
the event stream, which would make the gate behave as if RotorHazard were linked.
Failures are appended to <out>.failures.jsonl as they happen.
"""
import argparse
import concurrent.futures
import ctypes
import http.client
import json
import socket
import subprocess
import threading
import time
from pathlib import Path

PATHS = ['/', '/script.js', '/style.css', '/c5-multipilot.js', '/event.js', '/version']
FRESH_TIMEOUT_S = 2.5


class Series:
    def __init__(self, name, sink=None):
        self.name = name
        self.sink = sink
        self.lock = threading.Lock()
        self.samples = []

    def add(self, ok, elapsed, error=None):
        with self.lock:
            self.samples.append((time.time(), ok, round(elapsed, 3), error))
            if self.sink and not ok:
                with self.sink.open('a', encoding='utf-8') as f:
                    f.write(json.dumps({'utc': time.strftime('%H:%M:%S', time.gmtime()), 'series': self.name,
                                        'elapsed': round(elapsed, 3), 'error': error}) + '\n')

    def report(self, gap_s):
        with self.lock:
            samples = list(self.samples)
        outages, start, last_good, errors = [], None, None, {}
        for at, ok, _, error in samples:
            if ok:
                if start is not None:
                    outages.append({'start': start, 'end': at, 'seconds': round(at - start, 2)})
                    start = None
                last_good = at
            else:
                errors[error] = errors.get(error, 0) + 1
                if start is None:
                    start = last_good or at
        if start is not None:
            outages.append({'start': start, 'end': None, 'seconds': round(samples[-1][0] - start, 2)})
        times = sorted(s[2] for s in samples if s[1])
        return {
            'samples': len(samples), 'failed': sum(not s[1] for s in samples), 'errors': errors,
            'maxOkSeconds': times[-1] if times else None,
            'p99OkSeconds': times[int(len(times) * .99)] if times else None,
            'outages': [o for o in outages if o['seconds'] >= gap_s],
        }


def fresh_once(host):
    sock = socket.create_connection((host, 80), timeout=FRESH_TIMEOUT_S)
    try:
        sock.settimeout(FRESH_TIMEOUT_S)
        sock.sendall(f'GET /api/rh/info HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n'.encode())
        while sock.recv(4096):
            pass
    finally:
        sock.close()


def fresh_loop(host, series, stop, interval):
    while not stop.is_set():
        started = time.monotonic()
        try:
            fresh_once(host)
            series.add(True, time.monotonic() - started)
        except Exception as exc:
            series.add(False, time.monotonic() - started, type(exc).__name__)
        stop.wait(interval)


def held_loop(host, series, stop, path='/api/rh/clock'):
    conn = http.client.HTTPConnection(host, timeout=FRESH_TIMEOUT_S)
    while not stop.is_set():
        started = time.monotonic()
        try:
            conn.request('GET', path)
            response = conn.getresponse()
            response.read()
            series.add(response.status == 200, time.monotonic() - started, f'http{response.status}')
        except Exception as exc:
            series.add(False, time.monotonic() - started, type(exc).__name__)
            conn.close()
        stop.wait(1.0)


def ping_loop(host, series, stop):
    while not stop.is_set():
        started = time.monotonic()
        result = subprocess.run(['ping', '-n', '1', '-w', '1000', host], capture_output=True, text=True)
        # Windows exits 0 for "unreachable" replies, so require a real reply.
        ok = result.returncode == 0 and 'TTL=' in result.stdout
        series.add(ok, time.monotonic() - started, None if ok else 'noReply')
        stop.wait(1.0)


def stream_loop(host, state, stop):
    """Hold the RotorHazard stream open, as the plugin does."""
    while not stop.is_set():
        try:
            with socket.create_connection((host, 80), timeout=10) as sock:
                sock.sendall((f'GET /api/rh/events HTTP/1.1\r\nHost: {host}\r\n'
                              'Accept: text/event-stream\r\n\r\n').encode())
                sock.settimeout(1.0)
                while not stop.is_set():
                    try:
                        if not sock.recv(4096):
                            state['streamEnds'] += 1
                            break
                    except socket.timeout:
                        continue
        except Exception:
            state['streamEnds'] += 1
            stop.wait(1.0)


def fetch(host, path):
    conn = http.client.HTTPConnection(host, timeout=25)
    try:
        conn.request('GET', path)
        response = conn.getresponse()
        response.read()
        return response.status == 200
    except Exception:
        return False
    finally:
        conn.close()


def process_alive(pid):
    handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return False
    code = ctypes.c_ulong()
    ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
    ctypes.windll.kernel32.CloseHandle(handle)
    return code.value == 259  # STILL_ACTIVE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host')
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--seconds', type=float, default=300)
    parser.add_argument('--burst-every', type=float, default=5.0, help='0 disables bursts')
    parser.add_argument('--burst-size', type=int, default=12)
    parser.add_argument('--fresh-interval', type=float, default=0.25)
    parser.add_argument('--monitor', action='store_true')
    parser.add_argument('--until-pid', type=int, help='also stop when this process exits')
    args = parser.parse_args()
    if args.monitor:
        args.burst_every = 0
    assert not args.out.exists(), 'evidence must not overwrite an earlier run'

    stop = threading.Event()
    sink = args.out.with_suffix('.failures.jsonl') if args.monitor else None
    if sink:
        args.out.parent.mkdir(parents=True, exist_ok=True)
    fresh, held, ping = Series('fresh', sink), Series('held', sink), Series('ping', sink)
    state = {'streamEnds': 0}
    loops = [
        (fresh_loop, (args.host, fresh, stop, args.fresh_interval)),
        (held_loop, (args.host, held, stop, '/api/rh/info') if args.monitor else (args.host, held, stop)),
        (ping_loop, (args.host, ping, stop)),
    ]
    if not args.monitor:
        loops.append((stream_loop, (args.host, state, stop)))
    workers = [threading.Thread(target=target, args=arguments, daemon=True) for target, arguments in loops]
    for worker in workers:
        worker.start()

    bursts, burst_failed, burst_times = 0, 0, []
    deadline = time.monotonic() + args.seconds
    with concurrent.futures.ThreadPoolExecutor(args.burst_size) as pool:
        while time.monotonic() < deadline and (not args.until_pid or process_alive(args.until_pid)):
            if args.burst_every <= 0:
                time.sleep(1)
                continue
            started = time.time()
            paths = [PATHS[i % len(PATHS)] for i in range(args.burst_size)]
            results = list(pool.map(lambda path: fetch(args.host, path), paths))
            bursts += 1
            burst_failed += results.count(False)
            burst_times.append((started, round(time.time() - started, 2)))
            time.sleep(args.burst_every)
    stop.set()
    time.sleep(1.5)

    report = {
        'utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'host': args.host, 'seconds': args.seconds,
        'bursts': bursts, 'burstSize': args.burst_size, 'burstRequestsFailed': burst_failed,
        'slowestBurstSeconds': max((b[1] for b in burst_times), default=None), 'streamEnds': state['streamEnds'],
        'fresh': fresh.report(1.0), 'held': held.report(1.0), 'ping': ping.report(1.0),
    }
    conn = http.client.HTTPConnection(args.host, timeout=5)
    conn.request('GET', '/api/system/info')
    info = json.loads(conn.getresponse().read())
    report['gate'] = {k: info.get(k) for k in ('version', 'board', 'heapFree', 'heapLow', 'busyRefusals', 'requestsNow')}
    report['gate']['ethernet'] = info.get('ethernet')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ('bursts', 'burstRequestsFailed', 'slowestBurstSeconds', 'streamEnds', 'fresh', 'held', 'ping')}, indent=1))


if __name__ == '__main__':
    main()
