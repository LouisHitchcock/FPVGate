# FPVGate v1.7.2 Release

**Release Date:** April 24, 2026

## Upgrade Notes
- **No manual config reset required** - Config migrates automatically to v22
- **Full flash recommended** - This release includes firmware and web UI updates
- **SD card package unchanged** - `SD_Card.zip` is carried forward from v1.7.1
- **Holeshot logic validated** - Gate 1 handling remains consistent with v1.7.1 behavior
- **Built from current working tree** - Includes local (non-commit) holeshot hardening and `minLap` sanity validation changes present in this repo state

## What's New Since v1.7.1 (Highlights)

### Handcam + OSD
- Added a dedicated handcam overlay page with live RSSI graph support
- Added OSD menu entry updates in the web UI and webserver routing

### Calibration + Diagnostics
- Added RSSI debug popout tooling
- Reworked calibration live-update and persistence behavior
- Fixed debug overlay toggle reliability

### Race Controls, Sync, and Timing UX
- Added race countdown mode setting (`Less than 5` vs `10 Second Countdown`)
- Added and stabilized **Heat Minutes** behavior (time-based auto-stop) and related config migration handling
- Continued sync/race-flow hardening from the merged touchscreen branch
- Preserved Gate 1 (holeshot) exclusion in race stats and race-history analytics

### Heat Minutes (Time-Based Auto Stop)
- Added a dedicated **Heat Minutes** race limit so a race can auto-stop by elapsed time, not just lap count
- Value is persisted in config and migrated safely for existing installs
- Works alongside max laps, giving events a predictable duration cap
- Recommended sanity check after update: set a short Heat Minutes value and confirm race auto-stops on time

### Touchscreen/LCD System Work (Merged History)
- Large StarForgeOS-derived touchscreen/LVGL integration and race-screen work was merged into this release range
- Included fixes for display stalls, race start/stop sync behavior, and SD/LCD coexistence issues
- Included incremental UI improvements such as threshold visualization and race history loading behavior

### Storage, Boot, and Reliability
- Improved race-history loading and boot-time behavior to reduce SPI contention and startup stalls
- Included SD-card robustness fixes across race-history and LCD usage paths
- Included power/deep-sleep and board-specific stability updates from merged history

### Board and Platform Maintenance
- Refactored self-test to runtime capability detection with pass/fail/skip tri-state reporting
- Enabled FPVGate AIO LED support
- Consolidated AIO board definition and corrected AIO SD card pin mapping
- Updated ArduinoJson v7 compatibility and related runtime integration points
- Removed in-progress ELRS backpack code from `main` for release stability

### Localization and Release Packaging
- Added missing locale key coverage and additional i18n updates
- Included full multi-board binary packaging for this release

### Community Contributions
- Significant merged contributions from **racefpv** across this release range:
  - Touchscreen/LCD UI system and race-flow parity improvements
  - SD/LCD stability and race-history reliability work
  - DMA RSSI and board-level pin/power fixes
  - Deep sleep, power-switch, and related hardware-behavior updates
- `CONTRIBUTORS.md` has been updated with the expanded RaceFPV contribution summary

## Updating to v1.7.2

### Recommended update path
1. Back up config from the web UI (and SD backup if used).
2. Flash all four board binaries (`bootloader`, `partitions`, `firmware`, `filesystem`).
3. Reboot and reconnect to the web UI.
4. Open Configuration once and verify frequency settings, countdown mode, and lap limits.
5. Run a quick sanity race:
   - Gate 1 should appear as holeshot.
   - Fastest/median/best-3 should ignore Gate 1.
   - Max laps auto-stop should trigger on real laps, not Gate 1.
   - Heat Minutes should auto-stop race when time limit is reached.

### Web Flasher (Recommended)
Visit https://fpvgate.xyz/flasher.html

### Manual Full Flash
```
esptool.py --chip esp32s3 --port [COM_PORT] write_flash \
  0x0 [board]_bootloader.bin \
  0x8000 [board]_partitions.bin \
  0x10000 [board]_firmware.bin \
  0x410000 [board]_filesystem.bin
```

## SD Card
No new SD card content is required for this release.

## Documentation
- [User Guide](https://github.com/LouisHitchcock/FPVGate/blob/main/docs/USER_GUIDE.md)
- [Hardware Guide](https://github.com/LouisHitchcock/FPVGate/blob/main/docs/HARDWARE_GUIDE.md)
