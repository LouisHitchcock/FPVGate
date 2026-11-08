# Independent retry watchdog

The original retry worker could stop the whole run when its status-file rename
failed. The independent process watchdog now treats worker crashes, unexpected
exits and missing progress as recoverable failures within the original deadline.

`tools/watch_retry_race_day.py` launches `retry_race_day.py` in unique
`generation-NNN` directories. On failure it saves exit details, traceback output
and an alert record, requests graceful stop of orphaned gate tests, waits for
those processes to exit, then starts a fresh worker using the same immutable
initial-run anchor. The worker rechecks original board baselines before testing.
A retry never renews the time budget. No hardware reset or reflash is implied.

The watchdog journal and console logs are separate from worker status files.
Locked watchdog status writes produce error records without disabling recovery.
If safe cleanup cannot complete, it records RECOVERY_BLOCKED and launches no
overlapping tests. At the deadline it requests stop and permits cleanup only.
Window completion is not a board qualification pass; retain every failed attempt.

Logs: `watchdog.json`, `events.jsonl`, `alerts/`, generation console logs and each
generation's unchanged per-attempt diagnostics. Existing results are not replaced.

## Launch

Use the RH Python environment. Choose a fresh output directory. By default,
the deadline comes from the supplied initial run. Only an explicit `--start-now`
creates a new window; automatic recovery does not use that option.

```powershell
C:/tmp/fpvgate-rh451/Scripts/python.exe tools/watch_retry_race_day.py `
  --initial-run .dev/three-hour-20261107/run-01 `
  --out .dev/three-hour-20261107/new-watchdog-window `
  --seconds 10800 `
  --config-template .dev/rc-evidence/rc4-20261105/rh-debug-template-8h.json `
  --start-now
```

The explicit new-window anchor retains the source baseline for identity and
restoration checks. A configuration mismatch waits for readiness; it does not
silently overwrite a user's changed settings.

## Validation (no hardware requests)

Twelve tests passed across retry budget/status writing and watchdog recovery.
Real subprocess fixtures exercised crashes, stalls, status-write failure and
orphan cleanup before replacement. Matcher tests reject sibling/unrelated
processes. An expired window starts no worker. Persistent recovery proof is
`.dev/watchdog-validation-20261107/`: two worker crashes were automatically
recovered, earlier results retained, and the fixed deadline preserved. This is a
harness recovery drill, not a gate pass. The earlier hardware run remains
incomplete. No new hardware window was started as part of this repair.
