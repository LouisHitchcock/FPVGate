# FPVGate validation plan

How releases get validated, what each layer covers, and — just as importantly —
what it does not cover and still needs a person.

## Why this exists

Every release up to 1.7.3 was validated by hand: flash a board, click through the
UI, run a few races, decide it looked right. That worked when the firmware was
smaller. It does not scale to the current surface area — 18 self-test checks, two
transports, nine board targets, SD-backed race history, RSSI capture, a marshal
editor and OTA — and it does not catch intermittent faults at all, because nobody
hand-tests the same thing four hundred times.

The aim is not to remove human testing. It is to make the human testing *count*
by automating everything that a machine can judge objectively, so attention goes
to the things only a person can assess.

## The layers

| Layer | Runs | Needs hardware | Duration | Command |
|---|---|---|---|---|
| **1. Unit** | every change | no | seconds | `cd tests && npx jest` |
| **2. Build** | every change | no | ~2 min | `pio run -e <target>` |
| **3. Component** | before release | yes | ~2 min | `race_day_sim.py --components-only` |
| **4. Page load** | before release, **every board** | yes | ~1 min | `concurrent_load.py` |
| **5. Race day** | before release | yes | 1–4 h | `race_day_sim.py --heats 20` |
| **6. Reliability** | before release | yes | 4 h+ | `reliability_check.py` |

### 1. Unit — `tests/`

Jest, browser-side logic only. Currently 44 tests across four suites covering
band/channel selection, i18n fallback, the pre-paint theme restore, and lap-time
round-tripping.

The valuable ones extract the real implementation out of `data/script.js` and
`data/index.html` and execute it, rather than reimplementing the logic in the
test. A test that copies the logic it is testing proves nothing.

**Does not cover:** anything in firmware, anything needing a device.

### 2. Build — PlatformIO

Every target must compile, and the filesystem image must build. The filesystem
build is not optional: it is what caught `data/` overflowing the old 1 MB spiffs
partition, which no amount of firmware compiling would have found.

Build at minimum `FPVGateAIO` and one non-AIO target, since board-specific
`#ifdef` paths diverge.

### 3. Component — `race_day_sim.py --components-only`

One pass over every component with explicit pass/fail:

- device self test (18 checks) on every transport
- config read / modify / read back / restore
- a full heat: start, laps, stop, save, verify persisted
- RSSI sidecar written, served over the chunked endpoint, `sampleCount` matching
  the array actually returned
- lap editing recalculates fastest, median and best-3 correctly
- history ordering is newest-first
- delete removes both the race and its sidecar
- track create and list
- SD present
- both transports serve identical data for the same race

**This writes to the device.** It creates races and deletes them afterwards.

### 4. Page load — `concurrent_load.py`

Fetches every startup asset at once, repeatedly, the way a browser does on a
cold load, and fails any response shorter than its `Content-Length`.

This layer exists because layers 3, 5 and 6 all missed a real fault. On an
ESP32-S3 DevKitC-1 the web UI would not open reliably in a browser, yet every
asset served byte-exact when requested one at a time — a sequential failure rate
of roughly 1 in 1350. Fetched concurrently, six page loads in eight failed. The
cause was a fixed egress buffer shared across connections, which only a
simultaneous burst can exhaust.

**Run this on every supported board, not just the one on the bench.** The fault
is memory- and buffer-dependent, so a board with PSRAM can pass while a board
without it fails on identical firmware. That is exactly what happened: the
FPVGateAIO was fine throughout.

Read-only and takes about a minute, so there is no reason to skip it.

### 5. Race day — `race_day_sim.py`

The same checks, repeated across many heats over hours, with periodic re-checks
of the self test and history. Catches what one pass cannot: storage leaks,
degradation across heats, history behaviour as races accumulate.

### 5. Reliability — `reliability_check.py`

Read-only sustained load with liveness probing, on both transports at once.
Answers "does it stay up, and does it recover if it doesn't". See
`RELIABILITY_RUNBOOK.md`.

Run this against a gate with **real** race data — it mutates nothing, so it is
the right one for a device you care about.

## Release gates

Before tagging a release, all of:

- [ ] Layer 1 green
- [ ] Layer 2 green for `FPVGateAIO` plus one non-AIO target, firmware **and**
      filesystem
- [ ] Layer 3 green on a real board
- [ ] Layer 4 green, at least 10 heats
- [ ] Layer 5 green, at least 4 hours, verdict PASS
- [ ] Manual checklist below completed

A failing layer blocks the release. A layer that could not run — exit 2 — is not
a pass; find out why and rerun.

## What still needs a person

Automation cannot judge these. They stay on a manual checklist:

**Physically observable**
- buzzer is audible and the tone is right
- RGB LEDs light in the right colours and patterns
- LCD variants render correctly and the backlight behaves
- battery monitor reads correctly against a multimeter

**Needs a real drone**
- RSSI peaks are real gate crossings, not noise
- lap detection fires at the right moment
- enter/exit thresholds are sensible on real hardware
- the calibration wizard produces usable thresholds

**Needs another device or a phone**
- multi-gate sync, master/slave
- RotorHazard integration
- mobile browser layout, and the responsive breakpoints
- captive portal on iOS and Android

**Needs a specific starting state**
- first-boot experience on a blank device
- OTA update from the previous release
- web flasher, including the re-enumeration flow on a 1.8.0 device

## Known gaps in the automation

Stated plainly so nobody assumes more coverage than exists.

**RSSI content is not synthetic.** The harness starts a real race and the device
records whatever its RX5808 sees, which on a bench is idle noise. That fully
exercises the capture pipeline — staging buffers, writer task, SD write, sidecar
attach, header finalize, chunked serve — but it does **not** validate peak
detection, because there are no peaks. Proper validation of lap detection would
need a firmware hook to inject synthetic RSSI. That hook does not exist and is
the single highest-value addition to this plan.

**Only the primary transport drives writes.** Races are created over the first
configured transport. The second is checked for read parity only.

**No concurrency stress in the race-day harness.** Heats run sequentially. Real
race days have several people refreshing the UI while a race runs. `stress_test.py`
covers concurrency separately; the two are not combined.

**Nothing tests failure recovery deliberately.** Nothing pulls the SD card
mid-race, drops WiFi mid-save, or power-cycles during a write. Those are real
race-day events and are currently untested.

**Board coverage is one board.** The harness runs against whatever is plugged in.
Nine targets exist; eight go untested per release unless someone plugs them in.

## Adding a component check

Add a `suite_*` method to `Harness` in `race_day_sim.py`. It must:

1. build a `Check(suite, name)`
2. call `.ok(detail)` or `.fail(detail, expected)` — always give `expected`, since
   that is what tells the reader what *should* have happened
3. `self.add(check)` exactly once
4. leave the device as it found it, or register cleanup in `self.created`

Verify a new check can actually fail. A check that cannot fail is worse than no
check, because it reports confidence it has not earned. The delete check in this
harness passed for the wrong reason on its first run — it treated a correct 404
as a failure — and was only caught by reading the firmware to see what should
have happened.
