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


## AIO deployment and on-device import smoke - 9 November 00:59 UTC

The user explicitly ended the failed soak to flash the AIO. Both active test lanes completed baseline restoration and the watchdog/retry processes were stopped; no automatic soak resumption is scheduled. Prior failed attempts and the final intentional stop remain recorded. Ethernet was not flashed.

AIO S3 application from 6ff052a is installed: 1,493,824 bytes, SHA256 `6e750de59671ee6aef4c6de5d48d429d24675d5982dfda4cff8ab1cdb7f39038`. The matching UI is installed and all 31 served assets compare byte-for-byte with the staged sources. A full 8 MB flash backup was read/digest-verified before writing. Only the active app1 and LittleFS partitions were written and hash-verified; partition table, NVS and SD contents were retained. The filesystem backup contained only UI assets. Private backup/device images are under `.dev/aio-import-install-20261109/`, not release artifacts. The backup was taken with receiver frequencies temporarily zeroed; the original configuration is in before.json and has been restored.

ROM USB enumerated as COM22, normal application as COM23. The stock reset left the volatile force-download bit set; clearing RTC_CNTL_FORCE_DOWNLOAD_BOOT and issuing RTC system reset returned the device to the app. Preserve the initial preparation/verification failure reports (Windows tool absolute-path handling and a verification-script NameError) alongside the final PASS; neither required another image write.

On-device test executed the served Import Races function through a Node/FileReader stand-in against the real API: a **22,922-byte, eight-pilot** saved race imported successfully, retaining every pilot's identity/slot/frequency/thresholds/lap array. A repeat import produced no duplicate. The temporary record was deleted and original history matched. Config, history, Event and tracks also match the pre-flash baseline. C5 remains 1.2.6-d6d7, online and streaming fresh records. This is functional import evidence, not physical browser-click, RF timing or endurance qualification. Refresh the browser page to load the new UI.

Final evidence: install.json, completion.json, import-smoke.json and post-smoke.json in the local installation directory. Wider release blockers remain open. Ethernet import deployment/verification is pending.
