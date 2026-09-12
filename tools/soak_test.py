#!/usr/bin/env python3
"""Long-running soak test for a FPVGate, across both transports at once.

Built for leaving running for an hour or more. It answers two questions that a
short load test cannot: does either transport die over time, and does it come
back on its own when it does.

Two things happen on a loop:

* a liveness probe of /status on every configured transport, often and cheaply,
  recording latency and the device heap
* a periodic burst of heavy mixed traffic shaped like race-time usage - rapid
  status polling interleaved with large asset transfers

The burst is READ-ONLY. It deliberately does not drive /timer/start or
/timer/stop, because a soak run would otherwise write hundreds of races to the
SD card and fill the race history.

Output is quiet on purpose. Only state changes are printed - a transport going
down, a transport coming back, and a one-line summary per burst - so it can be
left running and watched without drowning in noise. Everything is written to the
log file regardless.

Example
-------
    python tools/soak_test.py --wifi 192.168.0.225 \
        --usb 192.168.7.1 --bind 192.168.7.2 \
        --duration 4200 --log soak.log

Exit status is 0 only if every transport was alive at every probe.
"""

import argparse
import http.client
import json
import sys
import time
from datetime import datetime

ASSETS = ["/script.js", "/", "/style.css", "/races", "/status", "/version"]


class Transport:
    def __init__(self, name, host, bind):
        self.name = name
        self.host = host
        self.bind = bind
        self.alive = True           # assume alive so the first failure reports
        self.probes = 0
        self.failures = 0
        self.down_since = None
        self.outages = []           # (start_iso, seconds, probes_missed)
        self.missed = 0
        self.heap_floor = None
        self.latencies = []
        self.burst_requests = 0
        self.burst_failures = 0
        self.bytes = 0

    def request(self, path, timeout):
        source = (self.bind, 0) if self.bind else None
        conn = http.client.HTTPConnection(self.host, timeout=timeout, source_address=source)
        total = 0
        t0 = time.time()
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
                return False, total, time.time() - t0, f"HTTP {resp.status}"
            if expected is not None and total != int(expected):
                return False, total, time.time() - t0, f"truncated {total}/{expected}"
            return True, total, time.time() - t0, None
        except Exception as exc:
            return False, total, time.time() - t0, f"{type(exc).__name__}: {exc}"
        finally:
            conn.close()


def parse_heap(text):
    free = minimum = None
    for line in text.splitlines()[:6]:
        clean = line.replace("\t", "").strip()
        if clean.startswith("Free:"):
            free = int(clean.split(":")[1])
        elif clean.startswith("Min:"):
            minimum = int(clean.split(":")[1])
    return free, minimum


def probe(t, args, log):
    """One liveness check. Returns True if the transport answered."""
    source = (t.bind, 0) if t.bind else None
    t.probes += 1
    ok = False
    heap = None
    t0 = time.time()
    try:
        conn = http.client.HTTPConnection(t.host, timeout=args.timeout, source_address=source)
        conn.request("GET", "/status", headers={"Connection": "close"})
        body = conn.getresponse().read().decode("utf-8", "replace")
        conn.close()
        free, minimum = parse_heap(body)
        if minimum:
            heap = minimum
            t.heap_floor = minimum if t.heap_floor is None else min(t.heap_floor, minimum)
        ok = True
        t.latencies.append(time.time() - t0)
    except Exception as exc:
        log(f"    {t.name} probe error: {type(exc).__name__}: {exc}", quiet=True)

    if ok and not t.alive:
        down_for = time.time() - t.down_since
        t.outages.append((datetime.fromtimestamp(t.down_since).isoformat(timespec="seconds"),
                          round(down_for, 1), t.missed))
        log(f"RECOVERED  {t.name} answered again after {down_for:.0f}s down "
            f"({t.missed} probe(s) missed). It came back WITHOUT intervention.")
        t.alive = True
        t.down_since = None
        t.missed = 0
    elif not ok and t.alive:
        t.alive = False
        t.down_since = time.time()
        t.missed = 1
        t.failures += 1
        log(f"DOWN       {t.name} stopped answering /status")
    elif not ok:
        t.missed += 1
        t.failures += 1
    return ok


