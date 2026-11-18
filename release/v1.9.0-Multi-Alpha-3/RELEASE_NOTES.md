# FPVGate v1.9.0-Multi-Alpha-3

October 12, 2026

Third alpha of Multi-Pilot support with an ESP32-C5 receiver. This is a testing release. Use v1.8.3 for normal single-pilot use.

This release is built for two boards only: the **Seeed XIAO ESP32S3** and the **Waveshare ESP32-S3-ETH**. Owners of other boards should stay on v1.9.0-Multi-Alpha-2 for now.

**What was tested for this release:** both boards, each with an ESP32-C5 receiver, overnight alongside RotorHazard. The Waveshare ESP32-S3-ETH on Ethernet ran 8 hours with no lost C5 data, no reboot and every RotorHazard race completed. The XIAO ESP32S3 on Wi-Fi ran 8 hours with no reboot: 32 of 32 RotorHazard races, every gate race, and four C5 firmware updates through the gate, each in about 20 s.

## What is new

- **Waveshare ESP32-S3-ETH is tested, and no longer needs expert mode** in the web flasher. Uploads over Ethernet, OTA updates included, used to crawl at about 10 KB/s and time out: the Ethernet chip's receive buffer was being cut to a single frame by the order the drivers started in. It now runs at over 1 MB/s, and a full OTA update takes about 10 s. USB networking switches off while Ethernet is connected, the header shows the Ethernet address, and a replugged cable gets a new address.
- **Update the C5 receiver through the gate.** Settings > System > C5 Receiver Firmware lists the [FPVGate C5MK](https://github.com/LouisHitchcock/FPVGateC5MK) releases, or takes a file, and sends the new firmware over the existing link, with no USB cable on the C5. The gate checks the image is for the C5's board, and a C5 that can't reach the gate after an update goes back to its old firmware. Needs C5MK 1.1.0 or later on the C5 (one USB flash to get there).
- **Race director** (Settings > User Interface > Event Mode, off by default): pilots, groups, formats and a heat schedule, channel assignment within a band, Elo and best-lap seeding, a Next Heat button, and import and export.
- **Manual +Lap** for each C5 pilot on the race screen.
- **One pass, one lap.** A dip in signal while flying through the gate could end the pass and count it twice. A pass now ends only after 300 ms below Exit.
- **No lost C5 data when a race is saved.** The web server could hold off the C5 reader for about a second while the race was written.
- **XIAO on Wi-Fi no longer freezes under load.** Several pages and event streams loading at once could run the gate out of memory. Each connection now holds less, live RSSI is skipped while a stream is backed up (passes and laps never are), and file downloads are refused with "busy" before memory runs out.
- **RotorHazard:** RSSI 20 times a second with each pass's peak kept, so RotorHazard's Marshal page works, and full-resolution RSSI for the plugin's **Full-resolution RSSI** option. Use the FPVGate RotorHazard plugin 2.1.4 or later.

Everything from v1.9.0-Multi-Alpha-2 is included. The full list is in the [changelog](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Multi-Alpha-3/CHANGELOG.md).

## Hardware and setup

Multi-Pilot requires a separate ESP32-C5 running [FPVGate C5MK receiver firmware](https://github.com/LouisHitchcock/FPVGateC5MK). Use C5MK 1.1.0: earlier versions work for racing but can't be updated through the gate. Flash 1.1.0 over USB once from its [release folder](https://github.com/LouisHitchcock/FPVGateC5MK/tree/v1.1.0/release); after that, updates go through the gate.

Wiring, S3 to C5 (3.3V logic, plus ground):

| S3 board | S3 TX | S3 RX | Waveshare C5-Zero | Seeed XIAO ESP32-C5 |
|---|---|---|---|---|
| Seeed XIAO ESP32S3 | D3 / GPIO4 | D4 / GPIO5 | TX to GPIO4, RX to GPIO5 | TX to D4 / GPIO23, RX to D5 / GPIO24 |
| Waveshare ESP32-S3-ETH | GPIO43 | GPIO44 | TX to GPIO4, RX to GPIO5 | TX to D4 / GPIO23, RX to D5 / GPIO24 |

Power the C5 from 5V to its 5V/VUSB pin, not from the S3's 3V3 pin.

In Settings > Configuration, choose **ESP32-C5 Multi-Pilot** as the Receiver Module and save. Open Calibration, check that the C5 is online, then configure the pilot channels and thresholds. The C5 tunes 5180 to 5917MHz; Boscam E7 and E8 are outside that range.

See the [C5 setup guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Multi-Alpha-3/docs/C5_MULTI_PILOT.md) and the [Waveshare ESP32-S3-ETH guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Multi-Alpha-3/docs/WAVESHARE_S3_ETH.md).

## Known limits

- Keep the web race page open. Race completion, heat timeout and some announcements and LED actions depend on the browser.
- Each pilot is limited to 64 crossings. Physical eight-pilot race testing has not been completed.
- In C5 mode, Master/Slave and daisy-chaining are unavailable, and RotorHazard needs plugin 2.
- Onboard speech, LCD screens, OSD and external transports do not yet provide full eight-pilot support.
- On the XIAO over Wi-Fi, many downloads at once can still bring memory low. The gate refuses further downloads with "busy" rather than freezing; reload the page.
- In the XIAO overnight test the gate dropped off Wi-Fi once, for 38 minutes, and came back by itself without rebooting. This is being looked into.
- While the gate stores a C5 image before updating it, the C5's live data has gaps for a few seconds. Don't update the C5 during a race.
- USB networking is full-speed USB, a few hundred KB/s. Under very heavy use it slows down rather than stopping.

## Installation

Open the [web flasher](https://fpvgate.xyz/flasher.html), enable **Pre-Release Mode**, and select `v1.9.0-Multi-Alpha-3` and your board.

Devices on v1.9.0-Multi-Alpha-2 or Alpha-1, v1.8.3 or the 1.8 release candidates can install the matching firmware and filesystem pair over the air. If upgrading from 1.7.x, use a full USB flash. A Waveshare ESP32-S3-ETH on Alpha-2 should update over USB or Wi-Fi, not over Ethernet: Alpha-2's Ethernet is too slow for the upload.

For manual flashing, download your board's four binaries and its flash instructions. The filesystem offset is `0x410000` on the XIAO ESP32S3 and `0x610000` on the Waveshare ESP32-S3-ETH. After USB flashing, unplug and reconnect the board.

Existing 1.7.3 or 1.8.3 SD cards need no changes.

USB networking is available at `http://192.168.7.1` on Windows and Linux. macOS is not supported.
