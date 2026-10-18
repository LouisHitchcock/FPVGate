# FPVGate v1.9.0-Alpha-4

October 18, 2026

Fourth alpha of Multi-Pilot support with an ESP32-C5 receiver, the one after v1.9.0-Multi-Alpha-3: the alphas are now named v1.9.0-Alpha-N. This is a testing release. Use v1.8.3 for normal single-pilot use.

This release is built for two boards only: the **Seeed XIAO ESP32S3** and the **Waveshare ESP32-S3-ETH**. Owners of other boards should stay on v1.9.0-Multi-Alpha-2 for now.

**What was tested for this release:** the race screen on a XIAO ESP32S3 with an ESP32-C5 receiver. This is a small release on top of Multi-Alpha-3, and has not had Multi-Alpha-3's overnight run.

## What is new

- **Race analysis works in C5 races.** Fastest Lap and Fastest 3 Consecutive said to complete a lap, and Best 3 Laps and Median Lap showed "--", however many laps were flown.
- **Reworked race screen.** Fastest Lap, Fastest 3 Consecutive, Best 3 Laps and Median Lap are four boxes in a row, always shown. In a C5 race the first two are the best of any pilot, with their name, and Best 3 and Median are the race leader's. Below them, Consistency and Lap Times charts, opening on Consistency; turn either off in Settings > User Interface > Race Analytics Display.
- **A USB flash now starts the new firmware.** A gate last updated over the air kept starting its old firmware after a USB flash, from the web flasher or by hand. The web flasher now resets that, and manual flashing includes `boot_app0.bin`.
- **No reboot when a browser disconnects.** A gate could crash and restart when a browser closed or lost its connection while a message was being sent to it.
- **RotorHazard test pass:** `POST /api/rh/testPass?node=n` sends RotorHazard a pass on a node as if a quad had flown through, to check a setup such as split gates without flying.

Everything from v1.9.0-Multi-Alpha-3 is included. The full list is in the [changelog](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Alpha-4/CHANGELOG.md).

## Hardware and setup

Multi-Pilot requires a separate ESP32-C5 running [FPVGate C5MK receiver firmware](https://github.com/LouisHitchcock/FPVGateC5MK). Use C5MK 1.1.0: earlier versions work for racing but can't be updated through the gate. Flash 1.1.0 over USB once from its [release folder](https://github.com/LouisHitchcock/FPVGateC5MK/tree/v1.1.0/release); after that, updates go through the gate.

Wiring, S3 to C5 (3.3V logic, plus ground):

| S3 board | S3 TX | S3 RX | Waveshare C5-Zero | Seeed XIAO ESP32-C5 |
|---|---|---|---|---|
| Seeed XIAO ESP32S3 | D3 / GPIO4 | D4 / GPIO5 | TX to GPIO4, RX to GPIO5 | TX to D4 / GPIO23, RX to D5 / GPIO24 |
| Waveshare ESP32-S3-ETH | GPIO43 | GPIO44 | TX to GPIO4, RX to GPIO5 | TX to D4 / GPIO23, RX to D5 / GPIO24 |

Power the C5 from 5V to its 5V/VUSB pin, not from the S3's 3V3 pin.

In Settings > Configuration, choose **ESP32-C5 Multi-Pilot** as the Receiver Module and save. Open Calibration, check that the C5 is online, then configure the pilot channels and thresholds. The C5 tunes 5180 to 5917MHz; Boscam E7 and E8 are outside that range.

See the [C5 setup guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Alpha-4/docs/C5_MULTI_PILOT.md) and the [Waveshare ESP32-S3-ETH guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Alpha-4/docs/WAVESHARE_S3_ETH.md).

## Known limits

- With an SD card fitted, Race History can show "No races saved yet", or come and go, even though races are being saved. This is being looked into.
- Keep the web race page open. Race completion, heat timeout and some announcements and LED actions depend on the browser.
- Each pilot is limited to 64 crossings. Physical eight-pilot race testing has not been completed.
- In C5 mode, Master/Slave and daisy-chaining are unavailable, and RotorHazard needs plugin 2.
- Onboard speech, LCD screens, OSD and external transports do not yet provide full eight-pilot support.
- On the XIAO over Wi-Fi, many downloads at once can still bring memory low. The gate refuses further downloads with "busy" rather than freezing; reload the page.
- While the gate stores a C5 image before updating it, the C5's live data has gaps for a few seconds. Don't update the C5 during a race.
- USB networking is full-speed USB, a few hundred KB/s. Under very heavy use it slows down rather than stopping.

## Installation

Open the [web flasher](https://fpvgate.xyz/flasher.html), enable **Pre-Release Mode**, and select `v1.9.0-Alpha-4` and your board.

Devices on v1.9.0-Multi-Alpha-3, Alpha-2 or Alpha-1, v1.8.3 or the 1.8 release candidates can install the matching firmware and filesystem pair over the air. If upgrading from 1.7.x, use a full USB flash. A Waveshare ESP32-S3-ETH on Alpha-2 should update over USB or Wi-Fi, not over Ethernet: Alpha-2's Ethernet is too slow for the upload.

For manual flashing, download your board's four binaries, `boot_app0.bin` and the board's flash instructions. `boot_app0.bin` is new: without it, a gate last updated over the air keeps starting its old firmware after a USB flash. The filesystem offset is `0x410000` on the XIAO ESP32S3 and `0x610000` on the Waveshare ESP32-S3-ETH. After USB flashing, unplug and reconnect the board.

Existing 1.7.3 or 1.8.3 SD cards need no changes.

USB networking is available at `http://192.168.7.1` on Windows and Linux. macOS is not supported.
