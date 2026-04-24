# Changelog - v1.7.2

## [1.7.2] - 2026-04-24

### Upgrade Notes
- **No manual config reset required** - Config migrates automatically to `CONFIG_VERSION 22`
- **Full flash recommended** - Both firmware and filesystem changed across this range
- **SD card package unchanged** - `SD_Card.zip` carried forward from v1.7.1
- **Commit-range caveat** - `v1.7.1..HEAD` includes merged branch history with earlier author dates; this changelog explicitly reviews that full range

### Holeshot Logic Status
- **Validated as still correct** during release prep:
  - Gate 1 (holeshot) remains a distinct first crossing in firmware race accounting
  - Race analysis continues to exclude Gate 1 for fastest/median/best-3 metrics
  - Max-laps auto-stop still excludes Gate 1 and triggers on real laps only
- **No post-v1.7.1 functional regressions** were found in reviewed Gate 1 logic paths; core lap-detection changes in this range were mostly instrumentation, integration, or adjacent feature work
### Local Working-Tree Deltas Included in This Build (Not in Commit Inventory)
- `lib/LAPTIMER/laptimer.h` + `lib/LAPTIMER/laptimer.cpp`
  - Adds Gate 1 bootstrap arming state (`gate1Armed`)
  - Relaxes Gate 1 thresholding when `enter` is high relative to `exit`
  - Adds Gate 1-specific hold/peak margin behavior to avoid missed holeshot capture
  - Extends entered-gate timeout handling and updates debug visibility around Gate 1 capture
- `lib/CONFIG/config.cpp`
  - Adds `minLap` range sanity validation during EEPROM load and JSON input handling
  - Rejects out-of-range `minLap` values instead of accepting potentially corrupt data
- Release binaries in `release/v1.7.2` were built from this current repo state, so these local deltas are included in artifacts even though they are not part of `v1.7.1..HEAD` commit history

### Added
- Handcam overlay page with live RSSI graph and OSD entry (`696082d`)
- RSSI debug popout tooling in web UI (`58a0e1a`)
- Race countdown mode setting (`Less than 5` or `10 Second Countdown`) (`b297d25`)
- Runtime self-test capability detection with pass/fail/skip tri-state output (`fc683f6`)

### Changed
- FPVGate AIO LED capability enabled and release version bumped to 1.7.2 (`87c074c`)
- AIO board definition consolidation and SD pin cleanup (`4690049`, `2d8df0d`)
- Config migrations expanded to newer config versions, including countdown and max-heat behavior handling (`lib/CONFIG`)
- Touchscreen merge history integrated into `main` via merge commits, bringing race history, LCD UI, power, and DMA-related work (`9699ce1` plus merged history listed below)

### Fixed
- Debug RSSI overlay toggle reliability (`b8ba109`)
- Calibration live-update/persistence and band-channel sync issues (`58a0e1a`, `0dafdaf`, `b821c2d`)
- ArduinoJson v7 API compatibility and webserver runtime stability (`742e82f`)
- FPVGate AIO SD card MOSI/MISO assignment (`2d8df0d`)
- ELRS backpack in-progress code removed from `main` to stabilize release branch (`e15544c`)

### Detailed Review by Workstream (all commits in range were reviewed)
- **Web UI race diagnostics and overlays** (`696082d`, `58a0e1a`, `0dafdaf`, `b8ba109`, `b821c2d`):
  - Added dedicated handcam overlay and RSSI visualization support
  - Added RSSI debug popout and improved calibration update/persistence flow
  - Tightened debug overlay toggle behavior and web UI state refresh logic
- **Race flow and analysis behavior** (`b297d25`, `d02b596`, `740a171`, `a9313da`, `9699ce1`):
  - Expanded countdown behavior control
  - Continued sync between LCD and web race flow
  - Kept Gate 1 treatment consistent across timer, stats, and history displays
- **Self-test/runtime capability model** (`fc683f6`):
  - Moved self-test evaluation toward capability-driven runtime checks so unsupported hardware paths can cleanly report skip instead of false fail
- **Board/platform maintenance and release hardening** (`87c074c`, `4690049`, `742e82f`, `2d8df0d`, `b614871`, `3f0149c`, `917cd93`, `844176c`):
  - Consolidated and corrected board definitions and pin mappings
  - Updated compatibility for newer dependency expectations
  - Kept power and board-specific reliability updates flowing into the merged history
- **Touchscreen/LCD merged history** (`e795e6d` through `565d8f3`, merged to main by `9699ce1`):
  - Large set of race UI, LCD, storage, DMA, deep sleep, and wiring/stability changes from the touchscreen branch now present in the reviewed range
- **ELRS backpack scope control** (`a7757c3`, `796fa42`, `68e9b49`, `ad327ef`, then removal in `e15544c`):
  - Experimental ELRS backpack work entered history then was intentionally removed from `main` before this release packaging
- **Localization and release packaging** (`2fcfb02`, `f68924e`):
  - Added missing locale key coverage
  - Added previous release binaries and SD assets in repository history

