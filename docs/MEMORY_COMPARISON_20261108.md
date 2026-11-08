# Controlled staging-memory comparison: 8 November 2026

## Correction discovered during the test

The ordinary allocator is not synonymous with internal RAM. The installed ESP32-S3 SDK enables `CONFIG_SPIRAM_USE_MALLOC=1` with `CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=4096` for both board memory configurations. An 8192-byte ordinary calloc can therefore already select PSRAM. The original `sampleQueueExternal` flag reported whether the explicit external allocation succeeded, not the actual location of a fallback allocation. C5 begin now uses `esp_ptr_external_ram()` to report the actual queue residency. A native regression covers a fallback calloc that itself returns external memory.

The bench macro's legacy name `FPVGATE_BENCH_INTERNAL_STAGING` bypasses explicit external allocation and restores ordinary calloc/malloc; **it does not force internal RAM**. The first controls were incorrectly described as internal-only. Retain their data, but do not interpret their flag=false as proof of internal residency or the 8 KB queue as 8 KB of newly recovered internal RAM. The corrected comparison uses this ordinary-allocator control and verifies actual residency. This supersedes the original interpretation below.

## Question and scope

Measure the effect of the latest 8 KB C5 sample-queue and bounded Event allocator moves on each board. Previous minimum-heap figures came from different mixed-race trials; they did not isolate the allocation saving. This test compares each board against itself. USB networking on AIO and W5500 on Ethernet remain fixed throughout; differences between board absolute free-heap readings are not evidence of different ESP32 capacities.

## Method

Evidence root: `.dev/memory-ab-20261108/`. Execute PSRAM-before, ordinary-allocator control, then PSRAM-after on both boards. The control uses the current source plus `FPVGATE_BENCH_INTERNAL_STAGING=1`, preserving every normal target flag. This only bypasses the C5 sample queue and Event Budget external allocations; earlier JSON/SSE/USB memory changes remain enabled. Native production-block checks run in normal and ordinary-control modes, including allocation fallback/OOM, queue zeroing, preserved realloc contents and the unchanged 48 KB Event limit. The macro is never enabled in normal configuration files.

Both control builds succeeded; immutable binaries, hashes and exact flags are in `internal-images.json`. Original normal candidate images are the archived `headroom-20261108/install-<target>-staging/firmware.bin` applications. C5 receiver firmware and UI filesystem are unchanged. Application OTA quiesces C5 scanning, waits for boot/readiness, restores frequencies and verifies config/history/Event before profiling. This is not qualification of live-UART flash staging.

`tools/memory_stage_compare.py` waits for uptime >=120 seconds, verifies queue size 8192 and expected placement, captures persistent baselines, and settles for another ten seconds. Each board uses one pooled monitoring session; no race controllers, independent network probes or serial logging run concurrently. Both boards run in parallel for every variant. Phases:

1. Idle: twenty heap readings at 0.5-second intervals.
2. Event parse: three uploads of the identical production native-test Event fixture, recording latency and heap; then restore the prior Event content. No race is started. Gate revision advances monotonically as required by the API.
3. Startup assets: three bursts of the same six paths, four workers, sampled during each burst; record status, bytes, hashes and latency. Paths are `/`, `/script.js`, `/style.css`, `/c5-multipilot.js`, `/event.js`, `/version`.

The firmware's existing 2 ms heap-low sampler is reset before every phase. Report median free internal heap, minimum observed reading, sampler low and median largest block separately. Restore and compare config (excluding live battery voltage), history, tracks and Event content at completion. Abort a profile at the first request/validation failure, retain diagnostics, restore Event. The comparison orchestrator restores the normal archived applications if an internal-control stage fails. It never converts a failure into a pass.

These are controlled heap profiles, not an endurance or physical RF timing qualification. The former eight-hour run was explicitly interrupted for this requested comparison. Its failures and baseline restorations remain recorded in `headroom-20261108/watched-eight-hour`; its deadline remains 9 November 03:55 UTC if resumed. Neither interruption nor later continuation constitutes an uninterrupted eight-hour pass.

## Attempt history

- `.dev/memory-ab-20261108`: PSRAM-before completed on both boards. Control idle medians were almost identical to PSRAM, prompting the allocator investigation. AIO control stopped on HTTP 503 from Event GET during restoration; its finally block restored Event content and both normal applications were reinstalled, with config/history/Event parity. Ethernet control completed. This attempt is FAILED, not a completed comparison.
- `.dev/memory-ab-verified-20261108`: repeat PSRAM-before stopped on Ethernet Event POST HTTP 409; baselines restored. This attempt is FAILED. No control installation was started.
- `.dev/memory-ab-final-20261108`: corrected profiler uses the revision returned by each successful Event POST, avoiding an intervening streamed Event GET/read lease before the next write. No retry is added to measured requests. Both normal images remain unchanged. Build activity is kept outside profile measurements. Results pending.