def burst(t, args, log):
    """A short burst of race-shaped traffic: heavy assets plus rapid polling."""
    started = time.time()
    fails = []
    for i in range(args.burst_requests):
        # Roughly the pattern the UI produces during a race: frequent small
        # status polls with occasional large transfers.
        path = "/status" if i % 3 else ASSETS[i % len(ASSETS)]
        ok, nbytes, elapsed, err = t.request(path, args.timeout)
        t.burst_requests += 1
        t.bytes += nbytes
        if not ok:
            t.burst_failures += 1
            fails.append(f"{path}: {err}")
        time.sleep(args.burst_delay)
    if fails:
        log(f"BURST FAIL {t.name} {len(fails)}/{args.burst_requests} failed in "
            f"{time.time() - started:.0f}s -- first: {fails[0]}")
    else:
        log(f"burst ok   {t.name} {args.burst_requests}/{args.burst_requests} in "
            f"{time.time() - started:.0f}s, {t.bytes / 1e6:.0f} MB cumulative")
    return not fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wifi", help="gate address over WiFi")
    ap.add_argument("--usb", help="gate address over USB networking")
    ap.add_argument("--bind", help="host source address for USB, e.g. 192.168.7.2")
    ap.add_argument("--duration", type=int, default=3600, help="seconds to run (default 3600)")
    ap.add_argument("--check-interval", type=int, default=30, help="seconds between liveness probes")
    ap.add_argument("--burst-interval", type=int, default=300, help="seconds between traffic bursts")
    ap.add_argument("--burst-requests", type=int, default=40, help="requests per burst per transport")
    ap.add_argument("--burst-delay", type=float, default=0.05, help="pause between burst requests")
    ap.add_argument("--timeout", type=int, default=15, help="per-request timeout")
    ap.add_argument("--log", default="soak.log", help="log file path")
    args = ap.parse_args()

    if not args.wifi and not args.usb:
        ap.error("give at least one of --wifi or --usb")

    logfile = open(args.log, "w", encoding="utf-8", buffering=1)

    def log(msg, quiet=False):
        stamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{stamp}] {msg}"
        logfile.write(line + "\n")
        if not quiet:
            print(line, flush=True)

    transports = []
    if args.usb:
        transports.append(Transport("USB ", args.usb, args.bind))
    if args.wifi:
        transports.append(Transport("WiFi", args.wifi, None))

    start = time.time()
    end = start + args.duration
    log(f"soak start: {args.duration}s, probing every {args.check_interval}s, "
        f"burst of {args.burst_requests} every {args.burst_interval}s")
    log(f"transports: {', '.join(t.name.strip() + ' ' + t.host for t in transports)}")

    next_burst = start + args.burst_interval
    try:
        while time.time() < end:
            for t in transports:
                probe(t, args, log)
            if time.time() >= next_burst:
                for t in transports:
                    # No point bursting at a transport that is already down; the
                    # probe loop is what will notice it coming back.
                    if t.alive:
                        burst(t, args, log)
                next_burst = time.time() + args.burst_interval
            time.sleep(max(0, args.check_interval - 1))
    except KeyboardInterrupt:
        log("interrupted")

    elapsed = time.time() - start
    log("-" * 64)
    log(f"soak finished after {elapsed / 60:.0f} minutes")
    failed = False
    for t in transports:
        alive = "UP" if t.alive else "DOWN AT END"
        med = sorted(t.latencies)[len(t.latencies) // 2] if t.latencies else 0
        log(f"{t.name}: {alive}  probes {t.probes}, failed {t.failures}  "
            f"burst {t.burst_requests - t.burst_failures}/{t.burst_requests}  "
            f"median /status {med:.3f}s  "
            f"heap floor {t.heap_floor / 1024:.0f} KB" if t.heap_floor else
            f"{t.name}: {alive}  probes {t.probes}, failed {t.failures}")
        if t.outages:
            log(f"    {len(t.outages)} outage(s):")
            for when, secs, missed in t.outages:
                log(f"      {when}  down {secs:.0f}s, {missed} probe(s) missed, recovered unaided")
        if t.failures or not t.alive:
            failed = True
    log("RESULT: " + ("FAILURES SEEN - see above" if failed else "clean, no transport ever stopped answering"))
    logfile.close()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
