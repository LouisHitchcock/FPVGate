# FPVGate Quick Start Guide

Get your FPVGate lap timer up and running in minutes!

## What You Need

- ESP32-S3-DevKitC-1 board
- RX5808 5.8GHz video receiver module ([SPI modded](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html))
- USB-C cable (data capable)
- 5V power supply (18650 battery + 5V regulator recommended)
- (Optional) WS2812 RGB LED strip (1-2 LEDs)
- (Optional) 3.3V-5V buzzer

## Option 1: Flash Prebuilt Firmware (Easiest)

### Using esptool.py (All Platforms)

1. **Install esptool**:
   ```bash
   pip install esptool
   ```

2. **Download the prebuilt files** from the [latest release](https://github.com/LouisHitchcock/FPVGate/releases)

3. **Connect your ESP32-S3** via USB

4. **Flash all files at once**:
   ```bash
   esptool.py --chip esp32s3 --port COM12 --baud 460800 write_flash -z \
     0x0000 bootloader-esp32s3.bin \
     0x8000 partitions-esp32s3.bin \
     0x10000 firmware-esp32s3.bin \
     0x670000 littlefs-esp32s3.bin
   ```
   
   Replace `COM12` with your actual port (check Device Manager on Windows, `/dev/ttyUSB0` on Linux, `/dev/cu.usbserial-*` on Mac)

### Using ESP Flash Tool (Windows Only)

1. Download [ESP Flash Tool](https://www.espressif.com/en/support/download/other-tools)
2. Select **ESP32-S3** chip
3. Add the files with these addresses:
   - `0x0000` → `bootloader-esp32s3.bin`
   - `0x8000` → `partitions-esp32s3.bin`
   - `0x10000` → `firmware-esp32s3.bin`
   - `0x670000` → `littlefs-esp32s3.bin`
4. Click **Start**

## Option 2: Build from Source

### Prerequisites
- [Visual Studio Code](https://code.visualstudio.com/)
- [PlatformIO Extension](https://platformio.org/install/ide?install=vscode)

### Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/LouisHitchcock/FPVGate.git
   cd FPVGate
   ```

2. **Open in VS Code**:
   ```bash
   code .
   ```

3. **Build & Upload**:
   - Open PlatformIO (alien icon in sidebar)
   - Under **ESP32S3** → **General**:
     - Click **Build** (wait for success)
     - Click **Upload** (flashes firmware)
   - Under **ESP32S3** → **Platform**:
     - Click **Upload Filesystem Image** (flashes web interface)

## Hardware Wiring

### Minimal Setup (Required)

```
ESP32-S3        RX5808
GPIO4    ────── RSSI
GPIO10   ────── CH1 (DATA)
GPIO11   ────── CH2 (SELECT)
GPIO12   ────── CH3 (CLOCK)
GND      ────── GND
5V       ────── +5V
```

### Optional: RGB LED

```
ESP32-S3        WS2812 Strip
GPIO18   ────── Data In
5V       ────── +5V
GND      ────── GND
```

### Optional: Buzzer

```
ESP32-S3        Buzzer
GPIO5    ────── Positive (+)
GND      ────── Negative (-)
```

## First Use

1. **Power on** your FPVGate device

2. **Connect to WiFi**:
   - Network: `FPVGate_XXXX` (XXXX = last 4 digits of MAC address)
   - Password: `fpvgate1`

3. **Open web interface**:
   - Go to: `http://www.fpvgate.xyz` or `http://192.168.4.1`

4. **Configure your settings** (Configuration tab):
   - Set your **Band & Channel** to match your VTx (default: RaceBand 8)
   - Set **Pilot Name** (for backend)
   - Set **Pilot Callsign** (short name for UI)
   - Set **Phonetic Name** (for TTS pronunciation)
   - Choose a **Pilot Color**
   - Select your **Theme** (23 options available!)

5. **Calibrate** (Calibration tab):
   - Power on your drone and wait 30 seconds
   - Place drone ~3-6 feet away
   - Watch the RSSI graph
   - Set **Enter RSSI** 2-5 points below peak
   - Set **Exit RSSI** 8-10 points below Enter
   - Click **Save RSSI Thresholds**

6. **Start Racing!** (Race tab):
   - Click **Start Race**
   - Fly through the gate
   - Laps recorded automatically
   - View analysis with bar charts
   - Click **Stop Race** when done

## Default Settings

- **WiFi**: `FPVGate_XXXX` / `fpvgate1`
- **Web Address**: `http://www.fpvgate.xyz` or `http://192.168.4.1`
- **Default Channel**: RaceBand 8 (5917 MHz)
- **Minimum Lap Time**: 5 seconds
- **Lap Count**: Infinite (0)
- **Theme**: Material Oceanic

## Tips

- **Settings auto-save** - Changes save automatically 1 second after you stop editing
- **Test Voice** - Use "Test Voice" button to hear TTS pronunciation
- **Download Config** - Backup your settings as JSON
- **Race History** - All races auto-save with pilot info (name, callsign, channel)
- **Visual Analysis** - Lap history and fastest round charts show after each race

## Troubleshooting

### Can't find WiFi network
- Check device is powered (5V to VBUS pin)
- Wait 10 seconds after power-on
- Look for `FPVGate_` followed by 4 characters

### Missing laps
- Lower **Enter RSSI** threshold by 5 points
- Ensure VTx warmed up (wait 30 seconds)
- Verify Band/Channel matches your drone

### Too many false laps
- Increase **Minimum Lap Time** to 8-10 seconds
- Raise **Exit RSSI** threshold by 3-5 points
- Move timer further from flight path

### Can't flash firmware
- Use a **data-capable** USB-C cable (some are charge-only)
- Try different USB ports
- Never connect anything to GPIO3 (strapping pin)

## Need Help?

- 📖 Full documentation: [README.md](README.md)
- 🐛 Report issues: [GitHub Issues](https://github.com/LouisHitchcock/FPVGate/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions)

---

**Happy Flying! 🚁**
