# History filters and access to older races - 9 November 2026

The AIO had 87 stored races while the history endpoint/UI exposed only the newest 50. Logs showed the user's backup import processing 50 existing timestamps, not new rows. The exact user-selected file/date has not been supplied, so this establishes duplicate/cap behavior rather than identifying their individual race.

## Behavior

- Filter by pilot name/callsign, inclusive local race-date range, minimum/maximum completed laps, imported records or imports in the last 24 hours/7 days/30 days, and text in race name/tag/track/notes.
- Sort by newest/oldest race date, latest import, most/fewest laps. Multi-pilot totals combine all pilots, excluding each Gate 1 and without counting the legacy mirror twice. This default is explicit in the UI; the user's optional lap-count preference remains unanswered.
- Clear controls and show matched/total counts. Filtered/sorted cards retain original indices for edit/download/delete/details. Hiding an expanded record stops playback; details DOM survives an empty view.
- The browser obtains older history through timestamp-cursor pages of at most 50 records and applies filters locally. A new race arriving between pages cannot shift the older cursor. Legacy `/races` and server export responses retain their capped shape; the UI's Download All Races builds its complete backup from all fetched pages in browser memory. A failed page retains the previous loaded history and reports an error. Repeated/invalid cursors cannot loop forever.
- Persist optional `importedAt` separately from the race timestamp. Client import time is preferred (with device-clock fallback); old files load with zero/unknown import time. Re-importing an existing race updates only this local metadata using the stored record, preserving saved pilot/lap data. A storage failure is reported. No synthetic import dates are backfilled. A repeat import in the same second needs no metadata rewrite.
- New labels use the established English fallback when a locale lacks them.

## Verification

191 Jest tests pass, including filter/date/lap/import combinations, stable card indices, bounded-page loading, cursor failure, details/playback behavior and full backup export. Native production serializer/import tests cover cursor pagination with a concurrent new record, immutable ownership, malformed files, duplicate metadata update without lap/name replacement, recorder ownership and import-time serialization. Three history tests and the native Event fixture pass. AIO application and clean filesystem builds succeed with two jobs.

Application/UI deployment and real-device pagination/filter verification are pending at this source checkpoint. The prior failed soak remains ended by the user; no stable release or new soak pass is claimed.


## AIO installed and verified - 9 November 01:34 UTC

Source 2953af2 is committed/pushed and installed on the AIO with its matching clean UI filesystem. Application: 1,494,832 bytes, SHA256 `040cf63bbaa757f9019631aba32c4e3114c3ed7c37592c56c668b638cdb9af56`. All 32 served assets match the staged source. Used network OTA, temporarily quiescing C5 frequencies, then restored and verified config/history/Event/tracks; optional importedAt=0 is normalized when comparing legacy responses. C5 firmware is unchanged. The earlier full backup showed a UI-only LittleFS; SD/NVS remain intact. Ethernet was not flashed.

On-device Node harness executed the served history loader, import, filter and export functions (DOM/FileReader/download stand-ins, real API). It fetched all **87 original races** in 50/37 pages. A temporary race older than every existing race was imported, bringing the view to 88 in bounded 50/38 pages. Combined pilot + last-24-hour import + exactly-16-completed-lap filters selected it with its original card index; min-17-lap filter excluded it. Re-import updated/retained import metadata without duplicating or altering its saved laps/race timestamp. Download All serialized all 88 records. Cleanup removed the temporary record and deep comparison confirmed all 87 original records remained unchanged. This is functional device/API evidence, not manual browser-click, physical RF or endurance qualification.

Evidence: `.dev/history-filters-20261109/install/install.json` and `device-smoke.json`; private backup/state files remain local. The user-ended failed soak stays stopped. Refresh the AIO page to load the new controls. Old imports have unknown/zero import time until re-imported; no dates were fabricated for them.