### Complete Commit Inventory Reviewed (`v1.7.1..HEAD`)
- `696082d` (2026-04-23) Add handcam overlay with live RSSI graph and OSD menu entry
- `87c074c` (2026-04-21) Enable FPVGateAIO LED support and bump version to 1.7.2
- `fc683f6` (2026-04-21) Refactor self-test to runtime capability detection with pass/fail/skip tri-state
- `b821c2d` (2026-04-21) fixed various bugs
- `0dafdaf` (2026-04-21) Rework RSSI calibration + band/channel sync and webserver cleanup
- `58a0e1a` (2026-04-21) Add RSSI debug popout; fix calibration live-update and persistence
- `b297d25` (2026-04-21) Add 'Race Countdown' mode setting (Less than 5 / 10 Second)
- `b8ba109` (2026-04-21) Fix debug RSSI overlay not appearing after toggle
- `e15544c` (2026-04-19) Remove in-progress ELRS Backpack code from main
- `2d8df0d` (2026-04-19) Fix FPVGATE_AIO SD card MOSI/MISO pin assignment
- `742e82f` (2026-04-19) Fix ArduinoJson v7 API, remove ESP32C3, fix web server TCP restart
- `4690049` (2026-04-19) Consolidate FPVGate AIO board, revert SD pin/speed changes
- `9699ce1` (2026-04-12) Merge touchscreen mode with race history fix
- `565d8f3` (2026-04-10) Merge main into feature/touchscreen: resolve config.h and script.js conflicts
- `f68924e` (2026-04-09) Add v1.7.1 release binaries and SD card
- `2fcfb02` (2026-04-09) Add missing port_option locale key to all languages
- `844176c` (2026-04-05) make sure we soft power off the novacore completely
- `917cd93` (2026-04-04) update novablade board on/off pin
- `ad327ef` (2026-03-28) goggle link working
- `68e9b49` (2026-03-28) get initial espnow working correctly
- `796fa42` (2026-03-28) more elrs espnow work
- `a7757c3` (2026-03-28) initial pass of elrs backpack support
- `8431b37` (2026-03-21) start adding different tones when using a passive buzzer
- `7cfb25e` (2026-03-21) get gyro working for screen flip
- `976c4a1` (2026-03-21) furthur improve deep sleep
- `7dde54c` (2026-03-21) use a soft power button on gpio16 in place of physical on/off swtich at battery
- `2bca3b0` (2026-03-20) comment cleanup
- `6cc4bdb` (2026-03-20) fix a web server overriding waveshare battery divider bug
- `314b3aa` (2026-03-20) implement better task not found fix, fix a bug where saving to eeprom would cause rssi readings to lock up
- `2790cff` (2026-03-20) fix rssi with dma mode, fix battery readings, fix task reset spam messages, disable leds for touchscreen system
- `e5bb7b4` (2026-03-20) move rssi on touchscreen to gpio8 so dma can work properly
- `33496b0` (2026-03-20) fix pinout issues causing usb errors and rssi issues on waveshare boards
- `32aa465` (2026-03-19) fix merge conflicts with upstream
- `e238968` (2026-03-12) Merge branch 'feature/touchscreen' of github.com:LouisHitchcock/FPVGate into feature/touchscreen
- `3f0149c` (2026-03-04) Add FPVGateAIO and XIAO S3 Plus board definitions with v1.6.2 release
- `db4208e` (2026-03-02) remove unused cluster.yaml
- `b2944c5` (2026-03-02) get dma mode working on touchscreen board target
- `b614871` (2026-03-02) Fix build configuration for non-LCD boards
- `eb02eaa` (2026-03-02) Merge pull request #6 from RaceFPV/feature/touchscreen-dma
- `3dc5fbc` (2026-03-02) fix a huge bug related to sd card not being present causing complete lcd failure
- `5b00cbd` (2026-03-01) Optimize boot time with yields during race loading
- `13bd214` (2026-03-01) Fix race history loading from SD card
- `d809588` (2026-03-01) Merge pull request #5 from RaceFPV/feature/touchscreen-startsync
- `a9313da` (2026-03-01) fix more display stall bugs, add a booting overlay to give lcd/sd a chance to bootstrap, make start 10 seconds and sync events between lcd and web interface
- `740a171` (2026-02-26) get start/stop on lcd to work like web version, track latest laps on lcd, get sd card and lcd to properly share pinout without crashes/conflicts
- `fe7ec10` (2026-02-26) Merge main into feature/touchscreen - add I2S audio support alongside LCD UI
- `27ad9ea` (2026-02-26) Update racefpv contributions with layout and SD card improvements
- `3056c88` (2026-02-26) Fix tab swiping on racing screen
- `f0d0805` (2026-02-26) have the sd card auto create folders on startup, throttle some serial spam messages, make sure sd card doesnt interrupt start stop race commands
- `1926c6c` (2026-02-25) switch touchscreen lvgl to percentages instead of hardcoded pixel dimensions, add a bit better protections against sd card read/write causing display lockup
- `82bbddc` (2026-02-26) Merge pull request #3 from RaceFPV/feature/touchscreen
- `d894f92` (2026-02-25) fix a hardcoded path issue with waveshare target
- `8341578` (2026-02-23) Add threshold visualization to racing tab RSSI display
- `1c52a12` (2026-02-23) Add threshold visualization to calibration screen
- `d02b596` (2026-02-23) Fix Racing tab timer displays and manual lap handling
- `5e85b45` (2026-02-23) Add battery voltage and percentage display to LCD UI
- `d977f9b` (2026-02-23) Implement lazy loading for race history to eliminate boot-time SPI contention
- `9ba1f5e` (2026-02-22) Implement iOS-style tabbed UI with swipeable pages
- `5380c50` (2026-02-22) Fix critical SPI bus stability issues and add power switch support
- `d0941d0` (2026-02-21) Add racefpv (StarForgeOS) to contributors, update LCD documentation
- `e795e6d` (2026-02-21) Port LCD touchscreen UI from StarForgeOS with countdown overlay and bidirectional sync
