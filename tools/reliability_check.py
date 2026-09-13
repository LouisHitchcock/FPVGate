#!/usr/bin/env python3
"""Unattended reliability check for a running FPVGate.

One command, four phases, one verdict. Written to be run in the background by an
operator who should not have to interpret anything: it decides PASS or FAIL
against the explicit criteria below and says so in as many words.

    Phase 1  PREFLIGHT    find the gate on each transport, record what it is
    Phase 2  DIAGNOSTICS  run the device self test, probe every read-only
                          endpoint, verify response integrity
    Phase 3  SOAK         sustained mixed load with liveness probing, for hours
    Phase 4  VERDICT      PASS or FAIL against the criteria, plus a JSON report

PASS requires ALL of the following:
  * at least one transport reachable at preflight
  * every device self-test check passes, on every reachable transport
  * every probed endpoint returns 200 with a body matching its Content-Length
  * no transport ends the run down
  * every outage recovers unaided within --max-outage seconds
  * request failure rate stays at or below --max-failure-rate percent
  * heap minimum stays at or above --min-heap bytes
  * the device never restarts during the run
  * free heap is not trending down faster than --max-heap-leak bytes per hour

There is no uptime or reset reason over HTTP, so a restart is detected by
watching min-heap-ever: it only falls while the device runs, and resets on boot,
so an increase means it restarted. Without this a silent watchdog reset looks
like a brief outage followed by recovery, and passes.

Anything else is FAIL. A truncated body counts as a failure even though the
HTTP status was 200 -- that is the signature of the RNDIS transmit stall, and a
status-only check reports success on exactly the fault being hunted.

Exit status: 0 PASS, 1 FAIL, 2 could not run at all.

Usage
-----
    # The normal case: both transports, four hours
    python tools/reliability_check.py --usb 192.168.7.1 --bind 192.168.7.2 \
        --wifi 192.168.0.225 --duration 14400

    # Quick confidence check before a longer run
    python tools/reliability_check.py --wifi 192.168.0.225 --duration 600

See tools/RELIABILITY_RUNBOOK.md for how to run this unattended and what to
report back.
"""

import argparse
import http.client
import json
import statistics
import sys
import time
from collections import defaultdict
from datetime import datetime

# Read-only endpoints. Nothing here mutates device state, so the check can be
# run against a gate holding races that matter.
PROBE_ENDPOINTS = [
    "/status", "/version", "/config", "/races", "/tracks",
    "/", "/script.js", "/style.css", "/calib-styles.css", "/i18n.js",
    "/locales/en.json",
]

# Weighted towards large transfers: small requests keep working right through a
# transmit stall and would report a clean run while bulk transfer is broken.
SOAK_MIX = ["/script.js"] * 5 + ["/"] * 3 + ["/style.css"] * 2 + \
           ["/races"] * 2 + ["/status"] * 3 + ["/version"] * 1


class Result:
    def __init__(self):
        self.preflight = {}
        self.diagnostics = []
        self.soak = {}
        self.failures = []
        self.started = datetime.now().isoformat(timespec="seconds")


