# rc.3 corrective validation

The failed 5 November overnight run is retained under
`.dev/rc-evidence/overnight-20261105`. Corrective attempts have their own
directories under `.dev/rc-evidence/corrective-work-20261105`; failed attempts
must not be overwritten or turned into passing results.

The candidate retains C5MK 1.2.5. It uses pinned AsyncTCP 3.5.0 and
ESPAsyncWebServer 3.12.1 with the project network patch applied during builds.
The earlier null-client callback-only patch did not fix all close failures.
The final patch also serializes SSE disconnects and returns the number of
bytes accepted by lwIP even if output is temporarily deferred. Otherwise an
HTTP response can enqueue the same bytes twice. Full history responses under
load reproduced that corruption on the bench before the accepted-byte fix.

History retains its full in-memory index, matching its SD load behaviour;
only the list response is capped at 50 races. Saving and deleting a test race
must not make the oldest existing race disappear until reboot.

## Focused checks

Use a Python environment with the RH 4.5.1 dependencies, requests and
python-socketio. All commands run from the repository root.

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
npm test --prefix tests -- --runInBand
python tools/check_history_routes.py http://192.168.7.1
python tools/network_close_stress.py http://192.168.7.1 --seconds 60 --history-json --output .dev/network-check.json
```

The network check exercises normal SSE closes, interrupted asset responses,
TCP resets and gate-clock continuity. `--history-json` also validates large
history exports and retains malformed bodies and headers. Check
`historyMaxBytes`: an empty history does not exercise a large response.

Run the race acceptance harness against a fresh evidence directory, with the
RF rig off and isolated RH source/data. For example:

```powershell
python tools/race_day_acceptance.py --out .dev/rc3-acceptance-01 --config-template .dev/rc-evidence/overnight-20261105/rh-aio/config.json --rh-source ../rotorHazard/RotorHazard-4.5.1 --seconds 300 --lap-interval 1.2 --between-heats 0 --boards aio
```

The template supplies test-server settings; credentials are regenerated.
The harness uses the sibling `fpvgate-rh-plugin-release` plugin source.
It does not use the user's production RH database. Fixed calibration and
threshold-lowering settings apply only to these isolated deterministic tests;
adaptive calibration remains a separate feature to validate.

The harness verifies SD-backed storage by default, frequencies and thresholds,
waits for all heat slots and pilot assignments, journals running race IDs
before saving, waits for exact RH live counts before stop, and checks saved
records only after RH has finished saving. The appearance of a race-header
row does not mean its pilot/lap rows are complete. The harness waits for RH's
ready state and complete saved counts, and does not stop RH mid-save just
because a partial database snapshot is visible. Failed JSON bodies
and input attempts are retained. Unknown results are preserved and config
restoration is attempted independently. No blind lap-injection retries or
automatic baseline metadata imports are performed. It stops on the first
failed cycle by default; `--continue-on-failure` is a diagnostic option.
An interrupted or failed run returns a nonzero exit status. Inspect the
terminal JSON result and per-lane completion as well.

Both gates need available baseline Event/history storage before a dual-board
race qualification. LittleFS fallback must not be mistaken for a clean or
empty SD card. An eight-hour coordinator cannot qualify a lane that stopped
early. A focused PASS is not a release sign-off: follow it with an integrated
soak, realistic RF timing, full native-USB RH saving and remaining hardware
coverage from the overnight postmortem.
