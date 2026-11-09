# Release qualification continuation - 8 November 2026

Work continues on V1.9.0-alpha. PR #22 remains draft. Do not merge main, tag or publish while qualification is incomplete.

## Candidate changes
- Race-file JSON read/write/import documents use the existing PSRAM-first allocator.
- Build-local pinned ESPAsyncWebServer patch moves request parsing documents and zero-initialized request bodies to PSRAM, with ordinary-memory fallback. No installed SDK edits. Unknown dependency layouts are rejected; the patch is idempotent.
- Queued SSE payload bytes use shared owned PSRAM-first storage. Content, framing, partial-write accounting, ordering, rates and queue limits remain unchanged. Native tests exercise both memory modes, immutable ownership, two clients, embedded null bytes and short accepted writes using the production SSE write method.
- Ordinary races no longer acquire an Event completion/cancellation lease when no Event session is active. A deterministic native regression fails on the previous implementation and passes with the fix; real Event races still refuse a held lease, preserve their session, and retry without duplicate history.
- USB TX staging now uses 24 slots only when the PSRAM allocation succeeds; internal-memory fallback remains nine slots. Payloads are CPU-owned and copied into TinyUSB endpoint buffers. This addresses observed pool exhaustion without repeating the earlier failed experiment that added 24 static internal-RAM slots. Both modes, allocation failure, idempotency and every frame's bytes are covered by native checks.
- Full-race controller captures USB counters before the workload and after a fault/completion. Retry watchdog forwards explicit immutable installed-image paths to each generation/attempt. Baseline matching allows only monotonic Event revision advances with otherwise identical content; actual data changes or revision rollback still block readiness.

## Evidence so far
Local root: .dev/headroom-20261108. All trials stop on their first fault and retain baseline restoration evidence.

- aio-race-load: race-file JSON candidate failed the unchanged heap floor at 39884 bytes. Previous 52-byte margin was not reliable.
- request-race-load: request parsing/body allocation candidate passed 22 checks (0 FAIL/ERROR), minimum 41248 bytes; margin still narrow.
- dual-event-race-load: Ethernet ordinary race history saved, but unnecessary Event completion locking failed with Event storage busy. Both baselines restored. This produced the native Event regression above.
- dual-lock-race-load: ordinary Ethernet completion passed after the fix. AIO later failed one ping probe; HTTP fresh/held probes remained successful and minimum internal heap was 45512 bytes. Later USB diagnostics showed poolLow=0 and dropped=23, cumulative since boot; the precise fault-time delta was not captured, so pool exhaustion is a supported hypothesis, not a proved attribution of that ICMP loss.
- New PSRAM-only 24-slot pool build/replay and restart/long-soak results are pending at this source checkpoint.

Early post-OTA Event 404 or partial-history readback was seen on Ethernet. Separate later validation against pre-flash/controller-preflight baselines confirmed configuration/history/Event intact; original early installer FAIL records are retained. Readiness checks now wait for complete history/Event parity instead of treating an online API alone as full boot completion.

## Current verification and next actions
73 Python tests pass, plus native Event fixture checks and the previous 169-test Jest suite. Both board images built for the preceding Event/memory changes. The new pool-capacity candidate build and hardware verification are separate pending gates; passing unit tests do not qualify it.

Next: install the new exact images only after successful builds; verify all data. Run a short dual-gate mixed race/load/Event replay with USB counter deltas. If clear, run software restart checks on both boards, then start a fresh eight-hour window under the independent watchdog with exact archived image paths. Keep the 40000-byte floor and network checks unchanged. Every retry remains inside the initial deadline; prior failures remain failures.

Only S3 COM23 (AIO) and COM42 (Ethernet) are connected. Native C5 USB, RF/VTX rig, ELRS and direct physical light/audio/power-cut observations remain unqualified; do not replace them with injected-lap evidence. C5 image staging UART-loss investigation also remains open; S3-only restart passes will not qualify that path. The localized UI filesystem was built earlier but is not yet installed on the bench devices. Companion repositories are not changed by this checkpoint.


## Continuation after 99eb4eb (19:49 UTC)

The 24-slot PSRAM USB pool candidate was installed on both boards. `dual-tx-race-load` stopped on an Ethernet `/api/system/info` connect timeout; independent fresh HTTP (55), held HTTP (60) and ping (61) probes all succeeded. This is an unresolved fresh-connection failure, not evidence of a complete Ethernet outage. Both USB dropped/deferred deltas were zero. The subsequent `traced-race-load` completed 46 PASS, 0 FAIL/ERROR, 6 BLOCKED at 19:37:49 UTC. Both gates' network probes had zero failures, USB drop deltas were zero, and 1,344 traced controller connections had zero errors. Minimum internal heap was AIO 40,992 and Ethernet 42,764 bytes: still narrow. Prior failed attempts remain failed.

