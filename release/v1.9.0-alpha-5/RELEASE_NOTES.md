# FPVGate-v1.9.0-alpha-5

24 October 2026

Fifth Multi-Pilot alpha, following Alpha-4, with RotorHazard timing fixes. Install it together with
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
- **FPVGate C5MK AIO**: additional dedicated board build, files prefixed
  `FPVGateC5MKAIO-`, 8MB flash. Not the older RX5808 FPVGate AIO.

### Additional C5MK AIO build

The additional AIO target uses the AIO LED, buzzer and SD pin map, reports
board ID `FPVGateC5MKAIO`, and fixes the receiver to ESP32-C5 on fresh boot,
saved-config load and setting changes. Its C5 UART is S3 GPIO4 TX / GPIO5 RX.
Temporary bring-up pin-test and full-rate debug trace endpoints are not shipped.

Source for this additional board is
[commit 0ed9a5b](https://github.com/LouisHitchcock/FPVGate/commit/0ed9a5b09bd3fad48706f588c79ce32b26dc4224).
The original Alpha 5 tag and XIAO S3/S3-ETH images remain unchanged; this is
an additive board package, not another alpha or release series.

In the timer flasher, enable **Pre-Release Firmware**, choose **FPVGate C5MK
AIO (ESP32-S3 + ESP32-C5)** and **v1.9.0-alpha-5**. This flashes the S3 timer
only. The integrated XIAO ESP32-C5 receiver has separate firmware: choose
**Seeed XIAO ESP32-C5** in the [C5 flasher](https://fpvgate.xyz/c5.html#flasher),
or use the gate's receiver updater for an already compatible receiver. Do not
select the C5-Zero image for the AIO's XIAO C5. C5MK 1.2.4-rc.1 is the new
USB timing RC; it is separate from this S3 build.

Choose the board matching your hardware. This is the S3 gate firmware, not
firmware for the separate ESP32-C5 receiver. An already working Alpha-4 C5
receiver does not need updating for this timing test (C5MK 1.2.1 or later).

## Upgrade from Alpha-4

1. Back up the gate configuration and RotorHazard database.
2. Download your board's `-firmware.bin` and `-littlefs.bin` from this release.
3. In the gate's update screen, install the firmware first and the filesystem
   second. Reconnect and confirm `/version` reports `1.9.0-alpha-5`.
4. Install plugin v2.3.2-rc.1 using its release instructions, replacing the
   existing plugin folder, then restart RotorHazard.

Keep the existing frequencies, thresholds and Full-resolution RSSI setting for
the first comparison. Use a second run if you want to compare RSSI resolutions;
restart RotorHazard after changing that option.

The downloads are available from this GitHub prerelease and through the normal
website prerelease channel: enable Pre-Release Mode in the
[web flasher](https://fpvgate.xyz/flasher.html) and select `v1.9.0-alpha-5`.

## Wired flashing

For a full wired flash, download your board's four binaries, `boot_app0.bin`,
and its `-FLASH_INSTRUCTIONS.txt`. Follow that file's five-image command.
The filesystem offset is `0x410000` for XIAO S3/C5MK AIO and `0x610000` for S3-ETH.
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

## Validation status

Firmware and filesystem builds pass for all three supported boards. All 61
frontend/config tests pass (including native C++ tests of the AIO pin map and
production Config methods), and the matching plugin passes 16 timing/tuning regressions against
RH 4.4.0 with the real gate detector simulator. Packaged image checks cover the
version, flash headers, partition sizes/offsets and matching web assets.
These release images have not yet been flashed for a new hardware qualification
run; the prerelease is for that testing.

SHA-256 checksums for the individual flash images are in `SHA256SUMS.txt`.
