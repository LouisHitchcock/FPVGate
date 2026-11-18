#!/usr/bin/env python3
"""Record and compare FPVGate C5 timing telemetry.

Live collection uses the existing /events SSE stream.  It does not require
flight-controller changes: run it while the C5 is scanning, and run it during
repeatable gate passes when lap consistency is being measured.

Examples (PowerShell):
  python tools/c5_timing_validation.py --host 192.168.0.201 --seconds 120 --output new.json
  python tools/c5_timing_validation.py --compare old.json new.json
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    pos = (len(ordered) - 1) * p
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


def summarize(record: dict) -> dict:
    rssi_events = [e for e in record["events"] if e["type"] == "c5Rssi"]
    lap_events = [e for e in record["events"] if e["type"] == "c5Lap"]
    if not rssi_events:
        return {"rssiEvents": 0, "lapEvents": len(lap_events)}

    first = rssi_events[0]["data"]
    last = rssi_events[-1]["data"]
    elapsed = max(rssi_events[-1]["t"] - rssi_events[0]["t"], 1e-9)
    samples = int(last.get("samples", 0)) - int(first.get("samples", 0))
    gaps = int(last.get("seqGaps", 0)) - int(first.get("seqGaps", 0))
    drops = int(last.get("queueDrops", 0)) - int(first.get("queueDrops", 0))
    event_intervals = [b["t"] - a["t"] for a, b in zip(rssi_events, rssi_events[1:])]
    rssis = [int(v) for e in rssi_events for v in e["data"].get("rssi", [])]
    values = sorted(set(rssis))
    steps = [b - a for a, b in zip(values, values[1:]) if b > a]
    laps = [float(e["data"]["lapTimeMs"]) for e in lap_events if "lapTimeMs" in e["data"]]
    pilots = sum(1 for f in last.get("freq", []) if int(f)) or 1
    bad_records = int(last.get("badRecords", 0)) - int(first.get("badRecords", 0))

    return {
        "rssiEvents": len(rssi_events),
        "rssiEventRateHz": len(rssi_events) / elapsed,
        "acceptedSamples": samples,
        "acceptedSampleRateHz": samples / elapsed,
        "pilots": pilots,
        "perPilotSampleRateHz": samples / elapsed / pilots,
        "scanMode": bool(last.get("scan", False)),
        "badRecords": bad_records,
        "sequenceGaps": gaps,
        "queueDrops": drops,
        "onlineFraction": sum(bool(e["data"].get("on")) for e in rssi_events) / len(rssi_events),
        "readyFraction": sum(bool(e["data"].get("ready")) for e in rssi_events) / len(rssi_events),
        "refreshIntervalMs": {
            "median": statistics.median(event_intervals) * 1000 if event_intervals else None,
            "p95": percentile(event_intervals, 0.95) * 1000,
            "max": max(event_intervals) * 1000 if event_intervals else None,
        },
        "rssiUniqueValues": len(values),
        "smallestRssiStep": min(steps) if steps else None,
        "lapCount": len(laps),
        "lapMedianMs": statistics.median(laps) if laps else None,
        "lapStddevMs": statistics.stdev(laps) if len(laps) > 1 else None,
        "lapP95Ms": percentile(laps, 0.95),
    }


def collect(host: str, seconds: float) -> dict:
    url = f"http://{host}/events"
    request = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    events = []
    started = time.monotonic()
    event_type = None
    print(f"Listening to {url} for {seconds:.1f}s...")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            while time.monotonic() - started < seconds:
                raw = response.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                elif line.startswith("data:") and event_type in ("c5Rssi", "c5Lap"):
                    try:
                        data = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    events.append({"t": time.monotonic() - started, "type": event_type, "data": data})
                elif not line:
                    event_type = None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SystemExit(f"SSE connection failed: {exc}") from exc

    record = {
        "format": 1,
        "host": host,
        "startedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "durationSeconds": seconds,
        "events": events,
    }
    record["summary"] = summarize(record)
    return record


def print_summary(path: str, record: dict) -> None:
    print(f"\n{path}")
    for key, value in record["summary"].items():
        print(f"  {key}: {value}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="192.168.0.201")
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--compare", nargs=2, metavar=("BASELINE", "CANDIDATE"))
    args = parser.parse_args()

    if args.compare:
        baseline = json.loads(Path(args.compare[0]).read_text(encoding="utf-8"))
        candidate = json.loads(Path(args.compare[1]).read_text(encoding="utf-8"))
        print_summary(args.compare[0], baseline)
        print_summary(args.compare[1], candidate)
        print("\nCandidate - baseline")
        for key, old in baseline["summary"].items():
            new = candidate["summary"].get(key)
            if isinstance(old, (int, float)) and isinstance(new, (int, float)):
                print(f"  {key}: {new - old:+.3f}")
        return

    record = collect(args.host, args.seconds)
    print_summary("live", record)
    if args.output:
        args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        print(f"\nSaved {args.output}")


if __name__ == "__main__":
    main()
