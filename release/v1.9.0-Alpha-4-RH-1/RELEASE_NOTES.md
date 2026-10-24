# FPVGate v1.9.0-Alpha-4-RH-1

24 October 2026

RotorHazard timing test prerelease based on Alpha-4. Install it together with
[FPVGate RH plugin v2.3.2-rc.1](https://github.com/LouisHitchcock/fpvgate-rh-plugin/releases/tag/v2.3.2-rc.1).
Both parts are needed to test the timestamp fixes.

## What changed

- C5 gate passes use the midpoint of the first and last sample at the RSSI peak.
- RotorHazard receives the actual peak sample times for its RSSI history,
  rather than assigning those samples their network arrival times.
- Both RSSI resolutions have matching pass/history timestamps.
- Taking the reference clock after all peak snapshots prevents a newer sample
  from wrapping its age and losing its sample timestamp.
- The matching plugin adopts clock corrections between crossings, keeping a
  crossing and its history on the same clock mapping.

These fixes address differences between live timing and Marshal recalculation.
Agreement between those two does not establish RF timing accuracy; the camera
comparison and physical multi-transmitter testing are still needed.

This build contains the RH timing changes only on top of Alpha-4. The separate
gate-side race completion work is not included. Full-rate debug trace capture
is not enabled in these binaries. Existing Alpha-4 limitations still apply.

## Supported boards

- **Seeed XIAO ESP32S3**: files prefixed `SeeedXIAOESP32S3-`, 8MB flash.
- **Waveshare ESP32-S3-ETH**: files prefixed `WaveshareS3ETH-`, 16MB flash.

Choose the board matching your hardware. This is the S3 gate firmware, not
firmware for the separate ESP32-C5 receiver. An already working Alpha-4 C5
receiver does not need updating for this timing test (C5MK 1.2.1 or later).

## Upgrade from Alpha-4

1. Back up the gate configuration and RotorHazard database.
2. Download your board's `-firmware.bin` and `-littlefs.bin` from this release.
3. In the gate's update screen, install the firmware first and the filesystem
   second. Reconnect and confirm `/version` reports `1.9.0-Alpha-4-RH-1`.
4. Install plugin v2.3.2-rc.1 using its release instructions, replacing the
   existing plugin folder, then restart RotorHazard.

Keep the existing frequencies, thresholds and Full-resolution RSSI setting for
the first comparison. Use a second run if you want to compare RSSI resolutions;
restart RotorHazard after changing that option.

The downloads are available directly from this GitHub prerelease. Website
flasher/online-update listing is not part of this release.

## Wired flashing

For a full wired flash, download your board's four binaries, `boot_app0.bin`,
and its `-FLASH_INSTRUCTIONS.txt`. Follow that file's five-image command.
The filesystem offset is `0x410000` for XIAO S3 and `0x610000` for S3-ETH.
`boot_app0.bin` is written at `0xe000` so the new app is selected after a
previous OTA update. Unplug and reconnect after flashing.

Upgrading from 1.7.x requires a full wired flash because the partition layout
changed. Existing Alpha-4 devices can use the firmware/filesystem OTA pair.
Existing SD card contents need no changes.

## What to collect

- The original saved RH race database before Marshal recalculation, plus
  the recalculated result if used.
- Live and recalculated crossing timestamps relative to race start, including
  Gate 1 and node/pilot identifiers; preserve these as separate datasets.
- Firmware/plugin/RH versions, frequencies, thresholds, RSSI resolution and
  connection type.
- The camera recording, with a fixed crossing line and a visible timing
  reference. A 120fps recording has about 8.3ms between frames.

SHA-256 checksums for the individual flash images are in `SHA256SUMS.txt`.
