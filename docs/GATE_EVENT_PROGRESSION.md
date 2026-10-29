# Gate-managed C5 Event progression

Unreleased alpha source work, 25 October 2026. Existing published Alpha 5
images do not acquire this implementation just because their source branch
or documentation changes. Build matching firmware and filesystem; physical
qualification is still outstanding.

## Operating contract

With C5 and Event Mode enabled, load a valid heat and wait for the Event
editor's save acknowledgement before Start. The gate restores that heat's
slots, calibration and format before starting, then freezes the pilot mapping,
names, rules, event/group labels and scheduled step for that race.

Completion saves history first, appends one Event result, advances the schedule
position and, with automatic progression enabled, loads the next group. It
does **not** automatically start another race. Rotate and each-group-repeat
blocks are supported. At schedule end, or if the next heat is invalid, the
active heat is cleared without discarding the completed result. With automatic
progression off, the current heat remains loaded; explicitly load the desired
next heat. An ad-hoc group with no scheduled step does not advance the schedule.

The browser can be closed throughout the race and completion. Reopening it
refreshes Event results and the new live configuration, while the finished
race display keeps its original roster. Speech, seeding and editing still need
a page. Conventional receiver race completion is unchanged.

## Persistence and concurrency

- `/event.json` retains the version 3 editor schema and adds server-owned
  `gateRevision`. Every accepted edit or result advances it. Stale edits return
  HTTP 409 instead of silently overwriting another tab's changes/results.
- The editor serializes writes and flushes pending edits before browser Start.
  On conflict, export your draft if needed, then use **Reload from gate**;
  automatic refresh does not discard an unsaved draft.
- Event reads, uploads and commits share a lease. Editing is rejected during
  an Event race. A busy reader/upload may require retrying Start or Stop.
- Before the timer starts, `/event-session.json` records the frozen heat.
  If that write fails, the timer does not start. After a result save, it is
  removed. A reboot can reconcile a saved history record against this journal
  without duplicating the Event result or advancing twice.
- Failed history/Event writes block Start/Clear. Correct storage and retry
  Stop. History already saved is not appended again. Do not remove the journal
  or replace the event file manually while recovery is pending.
- Replacements use a staged file and `.bak` rollback. Startup restores a backup
  only if the destination is missing; an existing committed destination wins.
  This is application-level recovery, not a guarantee against damaged media.
- A reboot **during an unsaved race still loses its laps**. The journal binds
  a heat to an already saved race; it does not log every crossing. An entirely
  empty race creates neither a history record nor an Event result.
- Event documents are limited to 512 KiB, with a separate 48 KiB JSON allocation
  budget for configuration. Historical result bodies are streamed in bounded
  windows. Oversize/malformed uploads are rejected without replacing the event.
  Export/archive large events; unlimited historical growth is not supported.

`GET /api/c5/race` exposes `eventManaged`, `eventFailed`, `error` and frozen
roster identities alongside the [race status fields](GATE_RACE_COMPLETION.md#api).
`eventManaged` denotes firmware support, not proof that Event Mode or a heat
is currently loaded. Older firmware retains browser-side Event recording.

## Verification and remaining qualification

```powershell
./tests/native/build_race_control.ps1
./tests/native/build_event_director.ps1
npm test --prefix tests -- --runInBand
python -m unittest discover -s tests -p test_package_release.py -v
```

The Event harness compiles the real controller, director, detector and
ArduinoJson with simulated history/storage. It covers frozen identities/rules,
rotate/each schedules, exhausted/invalid next heats, large prior results,
revision conflicts, failed writes, Stop retries and reboot reconciliation.
Jest also compiles the actual Storage replacement methods against injected
rename/remove/mutex failures. These tests do not emulate real flash wear,
SD power-loss behavior, RF reception or FreeRTOS timing.

Before release, on each applicable shipping board:

1. Back up history/Event data and flash matching app/filesystem.
2. Load two different pilot groups. Close every page, finish the first heat,
   reopen and verify one history record, one correctly mapped Event result,
   the next group's channels and unchanged finished-race identities.
3. Repeat using heat timeout with a DNS pilot, manual Stop, automatic
   progression disabled, schedule exhaustion and an invalid next heat.
4. Test two tabs: stale edits must fail visibly without removing results.
5. Safely induce storage-write failure; confirm Start/Clear block and Stop
   retry records once. Test controlled reboot after history save, after Event
   commit and during an unsaved race. Record actual recovery and lost data.
6. Repeat on LittleFS fallback and SD where supported, including near-capacity
   storage; check heap headroom, UI/USB/Ethernet responsiveness and RH passes.

Use an explicitly authorized hardware session. No offline test establishes
six-board or independent eight-transmitter qualification.
