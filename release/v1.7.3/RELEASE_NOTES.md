# FPVGate v1.7.3 Release Notes

**Release Date:** June 13, 2026
**Type:** Minor — New features, multilingual voice packs, new board support

---

## Upgrade Notice: SD Card Mandatory Update

**You MUST update your SD card contents when upgrading to v1.7.3.**

This release introduces a new canonical `voice_*` directory structure for multilingual voice packs. Download `SD_Card.zip` from this release and extract all folders to the root of your SD card, overwriting any existing `voice_*` or `sounds_*` directories.

---

## What's New in v1.7.3

### Race Notes
Add and edit notes during or after a race. Notes are persisted in race history and visible in the race detail view. An auto-open-on-stop option is available in configuration.

### Configurable Race Analytics Panels
Independently toggle Fastest Lap, Fastest 3 Consecutive, Lap Times, and Consistency panels (up to 3 at once). The Best 3 Laps + Median stats box is always visible. Works in both personal and synchronized race modes.

### Multilingual Voice Packs
German, Spanish, and French ElevenLabs voice packs are now included alongside English. Voice packs use a new canonical `voice_*` directory structure:
- `voice_default_en` (default English)
- `voice_rachel_en` (alternate English)
- `voice_german_de` (German)
- `voice_spanish_es` (Spanish)
- `voice_french_fr` (French)

Legacy `sounds_*` directories are still read as a fallback, but the web interface and self-test now expect the new layout.

### Editable Calibration Results
After running the calibration wizard, Enter/Exit RSSI thresholds and Min Lap Time values are now displayed as editable numeric inputs. You can fine-tune the values before applying them.

### WebTTS Locale-Aware Voice Selection
Browser speech synthesis (WebTTS) now auto-selects a voice matching your current UI language when available.

### FPVGate Solo Board Support
New lightweight board target for minimal peripheral configurations. Same flash layout as XIAO ESP32S3 (8MB, custom_8mb.csv).

### SD Card Init Retries
Up to 5 retries at 10-second intervals when SD card initialization fails transiently at boot.

---

## Supported Hardware

**Recommended:**
- ESP32-S3 DevKitC-1 (8MB Flash)
- Seeed Studio XIAO ESP32S3 (8MB)
- FPVGate AIO V3 (XIAO ESP32S3, 8MB)

**Expert Mode:**
- ESP32-S3 Super Mini (4MB Flash)
- LilyGO T-Energy S3
- XIAO ESP32S3 Plus (16MB Flash)
- FPVGate Solo (XIAO ESP32S3, 8MB)

---

## Installation

### Web Flasher (Recommended)
Use [https://fpvgate.xyz/flasher.html](https://fpvgate.xyz/flasher.html) and select your board and version.

### Command Line
Download the board-specific zip from the release assets and flash using esptool:

```bash
# ESP32-S3 DevKitC-1 (8MB)
esptool.py --chip esp32s3 --port COM3 write_flash -z \
  0x0 bootloader.bin \
  0x8000 partitions.bin \
  0x10000 firmware.bin \
  0x410000 littlefs.bin

# ESP32-S3 Super Mini (4MB)
esptool.py --chip esp32s3 --port COM3 write_flash -z \
  0x0 bootloader.bin \
  0x8000 partitions.bin \
  0x10000 firmware.bin \
  0x290000 littlefs.bin

# XIAO ESP32S3 Plus (16MB)
esptool.py --chip esp32s3 --port COM3 write_flash -z \
  0x0 bootloader.bin \
  0x8000 partitions.bin \
  0x10000 firmware.bin \
  0x610000 littlefs.bin
```

Each board zip includes a `FLASH_INSTRUCTIONS.txt` with the exact commands for that target.

---

### SD Card Setup
1. Download `SD_Card.zip` from this release
2. Extract all folders to the root of a FAT32-formatted SD card (max 32 GB)
3. Insert into the ESP32-S3
4. Reboot — firmware will auto-detect and use SD card for voice files and race history

---

## Notes
- Settings are preserved across upgrades.
- Voice selection has been normalized: legacy values (`piper`, `voice_de`, etc.) are automatically mapped to the new canonical names.
- Race history storage now includes null-guards to prevent crashes when SD card is not present.

---

## Links
- Website: [https://fpvgate.xyz](https://fpvgate.xyz)
- Docs: [https://github.com/LouisHitchcock/FPVGate/tree/main/docs](https://github.com/LouisHitchcock/FPVGate/tree/main/docs)
- Issues: [https://github.com/LouisHitchcock/FPVGate/issues](https://github.com/LouisHitchcock/FPVGate/issues)
- Discord: [https://discord.com/invite/XwammuWCCj](https://discord.com/invite/XwammuWCCj)
