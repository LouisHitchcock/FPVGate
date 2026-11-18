# C5 race completion on the gate

Integrated into the refreshed Alpha 5 source and six-board packaging scope,
together with the consecutive-lap announcer fixes.
Physical closed-browser completion, failed storage recovery and all-six-board
qualification are still required; this docs pass does not claim those tests.

## Behaviour

With the C5 receiver selected, the gate owns race start, stop and history saving.
`C5RaceControl` runs in `loop()`; HTTP/LCD callers queue commands and the C5 task
keeps receiving samples while history is written. Non-C5 race control keeps its
existing behaviour.

- The roster, identities, minimum lap, maximum laps, heat time and track metadata
  are captured at the start. Gate 1 is recorded but does not count towards max laps.
- Each racer finishes at their own lap limit and stops accumulating laps. The
  race ends when every racer has finished. An enabled racer with no crossings
  remains unfinished; use a heat limit or manual Stop for a DNS/DNF.
- The configured heat time stops the race immediately, as the browser limit did.
  Zero laps/time means unlimited. The existing 64-crossing storage cap still
  applies; starts requesting more than 63 real laps are rejected.
- Automatic and manual stops save one history record with every racer's laps,
  including racers with no crossings. Legacy summary fields use the leader
  (most crossings, then lowest elapsed time). Stats and distance exclude Gate 1.
- The timer finalizes its RSSI capture before history attaches the sidecar.
  An entirely empty race creates no history record.
- Repeated stops do not create extra records. A failed save retains the race
  in memory, blocks Start/Clear, and can be retried with Stop. Power loss still
  loses an unsaved race; this is not a recovery journal.
- Browser lap/time auto-stops are disabled when the gate reports `gateManaged`.
  Reconnecting restores laps and the saved record ID without posting another
  race. Older browser tabs are also prevented from creating a duplicate through
  `/races/save` while the gate owns a current session.
- Browser speech and notes remain available with an open page. Unreleased alpha
  source now also records Event results and loads the next heat on the gate;
  see [Event progression](GATE_EVENT_PROGRESSION.md). Published Alpha 5 images
  are unchanged, and physical qualification still blocks release sign-off.

## API

`POST /timer/start?timestamp=<unix-seconds>` queues a C5 start and returns HTTP 202.
The timestamp is optional for non-browser callers. Without a valid device clock,
IDs advance from existing history (or uptime for an empty history); those IDs are
unique but do not provide an accurate calendar date.

`POST /timer/stop` queues a stop or retries a failed save; repeated requests are
safe. `POST /timer/clearLaps` only accepts an idle, saved session.

`GET /api/c5/race` adds these fields to the existing laps/roster response:

| Field | Meaning |
|---|---|
| `gateManaged` | Gate owns this C5 race lifecycle and persistence |
| `running` | Race is running |
| `busy` | A command or stop/save is in progress |
| `timestamp` | Current session ID, zero before a start/after Clear |
| `savedTimestamp` | Successfully saved history ID, otherwise zero |
| `saveFailed` | Persistence failed; Stop retries, Start/Clear are blocked |
| `eventManaged` | Firmware supports gate-side Events; not an Event-mode switch |
| `eventFailed`, `error` | Event-specific save failure and diagnostic message |
| `stopReason` | `manual`, `maxLaps`, `heatTime`, or empty |
| `finished` | Bitmask of racers who reached their lap limit |

Wait for `busy: false` and `running: false` before treating a stop as complete.
A successful HTTP stop response acknowledges the command, not a completed save.

## Verification

Install test dependencies with `npm install --prefix tests`. Run the native
tests from the repository root in PowerShell with C++17 `g++` on PATH:

```powershell
./tests/native/build_race_control.ps1
./tests/native/build_event_director.ps1
npm test --prefix tests -- --runInBand
```

The native harness compiles the real C5 detector and race controller with stub
Arduino clocks, configuration, timer and history writer. It covers RF filtering
and minimum laps, Gate 1, one/eight racers, observer slots, finished-pilot caps,
frozen settings, heat limits including millis rollover, empty races, save failure
and retry, queued Stop and duplicate prevention. It does not exercise real SD
writes, FreeRTOS scheduling or power loss.

Frontend tests run the real page functions in a sandbox: reopening a finished
race, waiting for persistence, retry controls, duplicate stop notifications,
notes/Events and avoiding browser auto-stop/save for gate-managed races.

Before release, flash matching firmware **and filesystem** to the bench boards.
Start a C5 race, close every browser tab, finish all racers, then reconnect and
check exactly one history record with the expected laps and an accessible RSSI
trace. Repeat with a heat limit, a DNS racer, manual Stop, two open tabs and a
page reconnecting during a stop. Verify failed-write recovery on real storage
and run the existing device/load tests. Keep existing history backed up.

For the end-user flow see [Racing](USER_GUIDE.md#racing). For packaging and
matching app/filesystem requirements see [Release process](RELEASE_PROCESS.md).
