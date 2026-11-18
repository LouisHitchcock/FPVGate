# Event Director layouts and workflow

Development source, 26 October 2026. Install matching firmware and filesystem.
These changes are not in the published Alpha 5 images.

## Set up and run an event

Enable Event Mode under Settings → User Interface. The Event tab has three
pages: Run event, Pilots & setup, and Results.

Guided setup walks through pilots, race rules, groups and a schedule preview.
Paste one pilot name per line or use the existing roster import. Choose the
number flying together, a channel band and rounds per group. One round gives
each group one race. Rebuilding replaces the schedule after confirmation;
existing results are retained. Review group membership and channels afterwards.

Selecting a scheduled race previews it without retuning the receiver. Prepare
this race explicitly loads its pilots, channels and format. Continue to Race
screen opens the existing live controls; preparing a race never starts it.
Use Skip race to explicitly omit a race without inventing a result. Skipped
races remain visible and can be selected and prepared later.

The timing checklist is a manual acknowledgement in this browser, not an RF
health measurement or a gate-side start interlock. A check is invalidated by
changes to the pilot's channel or Enter/Exit levels and resets on page reload.
Check timing in Calibration opens the normal calibration page.

## Choose a display

Settings → User Interface → Event Director offers Guided, Club and Custom.
Guided enables the setup wizard, explanations and timing checklist. Club uses
the schedule dashboard with fewer prompts. Changing an individual preference
selects Custom. Reset to preset restores the selected preset, or Guided when
Custom is selected. Preferences apply only to this browser.

Layout can be Auto, Schedule dashboard, One race at a time, or Full page
(original layout). Full page restores the single editor with grouping/channel
controls at the top, heats/groups/standings on the left, pilots on the right
and race formats below. Selecting a heat in this view loads it, as in the
original editor. Pending result review and shared workflow controls remain
available. Switching back restores the guided/dashboard presentation without
changing the Event. The choice is remembered in this browser.

Auto moves the
schedule below the current race on a narrow screen. The focused layout uses
that order at every size. Hide the full schedule for a current-race-only view.
Upcoming pilots, standings, detailed statistics and advanced schedule tools
can be shown independently. Setup and Results remain available in every view.
Storage errors, channel conflicts and pending result review cannot be hidden
by turning off explanations or standings.

Temporary storage-busy responses are retried. A genuine revision conflict
requires an explicit reload so another director's edits are not overwritten.

## Shared race workflow

The Race workflow controls on Pilots & setup are saved in the Event document:

- `schedule.requireReview`: require acknowledgement of each saved race.
- `schedule.auto`: prepare the next race after saving, or after confirmation
  when review is required. This never starts a race automatically.
- `schedule.autoChannels`: assign channels when generating groups. Turning
  it off keeps the pilots' channels for manual review.

New events enable review and automatic channel assignment. Existing events
retain their previous progression behavior until explicitly changed. Browser
display presets never rewrite shared workflow settings.

With review enabled, the gate saves the race, records its result, advances
the schedule position and stores `schedule.reviewRaceId`. It holds the loaded
group and refuses another Start until confirmation clears that marker. The
marker survives reopening the browser and rebooting the gate. It also applies
to races loaded outside the schedule. Compatible gate firmware is required
for this protection when browsers are closed.

Use Race History / Marshal for lap corrections. Refresh corrected results
copies saved laps into the Event by physical slot while retaining its frozen
pilot mapping. Confirmation checks saved race history again. If laps changed,
the corrected results are shown and require another confirmation. Missing
history or an incomplete slot mapping blocks confirmation. Revision conflicts
retain the draft; export it before explicitly reloading from the gate.

## Development checks

`npm test --prefix tests -- --runInBand` runs browser logic and configuration
regressions. `./tests/native/build_event_director.ps1` exercises the real gate
controller, including review blocking, skipped heats and reboot recovery.

`node tools/preview_event_director.cjs` serves a local UI sandbox at
http://127.0.0.1:8099 using the production Event scripts and an in-memory demo.
It does not emulate RF, live race controls, calibration or persistent storage.
Restarting discards the demo event. Physical RF accuracy and overnight
qualification remain separate from these UI checks.

## Bench verification, 26 October 2026

The attached C5MK AIO was updated over USB networking with matching app and
filesystem. A race driven by manual gate passes stopped at its lap target,
saved one Event result and held Group A for review. Another Start was rejected.
The production browser then confirmed the saved result and prepared Group B
without starting it. Desktop and 390px mobile views rendered with no page
JavaScript errors or horizontal overflow. The test race was removed and the
original configuration was read back and compared after restoration.

This validates the control/UI path on one board with manual passes; it does
not establish physical RF detection accuracy, multi-transmitter operation or
overnight stability. The development image still reports `1.9.0-alpha-5`;
it has not been packaged or published as a new release.

Final checks: 139 automated tests pass, the native Event controller harness
passes, and three concurrent loads fetched all 39 of 39 startup assets
completely. The device self-test reported 16 passes and two expected skips
(the unused RX5808 and absent SD card). The final UI asset served by the board
was compared by SHA-256 with its source.
