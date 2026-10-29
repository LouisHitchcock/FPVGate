# RotorHazard post-soak investigation, 25 October 2026

Status: offline causes reproduced and physical USB stock/candidate/stock checks
completed. The first-read adapter is not validated as a hardware fix and is not
promoted. The S3 firmware, default peak estimator and RH upstream source remain
unchanged. The original investigation used `fix/post-soak-timing-diagnostics`; its
source tools and diagnostic environment are now present on `V1.9.0-alpha`.

## Preserved overnight evidence

`.dev/aio-night/runs/20261025-003420` is the complete eight-hour paired run.
48 heats, 480 RF passes, four same-frequency R1 seats per receiver. AIO Alpha 5
with XIAO C5 1.2.4-rc.1 versus C5-Zero native USB 1.2.4-rc.1; RH 4.4.0 and
plugin 2.3.2-rc.1 for the AIO. Both paths have 1,920 live and 1,920 recalculated
seat records, no misses/extras in this run. This is not eight independent pilots.

AIO worst live/recalc difference 0.000500011 ms, zero seat spread. USB worst
live/recalc 1.510750 ms and seat spread 1.142850 ms. USB passed the combined
strict 1 ms guards in 9/48 heats. Identical live/history results are internal
consistency, not sub-microsecond physical RF accuracy.

Comparing the median of four seat times on each RF pass: USB minus AIO median
-4.321275 ms, mean -6.195322 ms, scatter 6.824516 ms, worst absolute 37.598475 ms.
Boards, antennas and RF coupling differ: these are not isolated transport delays.

No observed S3 reboot, C5 offline/stale samples or UART error-counter increases.
285/288 asset requests succeeded; three timeouts occurred in the initial burst.
One later health probe was reset. USB network dropped-counter delta 2,547,
deferLost and repair deltas zero. These counters do not equal lost race crossings.

## 1. Extra S3 filtering is a demonstrated software difference

`lib/C5LINK/c5multipilot.cpp` applies `(3*previous + sample)/4` before timing
peaks. The C5 native USB detector in `rh_usb.cpp` has extra smoothing disabled
by default. Same-frequency sharing does not remove this difference.

`tools/rh_timing_diagnostics.py` sends the exact same samples to builds of the
production S3 detector and production C5 USB endpoint, with matching 140/110
thresholds. S3 minus USB:

| Constructed trace | Difference |
| --- | ---: |
| Triangle | 2 ms |
| Gaussian | 2.5 ms |
| Rippled Gaussian | 3 ms |
| Narrow higher peak beside a broader slightly lower peak | 23 ms |

The last trace demonstrates a change in the winning peak, not simply constant
filter group delay. It does not establish that filtering caused all of the
overnight 37.6 ms discrepancy. Existing timing-estimator research rejected
unvalidated replacements; do not replace the estimator or subtract a constant
delay just to make the paths agree.

## 2. USB snapshot reference mismatch reproduced with real RH code

C5 `Core::latchStats()` freezes pass and history ages on command 0x0D. Command
0x0E returns the second half unchanged. RH 4.4.0 `RHInterface.update()` reads
both, then derives readtime from `io_request/io_response` of the second command.
This includes time after the actual snapshot. Separate polls can have different
offsets, so live/history timing can also disagree.

`tools/rh_usb_poll_diagnostics.py` uses the production portable USB endpoint and
unchanged RH serial client with deterministic simulated I/O delays. Control:
zero error with zero delay. Delayed stock host: worst timestamp error against
the known trace 1.686 ms, worst live/recalc 0.825 ms. First-read reference:
0.600 ms and 0.350 ms respectively. Integer-ms device ages remain quantized.
This is a model result, not an on-hardware fix or explanation of every outlier.

`tools/rh_c5_usb_clock.py` is an opt-in laboratory adapter targeting only
`c5zero`/`xiaoc5` 1.2.4 identities. Default is observation without changes.
Other firmware/RX5808 nodes are untouched; failed reads invalidate cached
references. It does not modify wire data or the firmware peak estimator.

16 new offline regression tests pass, including the real RH/production-C5 replay,
software filter differences, failed reads, opt-in behavior and non-C5 isolation.
The production portable C5 suite also passes all 382 checks.

## 3. Network issue still open

Warm-state read-only test against unchanged AIO firmware: 10 concurrent cold-cache
page loads, 90/90 assets complete, median 2.7 s and worst 2.8 s. Therefore the
overnight startup timeout has not been reproduced by this test and is not fixed.
The transmit counter combines pool/queue refusals and failed sends; do not treat
it as a direct count of unrecovered TCP bytes or lost laps. Separate these cases
before changing pool sizing or backpressure behavior.

