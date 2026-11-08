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
