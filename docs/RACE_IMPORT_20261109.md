# Race import repair - 9 November 2026

## Findings

The Import Races UI posted the entire backup to `/races/upload`. The pinned AsyncCallbackJsonWebHandler defaults to a 16,384-byte body limit; this route did not override it. Multi-pilot backups readily exceed that limit. The UI did not inspect HTTP success or the JSON status and could report success for an error response. The backend already read multi-pilot fields; the evidence does not establish a new incompatible multi-pilot format. The user's specific file has not been supplied or replayed.

Other importer defects: a backup containing only existing timestamps returned ERROR, and a missing/non-array `races` collection was treated as an empty successful import. Import order could place old records ahead of new records under the 50-entry history-list cap.

## Change

The UI uploads complete races sequentially, retaining all pilots and metadata. Large aggregate backups no longer require a single large request. It checks HTTP status and the application status, stops at the first failed request, resets file input state, and refreshes any successfully imported prefix. File-read failures also reset the input.

The route accepts individual requests up to 256 KiB on PSRAM-equipped boards; boards without PSRAM retain the existing 16 KiB bound. Large individual races on those boards remain bounded rather than admitting an unbounded internal-memory allocation. The handler passes its already parsed JSON directly into RaceHistory, avoiding an extra serialized String plus a second JSON tree.

Collection/object/timestamp/array shapes are checked before writing a collection. Existing timestamps are skipped successfully without overwriting existing data. Storage failure stops the import, restores recorder ownership and returns ERROR; earlier successful records are retained. The resulting in-memory index is sorted newest first. Legacy single-pilot and multi-pilot JSON formats remain accepted. JSON metadata does not add transport of RSSI sidecar binaries.

## Validation and deployment

- All 179 Jest tests passed, including ten import regressions: large eight-pilot backups, legacy fields, HTTP 413/500, HTTP 200 with ERROR, partial failure and invalid files.
- Native production import/serialization methods with real pinned ArduinoJson passed: multi-pilot slot/frequency/threshold/lap preservation, legacy fields, duplicate no-op, malformed collection refusal before writes, newest-first order and storage-failure recorder restoration.
- Three existing history tests passed.
- Normal AIO firmware built successfully with two jobs (115.03 seconds). Shared import code is compiled by that target; an Ethernet-specific build was not repeated for this change.
- JS syntax and diff checks passed.

No firmware or UI filesystem was flashed. Both running soak lanes retain the explicitly archived installed application images; new local build outputs do not change their provenance. Host build activity is annotated in the watched run's `host-activity.jsonl`. The overnight race suite does not currently exercise import; these are offline regression results, not a physical import pass. After the diagnostic window, deploy matching application + UI and verify export/delete/import/readback of a real multi-pilot backup, plus duplicate import. Do not count this fix as device-qualified yet.
