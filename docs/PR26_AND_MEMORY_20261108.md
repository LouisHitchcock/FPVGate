# PR #26 integration and AIO memory investigation ? 8 November 2026

## Qualification window result
The watched AIO + Ethernet run from about 11:54 to 14:00 completed its fixed window with failures: 98 attempts, 87 AIO low-heap first failures, eight AIO network first failures, two controller errors, and one scheduled window end. Every attempt reported completed baseline restoration. The independent watchdog remained healthy. This is not a qualification pass.

## PR #26
Integrated Licardo's two commits ce3ff429 and 63503a56 into release/v1.9.0-rc.4 with conflict adaptations for the current RC interface. Preserve multi-pilot standings, always-visible race metrics, Say Lap Time Too/Beep Every Lap, Merge and the unified race editor, the multi-pilot RSSI view, current RotorHazard controls, and receiver/log diagnostics. Do not restore removed legacy controls from main. Both original human authorship and subsequent integration commits remain in history; no AI co-author trailers.

New English/Simplified Chinese strings, localized title/label/aria-label attributes, bounded initial locale wait and late status refresh are included. Newer RC-only translation keys not present in the contributed catalogue still use existing per-key English fallback. JS syntax and all locale JSON parse checks passed. Regression checks cover parameter parity, translated attributes retaining nested live values, unique HTML IDs, and retained RC controls. Announcer tests now use the actual English catalogue for newly localized phrases.

## Measured memory findings
The home-page route opened index.html after the global file-buffer middleware, leaving Arduino's larger default stdio buffer in place. It now opens the plain/gzip file explicitly, sets the same 512-byte file buffer before reading, and preserves gzip handling.

Four simultaneous home-page downloads, 12 requests total, moved internal minimum heap from 36788 bytes before to 51992 after; all downloads succeeded. Static JS/CSS controls measured 47776 before / 50460 after. This isolated result does not prove the combined workload passes.

The first combined race/load replay with the root fix still failed at 33044 bytes. A second with tighter superseded-telemetry backpressure still failed (35384 first detected, 34332 snapshot). At the low point four/five file-classified requests and both SSE streams were active. Snapshot file counts include non-/api URLs and are not a count of filesystem handles. Telemetry backpressure affects replaceable RSSI/status only; lap/pass messages remain queued and skipped RH peak updates retain their peak data.

The third candidate moved task-owned temporary JSON documents in the web server to the existing PSRAM-first allocator, with ordinary-memory fallback on boards without PSRAM. The 40000-byte qualification floor and 24576-byte low-heap admission threshold remain unchanged. The diagnostic snapshot threshold alone rose to 45000 so failures are observable.

## Controller error
One Windows PermissionError occurred reading a completed summary.json, rather than writing it. The controller now performs bounded retries for that local read. A persistent error still fails visibly; no board requests or race actions are repeated. The other controller error was an AIO connection timeout.

## Evidence
Local evidence root .dev/memory-pr26-20261108 contains before/after asset profiles, immutable installed images/baselines, build/test logs and each failed race-load replay. Raw configurations stay local. Previous watched-window logs remain in .dev/soak-until-1400-20261108. The filesystem build validates integrated UI assets; the bench AIO application updates do not install that filesystem image.

Validation: 68 Python tests and 169 Jest tests, firmware and filesystem builds pass. Release remains blocked until the complete workload, Event timeout investigation, flash/reboot cases and outstanding physical acceptance succeed. Do not publish or tag a stable release from this checkpoint.

## Further isolated checks
The JSON-allocation candidate also failed the combined workload (32940-byte first failure), despite successful application installation and data preservation. Neither backpressure nor the PSRAM preference is treated as a complete fix. Next A/B candidate also bounds event-stream TCP send credit to two segments, keeping files at one segment, and exposes actual PSRAM size/free diagnostics. A tight queued-telemetry policy prevents replacing TCP-buffer savings with an unbounded stream backlog; pass/lap delivery is still checked by real RH saved-race assertions.

## Follow-up evidence and final candidate direction
The stream-cap experiment also failed the floor and was removed along with the experimental telemetry backlog reduction. Existing stream timing/backpressure remains. Temporary web/config JSON prefers PSRAM; this alone was not sufficient.

A /config burst of 12 requests with four workers initially reached 50888 bytes. Moving only its JSON document to PSRAM reached 52660. Replacing its growable internal response buffer with an immutable PSRAM-first snapshot reached 60000 (system-info control 58780); bytes and parsed baseline configuration were unchanged. A new production-code test verifies snapshot/stream equivalence, pilot fields, escaped text and ownership after config mutation. The combined replay still failed at 35756, so this too is an improvement rather than a complete qualification fix.

The USB Ethernet transport had nine static full-MTU staging frames in internal RAM. The candidate keeps nine slots but allocates the pool in PSRAM where available, with ordinary-memory fallback. tud_network_xmit_cb copies staging bytes into TinyUSB's endpoint buffer; the pool is not handed directly to USB DMA. No queue depth or packet capacity changed. Both early startup failure paths free the allocation. Unit coverage exercises external storage, no-PSRAM fallback, allocation failure, idempotent allocation and exact copying of all nine MTU frames. USB diagnostics now report poolBytes/poolExternal. AIO static RAM fell from 133532 to 119892 bytes (13640 bytes recovered).

Installed-candidate verification and final mixed-load results are recorded below when terminal. The previous failed runs remain in race-load-01 through race-load-05.

## Terminal validation of the USB-pool candidate

AIO application SHA256 3360025818f3d5983167170952fa9f2e63021aeec1caab9b10da5c4e521ff999, 1492880 bytes, installed and verified with configuration/history/Event preserved. /api/usbnet/status confirms poolBytes=13644 and poolExternal=true. Ethernet remains on its previous bench image; its latest source build passed but was not flashed. AIO firmware, Ethernet firmware and integrated UI filesystem builds passed. The filesystem image is built, not installed on the bench AIO.

Focused replay race-load-06 completed at 18:11:37 UTC. The requested 240-second lane completed its in-progress work and restoration, reporting 296.86 elapsed seconds. Results: 22 PASS, 0 FAIL, 0 ERROR, six explicitly BLOCKED physical/native-USB categories. It completed local and production RotorHazard 1/2/4/8-pilot cycles plus another 1-pilot cycle, save/marshal/export/delete, six concurrent asset bursts, track changes, Event result review/next heat, and baseline restoration. Network probes: 239 fresh, 268 held and 291 ping samples, all successful. Boot counter stayed 8. UART sequence gaps, sample-queue drops, bad records and all UART error counters had zero deltas.

Minimum internal heap was 40052 bytes: only 52 bytes above the unchanged qualification floor. No busy refusals were reported. This is the first passing focused replay of this workload, not a long-soak qualification or proof that the historical Event timeout is resolved. Keep the release blocked. Next: seek more internal-memory margin, repeat a longer watched two-gate run using exact installed-image provenance, exercise Event repeatedly, and complete flash/reboot and outstanding physical acceptance. Do not silently lower the floor or infer RF accuracy from injected laps.

All current checks: 68 Python tests; 169 Jest tests in 17 suites; AIO and WaveshareS3ETH firmware builds; UI filesystem build; JS syntax and locale JSON validation. Bench pool tests cover PSRAM, no-PSRAM fallback, failure and full-frame copy. Configuration snapshot tests cover exact serialization and immutable ownership. Evidence VALIDATION_RESULT.json and raw logs remain local in race-load-06.
