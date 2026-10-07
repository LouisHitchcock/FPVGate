# FPVGate v1.9.0-Multi-Alpha-1

October 7, 2026

First public alpha of Multi-Pilot support using an ESP32-C5 receiver. This is a testing release. Use v1.8.3 for normal single-pilot use.

## What is included

- Up to eight pilots, with a channel, name, spoken name, colour and Enter/Exit thresholds for each pilot.
- A calibration screen with live RSSI graphs, automatic threshold capture and receiver diagnostics.
- Multi-pilot standings and lap tables, browser announcements and pilot colours for gate LEDs.
- Race history with every pilot's laps and an eight-channel RSSI recording when an SD card is fitted.
- Visual Marshal editing for each pilot, with an option to overlay the other channels.
- An RSSI debug window showing all pilot channels.

## Hardware and setup

Multi-Pilot requires a separate ESP32-C5 running [FPVGate C5MK receiver firmware](https://github.com/LouisHitchcock/FPVGateC5MK). Use receiver firmware version 2 or later for continuous scanning. The C5 firmware is a separate installation and is not included in these S3 binaries.

On XIAO S3 boards, connect D3/GPIO4 to C5 GPIO4, D4/GPIO5 to C5 GPIO5, and connect ground. Power the C5 from 5V to its 5V/VUSB pin. Do not power it from the S3's 3V3 pin. Link signals use 3.3V logic.

The ESP32-S3 DevKitC-1 build uses GPIO43 for TX and GPIO44 for RX. The XIAO wiring diagram does not apply to that board.

In Settings > Configuration, choose **ESP32-C5 Multi-Pilot** as the Receiver Module and save. Open Calibration, check that the C5 is online, then configure the pilot channels and thresholds. Stop the race before changing channels, gain, thresholds or pilot participation.

The C5 tunes 5180 to 5917MHz. Boscam E7 and E8 are outside that range.

See the [C5 setup guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Multi-Alpha-1/docs/C5_MULTI_PILOT.md) for the full instructions.

## Known limits

- Keep the web race page open. Race completion, heat timeout and some announcements and LED actions depend on the browser.
- Each pilot is limited to 64 crossings. Simultaneous passes, link interruptions and reconnection still need testing on hardware.
- C5 uses Multi mode, including when only one pilot races. Master/Slave, daisy-chaining and RotorHazard roles are unavailable in C5 mode.
- Onboard speech, LCD screens, OSD and external transports do not yet provide full eight-pilot support.
- JSON race downloads do not include the binary RSSI recording. Existing races are not converted to eight-channel traces.
- The new Multi-Pilot controls are currently in English.
- Physical eight-pilot race testing has not been completed. Build and frontend test results do not establish timing accuracy on hardware.

## Installation

Open the [web flasher](https://fpvgate.xyz/flasher.html), enable **Pre-Release Mode**, and select `v1.9.0-Multi-Alpha-1` and your board.

S3 builds are provided for FPVGate AIO, FPVGate Solo, Seeed XIAO ESP32S3, ESP32-S3 DevKitC-1 and XIAO ESP32S3 Plus. These are the FPVGate controller builds, not firmware for the ESP32-C5 receiver.

If upgrading from 1.7.x, use a full USB flash to install the new partition layout. Devices on v1.8.3 or the 1.8 release candidates already have this layout and can install the matching firmware and filesystem pair over the air.

For manual flashing, download your board's four binaries and its flash instructions. The filesystem offset is `0x410000` on 8MB boards and `0x610000` on XIAO ESP32S3 Plus. After USB flashing, unplug and reconnect the board normally.

Existing 1.7.3 or 1.8.3 SD cards need no changes. For a new card, use the website's SD setup tool or the SD archive from the [v1.7.3 release](https://github.com/LouisHitchcock/FPVGate/releases/tag/v1.7.3).

USB networking remains available at `http://192.168.7.1` on Windows and Linux. macOS is not supported.
