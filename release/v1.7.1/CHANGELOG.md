# Changelog - v1.7.1

## [1.7.1] - 2026-04-09

### Upgrade Notes
- **No config reset required** - Config version unchanged (v16)
- **Web interface fix only** - Only `littlefs.bin` needs updating, firmware is unchanged

### Fixed - Band/Channel Selector (Web UI)

- **Band select empty after opening Pilot Info settings** (`setBandChannelIndex`)
  - Root cause: function used the raw `freqLookup` array index (0-21) as the `selectedIndex` of a *filtered* dropdown. The dropdown only contains bands for the active system (e.g. 6 options for Analog), so an index of 18 (WalkSnail-R) resolved to `-1` (empty selection).
  - Secondary root cause: no `return` after a match, so frequencies that appear in multiple band tables (e.g. 5843 MHz = R5, DJI04-R, HDZero-R, HDZero-CE ch3, WalkSnail-R) always resolved to the *last* match in the table rather than the first/correct one.
  - Fix: find the matching `<option>` by `bandDef.value`, switch system if needed, and `return` on first match.

- **Band resets to A when opening Settings modal after a Calibration screen change**
  - Root cause: `openSettingsModal` re-fetched `/config` from the device on every open and restored band/channel from the device response. Since `autoSaveConfig` debounces saves by 1 second, the device config was stale - it still held the previous band, overwriting the user's pending change.
  - Fix: removed band/channel restoration from `openSettingsModal`. The DOM is always authoritative after page load; `populateCalibFreqOutput` already syncs calib changes back to the main `bandSelect`/`channelSelect` before the modal can open.

- **`openSettingsModal` using frequency fallback instead of stored indices**
  - Root cause: `openSettingsModal` called `setBandChannelIndex(config.freq)` (the broken frequency-lookup function) instead of using the stored `bandIndex`/`channelIndex` fields that `onload` uses correctly.
  - Fix: superseded by the removal of band/channel restoration from `openSettingsModal` entirely.

- **Calibration shows wrong band (e.g. A6) after power cycle** (`saveConfig` / `bandSelect` corruption)
  - Root cause: the broken `openSettingsModal` fetch (even from a previous modal open with a slow network) would complete asynchronously and call `setBandChannelIndex`, setting `bandSelect.selectedIndex = -1`. When `saveConfig()` then fired (from the 1-second `autoSaveConfig` debounce), `bandSelect.selectedIndex === -1` caused the read block to be skipped and `selectedBandIndex` to default to **0 (band A)**. The device saved the wrong `bandIndex` to EEPROM, which persisted through power cycles.
  - Fix 1: removing band/channel from `openSettingsModal` eliminates the corruption source.
  - Fix 2: `saveConfig()` now falls back to reading from `calibBandSelect` if `bandSelect.selectedIndex === -1`, so even if `bandSelect` is ever in an invalid state, the correct band is saved.

### Added - Tests
- New `tests/` directory with Jest + jsdom test suite (`tests/band-select.test.js`)
  - 20 tests covering all four bug scenarios and their fixes
  - Bug reproduction tests confirm the broken behavior
  - Fix tests validate correct band/channel restoration for all systems (Analog, DJI, HDZero, Walksnail)
  - Race condition tests validate that calib changes are not overwritten by stale device config
  - Save corruption tests confirm the power-cycle A6 root cause and the fallback fix