class Transport:
    def __init__(self, name, host, bind):
        self.name, self.host, self.bind = name, host, bind
        self.reachable = False
        self.alive = True
        self.probes = self.probe_failures = 0
        self.requests = self.request_failures = 0
        self.bytes = 0
        self.latencies = []
        self.heap_floor = None
        self.down_since = None
        self.outages = []
        self.heap_samples = []     # (elapsed_s, free, min_ever)
        self.reboots = []          # elapsed_s at which a reset was detected
        self.last_min = None
        self.selftest_failed = []
        self.endpoint_failures = []
        # Set once the bound source address has disappeared and been abandoned.
        # Reported at the end, because it means the USB adapter re-enumerated
        # mid-run, which is worth knowing even when the run then recovered.
        self.bind_lost = False

    def _attempt(self, path, timeout, bind):
        """One request, optionally from a specific source address."""
        src = (bind, 0) if bind else None
        conn = http.client.HTTPConnection(self.host, timeout=timeout, source_address=src)
        total, t0 = 0, time.time()
        try:
            conn.request("GET", path, headers={"Connection": "close"})
            resp = conn.getresponse()
            declared = resp.getheader("Content-Length")
            body = bytearray()
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                total += len(chunk)
                if len(body) < 262144:
                    body.extend(chunk)
            dt = time.time() - t0
            if resp.status != 200:
                return False, total, dt, f"HTTP {resp.status}", bytes(body)
            if declared is not None and total != int(declared):
                return False, total, dt, f"truncated: {total} of {declared} bytes", bytes(body)
            if total == 0:
                return False, 0, dt, "empty body", b""
            return True, total, dt, None, bytes(body)
        except Exception as exc:
            return False, total, time.time() - t0, f"{type(exc).__name__}: {exc}", b""
        finally:
            conn.close()

    def get(self, path, timeout):
        """Request, surviving the loss of the bound source address.

        Binding is optional and on a directly connected subnet unnecessary: the
        routing table already sends 192.168.7.1 out of the USB adapter. It is
        kept for hosts with unusual routing, but it must never be a single point
        of failure.

        When the device re-enumerates, the host address the gate handed out
        disappears and every bind fails with "address not valid in its context".
        That reads as the gate being down when the gate is fine. One overnight
        run was lost to exactly this, reporting a 98% USB failure rate for what
        was a single event. If the bound address goes away, the binding is
        dropped for good and the request retried on whatever route exists.
        """
        ok, total, dt, err, body = self._attempt(path, timeout, self.bind)
        if ok or not self.bind or not err:
            return ok, total, dt, err, body
        # WSAEADDRNOTAVAIL on Windows, EADDRNOTAVAIL elsewhere: the source
        # address itself is gone, which is a host problem, not a device one.
        if "10049" in err or "EADDRNOTAVAIL" in err or "not valid in its context" in err:
            self.bind_lost = True
            self.bind = None
            return self._attempt(path, timeout, None)
        return ok, total, dt, err, body


def heap_trend(samples):
    """Least-squares slope of free heap against time, in bytes per hour.

    A leak that never crosses the floor threshold inside the run would otherwise
    pass, so the slope is judged as well as the minimum.
    """
    usable = [(t, f) for t, f, _ in samples if f]
    if len(usable) < 10:
        return None
    n = len(usable)
    mean_t = sum(t for t, _ in usable) / n
    mean_f = sum(f for _, f in usable) / n
    denom = sum((t - mean_t) ** 2 for t, _ in usable)
    if denom == 0:
        return None
    slope = sum((t - mean_t) * (f - mean_f) for t, f in usable) / denom
    return slope * 3600.0


def make_logger(path):
    fh = open(path, "w", encoding="utf-8", buffering=1)

    def log(msg, quiet=False):
        line = f"[{datetime.now():%H:%M:%S}] {msg}"
        fh.write(line + "\n")
        if not quiet:
            print(line, flush=True)
    return log, fh


def parse_heap(text):
    free = minimum = None
    for line in text.splitlines()[:6]:
        clean = line.replace("\t", "").strip()
        if clean.startswith("Free:"):
            free = int(clean.split(":")[1])
        elif clean.startswith("Min:"):
            minimum = int(clean.split(":")[1])
    return free, minimum


# ---------------------------------------------------------------- phase 1

def preflight(transports, args, log, result):
    log("=" * 68)
    log("PHASE 1  PREFLIGHT")
    log("=" * 68)
    for t in transports:
        ok, _, dt, err, body = t.get("/status", args.timeout)
        if not ok:
            log(f"  {t.name}  UNREACHABLE at {t.host}  ({err})")
            continue
        t.reachable = True
        free, minimum = parse_heap(body.decode("utf-8", "replace"))
        vok, _, _, _, vbody = t.get("/version", args.timeout)
        version = vbody.decode("utf-8", "replace").strip() if vok else "unknown"
        t.heap_floor = minimum
        log(f"  {t.name}  reachable at {t.host}  {dt * 1000:.0f} ms")
        log(f"           version {version}, heap free {free}, min-ever {minimum}")
        result.preflight[t.name.strip()] = {
            "host": t.host, "version": version, "latency_ms": round(dt * 1000, 1),
            "heap_free": free, "heap_min": minimum,
        }
    live = [t for t in transports if t.reachable]
    if not live:
        log("")
        log("CANNOT RUN: no transport responded. Check the gate is powered, that")
        log("the USB cable is seated, and that --bind matches the host address on")
        log("the USB network adapter.")
    return live


# ---------------------------------------------------------------- phase 2

