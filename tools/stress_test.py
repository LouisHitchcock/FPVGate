#!/usr/bin/env python3
"""Whole-system stress test for a running FPVGate.

Drives every significant HTTP path at once, over one or both transports (USB
networking and WiFi) simultaneously, verifies every response against its
Content-Length, and samples the device's heap throughout.

The point is to catch the failures that only show up under sustained mixed load:
the RNDIS bulk-IN transmit stall, heap exhaustion, and any endpoint that degrades
when the device is busy rather than idle.

Examples
--------
    # USB only, the default, five minutes
    python tools/stress_test.py --usb 192.168.7.1 --bind 192.168.7.2

    # Both transports at once, fifteen minutes, heavier concurrency
    python tools/stress_test.py --usb 192.168.7.1 --bind 192.168.7.2 \
        --wifi 192.168.0.225 --duration 900 --workers 3

    # Stop at the first failure instead of running the clock out
    python tools/stress_test.py --usb 192.168.7.1 --bind 192.168.7.2 --stop-on-fail

Exit status is 0 if every request succeeded, 1 otherwise.
"""

import argparse
import http.client
import json
import statistics
import sys
import threading
import time
from collections import defaultdict

# Endpoint, weight. Weights bias the mix towards large transfers, because those
# are what expose the transmit stall; small requests keep working through it.
ENDPOINTS = [
    ("/script.js", 5),
    ("/", 4),
    ("/style.css", 3),
    ("/calib-styles.css", 2),
    ("/status", 3),
    ("/version", 2),
    ("/races", 2),
]

# Filled in at startup from /races if a race with RSSI history exists. This is
# the chunked-response path, which is the newest and least exercised code.
MARSHAL_PATH = None
MARSHAL_WEIGHT = 4


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.by_path = defaultdict(lambda: {"n": 0, "bytes": 0, "times": [], "fails": 0})
        self.failures = []
        self.requests = 0
        self.heap_samples = []

    def record(self, transport, path, ok, nbytes, elapsed, error=None, index=None):
        key = f"{transport} {path}"
        with self.lock:
            self.requests += 1
            e = self.by_path[key]
            e["n"] += 1
            if ok:
                e["bytes"] += nbytes
                e["times"].append(elapsed)
            else:
                e["fails"] += 1
                self.failures.append(
                    {
                        "request": index,
                        "transport": transport,
                        "path": path,
                        "bytes_before_failure": nbytes,
                        "error": error,
                        "at": round(time.time() - START, 1),
                    }
                )

    def heap(self, free, minimum):
        with self.lock:
            self.heap_samples.append((round(time.time() - START, 1), free, minimum))


def fetch(host, bind, path, timeout):
    """One request. Returns (ok, bytes_read, error). Verifies Content-Length."""
    source = (bind, 0) if bind else None
    conn = http.client.HTTPConnection(host, timeout=timeout, source_address=source)
    total = 0
    try:
        conn.request("GET", path, headers={"Connection": "close"})
        resp = conn.getresponse()
        expected = resp.getheader("Content-Length")
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            total += len(chunk)
        if resp.status != 200:
            return False, total, f"HTTP {resp.status}"
        # A truncated body is the stall signature, and it does not raise on its
        # own, so compare against the declared length where one is given.
        if expected is not None and total != int(expected):
            return False, total, f"truncated: got {total} of {expected} bytes"
        if total == 0:
            return False, 0, "empty body"
        return True, total, None
    except Exception as exc:
        return False, total, f"{type(exc).__name__}: {exc}"
    finally:
        conn.close()


def discover_marshal_path(host, bind, timeout):
    """Find a race with RSSI history so the chunked endpoint gets exercised."""
    source = (bind, 0) if bind else None
    conn = http.client.HTTPConnection(host, timeout=timeout, source_address=source)
    try:
        conn.request("GET", "/races", headers={"Connection": "close"})
        resp = conn.getresponse()
        body = resp.read()
        races = json.loads(body).get("races", [])
        for race in races:
            has = race.get("hasRssiHistory") or (race.get("rssiHistory") or {}).get("sampleCount")
            if has:
                return f"/api/marshal/rssi?timestamp={race['timestamp']}", race.get("rssiSampleCount", 0)
    except Exception:
        pass
    finally:
        conn.close()
    return None, 0


def worker(name, host, bind, stats, stop, args, weighted):
    i = 0
    while not stop.is_set():
        path = weighted[i % len(weighted)]
        i += 1
        t0 = time.time()
        ok, nbytes, err = fetch(host, bind, path, args.timeout)
        stats.record(name, path, ok, nbytes, time.time() - t0, err, stats.requests + 1)
        if not ok:
            print(f"  [{name}] FAIL {path} after {nbytes} bytes: {err}", flush=True)
            if args.stop_on_fail:
                stop.set()
                return
        if args.delay:
            time.sleep(args.delay)


