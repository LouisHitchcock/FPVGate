#!/usr/bin/env python3
"""Concurrent page-load test: fetch every startup asset at once, repeatedly.

This exists because nothing else in this directory reproduces the shape of load
a browser actually makes when it opens the web UI.

A browser loading a page with an empty cache does not ask for one file at a
time. It opens several connections at once and asks for everything together.
That is a very different load from one request after another: it puts several
full TCP windows on the wire simultaneously, and anything in the path with a
fixed, shared buffer - the USB networking egress pool, lwIP's pbuf supply, the
async web server's response buffers - meets its worst case immediately rather
than gradually.

stress_test.py can run concurrent workers with --workers, but it defaults to
one and no command in the README or the runbook raises it, so in practice every
documented check is sequential. Even with several workers its shape is wrong
for this: each worker loops independently over random assets, producing
sustained mixed traffic rather than the synchronised burst of one specific
asset set that a page load is. Sustained traffic lets TCP find a steady state.
A page load never gets the chance.

The difference is not subtle. On an ESP32-S3 DevKitC-1 the sequential failure
rate was about 1 in 1350 requests, which soak_test.py and reliability_check.py
both passed cleanly. Fetching the same assets concurrently failed six page
loads out of eight, every failure a truncated response. If a board serves
assets perfectly one at a time and still will not load in a browser, this is
the test that shows why.

A "failure" here is deliberately strict, because a browser is strict: a request
that returns 200 but fewer bytes than its Content-Length has failed, even
though nothing raised an error. That silent truncation is exactly what leaves
the UI stuck on the skeleton screen, waiting for the rest of a script that is
never coming.

Example
-------
    python tools/concurrent_load.py --host 192.168.7.1 --rounds 20

Exit status is 0 only if every asset of every page load arrived complete.
"""

import argparse
import http.client
import json
import statistics
import sys
import threading
import time

# The assets a cold load of the FPVGate UI actually requests, in no particular
# order - they are fetched together, so order is not meaningful.
DEFAULT_ASSETS = [
    "/index.html",
    "/style.css",
    "/calib-styles.css",
    "/jquery-3.7.1.min.js",
    "/i18n.js",
    "/audio-announcer.js",
    "/smoothie.js",
    "/script.js",
    "/locales/en.json",
]


class Result:
    def __init__(self, path, nbytes, seconds, error):
        self.path = path
        self.bytes = nbytes
        self.seconds = seconds
        self.error = error


def fetch(host, path, timeout, results, lock):
    """One asset, on its own connection, as a browser would."""
    started = time.time()
    received = 0
    error = None
    try:
        conn = http.client.HTTPConnection(host, timeout=timeout)
        # Connection: close keeps each asset on its own connection, which is
        # what makes this concurrent rather than pipelined.
        conn.request("GET", path, headers={"Connection": "close"})
        response = conn.getresponse()
        declared = response.getheader("Content-Length")
        while True:
            chunk = response.read(4096)
            if not chunk:
                break
            received += len(chunk)
        conn.close()
        if response.status != 200:
            error = f"HTTP {response.status}"
        elif declared is not None and received != int(declared):
            # A short read with no exception. The browser sees a broken file.
            error = f"truncated {received}/{declared}"
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
    with lock:
        results.append(Result(path, received, time.time() - started, error))