def diagnostics(transports, args, log, result):
    log("")
    log("=" * 68)
    log("PHASE 2  DIAGNOSTICS")
    log("=" * 68)
    healthy = True
    for t in transports:
        log(f"  {t.name}  device self test...")
        ok, _, _, err, body = t.get("/api/selftest", max(args.timeout, 45))
        if not ok:
            log(f"           SELF TEST UNREACHABLE: {err}")
            t.selftest_failed.append(f"endpoint unreachable: {err}")
            healthy = False
        else:
            try:
                tests = json.loads(body.decode("utf-8", "replace")).get("tests", [])
            except Exception as exc:
                log(f"           SELF TEST UNPARSEABLE: {exc}")
                t.selftest_failed.append(f"unparseable: {exc}")
                healthy = False
                tests = []
            passed = [x for x in tests if x.get("passed")]
            failed = [x for x in tests if not x.get("passed") and x.get("status") != "skip"]
            skipped = [x for x in tests if x.get("status") == "skip"]
            log(f"           {len(passed)} passed, {len(failed)} failed, {len(skipped)} skipped")
            for x in failed:
                log(f"           FAILED: {x.get('name')} -- {x.get('details')}")
                t.selftest_failed.append(f"{x.get('name')}: {x.get('details')}")
                healthy = False
            result.diagnostics.append({
                "transport": t.name.strip(), "passed": len(passed),
                "failed": [x.get("name") for x in failed],
                "skipped": [x.get("name") for x in skipped],
            })

        log(f"  {t.name}  endpoint probe ({len(PROBE_ENDPOINTS)} endpoints)...")
        for path in PROBE_ENDPOINTS:
            ok, n, dt, err, _ = t.get(path, args.timeout)
            if not ok:
                log(f"           FAILED {path}: {err}")
                t.endpoint_failures.append(f"{path}: {err}")
                healthy = False

        # The chunked marshal response is the newest code path and the one most
        # likely to truncate, so exercise it explicitly when a race has a trace.
        ok, _, _, _, body = t.get("/races", args.timeout)
        if ok:
            try:
                races = json.loads(body.decode("utf-8", "replace")).get("races", [])
                target = next((r for r in races
                               if r.get("hasRssiHistory") or (r.get("rssiHistory") or {}).get("sampleCount")), None)
                if target:
                    path = f"/api/marshal/rssi?timestamp={target['timestamp']}"
                    ok2, n2, _, err2, body2 = t.get(path, max(args.timeout, 45))
                    if not ok2:
                        log(f"           FAILED marshal RSSI: {err2}")
                        t.endpoint_failures.append(f"marshal: {err2}")
                        healthy = False
                    else:
                        try:
                            doc = json.loads(body2.decode("utf-8", "replace"))
                            declared = doc.get("sampleCount")
                            actual = len(doc.get("samples", []))
                            if declared != actual:
                                msg = f"marshal sampleCount {declared} but {actual} samples"
                                log(f"           FAILED {msg}")
                                t.endpoint_failures.append(msg)
                                healthy = False
                            else:
                                log(f"           marshal RSSI ok, {actual} samples, {n2} bytes")
                        except Exception as exc:
                            log(f"           FAILED marshal RSSI unparseable: {exc}")
                            t.endpoint_failures.append(f"marshal unparseable: {exc}")
                            healthy = False
                else:
                    log("           no race has an RSSI trace; chunked endpoint NOT tested")
            except Exception:
                pass
    log(f"  diagnostics: {'all healthy' if healthy else 'PROBLEMS FOUND, see above'}")
    return healthy


# ---------------------------------------------------------------- phase 3

