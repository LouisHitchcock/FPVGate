# C5 Multi-Pilot Handoff

Updated: 2026-10-05

## 2026-10-05 research: path to 1 kHz per pilot

Goal: match RotorHazard's ~1 kHz RSSI rate **per pilot**, continuously.

Where we are: the ~930 Hz below is the total over all eight pilots. Each
pilot gets one 16 ms slot every 128 ms: ~116 samples/s, delivered as ~14
samples then ~112 ms blind. Slot tuning cannot fix that. 1 kHz for eight
pilots needs one pilot visit (hop + dump + maths) every 125 us.

C5 bench measurements (`timer`, VTX off):

| Stage | n=2048 | n=512 | n=256 |
|---|---|---|---|
| Stock PLL hop | 398 us | 398 | 398 |
| Direct dump | 55 | 16 | 10 |
| Meter | 422 | 117 | 66 |

Hop finding (disassembly of Apache-2.0 libphy, esp32c5):
`phy_set_rf_freq_offset` -> `phy_set_rfpll_freq` (PLL I2C writes, then a
tail-call `ets_delay_us(300)`) -> `phy_ckgen_5g_cal` (3 I2C writes +
`ets_delay_us(20)`) -> `phy_freq_mem_change_5g_`. All steps are exported.
`radio::hopNoWait()` makes the same calls minus the 300 us wait: 103 us, or
68 us also skipping ckgen_5g and freq_mem (skip mask 3).

VTX bursts on R1 (5658):

- `hopprof`: dumps 0-300 us after `hopNoWait` (either variant) read within
  ~0.2 dB of steady state. The PLL is settled when the call returns.
- `hopspikes` (500 dumps each, carrier on): readings 12-25 dB high, no
  clipping, gain field unchanged: no hop 0, stock hop 4, hopNoWait 10,
  hopNoWait skip 3: 4. With the VTX off: 0 in all modes. The spikes come from
  hopping in general, not from removing the wait; the median-of-3 hides
  them. Cause unknown: save a raw spike capture to find it.
- `bandshape`: passband flat to +-15 MHz, -1.3 dB at +-18.5, -3 dB at ~+-21,
  ~-10 dB by +-25. Image rejection only ~18 dB at gain 30. Two pilots per
  dump (LO between a Raceband pair) would put each pilot's image on the
  other at only -17 dB: not viable without digital IQ-imbalance correction.

Budget with the proven hop: 68 + 10 + 66 us (n=256) = ~144 us -> ~870 Hz per
pilot; a single-pass meter (~25-35 us) gives ~1.1-1.2 kHz.

Planned order:

1. C5 runs the scan itself: the S3 sends the pilot list once; no F/OK
   handshake per slot.
