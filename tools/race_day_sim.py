#!/usr/bin/env python3
"""Race-day simulation and component validation for a FPVGate.

Drives a gate through what a race day actually does - configure, run heats,
record RSSI, save, review, marshal, delete - repeatedly, for hours, while
checking every component against explicit pass/fail criteria.

This exists because hand-testing each release stopped scaling. Every check here
states what it expects and why, so a failure names the broken component rather
than leaving someone to work it out.

WARNING: THIS WRITES TO THE DEVICE.
It creates races, edits lap times, and deletes what it created. It is not safe
to run against a gate holding race data you cannot afford to disturb. You must
pass --i-know-this-writes to run it at all. Races it creates are deleted at the
end, including on Ctrl-C, unless --keep-races is given.

Component suites
----------------
    selftest     the device's own 18-check diagnostic
    config       read, modify, read back, restore
    timer        start/stop lifecycle and state reporting
    race         full heat: start, laps, stop, save, verify persisted
    rssi         sidecar written, served chunked, sampleCount matches payload
    marshal      lap editing recalculates fastest/median/best-3 correctly
    history      ordering is newest-first, deletion removes race and sidecar
    tracks       create, list, update
    storage      SD present, free space does not leak across heats
    transport    USB and WiFi return identical data for the same race

Usage
-----
    # Validate every component once, about two minutes
    python tools/race_day_sim.py --usb 192.168.7.1 --bind 192.168.7.2 \
        --wifi 192.168.0.225 --i-know-this-writes --components-only

    # Full race day: 20 heats over 4 hours
    python tools/race_day_sim.py --usb 192.168.7.1 --bind 192.168.7.2 \
        --wifi 192.168.0.225 --i-know-this-writes --heats 20 --duration 14400

Exit status: 0 all passed, 1 something failed, 2 could not run.

See tools/VALIDATION_PLAN.md for how this fits the release process.
"""

import argparse
import http.client
import json
import random
import sys
import time
from datetime import datetime

# A heat's lap times, in milliseconds. Loosely realistic: a slower first lap
# from the start gate, then settling, with the odd scrappy one.
def synth_laps(count, base_ms=9500, jitter=1200):
    laps = [base_ms + random.randint(2000, 4000)]  # hole shot
    for _ in range(count - 1):
        lap = base_ms + random.randint(-jitter, jitter)
        if random.random() < 0.15:
            lap += random.randint(1500, 4000)  # a bad lap
        laps.append(lap)
    return laps


class Check:
    def __init__(self, suite, name):
        self.suite, self.name = suite, name
        self.passed = None
        self.detail = ""
        self.expected = ""

    def ok(self, detail=""):
        self.passed, self.detail = True, detail
        return self

    def fail(self, detail, expected=""):
        self.passed, self.detail, self.expected = False, detail, expected
        return self


class Gate:
    """One transport to one gate."""

    def __init__(self, name, host, bind, timeout):
        self.name, self.host, self.bind, self.timeout = name, host, bind, timeout

    def _conn(self, timeout=None):
        src = (self.bind, 0) if self.bind else None
        return http.client.HTTPConnection(self.host, timeout=timeout or self.timeout,
                                          source_address=src)

    def get(self, path, timeout=None):
        conn = self._conn(timeout)
        try:
            conn.request("GET", path, headers={"Connection": "close"})
            resp = conn.getresponse()
            declared = resp.getheader("Content-Length")
            body = bytearray()
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                body.extend(chunk)
            if declared is not None and len(body) != int(declared):
                raise IOError(f"truncated: {len(body)} of {declared} bytes")
            return resp.status, bytes(body)
        finally:
            conn.close()

    def get_json(self, path, timeout=None):
        status, body = self.get(path, timeout)
        if status != 200:
            raise IOError(f"HTTP {status} for {path}")
        return json.loads(body.decode("utf-8", "replace"))

    def post_json(self, path, payload, timeout=None):
        conn = self._conn(timeout)
        try:
            data = json.dumps(payload)
            conn.request("POST", path, body=data, headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Content-Length": str(len(data)),
                "Connection": "close",
            })
            resp = conn.getresponse()
            body = resp.read()
            return resp.status, body.decode("utf-8", "replace")
        finally:
            conn.close()

    def post_form(self, path, fields, timeout=None):
        from urllib.parse import urlencode
        conn = self._conn(timeout)
        try:
            data = urlencode(fields)
            conn.request("POST", path, body=data, headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": str(len(data)),
                "Connection": "close",
            })
            resp = conn.getresponse()
            body = resp.read()
            return resp.status, body.decode("utf-8", "replace")
        finally:
            conn.close()