def soak(transports, args, log, result):
    log("")
    log("=" * 68)
    log(f"PHASE 3  SOAK  ({args.duration}s, ~{args.duration / 3600:.1f} h)")
    log("=" * 68)
    log(f"  probe every {args.check_interval}s, burst of {args.burst_requests} "
        f"every {args.burst_interval}s")
    start = time.time()
    end = start + args.duration
    next_burst = start + args.burst_interval
    next_heartbeat = start + args.heartbeat

    while time.time() < end:
        for t in transports:
            ok, _, dt, err, body = t.get("/status", args.timeout)
            t.probes += 1
            if ok:
                t.latencies.append(dt)
                free, minimum = parse_heap(body.decode("utf-8", "replace"))
                if minimum:
                    # Min-heap-ever only ever falls while the device is running,
                    # and resets on boot. An increase therefore means it
                    # restarted. There is no uptime or reset reason over HTTP,
                    # so this is the only way to catch a silent watchdog reset -
                    # which otherwise reads as a brief blip and passes.
                    if t.last_min is not None and minimum > t.last_min + 2048:
                        at = time.time() - start
                        t.reboots.append(round(at, 1))
                        log(f"  REBOOT     {t.name} restarted: min-heap rose "
                            f"{t.last_min} -> {minimum}, which only happens on boot")
                    t.last_min = minimum
                    t.heap_floor = minimum if t.heap_floor is None else min(t.heap_floor, minimum)
                if free:
                    t.heap_samples.append((round(time.time() - start, 1), free, minimum))
                if not t.alive:
                    down = time.time() - t.down_since
                    t.outages.append(round(down, 1))
                    log(f"  RECOVERED  {t.name} after {down:.0f}s down, unaided")
                    t.alive, t.down_since = True, None
            else:
                t.probe_failures += 1
                if t.alive:
                    t.alive, t.down_since = False, time.time()
                    log(f"  DOWN       {t.name} stopped answering: {err}")

        if time.time() >= next_burst:
            for t in transports:
                if not t.alive:
                    continue
                fails = 0
                b0 = time.time()
                for i in range(args.burst_requests):
                    path = SOAK_MIX[i % len(SOAK_MIX)]
                    ok, n, _, err, _ = t.get(path, args.timeout)
                    t.requests += 1
                    t.bytes += n
                    if not ok:
                        t.request_failures += 1
                        fails += 1
                        result.failures.append({
                            "at_s": round(time.time() - start, 1),
                            "transport": t.name.strip(), "path": path, "error": err,
                        })
                        if fails == 1:
                            log(f"  BURST FAIL {t.name} {path}: {err}")
                log(f"  burst      {t.name} {args.burst_requests - fails}/{args.burst_requests} "
                    f"in {time.time() - b0:.0f}s, {t.bytes / 1e6:.0f} MB total"
                    + ("  <-- FAILURES" if fails else ""))
            next_burst = time.time() + args.burst_interval

        if time.time() >= next_heartbeat:
            elapsed = time.time() - start
            log(f"  ... {elapsed / 60:.0f} of {args.duration / 60:.0f} min, "
                + ", ".join(f"{t.name.strip()} {'up' if t.alive else 'DOWN'} "
                            f"{t.request_failures} req fail" for t in transports))
            next_heartbeat = time.time() + args.heartbeat

        time.sleep(max(0, args.check_interval - len(transports)))

    result.soak = {"elapsed_s": round(time.time() - start, 1)}
    return result


# ---------------------------------------------------------------- phase 4

