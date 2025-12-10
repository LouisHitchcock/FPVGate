# FPVGate

**Personal FPV Lap Timer for ESP32-S3**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PlatformIO](https://img.shields.io/badge/PlatformIO-ESP32--S3-orange.svg)](https://platformio.org/)
[![GitHub release](https://img.shields.io/github/v/release/LouisHitchcock/FPVGate)](https://github.com/LouisHitchcock/FPVGate/releases)

A compact, self-contained RSSI-based lap timing solution for 5.8GHz FPV drones. Perfect for personal practice sessions, small indoor tracks, and training.

![FPVGate](assets/logo-black.svg)

---

## What is FPVGate?

FPVGate measures lap times by detecting your drone's video transmitter signal strength (RSSI). When you fly through the gate, it detects the peak signal and records your lap time. No transponders, no complex setup—just plug in, calibrate, and fly.

### Screenshots

| Race Screen | Configuration Menu |
|:-----------:|:------------------:|
| ![Race Screen](screenshots/Race%20Screen%2005-12-2025.png) | ![Config Menu](screenshots/Config%20Menu%2005-12-2025.png) |

| Calibration Wizard | Race History |
|:------------------:|:------------:|
| ![Calibration Wizard](screenshots/Calibration%20Wizard%2005-12-2025.png) | ![Race History](screenshots/Race%20History%2005-12-2025.png) |

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
- Marshalling mode for post-race lap editing (add/remove laps)
- Detailed race analysis view

**Smart Storage**
- SD card support for audio files and race data
- Individual race files with index for better performance
- Auto-migration from flash to SD
- Cross-device race history (accessible from all connected devices)
- Config backup/restore
- Multi-voice audio library (4 voice packs)

**Developer Friendly**
- Self-test diagnostics
- OTA firmware updates
- Transport abstraction layer
- Open source (MIT License)

---

## Quick Start

### 1. Hardware You'll Need

| Component | Required | Notes |
|-----------|----------|-------|
| **ESP32-S3-DevKitC-1** | Yes | Main controller |
| **RX5808 Module** | Yes | 5.8GHz receiver ([SPI mod required](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html)) |
| **MicroSD Card** | Yes | FAT32, 1GB+ for audio storage |
| **5V Power Supply** | Yes | 18650 battery + regulator |
| **WS2812 RGB LEDs** | Optional | 1-2 LEDs for visual feedback |
| **Active Buzzer** | Optional | 3.3V-5V for beeps |

### 2. Basic Wiring

```
ESP32-S3        RX5808
GPIO4    ────── RSSI
GPIO10   ────── CH1 (DATA)
GPIO11   ────── CH2 (SELECT)
GPIO12   ────── CH3 (CLOCK)
GND      ────── GND
5V       ────── +5V
```

**[See complete wiring guide →](docs/HARDWARE_GUIDE.md)**

### 3. Flash Firmware

**Option A: Prebuilt Binaries (Recommended)**
```bash
# Download from releases page, then flash:
esptool.py --chip esp32s3 --port COM3 write_flash -z \
  0x0 bootloader.bin \
  0x8000 partitions.bin \
  0x10000 firmware.bin \
  0x410000 littlefs.bin
```

**Option B: Build from Source**
```bash
git clone https://github.com/LouisHitchcock/FPVGate.git
cd FPVGate
pio run -e ESP32S3 -t upload
pio run -e ESP32S3 -t uploadfs
```

**[Detailed setup guide →](docs/GETTING_STARTED.md)**

### 4. Connect and Configure

**WiFi (Default):**
1. Connect to `FPVGate_XXXX` network (password: `fpvgate1`)
2. Open `http://www.fpvgate.xyz` or `http://192.168.4.1`
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
- [Quick Start](QUICKSTART.md) - Fast track for experienced users
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

**Current Version:** v1.3.2  
**Platform:** ESP32-S3 (ESP32-C3 support legacy)  
**License:** MIT  
**Status:** Stable - actively maintained

### Recent Updates

**v1.3.2 (Latest)**
- WiFi Status Display with real-time connection monitoring
- Marshalling Mode for post-race lap editing (add/remove laps)
- LED settings persistence to EEPROM (survives reboots)
- Improved race history file structure (individual files + index)
- Rainbow Wave default LED preset
- Fixed Gate 1 timing calculation
- Fixed race history saving to SD card
- Fixed WiFi Station mode connection

**v1.3.1**
- Fixed race history storage initialization bug
- Improved calibration wizard with 3-peak marking system
- Enhanced threshold calculation (peak-relative instead of baseline-relative)
- Added visual smoothing to calibration chart for easier peak identification

**v1.3.0**
- iOS/Safari full audio support with vibration feedback
- Mobile-responsive interface for phones and tablets
- USB Serial CDC connectivity with Electron desktop app
- OSD overlay system for streaming (transparent, real-time)
- Cross-device race storage on SD card
- Race tagging, naming, and detailed analysis
- Enhanced race management with import/export

**v1.2.1**
- SD card storage for audio files
- Automatic flash-to-SD migration
- Enhanced OTA capacity (2MB updates)
- Graceful fallback to LittleFS

**v1.2.0**
- System self-test diagnostics
- PiperTTS integration
- Enhanced LED presets with color pickers
- Complete config export/import

**[Full changelog →](CHANGELOG.md)**

---

## Community & Support

- **Bug Reports:** [GitHub Issues](https://github.com/LouisHitchcock/FPVGate/issues)
- **Feature Requests:** [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions)
- **Star this repo** if you find it useful!

---

## Credits

FPVGate is a heavily modified fork of [PhobosLT](https://github.com/phobos-/PhobosLT) by phobos-. The original project provided the foundation for RSSI-based lap timing.

Portions of the timing logic are inspired by [RotorHazard](https://github.com/RotorHazard/RotorHazard).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Made with care for the FPV community**