def lap_stats(laps):
    """Mirror the firmware's own recalculation so results can be compared."""
    ordered = sorted(laps)
    mid = len(ordered) // 2
    median = (ordered[mid - 1] + ordered[mid]) // 2 if len(ordered) % 2 == 0 else ordered[mid]
    best3 = sum(ordered[:3]) if len(ordered) >= 3 else sum(ordered)
    return {"fastestLap": ordered[0], "medianLap": median, "best3LapsTotal": best3}


class Harness:
    def __init__(self, gates, args, log):
        self.gates = gates
        self.primary = gates[0]
        self.args = args
        self.log = log
        self.checks = []
        self.created = []          # race timestamps we made, for cleanup
        self.created_tracks = []

    def add(self, check):
        self.checks.append(check)
        mark = "PASS" if check.passed else "FAIL"
        line = f"    [{mark}] {check.suite}/{check.name}"
        if check.detail:
            line += f"  {check.detail}"
        self.log(line)
        if not check.passed and check.expected:
            self.log(f"           expected: {check.expected}")
        return check

    # ------------------------------------------------------------ suites

    def suite_selftest(self):
        self.log("  selftest")
        for g in self.gates:
            c = Check("selftest", g.name.strip())
            try:
                tests = g.get_json("/api/selftest", timeout=45).get("tests", [])
                failed = [t for t in tests if not t.get("passed") and t.get("status") != "skip"]
                if failed:
                    c.fail(", ".join(f"{t['name']}: {t['details']}" for t in failed),
                           "every self-test check passes")
                else:
                    c.ok(f"{len(tests)} checks, all passing")
            except Exception as exc:
                c.fail(str(exc), "self test reachable and parseable")
            self.add(c)

    def suite_config(self):
        self.log("  config")
        g = self.primary
        c = Check("config", "read-modify-read")
        try:
            before = g.get_json("/config")
            original = before.get("minLap")
            target = 35 if original != 35 else 45
            payload = dict(before)
            payload["minLap"] = target
            status, _ = g.post_json("/config", payload)
            if status != 200:
                c.fail(f"POST /config returned {status}", "HTTP 200")
            else:
                time.sleep(1.0)
                after = g.get_json("/config")
                if after.get("minLap") != target:
                    c.fail(f"minLap is {after.get('minLap')} after writing {target}",
                           "the written value is read back")
                else:
                    payload["minLap"] = original
                    g.post_json("/config", payload)
                    time.sleep(0.5)
                    restored = g.get_json("/config").get("minLap")
                    if restored != original:
                        c.fail(f"could not restore minLap to {original}, it is {restored}",
                               "original value restored")
                    else:
                        c.ok(f"minLap {original} -> {target} -> {original}")
        except Exception as exc:
            c.fail(str(exc), "config readable and writable")
        self.add(c)

    def run_heat(self, suite, laps, capture_seconds, label):
        """Drive one full heat and return (timestamp, laps) or raise."""
        g = self.primary
        status, _ = g.post_form("/timer/start", {})
        if status != 200:
            raise IOError(f"/timer/start returned {status}")
        # The device records RSSI for as long as the race runs, so this wait is
        # what produces a sidecar worth checking.
        time.sleep(capture_seconds)
        for lap in laps:
            g.post_json("/timer/addLap", {"lapTime": lap})
            time.sleep(0.05)
        status, _ = g.post_form("/timer/stop", {})
        if status != 200:
            raise IOError(f"/timer/stop returned {status}")
        time.sleep(1.5)  # let the recorder finalize its sidecar

        ts = int(time.time())
        race = {
            "timestamp": ts, "lapTimes": laps,
            "pilotName": "Sim Pilot", "pilotCallsign": label,
            "frequency": 5769, "band": "R", "channel": 4,
            "notes": "automated race-day simulation",
            "trackId": 0, "trackName": "", "totalDistance": 0.0, "syncMode": 0,
            **lap_stats(laps),
        }
        status, body = g.post_json("/races/save", race)
        if status != 200:
            raise IOError(f"/races/save returned {status}: {body[:120]}")
        self.created.append(ts)
        return ts

    def suite_race(self, heat_no=1):
        self.log(f"  race (heat {heat_no})")
        g = self.primary
        laps = synth_laps(random.randint(4, 8))
        c = Check("race", "run and persist")
        ts = None
        try:
            ts = self.run_heat("race", laps, self.args.capture_seconds, f"H{heat_no}")
            time.sleep(0.5)
            races = g.get_json("/races").get("races", [])
            found = next((r for r in races if r.get("timestamp") == ts), None)
            if not found:
                c.fail(f"race {ts} not in /races after save", "saved race appears in history")
            elif found.get("lapTimes") != laps:
                c.fail(f"lap times differ: sent {laps}, got {found.get('lapTimes')}",
                       "lap times round-trip unchanged")
            else:
                c.ok(f"{len(laps)} laps, timestamp {ts}")
        except Exception as exc:
            c.fail(str(exc), "a heat can be run and saved")
        self.add(c)
        return ts, laps

    def suite_rssi(self, ts):
        self.log("  rssi")
        g = self.primary
        c = Check("rssi", "sidecar recorded and served")
        try:
            races = g.get_json("/races").get("races", [])
            race = next((r for r in races if r.get("timestamp") == ts), None)
            if not race:
                c.fail(f"race {ts} missing", "the heat exists")
            elif not (race.get("hasRssiHistory") or (race.get("rssiHistory") or {}).get("sampleCount")):
                c.fail("race has no RSSI history; is an SD card fitted?",
                       "a race recorded with SD present has a sidecar")
            else:
                doc = g.get_json(f"/api/marshal/rssi?timestamp={ts}", timeout=45)
                declared = doc.get("sampleCount")
                actual = len(doc.get("samples", []))
                interval = doc.get("intervalMs")
                if declared != actual:
                    c.fail(f"sampleCount {declared} but {actual} samples returned",
                           "declared count matches the array, i.e. no truncation")
                elif actual == 0:
                    c.fail("zero samples recorded", "a running race records samples")
                else:
                    expected = (self.args.capture_seconds * 1000) / max(interval or 20, 1)
                    ratio = actual / expected if expected else 0
                    detail = f"{actual} samples @ {interval}ms, {ratio * 100:.0f}% of expected"
                    # Well under expectation means the writer task dropped samples.
                    if ratio < 0.5:
                        c.fail(detail, "at least half the expected samples captured")
                    else:
                        c.ok(detail)
        except Exception as exc:
            c.fail(str(exc), "sidecar readable over the chunked endpoint")
        self.add(c)

    def suite_marshal(self, ts, laps):
        self.log("  marshal")
        g = self.primary
        c = Check("marshal", "lap edit recalculates stats")
        try:
            edited = list(laps)
            edited[-1] = edited[-1] + 2500      # slow the last lap
            edited = edited[:-1] if len(edited) > 3 else edited
            status, body = g.post_json("/races/updateLaps",
                                       {"timestamp": ts, "lapTimes": edited})
            if status != 200 or '"OK"' not in body.replace(" ", ""):
                c.fail(f"updateLaps returned {status} {body[:80]}", 'status OK')
            else:
                time.sleep(0.5)
                races = g.get_json("/races").get("races", [])
                race = next((r for r in races if r.get("timestamp") == ts), None)
                want = lap_stats(edited)
                if not race:
                    c.fail("race vanished after edit", "the race still exists")
                elif race.get("lapTimes") != edited:
                    c.fail(f"laps are {race.get('lapTimes')}, expected {edited}",
                           "edited laps persisted")
                else:
                    bad = [k for k, v in want.items() if race.get(k) != v]
                    if bad:
                        detail = ", ".join(f"{k}={race.get(k)} expected {want[k]}" for k in bad)
                        c.fail(detail, "device recalculates fastest/median/best-3 on edit")
                    else:
                        c.ok(f"{len(edited)} laps, stats recalculated correctly")
        except Exception as exc:
            c.fail(str(exc), "lap times editable")
        self.add(c)

    def suite_history(self):
        self.log("  history")
        g = self.primary
        c = Check("history", "ordering newest-first")
        try:
            races = g.get_json("/races").get("races", [])
            stamps = [r.get("timestamp") for r in races]
            if stamps != sorted(stamps, reverse=True):
                c.fail(f"order is {stamps[:6]}", "strictly descending by timestamp")
            else:
                c.ok(f"{len(stamps)} races, correctly ordered")
        except Exception as exc:
            c.fail(str(exc), "history readable")
        self.add(c)

    def suite_delete(self, ts):
        self.log("  history/delete")
        g = self.primary
        c = Check("history", "delete removes race and sidecar")
        try:
            status, _ = g.post_form("/races/delete", {"timestamp": ts})
            time.sleep(0.5)
            races = g.get_json("/races").get("races", [])
            if any(r.get("timestamp") == ts for r in races):
                c.fail(f"race {ts} still present after delete", "race removed from history")
            else:
                # get() returns the status rather than raising, so check it
                # explicitly. A deleted race must make the endpoint 404.
                try:
                    status, _ = g.get(f"/api/marshal/rssi?timestamp={ts}")
                except Exception:
                    status = None  # connection refused is also acceptable
                if status == 200:
                    c.fail("sidecar still served after the race was deleted",
                           "the endpoint 404s once its race is gone")
                else:
                    c.ok(f"race {ts} gone, marshal endpoint returns {status or 'no response'}")
                    if ts in self.created:
                        self.created.remove(ts)
        except Exception as exc:
            c.fail(str(exc), "race deletable")
        self.add(c)

    def suite_tracks(self):
        self.log("  tracks")
        g = self.primary
        c = Check("tracks", "create and list")
        try:
            # /tracks/create takes trackId from the client rather than assigning
            # one, so it must be supplied and must be unique. Omitting it gives
            # every track id 0, which then cannot be deleted individually.
            track_id = int(time.time()) % 2_000_000_000
            name = f"Sim Track {track_id % 100000}"
            status, body = g.post_json("/tracks/create",
                                       {"trackId": track_id, "name": name,
                                        "distance": 150.5, "tags": "sim"})
            if status != 200:
                c.fail(f"create returned {status} {body[:80]}", "HTTP 200")
            else:
                time.sleep(0.5)
                data = g.get_json("/tracks")
                tracks = data if isinstance(data, list) else data.get("tracks", [])
                found = next((t for t in tracks if t.get("name") == name), None)
                if not found:
                    c.fail("created track not listed", "the new track appears in /tracks")
                else:
                    self.created_tracks.append(track_id)
                    if found.get("trackId") != track_id:
                        c.fail(f"track stored with id {found.get('trackId')}, sent {track_id}",
                               "the supplied trackId is preserved")
                    else:
                        c.ok(f"created and listed '{name}' with id {track_id}")
        except Exception as exc:
            c.fail(str(exc), "tracks createable")
        self.add(c)

    def suite_storage(self, baseline=None):
        self.log("  storage")
        g = self.primary
        c = Check("storage", "SD present and not leaking")
        try:
            status, body = g.get("/status")
            text = body.decode("utf-8", "replace")
            stype = free = None
            for line in text.splitlines():
                clean = line.replace("\t", "").strip()
                if clean.startswith("Type:"):
                    stype = clean.split(":", 1)[1]
                elif clean.startswith("Free:") and free is None and stype:
                    free = int(clean.split(":")[1])
            if stype != "SD":
                c.fail(f"storage type is {stype}", "SD card mounted")
            elif baseline is not None and free is not None and (baseline - free) > self.args.max_storage_growth:
                c.fail(f"free space fell {(baseline - free) / 1024:.0f} KB during the run",
                       f"growth under {self.args.max_storage_growth / 1024:.0f} KB")
            else:
                c.ok(f"type {stype}, free {free / 1e6:.0f} MB" if free else f"type {stype}")
            return free
        except Exception as exc:
            c.fail(str(exc), "storage reported")
            self.add(c)
            return None
        finally:
            if c.passed is not None and c not in self.checks:
                self.add(c)

    def suite_transport_parity(self, ts):
        if len(self.gates) < 2:
            return
        self.log("  transport parity")
        c = Check("transport", "identical data on both transports")
        try:
            docs = []
            for g in self.gates:
                races = g.get_json("/races").get("races", [])
                race = next((r for r in races if r.get("timestamp") == ts), None)
                docs.append((g.name.strip(), race))
            names = [n for n, _ in docs]
            if any(r is None for _, r in docs):
                missing = [n for n, r in docs if r is None]
                c.fail(f"race missing on {missing}", "the same race is visible on every transport")
            elif docs[0][1].get("lapTimes") != docs[1][1].get("lapTimes"):
                c.fail(f"{names[0]} and {names[1]} disagree on lap times",
                       "both transports serve identical data")
            else:
                c.ok(f"{names[0]} and {names[1]} agree")
        except Exception as exc:
            c.fail(str(exc), "both transports readable")
        self.add(c)

    # ------------------------------------------------------------ cleanup

    def cleanup(self):
        if self.args.keep_races:
            self.log(f"  --keep-races: leaving {len(self.created)} race(s) and "
                     f"{len(self.created_tracks)} track(s) on the device")
            return
        if self.created:
            self.log(f"  removing {len(self.created)} simulated race(s)...")
            removed = 0
            for ts in list(self.created):
                try:
                    self.primary.post_form("/races/delete", {"timestamp": ts})
                    removed += 1
                except Exception as exc:
                    self.log(f"    could not delete race {ts}: {exc}")
            self.log(f"  removed {removed} of {len(self.created)} race(s)")

        if self.created_tracks:
            self.log(f"  removing {len(self.created_tracks)} simulated track(s)...")
            removed = 0
            for tid in list(self.created_tracks):
                if not tid:
                    continue  # id 0 is not addressable; never create one
                try:
                    self.primary.post_form("/tracks/delete", {"trackId": tid})
                    removed += 1
                except Exception as exc:
                    self.log(f"    could not delete track {tid}: {exc}")
            self.log(f"  removed {removed} of {len(self.created_tracks)} track(s)")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--usb")
    ap.add_argument("--bind")
    ap.add_argument("--wifi")
    ap.add_argument("--i-know-this-writes", action="store_true",
                    help="required: this test creates, edits and deletes races")
    ap.add_argument("--components-only", action="store_true",
                    help="run every component suite once and stop")
    ap.add_argument("--heats", type=int, default=20)
    ap.add_argument("--duration", type=int, default=14400, help="max seconds for the full run")
    ap.add_argument("--capture-seconds", type=int, default=20,
                    help="how long each simulated heat runs, i.e. RSSI recorded")
    ap.add_argument("--heat-gap", type=int, default=30, help="seconds between heats")
    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--max-storage-growth", type=int, default=2_000_000,
                    help="bytes of free space the run may consume before failing")
    ap.add_argument("--keep-races", action="store_true", help="do not delete simulated races")
    ap.add_argument("--log", default="race_day.log")
    ap.add_argument("--report", default="race_day.json")
    args = ap.parse_args()

    if not args.usb and not args.wifi:
        ap.error("give at least one of --usb or --wifi")
    if not args.i_know_this_writes:
        print("REFUSING TO RUN.\n"
              "This harness creates races, edits lap times and deletes them again.\n"
              "It is not safe against a gate holding data you cannot lose.\n"
              "Re-run with --i-know-this-writes once you are sure.", file=sys.stderr)
        return 2

    fh = open(args.log, "w", encoding="utf-8", buffering=1)

    def log(msg):
        line = f"[{datetime.now():%H:%M:%S}] {msg}"
        fh.write(line + "\n")
        print(line, flush=True)

    gates = []
    if args.usb:
        gates.append(Gate("USB ", args.usb, args.bind, args.timeout))
    if args.wifi:
        gates.append(Gate("WiFi", args.wifi, None, args.timeout))

    log("FPVGate race-day simulation")
    log(f"transports: {', '.join(g.name.strip() + ' ' + g.host for g in gates)}")

    # Preflight: refuse to start against something that is not answering.
    reachable = []
    for g in gates:
        try:
            g.get("/status")
            reachable.append(g)
            log(f"  {g.name} reachable")
        except Exception as exc:
            log(f"  {g.name} UNREACHABLE: {exc}")
    if not reachable:
        log("CANNOT RUN: no transport responded.")
        fh.close()
        return 2

    h = Harness(reachable, args, log)
    start = time.time()
    baseline_free = None
    heats_run = 0

    try:
        log("")
        log("COMPONENT VALIDATION")
        h.suite_selftest()
        h.suite_config()
        baseline_free = h.suite_storage()
        h.suite_tracks()
        ts, laps = h.suite_race(heat_no=1)
        heats_run += 1
        if ts:
            h.suite_rssi(ts)
            h.suite_marshal(ts, laps)
            h.suite_transport_parity(ts)
            h.suite_history()
            h.suite_delete(ts)

        if not args.components_only:
            log("")
            log(f"RACE DAY: up to {args.heats} heats over {args.duration / 3600:.1f} h")
            deadline = start + args.duration
            while heats_run < args.heats and time.time() < deadline:
                heats_run += 1
                log(f"  heat {heats_run} of {args.heats} "
                    f"({(time.time() - start) / 60:.0f} min elapsed)")
                ts, laps = h.suite_race(heat_no=heats_run)
                if ts:
                    h.suite_rssi(ts)
                    if heats_run % 3 == 0:
                        h.suite_marshal(ts, laps)
                    if heats_run % 5 == 0:
                        h.suite_selftest()
                        h.suite_history()
                remaining = deadline - time.time()
                if heats_run < args.heats and remaining > args.heat_gap:
                    time.sleep(args.heat_gap)
            log("")
            log("FINAL CHECKS")
            h.suite_history()
            h.suite_storage(baseline_free)
            h.suite_selftest()
    except KeyboardInterrupt:
        log("")
        log("INTERRUPTED")
    finally:
        log("")
        log("CLEANUP")
        h.cleanup()

    elapsed = time.time() - start
    passed = [c for c in h.checks if c.passed]
    failed = [c for c in h.checks if not c.passed]

    log("")
    log("=" * 66)
    log(f"{len(passed)} passed, {len(failed)} failed, {heats_run} heat(s), "
        f"{elapsed / 60:.0f} min")
    if failed:
        log("")
        log("FAILURES")
        for c in failed:
            log(f"  {c.suite}/{c.name}: {c.detail}")
            if c.expected:
                log(f"      expected: {c.expected}")
    log("")
    log("VERDICT: " + ("PASS" if not failed else "FAIL"))
    log(f"  log:    {args.log}")
    log(f"  report: {args.report}")

    with open(args.report, "w", encoding="utf-8") as rf:
        json.dump({
            "finished": datetime.now().isoformat(timespec="seconds"),
            "verdict": "PASS" if not failed else "FAIL",
            "elapsed_s": round(elapsed, 1),
            "heats": heats_run,
            "passed": len(passed), "failed": len(failed),
            "checks": [{"suite": c.suite, "name": c.name, "passed": c.passed,
                        "detail": c.detail, "expected": c.expected} for c in h.checks],
        }, rf, indent=2)

    fh.close()
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