A further candidate moves the CPU-owned 8 KB C5 sample staging queue to PSRAM with a zeroed internal-memory fallback; its capacity is unchanged and the interrupt-facing 16 KB UART ring stays internal. Event's bounded parsing allocator also prefers PSRAM while retaining its 48 KB logical limit. Production-block native checks exercise PSRAM, fallback, OOM, zeroed queue contents, preserved realloc contents and budget refusal. All 76 Python tests and the native Event fixture pass; both firmware targets build successfully. Previous 169 Jest tests are unchanged by these C++/Python-only changes.

Application-only diagnostic installs passed config/history/Event parity on both boards:
- AIO: 1,493,536 bytes, SHA256 `019e17bdb298afb00624ebfa182da1215396c42750edffe7eadfa2aa99f0dc1c`.
- Ethernet: 1,531,968 bytes, SHA256 `70bd8d804d91135049f98438497c9e2b40a41d08a1321395a7fc3b4e8751e5f1`.
- Immutable images and before/after/install reports: `.dev/headroom-20261108/install-<environment>-staging/`.

The new dual-gate trial is `.dev/headroom-20261108/staging-race-load` (started 19:48:48 UTC). Result pending at this checkpoint. Opt-in connection tracing logs local TCP source ports, timestamps, outcomes and request paths (query/header/body excluded); a Windows TCP-table sampler requires no administrator privileges. TIME_WAIT rows are aggregated to bound log volume. Tests confirm original exceptions propagate and monkeypatches restore even if thread start fails. Retry supervisors forward the tracing option. S3-only restart tooling no longer requires native C5 USB or the scope, and passive serial capture reconnects after each USB disconnect.

Still pending: this candidate's short trial, restart checks, uninterrupted watched long soak, matching localized filesystem validation, C5 image-staging UART-loss fix, and the physical checks listed above. No stable release is authorized by these intermediate results.


## Latest short-trial failure and diagnostic continuation (19:54 UTC)

`staging-race-load` finished FAILED: 40 PASS, 3 FAIL (one external-stop and two terminal consequences), 0 ERROR, 6 BLOCKED. First fault was AIO fresh HTTP TimeoutError at 19:52:54 UTC after 2.516 seconds. Both gates restored their configuration/settings/history baselines. AIO minimum internal heap was 40,356 bytes; Ethernet 52,316. Both USB dropped/deferred deltas were zero. Controller connection traces had zero errors; the failing probe is a separate process, so this does not explain its timeout. Do not declare the new candidate qualified.

The fresh probe previously recorded only TimeoutError and waited for EOF, even after receiving a response body. It now records connect/send/receive phase, source port, first-byte timing, response byte counts, status and declared Content-Length/body completeness on failure. No response bodies, headers or credentials are logged. The same 2.5-second socket timeout and EOF success condition remain unchanged. Two targeted tests verify connection failure propagation and complete-body-without-close still being a failure with useful diagnostics. This permits distinguishing a connect stall, a response stall, and a delayed close rather than assuming every timeout means failure to accept.

Next diagnostic window: eight hours under the independent retry watchdog, using the exact installed staging images and richer connection/probe evidence. Each attempt stops on first fault, restores baselines, and retries within the original window. A window with failures is not a release qualification pass. S3 restart checks are deferred until this network failure is dispositioned; they have not run on this candidate. The long window does not flash or power-cycle devices.


## Active watched window (confirmed running)

Started 2026-11-08T19:55:03.857207+00:00; fixed deadline **9 November 2026 03:55:03 UTC / London**. Watchdog PID 63036; state `.dev/headroom-20261108/watched-eight-hour/watchdog.json`; first generation `generation-001/supervisor.json`, first attempt `generation-001/attempt-001/controller.json`. First attempt reached phase soak with no firstFailure as of 19:55:21 UTC; both board readiness/baseline checks passed. Exact installed images are in supervisor installedImageProvenance. Test tooling source is pushed as 2fc9499. Watchdog/supervisors continue independently of this chat. Retries cannot extend the deadline. Final restoration can finish after it. A failure-containing window remains diagnostic evidence, not a continuous qualification pass.


## Controlled memory comparison correction (2026-11-08T21:01:18.312630+00:00)

The ordinary allocator already placed the 8192-byte C5 queue in PSRAM on BOTH boards. Corrected address-based diagnostics in the ordinary-allocator control applications confirmed this. The explicit allocation does not recover another 8 KB of internal RAM; earlier claims implying that saving were wrong. The existing SDK enables PSRAM for ordinary malloc with a 4096-byte threshold. The former status flag identified the explicit allocation path, not the location of fallback memory; this is now corrected in source using esp_ptr_external_ram().

Matched idle medians, normal-before / ordinary-control / normal-after: AIO 88,388 / 88,902 / 90,160 bytes; Ethernet 90,128 / 91,996 / 92,646. Differences of this size are not an established saving; these runs show no repeatable 8 KB step. The final Ethernet repeat used heap/receiver-only reads after an Event GET busy response; see method limits in docs/MEMORY_COMPARISON_20261108.md. Event transient-allocation savings remain unqualified.

The broader comparison remained FAILED on AIO Event POST HTTP 409; Ethernet's control Event/assets phases completed. Subsequent normal application installs passed and independent snapshots confirmed config/history/Event content preserved on both, even though AIO's immediate Event restore POST had also refused. C5 firmware and UI filesystem are unchanged. Raw evidence is .dev/memory-ab-final-20261108.

