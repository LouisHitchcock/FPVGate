# Changelog - v1.7.3

## [1.7.3] - 2026-06-13

> **Upgrade Notice: SD Card Mandatory Update Required**
>
> This release introduces a new canonical `voice_*` directory structure for multilingual voice packs (English, German, Spanish, French).
>
> **You MUST update your SD card contents** after flashing this firmware:
> 1. Download `SD_Card.zip` from this release
> 2. Extract all folders to the root of your SD card
> 3. Overwrite any existing `voice_*` or `sounds_*` directories
>
> The firmware still reads legacy `sounds_*` directories as a fallback, but the web interface, voice selection, and self-test now expect the new `voice_*` layout. Failure to update the SD card will result in missing voice packs and broken audio.

### Added
- **FPVGate Solo Board** — New lightweight board target with minimal peripheral requirements (`23c2bda`)
- **Race Notes** — Add/edit notes per race via inline button or auto-open on race stop, persisted in race history (`c3d485c`, `0af398c`)
- **Configurable Race Analytics Panels** — Independently toggle Fastest Lap, Fastest 3 Consecutive, Lap Times, and Consistency panels (up to 3 at once) with always-on Best 3 Laps + Median stats box (`c2fe055`)
- **Multilingual Voice Packs** — German (de), Spanish (es), French (fr) ElevenLabs voice packs with canonical `voice_*` directory structure and legacy fallback aliases (`181cbed`)
- **Editable Calibration Results** — Enter/Exit RSSI and Min Lap Time values are now direct numeric inputs that can be adjusted before applying (`a97a614`)
- **WebTTS Locale-Aware Voice Selection** — Browser speech synthesis now auto-selects a voice matching the current UI language (`181cbed`)
- **SD Card Init Retries** — Up to 5 retries at 10-second intervals when SD card initialization fails transiently at boot

### Changed
- **Voice Selection Normalization** — Both firmware and frontend now normalize legacy voice values (`piper` to `default`, `voice_de` to `de`, etc.) on load and save (`181cbed`)
- **Default Voice** — Default voice changed from `piper` to `default` (canonical `voice_default_en` directory)
- **Voice Directory Structure** — Canonical `voice_default_en`, `voice_rachel_en`, etc. directories with `sounds_*` legacy fallback; webserver serves all paths (`181cbed`)
- **SD Card deferred init refactored** — Extracted `onSdCardReady()` helper, added retry loop with configurable attempts
- **FPVGate AIO NUM_LEDS set to 3** (`7cae9f8`)
- **FPVGate Solo board target** — New lightweight hardware target added (`23c2bda`)
- **Discord invite link updated** — Now points to correct server (`c7e19fb`)
- **Race Analysis section visibility** — Now driven by analytics panel toggles instead of sync mode alone; shows panels in both personal and sync modes (`c2fe055`)
- **OSD/Overlay cache-busting** — Added cache-busting headers for OSD and handcam overlay assets (`3bd8260`)

### Fixed
- **Storage null-guards** — Added null checks in `RaceHistory::saveRace`, `loadRaces`, `updateRace`, `updateLaps` to prevent crashes when storage backend is unavailable (`5bf6180`)
- **Race save promise handling** — `saveCurrentRace` now returns a Promise for proper chaining with race notes auto-open (`0af398c`)
- **Voice select value persistence** — Normalized voice values are written back to the select element to prevent stale invalid options (`181cbed`)
- **Duplicate CSS and typo fixes** — CodeRabbit review cleanup (`5bf6180`)
- **Audio test files** — Self-test now scans canonical `voice_*` directories with legacy fallbacks instead of hardcoded `sounds_*` paths
- **i18n race edit notes** — Added missing `item_notes` key for zh-CN locale
- **Heat Minutes documentation** — Clarified Heat Minutes behavior in v1.7.2 release docs (`f97e154`)

### i18n
- New locale keys added across all 5 languages (en, de, es, fr, zh-CN): race notes, analytics panel labels, calibration edit fields

### Complete Commit Inventory (v1.7.2..HEAD)
- `5bf6180` (2026-05-28) Apply CodeRabbit fixes: typo, duplicate CSS, 3-panel analytics default, storage null-guards
- `824f5b4` (2026-05-28) Merge branch 'main' into version/1.7.3
- `181cbed` (2026-05-20) Finalize multilingual voice packs and WebTTS locale behavior
- `a97a614` (2026-05-20) Add editable calibration results and polish wizard UI
- `1377746` (2026-05-18) Set FPVGATE_AIO NUM_LEDS to 3 (main)
- `7cae9f8` (2026-05-18) Set FPVGATE_AIO NUM_LEDS to 3
- `c2fe055` (2026-05-18) Split race analytics toggles and always-on stats
- `0af398c` (2026-05-18) Refine race notes flow and inline control spacing
- `c3d485c` (2026-05-18) v1.7.3 race notes, history persistence fixes, and language voice packs
- `3bd8260` (2026-04-13) Cache-bust OSD and overlay assets
- `23c2bda` (2026-04-08) Add FPVGate Solo board target and definitions
- `c7e19fb` (2026-04-07) Update Discord invite link
- `f97e154` (2026-03-29) docs: add explicit Heat Minutes notes to v1.7.2 release docs
