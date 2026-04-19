# FPVGate v1.7.1 Release

**Release Date:** April 9, 2026

## Upgrade Notes
- **No config reset required** - Firmware unchanged, web interface only
- **Filesystem update only** - Only `littlefs.bin` needs flashing (or use the web flasher)

## What's Fixed

### Band/Channel Selector Bugs (Web UI)
Three related bugs in the band/channel selection logic have been fixed:

- **Band select shows empty after opening Pilot Info** - Frequencies shared across multiple systems (e.g. R5 = 5843 MHz exists in Analog R, DJI04-R, HDZero-R, WalkSnail-R) caused `setBandChannelIndex` to use the raw frequency table index as the dropdown position and overwrite with the last match. For R5, this landed on WalkSnail-R at index 18 - out of range for the 6-option analog dropdown, resulting in an empty selection.

- **Band resets to A when opening Settings after changing on Calibration screen** - `openSettingsModal` re-fetched config from the device on every open. Since `autoSaveConfig` has a 1-second debounce, the device still held the old value, causing the modal to overwrite the user's pending change with stale data.

- **`setBandChannelIndex` frequency fallback** - The fallback path used the frequency lookup array index directly as `selectedIndex` instead of finding the option by its band value in the filtered dropdown. Also lacked an early return, so the last duplicate match always won.

## Installation

### Web Flasher (Recommended)
Visit https://fpvgate.xyz/flasher.html

### Manual Flash (Filesystem Only)
Since this is a web interface fix, only the filesystem needs updating:
```
esptool.py --chip esp32s3 --port [COM_PORT] write_flash \
  0x410000 [board]_filesystem.bin
```

### Full Flash
```
esptool.py --chip esp32s3 --port [COM_PORT] write_flash \
  0x0 [board]_bootloader.bin \
  0x8000 [board]_partitions.bin \
  0x10000 [board]_firmware.bin \
  0x410000 [board]_filesystem.bin
```

## SD Card
No SD card changes required for this release.

## Documentation
- [User Guide](https://github.com/LouisHitchcock/FPVGate/blob/main/docs/USER_GUIDE.md)
- [Hardware Guide](https://github.com/LouisHitchcock/FPVGate/blob/main/docs/HARDWARE_GUIDE.md)