The original eight-hour window was interrupted for this user-requested comparison, with prior failures retained (eight completed failed attempts in generation 1 before interruption; later cleanup attempts must not be counted as independent hardware findings). It is not running at this checkpoint. Any resumed window keeps the original 9 November 03:55 UTC deadline and is not an uninterrupted eight-hour qualification pass. Normal build artifacts are being regenerated; a contention-sensitive watchdog unit test will be rerun without compilation before verification is finalized. PR #22 remains draft; no stable publication.


## Verification after resuming (8 November, 22:37 UTC)

Both normal firmware targets rebuilt successfully with two parallel jobs. The isolated Python rerun passed all 78 tests in 50.397 seconds, including the previously contention-sensitive watchdog case; the original failed run remains in python-tests.log. Native Event checks also passed. Both gates are online/idle and config/history/tracks/Event content still match the original watched-window baselines, allowing only the expected monotonic Event revision advance. No new application flash was needed during this build/verification continuation. Resume the diagnostic window using the exact installed archived staging images and the original 03:55 UTC deadline; do not count the interruption as test time or call it an uninterrupted eight-hour pass.


## Continuation confirmed active: 8 November 22:38 UTC

Source and controlled-comparison corrections pushed on V1.9.0-alpha as 4629e92, with no co-author trailers. Normal AIO/Ethernet builds succeeded at the two-job limit. The Python suite passed all 78 tests when rerun without compilation contention; native Event checks passed. Both gates matched the original config/history/tracks/Event baselines before resuming. No flash accompanied this continuation.

The independent watchdog is RUNNING, PID 55328, at `.dev/headroom-20261108/watched-eight-hour-after-memory-comparison/watchdog.json`. First controller reached soak at 22:38:02 UTC with no firstFailure at this checkpoint. Original deadline remains **9 November 03:55:03 UTC/London**. Original failed attempts and the comparison/PC-use interruption remain preserved; this is a diagnostic continuation, not an uninterrupted eight-hour pass. Exact installed applications are pinned in supervisor installedImageProvenance. Faults stop each attempt, retain diagnostics and restore/retry within that fixed deadline.

Core correction remains: the original ordinary allocator already placed the 8 KB C5 queue in PSRAM on both boards. Do not claim another 8 KB internal-memory recovery. AIO Event-busy responses and network/heap failures are still open; no stable release has been published.


## Race import fix prepared (9 November)

Source fix and offline regressions are documented in docs/RACE_IMPORT_20261109.md. Whole-backup uploads hit the library's 16 KB default and the UI ignored error status. Imports now send complete races sequentially; the PSRAM route allows bounded larger individual races, avoids redundant parsing, validates collection shapes and accepts duplicate no-ops. All 179 Jest tests, the native production import regression, three history checks and the two-job AIO build pass. The user's specific backup was not supplied. Nothing was flashed during the running soak. Matching UI/app deployment and real-device import roundtrip remain pending after the current window.


## AIO deployment and on-device import smoke - 9 November 00:59 UTC

The user explicitly ended the failed soak to flash the AIO. Both active test lanes completed baseline restoration and the watchdog/retry processes were stopped; no automatic soak resumption is scheduled. Prior failed attempts and the final intentional stop remain recorded. Ethernet was not flashed.

AIO S3 application from 6ff052a is installed: 1,493,824 bytes, SHA256 `6e750de59671ee6aef4c6de5d48d429d24675d5982dfda4cff8ab1cdb7f39038`. The matching UI is installed and all 31 served assets compare byte-for-byte with the staged sources. A full 8 MB flash backup was read/digest-verified before writing. Only the active app1 and LittleFS partitions were written and hash-verified; partition table, NVS and SD contents were retained. The filesystem backup contained only UI assets. Private backup/device images are under `.dev/aio-import-install-20261109/`, not release artifacts. The backup was taken with receiver frequencies temporarily zeroed; the original configuration is in before.json and has been restored.

ROM USB enumerated as COM22, normal application as COM23. The stock reset left the volatile force-download bit set; clearing RTC_CNTL_FORCE_DOWNLOAD_BOOT and issuing RTC system reset returned the device to the app. Preserve the initial preparation/verification failure reports (Windows tool absolute-path handling and a verification-script NameError) alongside the final PASS; neither required another image write.

On-device test executed the served Import Races function through a Node/FileReader stand-in against the real API: a **22,922-byte, eight-pilot** saved race imported successfully, retaining every pilot's identity/slot/frequency/thresholds/lap array. A repeat import produced no duplicate. The temporary record was deleted and original history matched. Config, history, Event and tracks also match the pre-flash baseline. C5 remains 1.2.6-d6d7, online and streaming fresh records. This is functional import evidence, not physical browser-click, RF timing or endurance qualification. Refresh the browser page to load the new UI.

Final evidence: install.json, completion.json, import-smoke.json and post-smoke.json in the local installation directory. Wider release blockers remain open. Ethernet import deployment/verification is pending.
