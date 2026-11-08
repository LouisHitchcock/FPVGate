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
