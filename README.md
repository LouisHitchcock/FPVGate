# FPVGate

**Personal FPV Lap Timer for [Seeed Studio XIAO ESP32S3](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/) / [ESP32-S3-DevKitC-1](https://docs.keyestudio.com/projects/ESP32-S3/en/latest/1.Introduction.html)**

[![Website](https://img.shields.io/badge/Website-fpvgate.xyz-blue?style=for-the-badge&logo=google-chrome&logoColor=white)](https://fpvgate.xyz)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey?style=for-the-badge)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/XwammuWCCj)
[![Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/louishitchcock)
[![Shop](https://img.shields.io/badge/Shop-Buy%20FPVGate%20AIO-green?style=for-the-badge&logo=shopify&logoColor=white)](https://fpvgate.xyz/shop.html)


A compact, self-contained RSSI-based lap timing solution for 5.8GHz FPV drones. Perfect for personal practice sessions, small indoor tracks, and training.

---

## What is FPVGate?

FPVGate measures lap times by detecting your drone's video transmitter signal strength (RSSI). When you fly through the gate, it detects the peak signal and records your lap time. No transponders, no complex setup—just plug in, calibrate, and fly.

### Screenshots

| Race Screen | Configuration Menu |
|:-----------:|:------------------:|
| ![Race Screen](screenshots/02-04-2026/Race%20Screen%20Solo.png) | ![Config Menu](screenshots/02-04-2026/Settings%20Menu.png) |

| Calibration | Race History |
|:-----------:|:------------:|
| ![Calibration](screenshots/02-04-2026/RSSI%20Calibration.png) | ![Race History](screenshots/02-04-2026/Race%20History.png) |

| Multi Pilot | FPVGate AIO |
|:-----------:|:-----------:|
| ![Multi Pilot](screenshots/02-04-2026/Multi%20Pilot.png) | ![FPVGate AIO](screenshots/02-04-2026/FPVGate%20AIO%20Shop.png) |

### Key Features

**Dual Connectivity**
- WiFi Access Point (works with any device)
- USB Serial CDC (zero-latency local connection)
- Electron desktop app for Windows/Mac/Linux

**Visual Feedback**
- RGB LED indicators with 10 customizable presets (settings persist to EEPROM)
- Real-time WiFi status display with connection monitoring
- Real-time RSSI visualization
- OSD overlay for live streaming (transparent, multi-monitor support)
- Mobile-responsive web interface

**Natural Voice Announcements**
- Pre-recorded ElevenLabs voices (4 voices included)
- PiperTTS for low-latency synthesis
- Phonetic name support
- Configurable announcement formats

**Race Analysis**
- Real-time lap tracking with gap analysis
- Fastest lap highlighting
- Fastest 3 consecutive laps (RaceGOW format)
- Race history with export/import (cross-device SD card storage)
- Race tagging and naming
- Marshalling mode for post-race lap editing (add/remove/edit laps)
- Detailed race analysis view

**Track Management**
- Create and manage track profiles with metadata
- Track distance tracking (real-time distance display)
- Track images and custom notes
- Total distance and distance remaining calculations
- Track association with races
- Up to 50 tracks stored on SD card

**Smart Storage**
- SD card support for audio files and race data
- Individual race files with index for better performance
- Auto-migration from flash to SD
- Cross-device race history (accessible from all connected devices)
- Config backup/restore
- Multi-voice audio library (4 voice packs)

**Webhooks & Integration**
- HTTP webhook support for external LED controllers
- Configurable triggers (race start/stop, laps)
- Gate LED control with granular event settings
- Network-based device integration

**RotorHazard Integration**
- Bidirectional race start/stop with RotorHazard
- NTP-style clock synchronization for accurate timing
- Automatic lap submission to RH via HTTP POST
- Companion RH plugin included (`rh-plugin/`)

**I2S Speaker Audio (MAX98357A)**
- Hardware speaker output for race announcements
- Non-blocking MP3 playback from SD card
- Countdown, lap times, race start/stop audio

**Developer Friendly**
- Comprehensive self-test diagnostics (19 tests)
- OTA firmware updates
- Transport abstraction layer
- Open source (CC BY-NC-SA 4.0)

**Supported Bands:**

*Analog FPV:*
- **A (Boscam A)** - 5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725
- **B (Boscam B)** - 5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866
- **E (Boscam E)** - 5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945
- **F (Fatshark)** - 5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880
- **R (RaceBand)** - 5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917
- **L (LowBand)** - 5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621

*Digital FPV:*
- **DJI** - v1-25, v1-25CE, v1_50, 03/04-20, 03/04-20CE, 03/04-40, 03/04-40CE, 04-R
- **HDZero** - R, E, F, CE
- **WalkSnail** - R, 25, 25CE, 50

---

## Quick Start

### 1. Hardware You'll Need

> **Want a plug-and-play solution?** The **[FPVGate AIO](https://fpvgate.xyz/shop.html)** is a pre-built, ready-to-use device -- no soldering, wiring, or flashing required. Perfect if you just want to buy a device and start timing laps immediately.

**Building your own? Here's what you'll need:**

| Component | Required | Notes |
|-----------|----------|-------|
| **[Seeed Studio XIAO ESP32S3](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)** (Recommended) or **[ESP32-S3-DevKitC-1](https://docs.keyestudio.com/projects/ESP32-S3/en/latest/1.Introduction.html)** | Yes | Main controller |
| **RX5808 Module** | Yes | 5.8GHz receiver ([SPI mod required](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html)) |
| **MicroSD Card** | Yes | FAT32, 1GB+ for audio storage |
| **5V Power Supply** | Yes | USB power or any 5V power source |
| **WS2812 RGB LEDs** | Optional | 1-2 LEDs for visual feedback |
| **Active Buzzer** | Optional | 3.3V-5V for beeps |

### 2. Wiring Diagrams

Detailed wiring diagrams are available for each supported board:

- **[Seeed Studio XIAO ESP32S3](docs/wiring/Seeed-XIAO-ESP32S3.md)** - Recommended, compact, 8MB
- **[ESP32-S3 DevKitC-1 (8MB Flash)](docs/wiring/ESP32-S3-DevKitC-1.md)** - Alternative
- **[FPVGate AIO](https://fpvgate.xyz/shop.html)** - Pre-built, ready-to-use device ([buy here](https://fpvgate.xyz/shop.html))
- **[ESP32-S3 Super Mini (4MB Flash)](docs/wiring/ESP32-S3-SuperMini.md)** - Not recommended (see note below)
- **[LilyGO T-Energy S3](docs/wiring/LilyGO-T-Energy-S3.md)** - Expert mode, integrated battery
- **[Waveshare ESP32-S3-LCD-2](docs/wiring/Waveshare-ESP32-S3-LCD-2.md)** - Built-in 2" touchscreen LCD, battery, SD card
- **XIAO ESP32S3 Plus (16MB Flash)** - Expert mode

> **Note on ESP32-S3 Super Mini:** Through testing, this board has proven unreliable due to inconsistent quality from various suppliers. Some revisions experience frequent brownouts under load. This board is still supported but is not recommended for new builds.

**[Complete hardware guide →](docs/HARDWARE_GUIDE.md)**

### 3. Flash Firmware

**Option A: Web Flasher (Recommended)**

The easiest way to install FPVGate is using our web-based flasher:

**[https://fpvgate.xyz/flasher.html](https://fpvgate.xyz/flasher.html)**

1. Open the link in Chrome, Edge, or Opera (Web Serial API required)
2. Connect your ESP32 via USB
3. Select your board type
4. Click "Connect" and choose your device's COM port
5. Click "Flash" and wait for completion (~2-3 minutes)

Supported boards:
- Seeed Studio XIAO ESP32S3 (8MB) - Recommended
- ESP32-S3 DevKitC-1 (8MB Flash)
- ESP32-S3 Super Mini (4MB Flash) - Not recommended
- LilyGO T-Energy S3

**Option B: Command Line (Advanced)**
```bash
# Download board-specific binaries from releases page, then flash:
esptool.py --chip esp32s3 --port COM3 write_flash -z \
  0x0 [BOARD]-bootloader.bin \
  0x8000 [BOARD]-partitions.bin \
  0x10000 [BOARD]-firmware.bin \
  0x410000 [BOARD]-littlefs.bin
```

**Option C: Build from Source**
```bash
git clone https://github.com/LouisHitchcock/FPVGate.git
cd FPVGate

# For ESP32-S3 DevKitC-1 (8MB flash):
pio run -e ESP32S3 -t upload
pio run -e ESP32S3 -t uploadfs

# For ESP32-S3 Super Mini (4MB flash):
pio run -e ESP32S3SuperMini -t upload
pio run -e ESP32S3SuperMini -t uploadfs
```

**[Detailed setup guide →](docs/GETTING_STARTED.md)**

### 4. Connect and Configure

**WiFi (Default):**
1. Connect to `FPVGate_XXXX` network (password: `fpvgate1`)
2. Open `http://fpvgate.local` or `http://192.168.4.1`
3. Go to Configuration → Set your VTx frequency
4. Go to Calibration → Set RSSI thresholds
5. Start racing!

**USB (Electron App):**
1. Download [Electron app from releases](https://github.com/LouisHitchcock/FPVGate/releases)
2. Connect ESP32-S3 via USB
3. Launch app and select COM port
4. All features work identically to WiFi mode

**[Complete user guide →](docs/USER_GUIDE.md)**

---

## Documentation

**[Getting Started](docs/GETTING_STARTED.md)** - Hardware setup, wiring, flashing, initial config  
**[User Guide](docs/USER_GUIDE.md)** - How to connect, calibrate, race, and use features  
**[Hardware Guide](docs/HARDWARE_GUIDE.md)** - Components, wiring diagrams, troubleshooting  
**[Features Guide](docs/FEATURES.md)** - In-depth feature documentation  
**[Development Guide](docs/DEVELOPMENT.md)** - Building from source, contributing  

**Additional Docs:**
- [RotorHazard Integration](docs/ROTORHAZARD_INTEGRATION.md) - Connect FPVGate to RotorHazard
- [Voice Generation](docs/VOICE_GENERATION_README.md) - Generate custom voices
- [Multi-Voice Setup](docs/MULTI_VOICE_SETUP.md) - Configure multiple voices
- [SD Card Migration](docs/SD_CARD_MIGRATION_GUIDE.md) - SD card setup
- [Changelog](CHANGELOG.md) - Version history

---

## How It Works

FPVGate uses an RX5808 video receiver module to monitor your drone's RSSI (signal strength). As you fly through the gate:

1. **Approach** - RSSI rises above Enter threshold → crossing starts
2. **Peak** - RSSI peaks when you're closest to the gate
3. **Exit** - RSSI falls below Exit threshold → lap recorded

The time between peaks = your lap time. Simple, reliable, and accurate.

```
RSSI  │     /\
      │    /  \
      │   /    \     ← Single clean peak
Enter ├──/──────\───
      │ /        \
Exit  ├/──────────\─
      └─────────────── Time
```

---

## Project Status

**Current Version:** v1.7.0
**Platform:** [ESP32-S3 DevKitC-1](https://docs.keyestudio.com/projects/ESP32-S3/en/latest/1.Introduction.html), [Seeed Studio XIAO ESP32S3](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/), [FPVGate AIO](https://fpvgate.xyz/shop.html)
**License:** CC BY-NC-SA 4.0  
**Status:** Stable - actively maintained

### Recent Updates

**v1.7.0 (Latest Release - March 20, 2026)**
- **RotorHazard Integration** - Bidirectional race control, NTP clock sync, lap submission, companion RH plugin
- **I2S Speaker Audio (MAX98357A)** - Hardware speaker output for race announcements
- **New Boards** - FPVGate AIO V4, XIAO ESP32S3 Plus
- **Config v16** - New fields for RH integration and speaker settings

**v1.6.2 (February 26, 2026)**
- **Waveshare ESP32-S3-LCD-2** - New board support (Expert Mode)
- **Calibration Ignore Regions** - Mark noisy RSSI sections to exclude from threshold
- **Novacore Filter Tuning** - Per-filter toggles and parameter sliders
- **Debug RSSI Overlay** - Real-time debug chart in diagnostics

**v1.6.1 (February 14, 2026)**
- **Multi-Pilot Race Analysis** - Current lap timer, lap times chart, consistency chart
- **Race Synchronization** - Redesigned sync UI, TTS format override, speech keepalive
- **Mobile Experience** - Settings modal navigation, iOS Safari hostname fix

**v1.6.0 (February 9, 2026)**
- **Race Synchronization System** - Multi-timer sync for distributed race timing
- **Audio Controls** - Beep volume slider, independent browser audio volume

**[Full changelog →](CHANGELOG.md)**

---

## Community & Support

- **Bug Reports:** [GitHub Issues](https://github.com/LouisHitchcock/FPVGate/issues)
- **Feature Requests:** [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions)
- **Support Development:** [Ko-fi](https://ko-fi.com/louishitchcock)
- **Star this repo** if you find it useful!

---

## Credits

FPVGate is a heavily modified fork of [PhobosLT](https://github.com/phobos-/PhobosLT) by phobos-. The original project provided the foundation for RSSI-based lap timing.

Portions of the timing logic are inspired by [RotorHazard](https://github.com/RotorHazard/RotorHazard).

### Contributors
See [CONTRIBUTORS.md](CONTRIBUTORS.md) for full contributor list.

---

## License

This project is licensed under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.

You are free to share and adapt this work for non-commercial purposes, as long as you provide attribution and distribute any modifications under the same license.

See the [LICENSE](LICENSE) file for full details or visit https://creativecommons.org/licenses/by-nc-sa/4.0/

---

**Made with care for the FPV community**

