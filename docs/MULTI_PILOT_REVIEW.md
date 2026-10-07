# FPVGate multi-pilot review

Reviewed 7 October 2026. Scope: C5 receiver/timing, configuration, web race UI,
calibration, SD recording, history and marshalling, plus LCD, audio, overlays,
RotorHazard, transports and webhooks.

## Implemented

- **Exclusive Multi mode.** C5 selection gives effective mode 3 in firmware and
  UI. Personal/Master/Slave/RotorHazard roles and chained devices are unavailable.
  Firmware ignores stale sync roles and rejects incoming remote laps. Returning
  to a conventional receiver restores conventional mode controls.
- **Race view.** Pilot cards rank by crossing count, then cumulative time. They
  show total at the last crossing, laps excluding Gate 1, last/best lap and
  finish state. The detailed lap matrix remains. The single-pilot counter and
  manual-lap control are hidden for C5. One-racer C5 heats use the same view
  without duplicate browser announcements.
- **Calibration.** Setup steps, explicit selected-pilot control, capture actions
  above the graph, collapsible diagnostics and wider/mobile pilot cards.
  Calibration requires a connected receiver and stopped race; weak captures
  retain existing thresholds. The API rejects channel/gain/threshold changes
  during a C5 race. Saved status now waits for the actual configuration response.
- **Eight-channel recording.** SD captures all physical C5 slots at nominal
  20 ms cadence. Frames contain elapsed timestamps and eight peak-held RSSI
  values scaled to 0–255. Capture peaks are independent of the debug display.
  Fixed staging buffers keep sampling off SD writes; gaps do not shift later
  frames along the time axis.
- **Pilot-aware history.** Slot, frequency and thresholds survive save, load,
  import and download. Physical slot IDs correctly map sparse rosters.
- **Marshalling.** Select a pilot to move/add/delete/recalculate crossings or
  type times when its trace is unavailable. Optionally overlay all eight
  channels. Edits survive switching; one save updates every pilot and the
  legacy leader summary. Multi-pilot statistics exclude Gate 1. Empty results
  are allowed when removing all false crossings from a pilot.
- **Compatibility.** v1 single-channel sidecars retain their reader. Legacy
  synchronized races expose the local trace only for their local pilot;
  remote pilots use typed entry. Missing/corrupt traces fall back to typed entry.

The race presentation was informed by RotorHazard's separation of leaderboard,
per-node laps and node tuning in its [Run screen source](https://raw.githubusercontent.com/RotorHazard/RotorHazard/main/src/server/templates/run.html).

## Recording contract

The `.rssi` file retains the 12-byte FGRH header. Byte 4 is version 2 for C5;
bytes 5–6 are nominal interval (uint16 LE); bytes 7–10 count frames (uint32 LE);
byte 11 marks truncation. Each following 12-byte frame is elapsed milliseconds
(uint32 LE), then eight RSSI bytes in physical slot order 0–7. Version 1 remains
one byte per sample with an implicit time axis.

`GET /api/marshal/rssi?timestamp=...` returns v2 as `application/octet-stream`
using bounded file reads. v1 retains JSON. The browser checks length, version
and increasing timestamps. The 45,000-frame cap is approximately 15 minutes /
540 KB for C5. Graph points are review samples, not detector timestamps:
edited crossings snap to roughly 20 ms resolution under normal load. Long
stalls appear as gaps.

## Next priorities

| Priority | Area and evidence | Recommended change |
| --- | --- | --- |
| P1 | `data/script.js` owns C5 finish announcements, all-pilots-finished stop and heat timeout. | Move completion, timeout and automatic saving into a device-owned race controller. Closing a browser must not affect race rules or persistence. |
| P1 | `lib/C5LINK/c5multipilot.h` caps each pilot at 64 crossings and pending events are bounded. | Define visible overflow behaviour and recovery from the authoritative snapshot. Stress-test simultaneous passes and SSE reconnects. |
| P1 | `/api/c5/race` snapshots lap arrays while browser roster metadata comes from current configuration. | Snapshot identities, channels, thresholds and race rules at start, with a race ID on every event and response. |
| P1 | `lib/LCD_UI`, `lib/AUDIO/audio.cpp`, `data/osd.js` and `lib/TRANSPORT` primarily consume single-pilot events. | Add a common pilot-tagged event contract, then onboard speech, LCD standings, USB clients and OSD pilot selection. Browser support does not imply these consumers support eight pilots. |
| P2 | `lib/ROTORHAZARD/rotorhazard.cpp` uses one node index. | Add C5-slot-to-RH-seat mapping and a compatible companion-plugin contract before offering RH integration for Multi. It is currently disabled with C5. |
| P2 | `lib/WEBHOOK` exposes generic events; multi-pilot LEDs and announcements partly originate in the browser. | Emit pilot ID, colour, crossing timestamp and race ID from the device. Define ordering/deduplication for simultaneous crossings and multiple clients. |
| P2 | Minimum lap time is now saved for recalculation; other historic race rules are not fully saved. | Persist heat format, max laps and DNS/DNF/finished status as a start-of-race snapshot. |
| P2 | JSON downloads omit the binary RSSI sidecar. | Add a complete race export/import bundle and test rollback on interrupted edits or SD failures. |
| P2 | New UI strings are English; legacy timeline/distance widgets use leader or single-pilot fields. | Add translations, pilot-selectable playback and per-pilot distance/finish summaries. Distinguish race-wide results from the leader summary. |

## Verification and hardware follow-up

Frontend tests cover eight-slot decoding, timestamp gaps, corrupt captures,
sparse slot mapping, edit retention, legacy typed fallback and saving all
eight pilots without changing the other pilots' laps. Firmware builds cover
Seeed XIAO ESP32-S3 and FPVGate AIO. No device was flashed.

Still requires a physical eight-pilot session: compare peaks and crossings,
interrupt the link, test slow/full SD cards, verify stop/save/reload, and measure
timing with concurrent downloads and multiple clients. A local headless Edge
fixture verified eight pilot cards, v2 loading, slot-8 selection, switching and
saving all pilots with no page errors. Desktop race/marshal and mobile calibration
screenshots were reviewed. Actual touchscreen and device-network testing remain.
