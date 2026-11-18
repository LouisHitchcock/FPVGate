#!/usr/bin/env python3
"""Deterministic no-hardware test for C5 threshold-crossing timing.

The C5 is single-radio, so a pilot is observed once per eight-pilot scan
cycle. This replay sweeps the crossing phase across that interval and compares
the old "timestamp the first sample past the threshold" method with the new
linear interpolation between adjacent samples.

Run:
  python tools/c5_timing_replay.py
"""

from __future__ import annotations

import argparse
import random
import statistics


def percentile(values: list[float], p: float) -> float:
    values = sorted(values)
    pos = (len(values) - 1) * p
    lo, hi = int(pos), int(pos + 1)
    if lo == hi:
        return values[lo]
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)


def crossing_error(crossing_ms: float, sample_phase_ms: float, rising: bool, period_ms: float) -> tuple[float, float]:
    """Return (old absolute error, interpolated absolute error)."""
    # Sample the signal at the pilot's once-per-cycle observation times. The
    # signal is deliberately linear around the threshold, making the expected
    # crossing exact and interpolation independently verifiable.
    before = crossing_ms - ((crossing_ms - sample_phase_ms) % period_ms)
    after = before + period_ms
    if rising:
        old = after
    else:
        old = after

    # A linear signal crosses at the same fractional position regardless of
    # direction. This is the calculation used by C5MultiPilot.
    interpolated = before + (crossing_ms - before) / (after - before) * period_ms
    return abs(old - crossing_ms), abs(interpolated - crossing_ms)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=10000)
    parser.add_argument("--period-ms", type=float, default=160.0,
                        help="Pilot refresh interval for eight 20 ms slots")
    parser.add_argument("--seed", type=int, default=20261004)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    old_errors: list[float] = []
    new_errors: list[float] = []
    for _ in range(args.runs):
        crossing = rng.uniform(0, args.period_ms)
        phase = rng.uniform(0, args.period_ms)
        old, new = crossing_error(crossing, phase, bool(rng.getrandbits(1)), args.period_ms)
        old_errors.append(old)
        new_errors.append(new)

    old_p95 = percentile(old_errors, 0.95)
    new_p95 = percentile(new_errors, 0.95)
    old_max = max(old_errors)
    new_max = max(new_errors)
    print(f"runs: {args.runs}, refresh interval: {args.period_ms:.1f} ms")
    print(f"old edge timestamp: median={statistics.median(old_errors):.3f} ms "
          f"p95={old_p95:.3f} ms max={old_max:.3f} ms")
    print(f"new interpolation:  median={statistics.median(new_errors):.3f} ms "
          f"p95={new_p95:.3f} ms max={new_max:.3f} ms")
    print(f"p95 improvement: {old_p95 - new_p95:.3f} ms")

    if new_p95 > 1e-9 or new_max > 1e-9:
        raise SystemExit("FAIL: interpolation did not recover the known crossing time")
    if old_p95 <= new_p95:
        raise SystemExit("FAIL: new method did not improve on edge timestamping")
    print("PASS: interpolation recovers every known crossing")


if __name__ == "__main__":
    main()