## Physical A/B result, 25 October 2026

Receivers were reattached. The standalone C5-Zero now on COM8 (base MAC
3c:dc:75:8a:f7:24) is not the overnight COM37 unit (3c:dc:75:8a:ff:a8). It reported
1.2.3, was backed up in full to `.dev/aio-night/usb-zero/COM8-before-flash.bin`,
then flashed with all four verified published c5zero 1.2.4-rc.1 images. RH's real
serial client confirmed board/version/API 36/eight seats afterward. The AIO
remains on Alpha 5/internal XIAO C5 1.2.4-rc.1. No S3 reflash was performed.

One ten-crossing paired heat per condition, same script/seed/top=40/125:95
thresholds and stationary fixture, with HTTP asset bursts disabled:

| USB host mode | Run directory | AIO / USB race | Worst USB live/recalc | USB seat spread |
| --- | --- | --- | ---: | ---: |
| Stock before | 20261025-163304 | 67 / 61 | 1.000350 ms | 1.056650 ms |
| First-read candidate | 20261025-163716 | 68 / 62 | 1.178875 ms | 0.943050 ms |
| Stock repeat | 20261025-164116 | 69 / 63 | 0.738325 ms | 0.940350 ms |

All 30 RF passes were captured on all four seats of both paths (120 live seat
records per path), with complete saved histories, no missed/extra crossings.
The candidate did not consistently outperform stock and is NOT a proven fix.
All three heats confirmed RF off and node-setting restoration afterward. The
native USB server has been returned to stock clock behavior.

Raw I/O profiling confirmed first-read anchoring on all four corrected seats.
It also exposed that RH 4.4 copies firmware version but not board proctype onto
the extra seats of a multi-node device. The laboratory adapter now propagates
verified identity only across the exact shared Serial object. Two added tests
guard shared-seat coverage and isolation from another receiver. Initial stock
profiling covered seat 0 only; its timing behavior was stock on every seat.

The stock first/second reference gap was about 0.18 ms median in this setup;
the candidate's measured correction was about 0.17 ms median. It does not
account for the much larger cross-path outliers: the per-pass four-seat-median
worst USB/AIO differences in the three runs were 43.81, 27.51 and 13.50 ms.
Hardware/fixture effects and S3 smoothing remain to be isolated.

### Millisecond quantization counterexample

The real C5 endpoint plus real RH client now has a regression showing 1.3 ms
live/recalc disagreement with ZERO simulated I/O delay and the correct first-read
reference. A valid crossing's peak is held at device ms 2000..2003. The live
midpoint is truncated to 2001 ms, whereas history retains both endpoint ages.
History is polled at host/device phase 2050.9 ms and the later pass at 2450.1 ms.
Integer-ms ages reconstruct history midpoint 2002.4 ms versus live 2001.1 ms.
No RF noise, transport delay or dropped crossing is needed for this residual.

Consequently a universal <=1 ms live/Marshal guard is not guaranteed by this
legacy integer-age interface. Preserve all old failures; do not silently relax
the threshold or equate this observation with proven physical RF accuracy. The
earlier first-read reference mismatch is real, but it is not the entire cause.

## Previous preflight interruption and next step

An observation-only clock profiler was added to the isolated native USB RH
launcher. An earlier attempt was stopped in preflight: the AIO USB network interface
and old COM37 C5-Zero port disappeared. COM19 tester remains; stop confirmed RF
off. A newly visible COM7 was not assumed to be either receiver or flashed.
No RF passes were transmitted by the aborted attempt; overnight files remain.

That connection blocker was resolved for the A/B runs above. To isolate the
S3 smoothing/transport contribution, repeat USB and UART using
the same C5 receiver/RF path (never simultaneous ownership), or capture identical
full-rate input for both detectors. RX5808 and camera remain necessary for a
physical-line accuracy conclusion. Do not publish the candidate or mark release
qualification complete before hardware and holdout validation.

## S3 smoothing isolation bench build (2026-10-25)

With explicit permission, an application-only diagnostic build was prepared for
the attached C5MK AIO. `FPVGateC5MKAIO_EMAProbe` enables
`C5_TIMING_DIAGNOSTIC_NO_S3_EMA` and reports
`1.9.0-alpha-5-ema-probe`. Default and shipping targets retain the original EMA.
The diagnostic bypass affects the full S3 C5 detector/UI pipeline, not just RH.
It must not be packaged as a release or described as a validated accuracy fix.