2. Binary, batched UART records with C5 dump timestamps (ASCII R lines at
   8k samples/s need ~112 KB/s, over 921600 baud's ~92 KB/s); consider 2 Mbaud.
   The S3 maps the C5 clock to its own instead of stamping on parse.
3. `hopNoWait` (skip 3) in the scan; keep the median-of-3.
4. n=256 and a single-pass, non-volatile meter.
5. Later/optional: IQ-imbalance correction, then two pilots per dump.

The research commands (`hopprof`, `hopspikes`, `bandshape`, `hopNoWait`)
are in the C5 working tree, flashed, not yet committed.

## Current project state

- FPVGate repository: `C:\Users\Louis\Desktop\Code\FPVGate`
- Branch: `Multi-Pilot-Next-Gen`
- C5 repository: `C:\Users\Louis\Desktop\Code\FPVGateC5RX-mp`
- C5 branch: `feature/multipilot-dump`
- XIAO S3: `192.168.0.201`
- C5 USB/flash port: `COM3`
- C5 link: 921600 baud, 8N1
- XIAO slot source is restored to `SLOT_MS = 16`.
- C5 source default is `settleUs = 25`.

The final 16 ms XIAO OTA restore was started but interrupted during the build. The source is definitely back at 16 ms, but tomorrow verify the hardware is also running that build and reflash if necessary.

Do not stage or modify the existing unrelated worktree items:

- `CHANGELOG.md`
- `SD_Card.rar`
- `docs/research/`
- `release/v1.8.0-rc-2/`
- `release/v1.8.0-rc-3/`

## What has been implemented

FPVGate:

- C5 multi-pilot support for eight pilots on one RF node.
- 10-bit RSSI values over the existing line protocol.
- Microsecond RSSI sample timestamps.
- Per-pilot sample queues, sequence-gap and queue-drop counters.
- Threshold crossing interpolation.
- C5 timing validation and deterministic replay tools.
- Handshake timing telemetry exposed as SSE event `c5Timing` with:
  - `tuneToTuningUs`
  - `tuningToReadyUs`
  - `readyToFirstSampleUs`
  - `tuneToFirstSampleUs`

C5:

- Removed the redundant warm-up I/Q dump during retune.
- First RSSI measurement begins in the same step that reports `OK`.
- RF gain is only rewritten when the requested gain changes.
- Default node settle delay is now 25 µs.

Relevant commits:

- FPVGate `b173c9c` — Add C5 handshake timing telemetry
- C5 `a9ad8a4` — Reduce C5 node settle delay
- C5 `6b27ca8` — Measure immediately after C5 retune
- C5 `8538a30` — Shorten C5 retune warm-up

## Tests and results

The stable 16 ms slot remains the best-performing configuration.

### 16 ms slot, 100 µs settle

- Accepted RSSI rate: approximately 930 Hz
- Handshake median: 2.09 ms
- Handshake p95: 2.94 ms
- Sequence gaps: 0
- Queue drops: 0

### 16 ms slot, 50 µs settle

- Accepted RSSI rate: 929.9 Hz
- Sequence gaps: 0
- Queue drops: 0
- Handshake median: 2.07 ms

### 16 ms slot, 25 µs settle

- Accepted RSSI rate: 929.7 Hz
- Sequence gaps: 0
- Queue drops: 0
- Handshake median: 2.10 ms
- Handshake p95: 2.59 ms

25 µs is therefore acceptable and is the current C5 setting, but reducing the settle delay did not materially reduce total handshake latency.

### 12 ms slot, 25 µs settle

- Accepted RSSI rate: 906.0 Hz
- Sequence gaps: 0
- Queue drops: 0
- Online fraction: 100%
- Ready fraction: approximately 90.8%

This is stable but slower than 16 ms. Earlier 12 ms tests were also below the 16 ms throughput and one run produced queue/sequence errors. The 12 ms source change was not committed.

## Main finding

The settle delay is not the dominant latency. Current measured handshake phases are approximately:

```text
F sent -> TUNING received       1.2 ms median
TUNING -> OK received           0.46 ms median
OK -> first R received          0.32 ms median
F sent -> first R received      2.1 ms median
```

The largest opportunity is the XIAO-side `F -> TUNING` phase, probably caused by UART servicing and main-loop scheduling. The 16 ms slot currently amortises this fixed cost better than 12 ms.

## Recommended next work

1. Verify and, if needed, reflash the XIAO with the 16 ms firmware.
2. Add finer phase timestamps around the XIAO UART send and receive path so the `F -> TUNING` delay is split into:
   - command construction
   - UART write/enqueue
   - C5 response arrival
   - XIAO parser handling
3. Change the XIAO command writer from multiple `Serial1.print()` calls to one prebuilt frame and one UART write.
4. Investigate servicing C5 UART input from a dedicated/high-priority task or otherwise earlier in the main loop.
5. Replace the C5 line parser's `sscanf`/repeated string scans with a small fixed-format parser and remeasure jitter.
6. Add C5-side timestamps around RF hop, settle, `OK` transmission, dump start, and first `R` transmission.
7. Only after the handshake is reduced, retest 12 ms, then 10 ms. Do not try 8 ms until the 10 ms result is clean.

## Validation commands

From the FPVGate repo:

```powershell
python tools/c5_timing_validation.py --host 192.168.0.201 --seconds 60 --output .pio/c5-timing-new.json
python tools/c5_timing_validation.py --compare .pio/c5-timing-16ms.json .pio/c5-timing-new.json
```

Build the XIAO:

```powershell
python -m platformio run -e SeeedXIAOESP32S3
```

Firmware OTA requires selecting the firmware partition first:

```powershell
curl.exe -sS "http://192.168.0.201/ota/start?mode=firmware"
curl.exe -sS -F "file=@.pio/build/SeeedXIAOESP32S3/firmware.bin" http://192.168.0.201/ota/upload
curl.exe -sS -X POST http://192.168.0.201/api/system/reboot
```

Build and flash the C5 from its `multipilot` directory:

```powershell
python -m platformio run -e c5zero
$env:PYTHONIOENCODING='utf-8'
python -m platformio run -e c5zero -t upload --upload-port COM3
```