def read_heap(host, timeout):
    """Device free/min heap, if /status will tell us. Best effort only."""
    try:
        conn = http.client.HTTPConnection(host, timeout=timeout)
        conn.request("GET", "/status", headers={"Connection": "close"})
        body = conn.getresponse().read().decode("utf-8", "replace")
        conn.close()
    except Exception:
        return None, None
    free = minimum = None
    try:
        parsed = json.loads(body)
        free = parsed.get("heapFree")
        minimum = parsed.get("heapMin")
    except ValueError:
        for line in body.splitlines()[:8]:
            clean = line.replace("\t", "").strip()
            if clean.startswith("Free:"):
                free = int(clean.split(":")[1])
            elif clean.startswith("Min:"):
                minimum = int(clean.split(":")[1])
    return free, minimum


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="192.168.7.1",
                        help="gate address (default 192.168.7.1, the USB address)")
    parser.add_argument("--rounds", type=int, default=8,
                        help="simulated page loads (default 8)")
    parser.add_argument("--timeout", type=int, default=25,
                        help="per-asset timeout in seconds (default 25)")
    parser.add_argument("--slow", type=float, default=10.0,
                        help="seconds above which a page load counts as slow")
    parser.add_argument("--settle", type=float, default=1.0,
                        help="pause between page loads, letting TCP windows reset")
    parser.add_argument("--assets", nargs="*", default=DEFAULT_ASSETS,
                        help="override the asset list")
    parser.add_argument("--concurrency", type=int, default=0,
                        help="cap simultaneous requests (0 = all at once, as a "
                             "browser with an empty cache does). Sweeping this "
                             "finds how many connections the board can take.")
    args = parser.parse_args()

    print(f"concurrent load: {args.rounds} page loads of {len(args.assets)} assets "
          f"against {args.host}\n")

    rounds_failed = 0
    rounds_slow = 0
    assets_failed = 0
    assets_total = 0
    durations = []
    first_errors = []
    heap_floor = None

    for index in range(args.rounds):
        results = []
        lock = threading.Lock()
        # A semaphore rather than a thread pool, so that with the default of
        # no cap every request really is in flight at the same instant.
        gate = threading.Semaphore(args.concurrency) if args.concurrency else None

        def run(path):
            if gate is None:
                fetch(args.host, path, args.timeout, results, lock)
                return
            with gate:
                fetch(args.host, path, args.timeout, results, lock)

        started = time.time()
        threads = [threading.Thread(target=run, args=(path,)) for path in args.assets]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        elapsed = time.time() - started
        durations.append(elapsed)

        bad = [r for r in results if r.error]
        assets_total += len(results)
        assets_failed += len(bad)
        total_bytes = sum(r.bytes for r in results)

        note = ""
        if bad:
            rounds_failed += 1
            note = "  <-- " + bad[0].error[:60]
            first_errors.append(f"load {index + 1} {bad[0].path}: {bad[0].error}")
        elif elapsed > args.slow:
            rounds_slow += 1
            note = "  <-- slow"

        print(f"  load {index + 1:>3}: {elapsed:5.1f}s  {total_bytes / 1000:6.0f} KB  "
              f"{len(bad)}/{len(results)} failed{note}", flush=True)

        _, minimum = read_heap(args.host, args.timeout)
        if minimum is not None:
            heap_floor = minimum if heap_floor is None else min(heap_floor, minimum)

        if index + 1 < args.rounds:
            time.sleep(args.settle)

    print("\n" + "-" * 64)
    print(f"page loads      : {args.rounds}")
    print(f"  with failures : {rounds_failed}")
    print(f"  slow (>{args.slow:.0f}s)   : {rounds_slow}")
    print(f"assets          : {assets_total - assets_failed}/{assets_total} complete")
    if durations:
        print(f"page load time  : median {statistics.median(durations):.1f}s, "
              f"worst {max(durations):.1f}s")
    if heap_floor is not None:
        print(f"device heap floor: {heap_floor / 1024:.1f} KB")
        if heap_floor < 20 * 1024:
            print("  WARNING: under 20 KB. Memory, not buffering, may be the limit.")
    if first_errors:
        print("\nfirst failure of each bad load:")
        for line in first_errors[:10]:
            print(f"  {line}")

    if rounds_failed:
        print("\nRESULT: FAIL - the UI will load unreliably in a browser.")
        print("On a board using USB networking, check the [USB TX] serial line.")
        print("  low=0            the egress pool ran dry; it is too small, or the")
        print("                   drain rate rather than the buffer is the limit")
        print("  low well above 0 the pool is fine; look at heap and at the number")
        print("                   of concurrent connections the server accepts")
        return 1
    print("\nRESULT: PASS - every asset of every page load arrived complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