Before flashing, a complete 8 MB S3 backup was captured in
`.dev/aio-night/ema-probe/AIO-before-8MB.bin`, SHA-256
`08515507069a9f260b11425b994fef59c538661ce78f4778c86f033183f8b36a`.
Its app0 bytes match the published Alpha 5 application exactly. Configuration
and system metadata were also saved. Neither C5 receiver firmware nor the S3
filesystem image is changed by this experiment. Native USB RH remains stock.

The separate diagnostic native simulator gives zero S3/USB peak-time difference
on all four identical-input fixtures (triangle, Gaussian, ripples and competing
peaks). All 17 offline regression tests pass, as does the gate race-control
native suite. This establishes software equivalence for those fixtures only;
it is not an RF/camera accuracy measurement.

The finite hardware experiment runs two ten-pass diagnostic heats, restores the
checksum-verified published Alpha 5 app, then runs a ten-pass stock repeat.
Each heat uses four same-frequency seats on each receiver, Enter 125/Exit 95,
and no concurrent asset-load bursts. Raw evidence and restore metadata are
under `.dev/aio-night/ema-probe/` and the individual timestamped run folders.

### Completed physical comparison

Cross-path figures use the median of four same-frequency seats per RF pass,
on the shared PC clock; scatter is the population standard deviation over ten
passes. The earlier stock repeat is included as a preceding control.

| S3 mode | Run | AIO / USB race | Median USB minus AIO | Scatter | Worst absolute difference |
| --- | --- | --- | --- | --- | --- |
| Stock before | 20261025-164116 | 69 / 63 | -2.163 ms | 6.008 ms | 13.499 ms |
| EMA bypass 1 | 20261025-165759 | 70 / 64 | -2.293 ms | 14.922 ms | 26.288 ms |
| EMA bypass 2 | 20261025-170038 | 71 / 65 | -0.191 ms | 11.412 ms | 29.123 ms |
| Restored stock | 20261025-170341 | 72 / 66 | -4.397 ms | 12.515 ms | 26.371 ms |

All 30 newly transmitted passes were captured on all four seats of both paths:
120 live seat records per path, all with complete recalculable saved histories,
and no missing or extra crossings. No health-probe failures, unexpected reboots,
C5 offline events or stale streams were reported in these three heats. RF-off
and node-setting restoration were confirmed after each heat.

AIO live/recalc disagreement stayed at approximately 0.000500 ms in every heat.
Native USB worst disagreement was 0.930350, 1.292450 and 1.291050 ms in the three
new heats. The existing <=1 ms guard failures remain failures; complete capture
does not mean that every timing guard passed.

Conclusion: bypassing S3 smoothing removes the difference in the identical-input
software fixtures, but does NOT consistently improve the physical receiver
comparison. The restored stock result overlaps the diagnostic results, and the
fixture's run-to-run variation is material. Do not infer camera-referenced or
RX5808-equivalent accuracy from this experiment, attribute all residuals to
smoothing, or ship the bypass as an established fix. Retain the production EMA.
The next useful isolation is full-rate identical-input replay from captured RF,
or a same-receiver USB/UART comparison with an independent timing reference.

Restoration completed: the AIO runs the published `1.9.0-alpha-5` app0 image,
SHA-256 `1c70297f128421b7728451e4c4aac36a639c0bdefec4991283d3ca4090de4e7b`.
OTA verified the upload MD5; the firmware label, board, app size and filesystem
layout were checked after reboot. Its internal XIAO C5 remains online on
`1.2.4-rc.1`. No release artifacts, public repository, tags or flasher were
updated. At the time of the experiment the diagnostic build and tests were local
and uncommitted. Their later presence in alpha source does not change the
recorded hardware measurements or make the probe a shipping target.

## Reproduce offline

Run from the FPVGate repository root. These checks require separate local
C5MK and RotorHazard source checkouts; configure their paths as below.
Do not run RF/device orchestration merely to reproduce the offline tests.

Build the S3 simulator with `tests/native/build_rh_timing_sim.sh`. Build C5 USB
from the 1.2.4-rc.1 sources using the command in `tools/rh_timing_diagnostics.py`.
Run that script for the identical-input comparison. Run
`tools/rh_usb_poll_diagnostics.py --c5-root <C5MK> --rh-root <RH>` for host timing.

Set `RH_SOURCE` to the RH checkout and `C5_SOURCE` to the C5MK checkout, then:

```text
python -m unittest discover -s tests/native -p test_post_soak_diagnostics.py -v
```

These commands do not open serial ports, transmit RF or edit an RH server.
