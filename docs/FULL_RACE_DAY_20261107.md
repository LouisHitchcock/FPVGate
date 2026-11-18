# Full race-day qualification — 7 November 2026

## Purpose and authority

Louis requested an overnight race-day simulation covering FPVGate, C5MK and
RotorHazard integration. This plan follows the live roadmap and the 6 November
release-evidence reconciliation, including the explicit requirement to stop on
the first qualification failure. It does not authorize publication or declare
all release gates covered by a simulated race.

The Outline audit fetched all 128 documents in all four accessible collections;
73 contain release-relevant material. The complete inventory, current document
texts and extracted findings are in `.dev/outline-overnight-audit-20261107/`.
Historical running-job statements were checked against actual processes: no
race-day test was running at initial inspection. Earlier failed/interrupted
soaks remain failed/interrupted. The accepted timing baseline and deferred
C5MK2/camera work remain distinct; the new scope/PSU interface tasks are deferred.

## Connected test matrix

| Lane | Path | Observed firmware at initial inspection |
| --- | --- | --- |
| Ethernet | Waveshare S3-ETH, HTTP 192.168.0.65, UART C5-Zero | Gate rc.5; receiver 1.2.5 |
| AIO | C5MK AIO, USB network 192.168.7.1, UART XIAO C5 | Gate rc.5 with local heap/UART diagnostics; receiver 1.2.6 |
| Native USB | Separate Waveshare C5-Zero on COM29, native RH serial driver | Receiver 1.2.6 |

This is a deliberately recorded mixed-version bench matrix, not a frozen
shipping manifest. Do not silently relabel it as the older all-1.2.5 candidate.
Record actual running app/partition sizes, exact available image hashes, source
commits and dirty source snapshots, plugin tree hash and RH source version.
Never infer the running image solely from whatever build file exists locally.
Both gates currently report SD available; stop if either falls back to LittleFS.

## Phases and coverage

1. **Inventory and preservation.** Capture system/config/history/Event/tracks,
   receiver identity and storage/boot/log status. Export every visible saved
   race with its full details before mutations. Preserve existing IDs; delete
   only results independently journaled as belonging to this test. Native USB
   has its own isolated RH database, port and configuration. Capture its initial
   console settings and restore scanner mode after closing RH.
2. **Automated checks.** Gate Python/native and Jest suites; plugin transport and
   tuning tests; C5MK 1.2.6 native endpoint/host/node/link/LED tests and unchanged
   production RH USB-client tests where their prerequisites are available.
   Preserve commands, durations, outputs and exact versions. A missing physical
   fixture is BLOCKED, never PASS. A failing applicable check prevents promotion.
3. **Ten-minute rehearsal, all three lanes.** Use real devices and real isolated
   RH 4.5.1 servers. Gate lanes exercise browser-free start/stop, 1/2/4/8 pilots,
   max laps/manual/heat-time completion, all three lap formats, exact saved lap
   arrays, duplicate Stop, typed edits/invalid edits, notes/export/binary RSSI,
   track CRUD/selection, Event result/review refusal/next heat and restoration.
   Production plugin races reconcile each attempted input, gate save, RH live
   counts and final SQLite pilot/lap records. Alternate normal/full RSSI scales
   and restart RH while preserving its saved database.
4. **Native USB race-day lane.** Real unchanged RH serial discovery and receiver
   polling, eight actual C5 nodes, fixed thresholds, per-node frequency changes,
   live RSSI, stage/start/stop and saved RH results. Explicitly marked RH manual
   simulated laps exercise RH persistence while actual C5 USB polling continues;
   those laps do NOT prove RF detection or timing. Reconnect/restart RH between
   blocks and verify saved results remain. Never let two programs own COM29.
5. **Eight-hour soak.** Starts only if the complete rehearsal, all three lanes
   and every monitor pass. Continue varied heats, Event/track cycles, marshal
   and export checks, production-plugin races and native USB polling/races.
   Concurrent startup asset loads exercise transport/heap under race load.
   Repeated RH restart and scale-switch checks test reconnect and persistence.
6. **Cleanup and report.** Stop RH before restoration; restore gate settings,
   Event and exact baseline history, retaining unexpected records rather than
   deleting unknown data. Close serial readers, return standalone C5 to its
   pre-test scanner mode and verify its settings. Write final summaries and
   residual blockers, including restoration success/failure. Update Outline.

## Observability and stop conditions

Keep separate timestamped JSONL, raw serial/console and RH logs per lane;
per-heat input journals, assertions, controller state, saved databases, hashes
and source snapshots. Monitor fresh HTTP, persistent-request probes, ping,
internal free/minimum/largest heap, SD presence/write errors, C5 online/version,
boot counter and heartbeat freshness. Save the retained heap mark before
starting a new measurement; prior low-heap failures are not erased as evidence.

The AIO internal-heap floor remains **40,000 bytes**. First harness FAIL/ERROR,
network probe failure, heap-floor breach, lost receiver/storage, unexpected boot
or dead monitor stops new work across ALL lanes and blocks phase promotion.
Use a shared external stop file and graceful cleanup. Complete an already
active operation only as needed for safe restoration; never continue subsequent
test cycles after a failure. Do not retry ambiguous injected commands or hide a
failed request with an unconditional retry. Keep Windows awake while running.

## Release blockers this run can address

| Release finding | Evidence from this plan | Limits still requiring disposition |
| --- | --- | --- |
| AIO USB/heap interruptions | Monitored race load, asset bursts, retained minima, UART/serial evidence | A pass qualifies only this exact candidate; intermittent solder/power issue has no proven root cause |
| Ethernet established-uptime connection stalls | Production connect-only retry plugin plus fresh/held/ping monitoring | Successful retry is evidence, not proof the gate stall itself is fixed |
| Lost/duplicate passes, heat 35 | Per-input journal, exact gate/live/database reconciliation | Original failure cause is not retrospectively proven |
| Event F05/advance/review | Repeated saved-result/review/next-heat assertions | Broader browser/two-tab/recovery checks remain separately identified |
| Native C5 USB compatibility | Production RH 4.5.1 driver with actual C5-Zero 1.2.6, races and persistence | RF/timing accuracy and Linux stable-port/replug tests remain open |
| SD persistence and crash-retained logs | Actual SD writes, save/export/restoration and log/boot monitoring | Power cuts, full/missing media and injected write failures are not inferred from endurance |
| Source/receiver/plugin compatibility | Explicit three-lane provenance and source snapshots | Mixed 1.2.5/1.2.6 is not automatic shipping approval |

## Explicit remaining coverage

The VTX rig was not attached at inventory. Unless independently confirmed and
added to a separate bounded RF plan, this run uses injected/manual crossings.
It cannot qualify independent eight-transmitter detection, physical crossing
timing, a camera reference or immunity to multipath. The live receiver RSSI
checks qualify data flow, not lap-detection accuracy.

Physical ELRS >=20-cycle/debounce/loss/binding/coexistence checks, speaker/beeper
and LED observation, real browser USB flashing, SD-writer repair of a physical
card, power-cut/full-media recovery and all-six-board smoke remain unqualified
without the corresponding fixtures/actions. Self-test interference and drifting
diagnostic request counters are known open findings; an endurance pass does not
disposition them. Do not run flash/EEPROM self-tests during qualification races
and then misrepresent their known disruption as clean racing evidence.

Final source freeze, six-board packages/filesystems, checksums, clean
install/upgrade/boot-slot recovery, release notes/known limits and public
merge/tag/flasher deployment remain separate release work. No automated run
certifies “every single aspect” of unavailable physical hardware.
