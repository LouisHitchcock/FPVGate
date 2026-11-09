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