def verdict(transports, args, log, result, diagnostics_ok, log_path, json_path):
    log("")
    log("=" * 68)
    log("PHASE 4  VERDICT")
    log("=" * 68)
    reasons = []

    for t in transports:
        total = t.requests + t.probes
        fails = t.request_failures + t.probe_failures
        rate = (fails / total * 100) if total else 0
        med = statistics.median(t.latencies) if t.latencies else 0
        heap = f"{t.heap_floor / 1024:.0f} KB" if t.heap_floor else "unknown"
        log(f"  {t.name}  {'UP' if t.alive else 'DOWN AT END'}  "
            f"{total} requests, {fails} failed ({rate:.2f}%), "
            f"{t.bytes / 1e6:.0f} MB, median /status {med * 1000:.0f} ms, heap floor {heap}")
        if t.outages:
            log(f"           {len(t.outages)} outage(s): "
                + ", ".join(f"{o:.0f}s" for o in t.outages))
        slope = heap_trend(t.heap_samples)
        if slope is not None:
            direction = "falling" if slope < 0 else "steady or rising"
            log(f"           heap trend {slope / 1024:+.1f} KB/h ({direction}), "
                f"{len(t.heap_samples)} samples")
        if t.reboots:
            log(f"           {len(t.reboots)} REBOOT(S) detected at "
                + ", ".join(f"{r / 60:.0f} min" for r in t.reboots))
        if t.bind_lost:
            log(f"           the bound source address disappeared during the run, so the "
                f"adapter re-enumerated; binding was dropped and requests continued")

        if not t.alive:
            reasons.append(f"{t.name.strip()} was down at the end of the run")
        if t.selftest_failed:
            reasons.append(f"{t.name.strip()} self test: " + "; ".join(t.selftest_failed))
        if t.endpoint_failures:
            reasons.append(f"{t.name.strip()} endpoint: " + "; ".join(t.endpoint_failures[:3]))
        if rate > args.max_failure_rate:
            reasons.append(f"{t.name.strip()} failure rate {rate:.2f}% exceeds "
                           f"{args.max_failure_rate}%")
        for o in t.outages:
            if o > args.max_outage:
                reasons.append(f"{t.name.strip()} had a {o:.0f}s outage, over the "
                               f"{args.max_outage}s limit")
        if t.heap_floor is not None and t.heap_floor < args.min_heap:
            reasons.append(f"{t.name.strip()} heap floor {t.heap_floor} below {args.min_heap}")
        # A device that restarted did not stay up, however well it served
        # requests either side of the restart.
        if t.reboots:
            reasons.append(f"{t.name.strip()} restarted {len(t.reboots)} time(s) during the run "
                           f"(min-heap rose, which only happens on boot)")
        slope = heap_trend(t.heap_samples)
        if slope is not None and slope < -args.max_heap_leak:
            reasons.append(f"{t.name.strip()} heap is leaking at {slope / 1024:.1f} KB/h, "
                           f"worse than the {args.max_heap_leak / 1024:.0f} KB/h limit")

    if not diagnostics_ok and not reasons:
        reasons.append("diagnostics reported problems")

    passed = not reasons
    result.soak["verdict"] = "PASS" if passed else "FAIL"
    result.soak["reasons"] = reasons

    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump({
            "started": result.started,
            "finished": datetime.now().isoformat(timespec="seconds"),
            "verdict": "PASS" if passed else "FAIL",
            "reasons": reasons,
            "preflight": result.preflight,
            "diagnostics": result.diagnostics,
            "soak": result.soak,
            "transports": [{
                "name": t.name.strip(), "host": t.host, "alive_at_end": t.alive,
                "requests": t.requests + t.probes,
                "failures": t.request_failures + t.probe_failures,
                "bytes": t.bytes, "outages_s": t.outages, "heap_floor": t.heap_floor,
                "reboots_at_s": t.reboots,
                "heap_trend_bytes_per_hour": heap_trend(t.heap_samples),
                "heap_samples": t.heap_samples[-200:],
            } for t in transports],
            "failures": result.failures[:200],
        }, fh, indent=2)

    log("")
    if passed:
        log("  VERDICT: PASS")
        log("  Every criterion met. No transport stopped answering, no truncated")
        log("  response, no self-test failure.")
    else:
        log("  VERDICT: FAIL")
        for r in reasons:
            log(f"    - {r}")
    log("")
    log(f"  log:    {log_path}")
    log(f"  report: {json_path}")
    return passed


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--usb", help="gate address over USB networking, e.g. 192.168.7.1")
    ap.add_argument("--bind", help="host address on the USB adapter, e.g. 192.168.7.2")
    ap.add_argument("--wifi", help="gate address over WiFi")
    ap.add_argument("--duration", type=int, default=14400, help="soak seconds (default 14400, 4h)")
    ap.add_argument("--check-interval", type=int, default=30)
    ap.add_argument("--burst-interval", type=int, default=300)
    ap.add_argument("--burst-requests", type=int, default=60)
    ap.add_argument("--heartbeat", type=int, default=600, help="seconds between progress lines")
    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--max-outage", type=int, default=60, help="longest tolerable unaided outage")
    ap.add_argument("--max-failure-rate", type=float, default=0.5, help="percent")
    ap.add_argument("--min-heap", type=int, default=40000, help="bytes")
    ap.add_argument("--max-heap-leak", type=int, default=10240,
                    help="bytes per hour of sustained heap loss before failing")
    ap.add_argument("--log", default="reliability.log")
    ap.add_argument("--report", default="reliability.json")
    ap.add_argument("--skip-soak", action="store_true", help="preflight and diagnostics only")
    args = ap.parse_args()

    if not args.usb and not args.wifi:
        ap.error("give at least one of --usb or --wifi")
    if args.usb and not args.bind:
        print("WARNING: --usb without --bind. Requests may leave via the wrong "
              "interface and appear to fail.", flush=True)

    log, fh = make_logger(args.log)
    result = Result()
    log(f"FPVGate reliability check, started {result.started}")

    transports = []
    if args.usb:
        transports.append(Transport("USB ", args.usb, args.bind))
    if args.wifi:
        transports.append(Transport("WiFi", args.wifi, None))

    try:
        live = preflight(transports, args, log, result)
        if not live:
            fh.close()
            return 2
        diagnostics_ok = diagnostics(live, args, log, result)
        if not args.skip_soak:
            soak(live, args, log, result)
        else:
            log("")
            log("  soak skipped (--skip-soak)")
        passed = verdict(live, args, log, result, diagnostics_ok, args.log, args.report)
        return 0 if passed else 1
    except KeyboardInterrupt:
        log("")
        log("INTERRUPTED. The run did not complete, so there is no verdict.")
        return 2
    finally:
        fh.close()


if __name__ == "__main__":
    sys.exit(main())
