"""Count RotorHazard passes the gate acknowledges but never puts on its stream.

Alternates two arms of equal length against a live gate, injecting paced
passes through /api/rh/testPass and counting them on /api/rh/events:

  clock  background load on /api/rh/clock, which refreshes the RH link stamp
  info   background load on /api/rh/info, which does not (a larger response,
         so a load-driven loss should show here at least as readily)

A 5 s clock poll keeps the link up in both arms, as the plugin does. Injected
passes carry no rawPeak, so real C5 passes are counted separately rather than
credited to the injection. No gate settings, race state or history are touched.
"""
import argparse
import http.client
import json
import socket
import threading
import time
from pathlib import Path

INJECT_NODES = 4
SETTLE_S = 3.0


class Stream(threading.Thread):
    """Reads the event stream; ends the run's validity if the socket drops."""

    def __init__(self, host):
        super().__init__(daemon=True)
        self.sock = socket.create_connection((host, 80), timeout=30)
        self.sock.sendall((f'GET /api/rh/events HTTP/1.1\r\nHost: {host}\r\n'
                           'Accept: text/event-stream\r\nConnection: keep-alive\r\n\r\n').encode())
        self.lock = threading.Lock()
        self.injected = []
        self.real = 0
        self.dropped = None
        self.stopping = False

    def run(self):
        buffer = b''
        try:
            while not self.stopping:
                chunk = self.sock.recv(4096)
                if not chunk:
                    raise ConnectionError('stream closed by gate')
                buffer += chunk
                while b'\n\n' in buffer:
                    message, buffer = buffer.split(b'\n\n', 1)
                    self.handle(message.decode(errors='replace'))
        except Exception as exc:
            if not self.stopping:
                self.dropped = repr(exc)

    def handle(self, message):
        lines = message.splitlines()
        if 'event: rhPass' not in lines:
            return
        body = next(line[5:].strip() for line in lines if line.startswith('data:'))
        data = json.loads(body)
        with self.lock:
            if 'rawPeak' in data:
                self.real += 1
            else:
                self.injected.append(data['node'])

    def take(self):
        with self.lock:
            injected, real = self.injected, self.real
            self.injected, self.real = [], 0
        return injected, real


def request(conn, method, path):
    conn.request(method, path)
    response = conn.getresponse()
    response.read()
    return response.status


def poll_link(host, stop):
    conn = http.client.HTTPConnection(host, timeout=5)
    while not stop.wait(5.0):
        try:
            request(conn, 'GET', '/api/rh/clock')
        except Exception:
            conn.close()


def load(host, path, stop, counts):
    conn = http.client.HTTPConnection(host, timeout=5)
    while not stop.is_set():
        try:
            status = request(conn, 'GET', path)
            counts[status] = counts.get(status, 0) + 1
        except Exception as exc:
            counts[type(exc).__name__] = counts.get(type(exc).__name__, 0) + 1
            conn.close()
            time.sleep(0.05)


def missing_positions(sent, received):
    """Sent nodes are a known sequence, so walk it to name what never arrived."""
    missing, position = [], 0
    for index, node in enumerate(sent):
        if position < len(received) and received[position] == node:
            position += 1
        else:
            missing.append({'index': index, 'node': node})
    return missing, len(received) - position


def run_arm(host, stream, arm, seconds, interval, threads):
    path = {'clock': '/api/rh/clock', 'info': '/api/rh/info'}[arm]
    stop = threading.Event()
    counts = {}
    workers = [threading.Thread(target=load, args=(host, path, stop, counts), daemon=True) for _ in range(threads)]
    for worker in workers:
        worker.start()
    conn = http.client.HTTPConnection(host, timeout=5)
    sent, rejected, errors = [], {}, 0
    deadline = time.monotonic() + seconds
    node = 0
    while time.monotonic() < deadline:
        try:
            status = request(conn, 'POST', f'/api/rh/testPass?node={node}')
            if status == 200:
                sent.append(node)
                node = (node + 1) % INJECT_NODES
            else:
                rejected[status] = rejected.get(status, 0) + 1
        except Exception:
            errors += 1
            conn.close()
        time.sleep(interval)
    stop.set()
    for worker in workers:
        worker.join(6)
    time.sleep(SETTLE_S)
    received, real = stream.take()
    missing, extra = missing_positions(sent, received)
    return {'arm': arm, 'seconds': seconds, 'acknowledged': len(sent), 'received': len(received),
            'missing': len(missing), 'extra': extra, 'missingAt': missing[:50], 'rejected': rejected,
            'injectErrors': errors, 'realPasses': real, 'loadRequests': counts}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host')
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--arm-seconds', type=float, default=60)
    parser.add_argument('--rounds', type=int, default=2)
    parser.add_argument('--interval', type=float, default=0.1, help='seconds between injected passes')
    parser.add_argument('--threads', type=int, default=2, help='background load connections')
    args = parser.parse_args()
    assert not args.out.exists(), 'evidence must not overwrite an earlier run'

    conn = http.client.HTTPConnection(args.host, timeout=5)
    assert request(conn, 'GET', '/api/rh/clock') == 200
    conn.request('GET', '/api/rh/info')
    info = json.loads(conn.getresponse().read())
    conn.request('GET', '/api/system/info')
    counts_before = json.loads(conn.getresponse().read()).get('rhPasses')
    stream = Stream(args.host)
    stream.start()
    time.sleep(1.0)
    stop_poll = threading.Event()
    threading.Thread(target=poll_link, args=(args.host, stop_poll), daemon=True).start()

    arms = []
    for _ in range(args.rounds):
        for arm in ('clock', 'info'):
            result = run_arm(args.host, stream, arm, args.arm_seconds, args.interval, args.threads)
            result['streamDropped'] = stream.dropped
            arms.append(result)
            print(json.dumps({k: v for k, v in result.items() if k != 'missingAt'}), flush=True)
            if stream.dropped:
                break
        if stream.dropped:
            break
    conn = http.client.HTTPConnection(args.host, timeout=5)
    conn.request('GET', '/api/system/info')
    counts_after = json.loads(conn.getresponse().read()).get('rhPasses')
    stop_poll.set()
    stream.stopping = True

    totals = {arm: {key: sum(a[key] for a in arms if a['arm'] == arm) for key in ('acknowledged', 'received', 'missing', 'extra')}
              for arm in ('clock', 'info')}
    report = {'utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'host': args.host,
              'version': info.get('version'), 'board': info.get('board'),
              'valid': not stream.dropped, 'totals': totals, 'gateCountsBefore': counts_before,
              'gateCountsAfter': counts_after, 'arms': arms}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print(json.dumps(totals))
    return 0 if report['valid'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
