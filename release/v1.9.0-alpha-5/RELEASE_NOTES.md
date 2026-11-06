# FPVGate-v1.9.0-alpha-5

24 October 2026 — refreshed integrated build, using the existing Alpha 5 release.

This refresh merges the consecutive-lap announcer fix and gate-side C5 race
completion with the existing RH timing fixes and C5MK AIO support. It now
ships all six planned S3 timer boards. It replaces the earlier Alpha 5
downloads; the reported version remains `1.9.0-alpha-5`.

**Already running Alpha 5? Install both the new firmware and filesystem.**
The same version label does not mean you already have these merged changes.
Back up configuration, SD/race data and your RH database before updating.
`BUILD_INFO.json` identifies the source revision and board set.

## Included changes

- Fixed 2-/3-consecutive-lap announcements: rolling totals exclude Gate 1,
  wait for enough real laps, and no longer throw before the max-laps check.
- C5 multi-pilot announcements honor the selected consecutive-lap mode
  independently for each pilot, retaining pilot names.
- In C5 mode the gate now owns race stopping and history saving. Each racer
  finishes at their own max-lap limit; the race stops when all finish or the
  configured heat time expires, even with no browser open.
- C5 stops save one record containing every racer's laps and finalize the
  RSSI capture. Repeated stops do not duplicate history. Failed saves retain
  the race in memory, block Start/Clear and can be retried with Stop.
- Browser reconnect restores the gate's race/saved ID rather than saving
  another copy. Older browser pages are prevented from posting duplicate
  history for the current gate-managed session.
- RH's raw pass stream continues after the local gate race reaches its own
  limit; RotorHazard still applies its own race and lap rules.
- Existing RH fixes remain: pass/history peak sample timestamps at both
  RSSI resolutions, reference clock read after snapshots, and the paired
  plugin's clock corrections adopted between crossings.
- Dedicated C5MK AIO board identity and AIO LED/buzzer/SD pin map, with its
  receiver fixed to C5 on defaults, saved-config load and setting changes.

## All six timer boards

| Flasher selection | File prefix / board ID | Flash | Filesystem offset |
|---|---|---|---|
| Seeed XIAO ESP32S3 | `SeeedXIAOESP32S3` | 8MB | `0x410000` |
| Waveshare ESP32-S3-ETH | `WaveshareS3ETH` | 16MB | `0x610000` |
| ESP32-S3 DevKitC-1 | `ESP32S3` | 8MB | `0x410000` |
| FPVGate AIO | `FPVGateAIO` | 8MB | `0x410000` |
| FPVGate Solo | `FPVGateSolo` | 8MB | `0x410000` |
| FPVGate C5MK AIO | `FPVGateC5MKAIO` | 8MB | `0x410000` |

Choose the exact board, not a different AIO or a different DevKit flash size.
The XIAO ESP32S3 Plus is not in the six-board 1.9.0 scope.

These are S3 timer images, not C5 receiver firmware. The C5MK AIO's separate
XIAO C5 uses **XIAO ESP32-C5** receiver firmware, not the C5-Zero image.
Existing working C5 receivers on C5MK 1.2.1+ do not need an update solely for
the S3 changes. C5MK 1.2.4-rc.1 is separately available for native RH USB tests.

## Install

In the [timer flasher](https://fpvgate.xyz/flasher.html), enable
**Pre-Release Firmware**, choose your board and **v1.9.0-alpha-5**.

For a complete wired flash use the board's four images plus `boot_app0.bin`:
bootloader at `0x0`, partitions at `0x8000`, boot_app0 at `0xe000`,
firmware at `0x10000`, and littlefs at the offset in the table.
Each board has a matching `-FLASH_INSTRUCTIONS.txt`. The OTA selector ensures
the gate starts the newly flashed app rather than an old app1 slot.

Existing compatible 1.8/1.9 installations can install the matching firmware
first and filesystem second using the gate updater. Upgrading from 1.7.x
requires a complete wired flash because the partition layout changed.
Reconnect/reload the page after both components are installed. Update every
open browser tab; don't mix old cached page code with the refreshed firmware.

For RH through FPVGate, also install
[plugin v2.3.2-rc.1](https://github.com/LouisHitchcock/fpvgate-rh-plugin/releases/tag/v2.3.2-rc.1)
and restart RH. Native C5 USB to RH uses the C5 firmware directly and needs
neither the S3 nor that plugin.

## Limits still open

- Browser-free stopping/saving applies to **C5 races only**. RX5808/other
  receiver stopping and saving still use the existing browser behavior.
- Events result recording and next-heat advancement still need an open page.
  This release does not complete the entire browser-free racing milestone.
- Max laps excludes Gate 1. A DNS racer remains unfinished: use a heat limit
  or manual Stop. More than 63 real laps is rejected due to the existing
  64-crossing storage capacity. A failed unsaved race does not survive power loss.
- Internal C5 crossing LED flashes, the separately reported practice-mode
  announcements, and multi-pilot onboard speech/LCD/OSD work are not claimed fixed.
- Temporary pin-test and full-rate debug trace endpoints are not enabled.
- Camera accuracy, physical multi-transmitter racing, six-board hardware
  checks, reconnect/two-tab/closed-browser trials, real SD save-failure recovery
  and overnight soak qualification remain outstanding.

## Verification and priority test

118 frontend/config tests pass, including the real announcement functions,
gate-managed browser behavior and native pin/configuration checks for all six boards.
The native race-control simulation passes Gate 1, one/eight racers, observers,
frozen limits, min-lap filtering, heat-time rollover, saves/retries and duplicate
prevention. The matching plugin's 16 timing/tuning regressions pass against
RH 4.4.0 with the merged real gate detector simulator.

All six firmware/filesystem pairs pass builds and image/partition checks.
SHA-256 hashes are in `SHA256SUMS.txt`.
Build/tests are not physical-device qualification of these images.

For Hazard's accuracy comparison, prioritize native C5 USB beside RX5808
and a fixed-line camera reference, then repeat through the UART/S3/plugin
path. Preserve individual race-relative crossing timestamps (including the
first), original and recalculated databases, node/pilot IDs, versions,
thresholds, frequencies, RSSI resolution and transport. Live/Marshal agreement
is not proof of RF accuracy; 120 fps gives an 8.33 ms frame interval.
