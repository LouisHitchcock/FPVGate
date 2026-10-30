# FPVGate v1.9.0-Multi-Alpha-2

October 9, 2026

Second alpha of Multi-Pilot support with an ESP32-C5 receiver. This is a testing release. Use v1.8.3 for normal single-pilot use.

> **Waveshare ESP32-S3-ETH: UNTESTED.** The new Ethernet board build has never been run on the hardware. It may not boot, Ethernet may not work, and pins may need changing. Only flash it if you are happy to test and report back; keep a USB cable handy to reflash.

**What was tested for this release:** a Seeed XIAO ESP32S3 with an ESP32-C5 receiver, over USB networking: 30 minutes at full load and 28 RotorHazard races, with no failure. The FPVGate AIO, Solo, ESP32-S3 DevKitC-1 and XIAO ESP32S3 Plus builds share the same code but were not run on hardware for this release.

## What is new

- **USB networking stays up.** Under sustained traffic the USB link used to stop within seconds to minutes and needed a power cycle. Two bugs in the USB controller driver that Arduino ships were the cause: one stalled the network send pipe, the other made the gate forget its USB address after an undocumented status bit. FPVGate now builds a fixed copy of the driver. On a Seeed XIAO ESP32S3 it ran 30 minutes at full load (page loads, live events, clock polls and serial at once) with no failure, then 20 back-to-back RotorHazard races over USB.
- **No more hang from the RGB LEDs.** A page load and the LED animation drawing the LEDs at the same moment could deadlock the web server until the watchdog rebooted the gate.
- **RotorHazard plugin 2 support.** The firmware now reports every pilot's passes with the gate's own timestamp, streams live RSSI for every node, and lets RotorHazard set each node's frequency and Enter/Exit levels. Plugin 2 itself is in private testing and will be published separately; until then the RotorHazard plugin 1 behaviour is unchanged.
- **Waveshare ESP32-S3-ETH (UNTESTED).** A new board build with wired Ethernet (W5500), microSD and an onboard RGB LED. It should take an address by DHCP, or use 192.168.8.1 when there is no DHCP server. See the [board guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Multi-Alpha-2/docs/WAVESHARE_S3_ETH.md). It compiles, but has never run on the board, so treat it as experimental.
- **Diagnostics over Wi-Fi.** After a crash, `/api/coredump/summary` shows where it happened, and `/api/usbnet/status` reports the USB link's health.

Everything from v1.9.0-Multi-Alpha-1 is included: up to eight pilots on an ESP32-C5 receiver, per-pilot calibration, standings, race history and RSSI editing.

## Hardware and setup

Multi-Pilot requires a separate ESP32-C5 running [FPVGate C5MK receiver firmware](https://github.com/LouisHitchcock/FPVGateC5MK), version 2 or later. It is not included in these S3 binaries.

On XIAO S3 boards, connect D3/GPIO4 to C5 GPIO4, D4/GPIO5 to C5 GPIO5, and connect ground. Power the C5 from 5V to its 5V/VUSB pin, not from the S3's 3V3 pin. Link signals use 3.3V logic. The ESP32-S3 DevKitC-1 and the Waveshare ESP32-S3-ETH use GPIO43 for TX and GPIO44 for RX.

In Settings > Configuration, choose **ESP32-C5 Multi-Pilot** as the Receiver Module and save. Open Calibration, check that the C5 is online, then configure the pilot channels and thresholds. The C5 tunes 5180 to 5917MHz; Boscam E7 and E8 are outside that range.

See the [C5 setup guide](https://github.com/LouisHitchcock/FPVGate/blob/v1.9.0-Multi-Alpha-2/docs/C5_MULTI_PILOT.md) for the full instructions.

## Known limits

- Keep the web race page open. Race completion, heat timeout and some announcements and LED actions depend on the browser.
- Each pilot is limited to 64 crossings. Physical eight-pilot race testing has not been completed.
- In C5 mode, Master/Slave and daisy-chaining are unavailable, and RotorHazard needs plugin 2.
- Onboard speech, LCD screens, OSD and external transports do not yet provide full eight-pilot support.
- USB networking is full-speed USB, a few hundred KB/s. Under very heavy use it slows down rather than stopping.
- The Waveshare ESP32-S3-ETH build has not been run on the board yet.

## Installation

Open the [web flasher](https://fpvgate.xyz/flasher.html), enable **Pre-Release Mode**, and select `v1.9.0-Multi-Alpha-2` and your board.

S3 builds are provided for FPVGate AIO, FPVGate Solo, Seeed XIAO ESP32S3, ESP32-S3 DevKitC-1, XIAO ESP32S3 Plus and Waveshare ESP32-S3-ETH. These are the FPVGate controller builds, not firmware for the ESP32-C5 receiver.

Devices on v1.9.0-Multi-Alpha-1, v1.8.3 or the 1.8 release candidates can install the matching firmware and filesystem pair over the air. If upgrading from 1.7.x, use a full USB flash. The Waveshare ESP32-S3-ETH needs a full USB flash the first time.

For manual flashing, download your board's four binaries and its flash instructions. The filesystem offset is `0x410000` on 8MB boards and `0x610000` on the 16MB XIAO ESP32S3 Plus and Waveshare ESP32-S3-ETH. After USB flashing, unplug and reconnect the board.

Existing 1.7.3 or 1.8.3 SD cards need no changes.

USB networking is available at `http://192.168.7.1` on Windows and Linux. macOS is not supported.
