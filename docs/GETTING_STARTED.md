# Getting Started with FPVGate

Complete guide to building, flashing, and configuring your FPVGate lap timer.

** Navigation:** [Home](../README.md) | [User Guide](USER_GUIDE.md) | [Hardware Guide](HARDWARE_GUIDE.md) | [Features](FEATURES.md)

---

## Table of Contents

1. [Hardware Requirements](#hardware-requirements)
2. [Hardware Assembly](#hardware-assembly)
3. [Software Setup](#software-setup)
4. [Flashing Firmware](#flashing-firmware)
5. [Initial Configuration](#initial-configuration)
6. [First Flight](#first-flight)
7. [Troubleshooting](#troubleshooting)

---

## Hardware Requirements

### Required Components

| Component | Specs | Purchase Links | Approx. Cost |
|-----------|-------|----------------|--------------|
| **ESP32-S3-DevKitC-1** | USB-C, 8MB Flash | [Espressif](https://www.espressif.com/en/products/devkits) | $10-15 |
| **RX5808 Module** | 5.8GHz receiver with SPI mod | [Banggood](https://www.banggood.com) | $5-8 |
| **MicroSD Card** | FAT32, 1GB+, Class 10 | Any retailer | $3-5 |
| **MicroSD Card Module** | SPI interface | Amazon/eBay | $2-3 |
| **5V Power Supply** | 18650 battery + boost converter | Various | $8-12 |

**Total Core Cost:** ~$30-45

### Optional Components

| Component | Purpose | Cost |
|-----------|---------|------|
| **WS2812 RGB LEDs** | Visual feedback (1-2 LEDs) | $5-10 |
| **Active Buzzer** | Audio beeps (3.3V-5V) | $1-2 |
| **Enclosure** | Protection and mounting | $0-20 |
| **Antenna** | Improved RSSI reception | $3-8 |

### Tools Required

- Soldering iron and solder
- Wire strippers
- Multimeter (for testing)
- USB-C cable (data capable)
- Computer (Windows, Mac, or Linux)

---

## Hardware Assembly

### Step 1: Prepare the RX5808 Module

The RX5808 must be modified for SPI control. Follow this guide:

**[RX5808 SPI Modification Guide](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html)**

**Key points:**
1. Remove resistor R5 (enables SPI mode)
2. Add wire jumpers for CH1, CH2, CH3
3. Verify SPI pins are accessible
4. Test with multimeter before connecting

### Step 2: ESP32-S3 Pin Connections

#### RX5808 Connection

```
ESP32-S3        RX5808 Module
─────────────────────────────
GPIO4    ────── RSSI (analog output)
GPIO10   ────── CH1 / DATA
GPIO11   ────── CH2 / SELECT
GPIO12   ────── CH3 / CLOCK
GND      ────── GND
5V (VBUS)────── +5V
```

** Important Notes:**
- **GPIO4** for RSSI - Do NOT use GPIO3 (strapping pin, will prevent flashing)
- **VBUS (5V)** - Not 3.3V! RX5808 requires 5V
- Solder connections for reliability (no breadboard for final build)

#### MicroSD Card Module (Recommended)

```
ESP32-S3        SD Card Module
─────────────────────────────
GPIO39   ────── CS (Chip Select)
GPIO36   ────── SCK (Clock)
GPIO35   ────── MOSI (Data In)
GPIO37   ────── MISO (Data Out)
GND      ────── GND
3.3V     ────── VCC
```

** SD Card Notes:**
- Must be formatted as FAT32
- Use 3.3V power (not 5V!)
- Module should have voltage regulator
- First boot will auto-copy audio files to SD

#### RGB LED Strip (Optional)

```
ESP32-S3        WS2812 Strip
─────────────────────────────
VBUS (5V)────── +5V
GND      ────── GND
GPIO18   ────── Data In
```

**LED Configuration:**
- Edit `lib/RGBLED/rgbled.h` to set LED count:
  ```cpp
  #define NUM_LEDS 2  // Change to 1 or 2
  ```
- Add 330Ω resistor on data line for stability
- Keep strip short (1-2 LEDs max)

#### Buzzer (Optional)

```
ESP32-S3        Active Buzzer
─────────────────────────────
GPIO5    ────── Positive (+)
GND      ────── Negative (-)
```

**Buzzer Notes:**
- Use active buzzer (not passive)
- 3.3V-5V compatible
- No resistor needed

### Step 3: Power Supply

**Option A: USB Power (Development)**
- USB-C cable to ESP32-S3
- Easy for testing
- Not portable

**Option B: Battery Power (Portable)**
```
18650 Battery (3.7V nominal)
    ↓
5V Boost Converter (USB output)
    ↓
ESP32-S3 VBUS pin (USB-C or 5V pin)
```

**Recommended Setup:**
- 18650 battery holder
- MT3608 boost converter (set to 5.0V)
- XT60 or JST connector
- Power switch
- Add voltage monitoring to GPIO1 (battery sense)

### Step 4: Physical Assembly

**Enclosure Considerations:**
1. **Ventilation** - ESP32-S3 generates heat
2. **Antenna Placement** - RX5808 antenna should extend outside
3. **LED Visibility** - Mount LEDs where visible
4. **Button Access** - Leave BOOT button accessible for flashing
5. **SD Card Access** - Allow card removal without disassembly

**Mounting Options:**
- 3D printed case (STL files available in community)
- Plastic project box
- Custom PCB with integrated mounting

---

## Software Setup

### Prerequisites

#### Option A: Flashing Prebuilt Firmware (Easiest)

**Install esptool:**
```bash
pip install esptool
```

That's it! Download firmware from [Releases](https://github.com/LouisHitchcock/FPVGate/releases).

#### Option B: Building from Source

**Install Required Software:**

1. **Visual Studio Code**
   - Download: https://code.visualstudio.com/

2. **PlatformIO Extension**
   - Open VS Code
   - Extensions (Ctrl+Shift+X)
   - Search "PlatformIO IDE"
   - Click Install

3. **Python** (for esptool)
   - Download: https://www.python.org/downloads/
   - Check "Add Python to PATH" during install

---

## Flashing Firmware

### Method 1: Prebuilt Binaries (Recommended)

**1. Download Firmware**

Go to [Releases](https://github.com/LouisHitchcock/FPVGate/releases) and download:
- `bootloader-esp32s3.bin`
- `partitions-esp32s3.bin`
- `firmware-esp32s3.bin`
- `littlefs-esp32s3.bin`

**2. Connect ESP32-S3**

- Use data-capable USB-C cable
- Connect to computer
- Note the COM port (Windows: Device Manager → Ports)

**3. Flash Firmware**

**Windows:**
```bash
esptool.py --chip esp32s3 --port COM3 --baud 921600 write_flash -z ^
  0x0 bootloader-esp32s3.bin ^
  0x8000 partitions-esp32s3.bin ^
  0x10000 firmware-esp32s3.bin ^
  0x410000 littlefs-esp32s3.bin
```

**Linux/Mac:**
```bash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 write_flash -z \
  0x0 bootloader-esp32s3.bin \
  0x8000 partitions-esp32s3.bin \
  0x10000 firmware-esp32s3.bin \
  0x410000 littlefs-esp32s3.bin
```

**4. Verify**

You should see:
```
Connecting....
Writing at 0x00000000... (100%)
Hash of data verified.
Leaving...
```

### Method 2: Build from Source

**1. Clone Repository**

```bash
git clone https://github.com/LouisHitchcock/FPVGate.git
cd FPVGate
```

**2. Configure LED Count (if using external LEDs)**

Edit `lib/RGBLED/rgbled.h`:
```cpp
#define NUM_LEDS 2  // Change to 1 or 2
```

**3. Build and Flash**

**Using VS Code:**
1. Open FPVGate folder in VS Code
2. PlatformIO icon (left sidebar)
3. Project Tasks → ESP32S3 → General → Build
4. Wait for "SUCCESS"
5. Project Tasks → ESP32S3 → General → Upload
6. Project Tasks → ESP32S3 → Platform → Upload Filesystem Image

**Using Command Line:**
```bash
# Build firmware
pio run -e ESP32S3

# Flash firmware
pio run -e ESP32S3 -t upload

# Flash web interface
pio run -e ESP32S3 -t uploadfs
```

### Common Flashing Issues

**"Port doesn't exist"**
- Use data-capable USB-C cable (not charge-only)
- Try different USB ports
- Check Device Manager (Windows) or `ls /dev/tty*` (Linux)

**"Timed out waiting for packet header"**
- Disconnect RX5808 RSSI wire from GPIO4
- Hold BOOT button while plugging in USB
- Try lower baud rate: `--baud 115200`

**"Flash size mismatch"**
- Ensure you have ESP32-S3 with 8MB flash
- Don't use ESP32 or ESP32-C3 binaries

---

## Initial Configuration

![Calibration Wizard](../screenshots/Calibration%20Wizard%2005-12-2025.png)

### Step 1: Connect to FPVGate

**Power on your FPVGate device**

**WiFi Connection (Default):**

1. Look for WiFi network: `FPVGate_XXXX` (XXXX = last 4 digits of MAC)
2. Connect using password: `fpvgate1`
3. Open browser and go to:
   - `http://www.fpvgate.xyz` (preferred)
   - `http://192.168.4.1` (fallback)

**USB Connection (Optional):**

1. Connect ESP32-S3 via USB
2. Download [Electron app](https://github.com/LouisHitchcock/FPVGate/releases)
3. Launch app and select COM port
4. All features work identically

### Step 2: Configure Your VTx Frequency

1. Navigate to **Configuration** tab
2. **Pilot Info** section:
   - **Band & Channel**: Select to match your VTx
   - Default is RaceBand 8 (5917 MHz)
   - Frequency auto-calculates

**Common Frequencies:**
- RaceBand 1-8: 5658-5917 MHz
- Fatshark 1-8: 5740-5880 MHz
- Band E (DJI): 5705-5945 MHz

3. Click **"Save Configuration"**

### Step 3: Set Pilot Information

**Pilot Info Section:**

1. **Pilot Name**: Full name (used in voice callouts)
2. **Pilot Callsign**: Short name (max 10 chars, for UI)
3. **Phonetic Name**: How TTS pronounces your name
   - Example: "Louis" → "Louie"
   - Example: "Xavier" → "Zavier"
4. **Pilot Color**: Choose your racing color

**TTS Settings Section:**

1. **Announcer Type**: Choose announcement style
   - `Lap Time` - Announces each lap (recommended)
   - `Beep` - Just beeps
   - `2 Consecutive Laps` - Every 2 laps
   - `3 Consecutive Laps` - Every 3 laps

2. **Voice**: Select voice engine
   - `ElevenLabs (Sarah)` - Default, energetic
   - `ElevenLabs (Rachel)` - Calm
   - `PiperTTS` - Lower latency

3. **Enable Voice**: Click to test audio

4. Click **"Save Configuration"**

### Step 4: Run System Self-Test

1. Navigate to **Configuration** tab
2. Scroll to **System Diagnostics** section
3. Click **"Run System Self-Test"**

**Verify all tests pass:**
-  RX5808 RSSI Module
-  Storage (SD card or LittleFS)
-  WiFi/USB connectivity
-  Audio/Buzzer
-  RGB LEDs (if installed)
-  Configuration values

**If tests fail**, see [Troubleshooting](#troubleshooting) section.

---

## First Flight

### Step 1: Calibrate RSSI Thresholds

** Critical: Proper calibration is essential for accurate timing**

1. **Warm up your VTx** (30 seconds minimum)
2. **Position your drone** one gate distance away (~3-6 feet)
3. Navigate to **Calibration** tab
4. Watch the **RSSI graph** - note the peak value as you move drone to gate
5. **Set Enter RSSI**: 2-5 points below observed peak
6. **Set Exit RSSI**: 8-10 points below Enter RSSI
7. Click **"Save RSSI Thresholds"**

**Good Calibration Example:**
```
Observed peak: 150
Enter RSSI: 145 (5 below peak)
Exit RSSI: 135 (10 below enter)
```

**[Detailed calibration guide →](USER_GUIDE.md#calibration)**

### Step 2: Test Detection

1. Stay in **Calibration** tab
2. Fly your drone through the gate area
3. Watch the RSSI graph:
   - Should see single clean peak
   - Peak should cross Enter threshold
   - Should exit below Exit threshold

**If you see multiple peaks or false triggers**, see [Calibration Tips](USER_GUIDE.md#calibration-tips).

### Step 3: First Race

1. Navigate to **Race** tab
2. Click **"Start Race"**
3. Wait for countdown and start beep
4. Fly through the gate!
5. Watch lap times appear in table
6. Click **"Stop Race"** when finished

**[Complete user guide →](USER_GUIDE.md)**

---

## Troubleshooting

### Hardware Issues

**No WiFi Network Appearing**

- Wait 15 seconds after power-on
- Check 5V power supply voltage
- Verify firmware flashed successfully
- Check Serial Monitor for error messages

**No RSSI Reading**

- Verify RX5808 is powered (5V)
- Check GPIO4 connection (RSSI pin)
- Ensure RX5808 SPI mod is correct
- Test with multimeter: RSSI pin should show ~1-3V

**RGB LEDs Not Working**

- Check 5V power to LED strip
- Verify GPIO18 data connection
- Ensure `NUM_LEDS` matches your setup
- WS2812 LEDs need 5V (not 3.3V)

**SD Card Not Detected**

- Format as FAT32
- Check wiring (use 3.3V, not 5V!)
- Verify CS pin on GPIO39
- Try different SD card (Class 10 recommended)

### Software Issues

**Can't Connect to Web Interface**

- Try both URLs: `http://www.fpvgate.xyz` and `http://192.168.4.1`
- Forget and reconnect to WiFi network
- Clear browser cache
- Try different browser

**Voice Announcements Not Working**

- Click "Enable Audio" in Configuration
- Check browser allowed audio autoplay
- Verify SD card has audio files (or will use fallback)
- Test with "Generate Audio" button

**Missing Laps**

- Lower Enter RSSI threshold by 5 points
- Ensure VTx warmed up (30 seconds)
- Check band/channel matches your VTx
- Increase minimum lap time if getting false laps

**Too Many False Laps**

- Increase Minimum Lap Time to 12-15 seconds
- Raise Exit RSSI threshold
- Move timer further from flight path
- Reduce RF interference

### Getting Help

1. **Check documentation**: [User Guide](USER_GUIDE.md) | [Hardware Guide](HARDWARE_GUIDE.md)
2. **Run self-test**: Configuration → System Diagnostics
3. **Check Serial Monitor**: For debug messages
4. **GitHub Issues**: [Report bugs](https://github.com/LouisHitchcock/FPVGate/issues)
5. **Community**: [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions)

---

## Next Steps

 **Hardware assembled and tested**  
 **Firmware flashed successfully**  
 **Initial configuration complete**  
 **First flight tested**

**Continue learning:**

 **[User Guide](USER_GUIDE.md)** - Master all features  
 **[Hardware Guide](HARDWARE_GUIDE.md)** - Advanced hardware tips  
 **[Features Guide](FEATURES.md)** - Explore capabilities  
 **[Development Guide](DEVELOPMENT.md)** - Contribute to the project

---

**Need help? [Open an issue](https://github.com/LouisHitchcock/FPVGate/issues) or [start a discussion](https://github.com/LouisHitchcock/FPVGate/discussions)!**
