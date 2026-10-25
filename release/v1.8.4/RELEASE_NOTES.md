# FPVGate v1.8.4 Release Notes

**Release Date:** October 20, 2026
**Type:** Hotfix — USB networking stopped responding under load

v1.8.4 is v1.8.3 with one fix. Nothing else has changed: same features, same settings, same web UI, same SD card contents.

---

## Upgrading

Gates on v1.8.3 or a 1.8.0 release candidate can update over the air from the settings screen, or use the web flasher. Settings and race history are kept.

Gates still on 1.7.x need the one-time full wired flash described in the [v1.8.3 release notes](https://github.com/LouisHitchcock/FPVGate/blob/v1.8.3/release/v1.8.3/RELEASE_NOTES.md), because of the 1.8 partition table change.

---

## Fixed

### USB networking and USB serial stopped responding under load
On v1.8.3, a busy USB connection could stop the gate's USB link until it was power-cycled. The web UI at `http://192.168.7.1` stopped answering and the USB serial port, though still listed by Windows, could not be opened. The gate itself kept running; only USB died. Several open browser tabs, a page reloading in a loop, or running the self test over USB were enough to set it off.

The cause was two bugs in the USB controller driver that Arduino-ESP32 2.0.17 ships for the ESP32-S3:

- An interrupt mask shared by every USB endpoint was updated without a lock from both cores and the interrupt handler. A lost update left an endpoint with data waiting and no interrupt to send it, stalling the network for good.
- On an undocumented interrupt bit the driver reset the USB connection on the gate's side only. The computer never saw a reset, so networking and serial both stopped.

The driver is now built from a fixed copy, with watchdogs for both failures as a backup.

Tested on an FPVGate AIO with the event stream, RSSI streaming, full page loads, rapid config polling, the USB serial console and the self test all running at once. v1.8.3 stopped responding within 20 seconds; v1.8.4 ran for 30 minutes with 11,672 requests, no failures, and 30 of 30 self tests passing.

### Affected boards
ESP32-S3 DevKitC-1, FPVGate AIO, FPVGate Solo and Seeed XIAO ESP32S3. The XIAO ESP32S3 Plus has no USB networking and is unchanged apart from the version number.

---

## Supported Hardware

| Board | Flash | Firmware environment |
|---|---|---|
| FPVGate AIO V3 (XIAO ESP32S3) | 8MB | `FPVGateAIO` |
| FPVGate Solo (XIAO ESP32S3) | 8MB | `FPVGateSolo` |
| Seeed Studio XIAO ESP32S3 | 8MB | `SeeedXIAOESP32S3` |
| ESP32-S3 DevKitC-1 | 8MB | `ESP32S3` |
| XIAO ESP32S3 Plus | 16MB | `XIAOS3Plus` |

---

## Installation

### Over the Air
On v1.8.3, open Settings and update to v1.8.4 from fpvgate.xyz, or install the firmware and filesystem files from the release assets.

### Web Flasher
Use [https://fpvgate.xyz/flasher.html](https://fpvgate.xyz/flasher.html) and select your board and v1.8.4.

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