def heap_sampler(host, bind, stats, stop, interval):
    """Poll /status for heap. Cheap, and the only in-flight health signal we get
    -- the CDC serial console is unusable while RNDIS is active."""
    while not stop.wait(interval):
        ok, _, _ = (None, None, None)
        source = (bind, 0) if bind else None
        try:
            conn = http.client.HTTPConnection(host, timeout=8, source_address=source)
            conn.request("GET", "/status", headers={"Connection": "close"})
            text = conn.getresponse().read().decode("utf-8", "replace")
            conn.close()
            free = mini = None
            for line in text.splitlines()[:6]:
                clean = line.replace("\t", "").strip()
                if clean.startswith("Free:"):
                    free = int(clean.split(":")[1])
                elif clean.startswith("Min:"):
                    mini = int(clean.split(":")[1])
            if free is not None and mini is not None:
                stats.heap(free, mini)
        except Exception:
            stats.heap(-1, -1)  # unreachable, recorded so it shows in the trace


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--usb", help="gate address over USB networking, e.g. 192.168.7.1")
    ap.add_argument("--bind", help="host source address for USB, e.g. 192.168.7.2. "
                                   "Without this the request can leave via the wrong interface")
    ap.add_argument("--wifi", help="gate address over WiFi, e.g. 192.168.0.225")
    ap.add_argument("--duration", type=int, default=300, help="seconds to run (default 300)")
    ap.add_argument("--workers", type=int, default=1, help="concurrent workers per transport (default 1)")
    ap.add_argument("--timeout", type=int, default=20, help="per-request timeout in seconds (default 20)")
    ap.add_argument("--delay", type=float, default=0.0, help="pause between requests per worker")
    ap.add_argument("--heap-interval", type=int, default=10, help="seconds between heap samples")
    ap.add_argument("--stop-on-fail", action="store_true", help="stop at the first failure")
    ap.add_argument("--out", help="write the JSON report here")
    args = ap.parse_args()

    if not args.usb and not args.wifi:
        ap.error("give at least one of --usb or --wifi")

    global START, MARSHAL_PATH
    START = time.time()

    primary, primary_bind = (args.usb, args.bind) if args.usb else (args.wifi, None)
    MARSHAL_PATH, samples = discover_marshal_path(primary, primary_bind, args.timeout)

    weighted = []
    for path, weight in ENDPOINTS:
        weighted.extend([path] * weight)
    if MARSHAL_PATH:
        weighted.extend([MARSHAL_PATH] * MARSHAL_WEIGHT)
        print(f"Marshal endpoint included: {MARSHAL_PATH} ({samples} samples)")
    else:
        print("No race with RSSI history found - the chunked marshal endpoint will NOT be tested")

    transports = []
    if args.usb:
        transports.append(("USB ", args.usb, args.bind))
    if args.wifi:
        transports.append(("WiFi", args.wifi, None))

    print(f"Transports: {', '.join(t[0].strip() + ' -> ' + t[1] for t in transports)}")
    print(f"Duration {args.duration}s, {args.workers} worker(s) per transport, "
          f"{len(set(weighted))} distinct endpoints")
    print("-" * 70, flush=True)

    stats = Stats()
    stop = threading.Event()
    threads = []

    for label, host, bind in transports:
        for w in range(args.workers):
            name = label if args.workers == 1 else f"{label}#{w + 1}"
            t = threading.Thread(target=worker, args=(name, host, bind, stats, stop, args, weighted), daemon=True)
            t.start()
            threads.append(t)

    sampler = threading.Thread(target=heap_sampler,
                               args=(primary, primary_bind, stats, stop, args.heap_interval), daemon=True)
    sampler.start()

    try:
        deadline = START + args.duration
        while time.time() < deadline and not stop.is_set():
            time.sleep(1)
    except KeyboardInterrupt:
        print("\ninterrupted")
    stop.set()
    for t in threads:
        t.join(timeout=args.timeout + 5)

    elapsed = time.time() - START
    report(stats, elapsed, args)
    return 1 if stats.failures else 0


def report(stats, elapsed, args):
    print("-" * 70)
    print(f"{'transport / endpoint':<44}{'n':>6}{'fail':>6}{'median':>9}{'max':>8}")
    total_bytes = 0
    for key in sorted(stats.by_path):
        e = stats.by_path[key]
        total_bytes += e["bytes"]
        med = f"{statistics.median(e['times']):.2f}s" if e["times"] else "-"
        mx = f"{max(e['times']):.2f}s" if e["times"] else "-"
        print(f"{key:<44}{e['n']:>6}{e['fails']:>6}{med:>9}{mx:>8}")

    print("-" * 70)
    print(f"{stats.requests} requests, {total_bytes / 1e6:.1f} MB, {elapsed:.0f}s "
          f"({stats.requests / elapsed:.2f} req/s)")

    if stats.heap_samples:
        live = [m for _, _, m in stats.heap_samples if m > 0]
        unreachable = sum(1 for _, f, _ in stats.heap_samples if f < 0)
        if live:
            print(f"heap min-ever floor: {min(live) / 1024:.0f} KB   "
                  f"(start {stats.heap_samples[0][2] / 1024:.0f} KB, {len(live)} samples)")
        if unreachable:
            print(f"heap poll UNREACHABLE {unreachable} time(s) - the gate stopped answering")

    if stats.failures:
        print(f"\n{len(stats.failures)} FAILURE(S):")
        for f in stats.failures[:20]:
            print(f"  at {f['at']}s  request ~{f['request']}  {f['transport']} {f['path']}")
            print(f"      {f['error']}  (after {f['bytes_before_failure']} bytes)")
        if len(stats.failures) > 20:
            print(f"  ... and {len(stats.failures) - 20} more")
        rate = len(stats.failures) / stats.requests * 100
        print(f"\nFAILED: {len(stats.failures)} of {stats.requests} requests ({rate:.2f}%)")
    else:
        print("\nPASSED: no failures")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "elapsed": elapsed,
                    "requests": stats.requests,
                    "bytes": total_bytes,
                    "failures": stats.failures,
                    "heap_samples": stats.heap_samples,
                    "by_endpoint": {k: {kk: vv for kk, vv in v.items() if kk != "times"}
                                    for k, v in stats.by_path.items()},
                },
                fh,
                indent=2,
            )
        print(f"report written to {args.out}")


if __name__ == "__main__":
    sys.exit(main())
