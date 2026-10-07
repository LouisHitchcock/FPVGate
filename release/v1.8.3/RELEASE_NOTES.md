# FPVGate v1.8.3 Release Notes

**Release Date:** October 7, 2026
**Type:** Major feature release — USB networking, over-the-air updates, Visual Marshal, faster web UI

v1.8.3 is the first full release of the 1.8 line. It follows the 1.8.0-rc-2 and 1.8.0-rc-3 release candidates; there were no 1.8.0, 1.8.1 or 1.8.2 releases.

---

## Upgrade Notice: Full Wired Flash Required

**Upgrading from 1.7.x requires a full wired flash. Over-the-air will not work for this upgrade.**

The 8MB partition table changed in the 1.8 line. An over-the-air update replaces the application only and leaves the old 1MB filesystem partition in place, which a 1.8 filesystem image does not fit.

Use the web flasher at [https://fpvgate.xyz/flasher.html](https://fpvgate.xyz/flasher.html), or flash the bootloader, partitions, firmware and filesystem together over USB (see Installation below). Once a gate is on 1.8.3, later over-the-air updates work normally. Gates already running a 1.8.0 release candidate have the new partition table and can update over the air.

Race history on the SD card is kept, and the SD card contents are unchanged from 1.7.3.

---

## What's New in v1.8.3

### USB Networking
The gate now appears as a USB network adapter over USB-C and serves the full web UI at `http://192.168.7.1`. No WiFi and no network infrastructure needed: plug in a cable and open the page. Available on every supported board.

Windows and Linux are supported. **macOS is not**, because Apple removed RNDIS support. This replaces the old USB serial (CDC) connection.

### Over-the-Air Updates
Update from the gate's own settings screen. Install a firmware and filesystem pair from a local file, or pull a chosen release straight from fpvgate.xyz, with a toggle for pre-release builds. Firmware is installed before the filesystem, so an interrupted update can always be retried from the browser.

### Visual Marshal
A RotorHazard-style RSSI graph for reviewing and correcting lap times after a race. The RSSI trace is recorded to the SD card during every race; open a race from history to see each gate crossing, drag a marker to move it, click near a peak to add a missed crossing, or recalculate the laps from new Enter/Exit lines.

Edit and Marshal are now one screen with the race details alongside the graph. Races recorded without a trace fall back to typed lap entry.

### Faster Web UI
Web assets are now served gzipped: a cold load drops from 788KB to about 190KB. On an FPVGate AIO and an ESP32-S3 DevKitC-1 a full page load went from around 7 seconds to roughly 2, and loads no longer fail when a browser opens several connections at once. The page also paints its layout and your theme immediately instead of flashing the wrong theme first.

### Bigger Filesystem
The 8MB partition table grows the filesystem from 1MB to 3.875MB and adds a crash-dump partition, using flash that was previously unallocated.

### System Information Endpoint
`/api/system/info` reports the board, chip, partition layout and the size of each application slot, so updaters can pick the right binary.

---

## Fixes

- **Race history is sorted newest-first.** Recent races previously could appear last.
- **Battery monitoring on the Seeed XIAO ESP32S3** read a pin with no ADC channel and could raise false low-battery alerts. It now reads D0 (GPIO1). The XIAO has no onboard divider, so wire an external 100K/100K divider from the battery to D0.
- USB networking no longer sets the gate as the computer's DNS server, which previously cut the computer's internet access while it was plugged in.
- The Marshal no longer writes to the SD card from the lap loop, and streams its RSSI data instead of building it in memory.

## Removed

- The USB serial (CDC) connection, replaced by USB networking.
- An unfinished I2S audio output that was only built for the DevKitC-1 and did nothing (saves 129KB of flash on that board).
- The unused physical mode-switch pin definitions, which collided with battery sense on the AIO and XIAO.

---

## Supported Hardware

| Board | Flash | Firmware environment |
|---|---|---|
| FPVGate AIO V3 (XIAO ESP32S3) | 8MB | `FPVGateAIO` |
| FPVGate Solo (XIAO ESP32S3) | 8MB | `FPVGateSolo` |
| Seeed Studio XIAO ESP32S3 | 8MB | `SeeedXIAOESP32S3` |
| ESP32-S3 DevKitC-1 | 8MB | `ESP32S3` |
| XIAO ESP32S3 Plus | 16MB | `XIAOS3Plus` |

USB networking is available on all of them.

---

## Installation

### Web Flasher (Recommended)
Use [https://fpvgate.xyz/flasher.html](https://fpvgate.xyz/flasher.html) and select your board and v1.8.3.

### Command Line
Download your board's four binaries and its `FLASH_INSTRUCTIONS.txt` from the release assets, then flash all four in one command:

```bash
# 8MB boards (AIO, Solo, Seeed XIAO ESP32S3, DevKitC-1)
esptool.py --chip esp32s3 --port COM3 --baud 460800 write_flash -z \
  0x0      <BOARD>-bootloader.bin \
  0x8000   <BOARD>-partitions.bin \
  0x10000  <BOARD>-firmware.bin \
  0x410000 <BOARD>-littlefs.bin

# XIAO ESP32S3 Plus (16MB)
esptool.py --chip esp32s3 --port COM3 --baud 460800 write_flash -z \
  0x0      XIAOS3Plus-bootloader.bin \
  0x8000   XIAOS3Plus-partitions.bin \
  0x10000  XIAOS3Plus-firmware.bin \
  0x610000 XIAOS3Plus-littlefs.bin
```

### SD Card
No change from 1.7.3. If you are setting up a new card, download `SD_Card.rar` from the [v1.7.3 release](https://github.com/LouisHitchcock/FPVGate/releases/tag/v1.7.3) and extract it to the root of a FAT32 card (max 32 GB).

---

## Links
- Website: [https://fpvgate.xyz](https://fpvgate.xyz)
- Docs: [https://github.com/LouisHitchcock/FPVGate/tree/main/docs](https://github.com/LouisHitchcock/FPVGate/tree/main/docs)
- USB networking: [docs/USB_NETWORKING.md](https://github.com/LouisHitchcock/FPVGate/blob/main/docs/USB_NETWORKING.md)
- Issues: [https://github.com/LouisHitchcock/FPVGate/issues](https://github.com/LouisHitchcock/FPVGate/issues)
- Discord: [https://discord.com/invite/XwammuWCCj](https://discord.com/invite/XwammuWCCj)