## Measured outcome

The original ordinary allocator placed the 8192-byte C5 queue in PSRAM on **both** boards, confirmed by the corrected address-based diagnostic in the control applications. The explicit queue allocation therefore did not newly recover 8 KB of internal RAM. The earlier statements implying that saving were incorrect.

Median free internal heap at idle (bytes):

| Board | Explicit PSRAM before | Original ordinary allocator | Explicit PSRAM after |
|---|---:|---:|---:|
| AIO | 88,388 | 88,902 | 90,160 |
| Ethernet | 90,128 | 91,996 | 92,646 |

These are repeated idle readings, not a statistical estimate of a small effect. The observed spread is about 1-2.5 KB, with no repeatable 8 KB step. The address checks are the stronger evidence that the queue was already external. Event's allocator changes can still affect temporary allocations; this exercise does not establish a reliable AIO Event-phase saving.

The final control run is still **FAILED**, not a full functional pass: AIO Event POST returned HTTP 409, and its attempted Event restoration POST also returned 409. Independent comparison of the saved pre-control baseline against the subsequent normal-install before/after documents confirmed its original Event content was unchanged and config/history were preserved. Ethernet completed its control Event/assets phases. Both boards were restored to the exact original normal candidate applications, with installer PASS and data parity.

Final AIO idle-only profile completed, with baseline restoration verification. The first Ethernet post-restore broader baseline read hit Event GET HTTP 503; retain that failed record. A separate read-only heap/receiver-only measurement completed its 20 samples without errors and did not touch Event/settings/history. Thus the last Ethernet column has the same sampling cadence and settling delay, but excludes the broader baseline reads. Do not represent the wider profile sequence as fully passed.

Raw summary: `.dev/memory-ab-final-20261108/idle-comparison-summary.json`. Address proofs: `aio-default/result.json` and `eth-default/result.json`, `receiverBefore.link.sampleQueueExternal=true` and bytes=8192. Both control image hashes/flags are in `default-images.json`; the legacy bench flag name does not mean forced-internal allocation. The controlled tests do not change C5 firmware, crossing timestamps, algorithms or UI filesystem.

Both normal target rebuilds succeeded after resuming with two jobs (AIO 67.73 s, Ethernet 265.31 s), replacing bench artifacts in `.pio/build`. These rebuilds are separate from the exact archived normal applications reinstalled on the boards. No stable publication or qualification pass results from this comparison.


Normal artifact rebuilding was stopped at the user's request to free the PC, then resumed on 8 November at 22:29 UTC using `platformio run -e FPVGateC5MKAIO -e WaveshareS3ETH -j 2`. No board flash is part of this rebuild. The contention-sensitive Python suite will run after compilation, and diagnostic soak continuation will keep the original deadline.


## Verification after resuming (8 November, 22:37 UTC)

Both normal firmware targets rebuilt successfully with two parallel jobs. The isolated Python rerun passed all 78 tests in 50.397 seconds, including the previously contention-sensitive watchdog case; the original failed run remains in python-tests.log. Native Event checks also passed. Both gates are online/idle and config/history/tracks/Event content still match the original watched-window baselines, allowing only the expected monotonic Event revision advance. No new application flash was needed during this build/verification continuation. Resume the diagnostic window using the exact installed archived staging images and the original 03:55 UTC deadline; do not count the interruption as test time or call it an uninterrupted eight-hour pass.


## Continuation confirmed active: 8 November 22:38 UTC

Source and controlled-comparison corrections pushed on V1.9.0-alpha as 4629e92, with no co-author trailers. Normal AIO/Ethernet builds succeeded at the two-job limit. The Python suite passed all 78 tests when rerun without compilation contention; native Event checks passed. Both gates matched the original config/history/tracks/Event baselines before resuming. No flash accompanied this continuation.

The independent watchdog is RUNNING, PID 55328, at `.dev/headroom-20261108/watched-eight-hour-after-memory-comparison/watchdog.json`. First controller reached soak at 22:38:02 UTC with no firstFailure at this checkpoint. Original deadline remains **9 November 03:55:03 UTC/London**. Original failed attempts and the comparison/PC-use interruption remain preserved; this is a diagnostic continuation, not an uninterrupted eight-hour pass. Exact installed applications are pinned in supervisor installedImageProvenance. Faults stop each attempt, retain diagnostics and restore/retry within that fixed deadline.

Core correction remains: the original ordinary allocator already placed the 8 KB C5 queue in PSRAM on both boards. Do not claim another 8 KB internal-memory recovery. AIO Event-busy responses and network/heap failures are still open; no stable release has been published.
