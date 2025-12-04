# FPVGate

**Personal FPV Lap Timer for ESP32-S3**

A compact, self-contained lap timing solution for 5.8GHz FPV drones. FPVGate combines RSSI-based timing with RGB LED status indicators and a modern web interface for accurate single-pilot lap timing.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PlatformIO](https://img.shields.io/badge/PlatformIO-ESP32--S3-orange.svg)](https://platformio.org/)
[![GitHub release](https://img.shields.io/github/v/release/LouisHitchcock/FPVGate)](https://github.com/LouisHitchcock/FPVGate/releases)
[![GitHub stars](https://img.shields.io/github/stars/LouisHitchcock/FPVGate)](https://github.com/LouisHitchcock/FPVGate/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/LouisHitchcock/FPVGate)](https://github.com/LouisHitchcock/FPVGate/issues)

**[Quick Start Guide](QUICKSTART.md)** | **[Download Prebuilt Firmware](https://github.com/LouisHitchcock/FPVGate/releases)**

---

## What is FPVGate?

FPVGate is a lap timer that measures the time it takes to complete a lap by detecting your drone's video transmitter signal strength (RSSI). When you fly through the gate, the timer detects the peak RSSI and records your lap time. It's perfect for:

- Personal practice sessions
- Small indoor tracks (even in your living room!)
- 2-3 inch whoops and micro quads
- Solo training and improvement tracking

## NEW in v1.2.1 - SD Card Storage Expansion

**SD Card Storage** - Offload audio files to SD card, freeing 85% of ESP32 flash memory  
**Automatic Migration** - Sounds auto-copy from flash to SD card on first boot  
**Expanded Capacity** - Support for 2MB OTA updates (vs 1.8MB before)  
**Graceful Fallback** - System works from LittleFS if SD card unavailable  
**Optimized Partitions** - 1MB LittleFS (web UI) + unlimited SD storage (audio)  

## v1.2.0 - System Diagnostics & Enhanced Features

**System Self-Test** - Comprehensive hardware/software diagnostics in Configuration page  
**PiperTTS Integration** - Lower latency TTS with exclusive mode (no pre-recorded file attempts)  
**Enhanced LED Presets** - Color pickers for Solid, Fade, and Strobe + new Pilot Colour preset  
**TTS Settings Section** - Dedicated UI section for all voice-related configuration  
**Complete Config Export** - Import/export now includes all frontend settings (theme, audio, LED)  
**Automatic Voice Engine** - TTS engine auto-selects based on chosen voice  
**Bug Fixes** - Fixed audio infinite loop, toggle stretching, voice button opacity

## v1.1.0 - Natural Voice System

**Natural Voice TTS** - ElevenLabs-powered pre-recorded audio (100% offline after generation)  
**Numbers 0-99** - "11.44" = "eleven point forty-four" (not robotic digit-by-digit)  
**Instant Transitions** - <50ms gaps between audio clips, 1.3x faster playback  
**4 Voice Options** - Sarah (energetic), Rachel (calm), Adam (male), Antoni (male)  
**Fastest 3 Consecutive** - RaceGOW format support in lap analysis  
**Gold Highlighting** - Fastest lap stands out with gold background  
**Redesigned Lap Table** - Lap Time | Gap | Total Time columns  
**Configurable Announcements** - Choose: Full / Lap+Time / Time Only  
**Gate 1 Terminology** - Replaces "Hole Shot" for clarity

## Confirmed Working Features

- **USB Connectivity** - Direct USB Serial CDC connection for local-only operation (ESP32-S3)  
- **Electron Desktop App** - Native desktop application with USB support for Windows/Mac/Linux  
- **Dual Transport** - Use WiFi or USB simultaneously, automatic fallback between transports  
- **Single Node RSSI Timing** - Accurate lap detection via 5.8GHz signal strength  
- **ESP32-S3 Support** - Optimized for ESP32-S3-DevKitC-1  
- **SD Card Storage** - Audio files stored on SD card, 85% more free flash space
- **System Self-Test** - Comprehensive diagnostics testing all hardware/software components  
- **RGB LED Indicators** - Visual feedback with 10 presets including customizable colors  
- **Web Interface** - Modern Material Design UI with **23 theme options**  
- **Dual TTS System** - ElevenLabs pre-recorded + PiperTTS (lower latency) with smart fallback
- **Natural Voice Announcements** - Natural number pronunciation ("eleven point forty-four")  
- **Phonetic Name Support** - Custom TTS pronunciation for pilot names  
- **Real-time RSSI Graph** - Visual calibration with live feedback  
- **Enhanced Lap Analysis** - Fastest Lap, Fastest 3 Consecutive, Best 3 Laps, Median  
- **Race History** - Saves pilot info (name, callsign, channel) with each race  
- **Persistent Settings** - Auto-save configuration, survives page refreshes  
- **Manual Lap Entry** - Add laps manually during race  
- **WiFi Access Point** - No apps required, works with any device  
- **OTA Updates** - Update firmware wirelessly  
- **Battery Monitoring** - Low voltage alarm with audio/visual alerts  
- **Configurable Lap Count** - Set finite laps (1-50) or infinite mode  
- **Pilot Color Selection** - Choose from 15 colors + Pilot Colour LED preset  
- **Complete Config Export** - Backup all settings including frontend preferences  
- **Minimum Lap Time** - Prevent false triggers from crashes (default: 5 seconds)  
- **Theme-Aware Branding** - SVG logo adapts to light/dark themes

## How It Works

FPVGate uses an **RX5808 video receiver module** to continuously monitor the RSSI (signal strength) of your drone's video transmitter. As your drone approaches the gate, the RSSI increases, peaks when you're closest, then decreases as you fly away.

The system uses two thresholds:
- **Enter RSSI** - Signal strength when you start crossing
- **Exit RSSI** - Signal strength when crossing ends

A lap is recorded when the RSSI rises above Enter, peaks, then falls below Exit. The time between peaks = your lap time.

The ESP32-S3 runs a web server that you connect to via WiFi. Configuration, race control, and live RSSI visualization all happen through your phone or tablet's web browser.

## Hardware Requirements

### Core Components
| Component | Description |
|-----------|-------------|
| **ESP32-S3-DevKitC-1** | Main controller with WiFi |
| **RX5808 Module** | 5.8GHz video receiver ([SPI mod required](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html)) |
| **MicroSD Card** | FAT32 formatted, for audio storage (1GB+ recommended) |
| **5V Power Supply** | 18650 battery + 5V regulator recommended |

### Optional Components
| Component | Description |
|-----------|-------------|
| **WS2812 RGB LED Strip** | 1-2 external LEDs for visual feedback |
| **Active Buzzer** | 3.3V-5V buzzer for audio notifications |

## Hardware Setup

### Wiring Diagram

#### RX5808 to ESP32-S3
```
ESP32-S3        RX5808
GPIO4    ────── RSSI
GPIO10   ────── CH1 (DATA)
GPIO11   ────── CH2 (SELECT)
GPIO12   ────── CH3 (CLOCK)
GND      ────── GND
5V       ────── +5V
```

#### Power Supply
```
5V Regulator → ESP32-S3 VBUS pin (5V input)
5V Regulator → RX5808 +5V pin
Battery GND  → Common ground for all components
```

#### Optional: External RGB LEDs
```
ESP32-S3        WS2812 Strip
VBUS (5V) ────── +5V
GND       ────── GND
GPIO18    ────── Data In
```

#### Optional: Buzzer
```
ESP32-S3        Buzzer
GPIO5    ────── Positive (+)
GND      ────── Negative (-)
```

#### MicroSD Card (Recommended)
```
ESP32-S3        MicroSD Module
GPIO39   ────── CS (Chip Select)
GPIO36   ────── SCK (Clock)
GPIO35   ────── MOSI (Data In)
GPIO37   ────── MISO (Data Out)
GND      ────── GND
3.3V     ────── VCC
```

### Important Notes
- **GPIO4 for RSSI**: GPIO3 is a strapping pin and will prevent flashing if connected
- **5V Power**: Both ESP32-S3 and RX5808 run on 5V for this setup
- **SD Card**: Must be FAT32 formatted; stores audio files to free up ESP32 flash
- **External LEDs**: If using external RGB strip, you can use 1-2 WS2812 LEDs

## Software Setup

### Prerequisites
- [Visual Studio Code](https://code.visualstudio.com/)
- [PlatformIO Extension](https://platformio.org/install/ide?install=vscode)
- USB-C cable (data capable)

## Installation Steps

### Option 1: Prebuilt Firmware (Recommended)

**Fastest way to get started!** Download prebuilt binaries and flash using esptool or ESP Flash Tool.

 **See the [Quick Start Guide](QUICKSTART.md) for detailed instructions.**

### Option 2: Build from Source

1. **Clone the Repository**
   ```bash
   git clone https://github.com/LouisHitchcock/FPVGate.git
   cd FPVGate
   ```

2. **Open in VS Code**
   - Launch VS Code
   - File → Open Folder → Select the FPVGate folder

3. **Configure LED Count (if using external LEDs)**
   
   If you're using external RGB LEDs, edit `lib/RGBLED/rgbled.h`:
   ```cpp
   #define NUM_LEDS 2  // Change to 1 or 2 based on your strip
   ```

4. **Build the Firmware**
   - Click the PlatformIO icon in the left sidebar
   - Project Tasks → ESP32S3 → General → Build
   - Wait for "SUCCESS"

5. **Flash the Firmware**
   - Connect your ESP32-S3 via USB
   - Project Tasks → ESP32S3 → General → Upload
   - Wait for "SUCCESS"

6. **Upload Web Interface Files**
   - Project Tasks → ESP32S3 → Platform → Upload Filesystem Image
   - Wait for "SUCCESS"

### Command Line Build (Alternative)
```bash
# Build firmware
pio run -e ESP32S3

# Flash firmware
pio run -e ESP32S3 -t upload

# Upload web files
pio run -e ESP32S3 -t uploadfs
```

### Building the Electron Desktop App (Optional)

If you want to build the Electron app from source:

1. **Install Node.js** (v16 or newer)
   - Download from [nodejs.org](https://nodejs.org/)

2. **Navigate to electron folder**
   ```bash
   cd electron
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Run in development mode**
   ```bash
   npm start
   ```

5. **Build for production**
   ```bash
   npm run build
   ```
   - Creates packaged app in `electron/dist/`
   - Windows: `FPVGate-win32-x64/FPVGate.exe`
   - macOS: `FPVGate-darwin-x64/FPVGate.app`
   - Linux: `FPVGate-linux-x64/FPVGate`

## Using FPVGate

### Connection Options

FPVGate supports two connection methods:

#### Option 1: WiFi Connection (Default)

1. **Power On** - Plug in your FPVGate device
2. **Connect to WiFi**
   - Look for network: `FPVGate_XXXX` (XXXX = last 4 digits of MAC)
   - Password: `fpvgate1`
3. **Open Web Interface**
   - Navigate to: `http://www.fpvgate.xyz` or `http://192.168.4.1`
   - The web interface should load automatically

#### Option 2: USB Connection (ESP32-S3 Only)

**Direct USB connection for zero-latency, local-only operation.**

**Benefits:**
- No WiFi required - works completely offline
- Lower latency for race control and LED commands
- Eliminates potential network connectivity issues
- WiFi remains available for multiple clients simultaneously

**Using the Electron Desktop App:**

1. **Download** the Electron app from the [Releases page](https://github.com/LouisHitchcock/FPVGate/releases)
2. **Install** and launch the FPVGate desktop application
3. **Connect** your ESP32-S3 via USB
4. **Select COM Port** in Configuration → System Setup
   - App auto-detects available serial ports
   - COM port selection dropdown added to config menu
5. The app automatically uses USB transport when connected

**Using Web Interface with USB:**

1. Connect your ESP32-S3 via USB
2. Open the web interface in a browser
3. Click the USB connection mode selector in Configuration
4. Select your COM port from the dropdown
5. All features work identically to WiFi mode

**Transport Features:**
- Automatic fallback: USB ↔ WiFi seamless switching
- Simultaneous connections: USB for race control, WiFi for spectators
- All features supported: race control, LED commands, lap timing, voice announcements
- JSON-based command protocol over Serial CDC

### RGB LED Status Indicators

The RGB LED provides instant visual feedback:

| Color/Pattern | Meaning |
|---------------|---------|
| **Green Flash** | User connected to web interface OR race started |
| **White Flash** | Lap detected! |
| **Red Triple Flash** | Race reset |
| **Off** | Idle/Ready state |

### Configuration

Navigate to the **Configuration** tab:

The Configuration tab is now organized into five clear sections:

#### Race Setup Section
- **Number of Laps**: Set finite laps (1-50) or infinite mode (0)
  - Default: Infinite (0)
  - Race auto-stops when lap count reached (unless infinite)
  - Live lap counter shows "Lap X / Y" or "Lap X" for infinite

- **Minimum Lap Time**: Prevents false laps from crashes or multi-passes
  - Default: 5 seconds
  - Recommended: 5-8 seconds for tight tracks, 10-15 seconds for larger tracks

#### TTS Settings Section
- **Announcer Type**: Choose how lap times are announced
  - `None` - Silent
  - `Beep` - Short beep only
  - `Lap Time` - Voice announces your lap time
  - `2 Consecutive Laps` - Announces combined time of last 2 laps
  - `3 Consecutive Laps` - Announces combined time of last 3 laps

- **Lap Announcement Format**: Choose how voice announces laps
  - `Pilot + Lap + Time` - "Louis Lap 5, 12.34" (Full)
  - `Lap + Time` - "Lap 5, 12.34"
  - `Time Only` - "12.34" (Fastest)

- **Voice**: Select TTS engine and voice
  - `ElevenLabs (Sarah - Energetic)` - Natural pre-recorded audio (default)
  - `ElevenLabs (Rachel - Calm)` - Natural pre-recorded audio
  - `ElevenLabs (Adam - Deep Male)` - Natural pre-recorded audio
  - `ElevenLabs (Antoni - Male)` - Natural pre-recorded audio
  - `PiperTTS (Lower Latency)` - **Exclusive mode** - uses only PiperTTS, no pre-recorded files
  - **Note**: ElevenLabs voices try pre-recorded files first, fallback to PiperTTS if missing
  
- **Announcer Rate**: Voice speed (0.1 = slow, 2.0 = fast)

- **Voice Control**: Enable/Disable/Test voice announcements
  - Visual feedback with active button highlighting

#### Pilot Info Section
- **Band & Channel**: Set to match your VTx frequency
  - Default: **RaceBand 8** (5917 MHz)
  - Supported: A, B, E, F (Fatshark), R (RaceBand), L (LowBand)
  - Frequency auto-calculated from selection

- **Pilot Name**: Full name for voice callouts
  
- **Pilot Callsign**: Short displayed name (max 10 characters)
  - Used in UI and race history

- **Phonetic Name**: How TTS pronounces your name (max 30 characters)
  - Example: "Louis" → "Louie", "Xavier" → "Zavier"
  - Falls back to Pilot Name if empty

- **Pilot Color**: Choose from 15 colors
  - Red, Orange, Gold, Green, Cyan, Blue, Purple, Magenta, Pink, White, Gray, Black, Brown, Spring Green, Hot Pink
  - Live preview swatch shows selected color
  - Default: Blue

#### LED Setup Section
- **LED Preset**: Choose from 10 visual effects
  - `Off` - LEDs disabled
  - `Solid Colour` - **Color picker available** - set custom solid color
  - `Rainbow Wave` - Smooth rainbow animation (default)
  - `Color Fade` - **Color picker available** - fade to/from custom color
  - `Fire` - Flickering fire effect
  - `Ocean` - Blue wave pattern
  - `Police` - Red/blue alternating (slowed for visibility)
  - `Strobe` - **Color picker available** - custom color strobe (slowed for visibility)
  - `Comet` - Chasing light effect
  - `Pilot Colour` - Uses your Pilot Color from Pilot Info section

- **Animation Speed**: Controls effect speed (1-20)
  - Affects Rainbow, Pulse, and animation presets
  - Default: 5

- **LED Brightness**: Adjust brightness (0-255)
  - Default: 80
  - Helps reduce power consumption or match ambient lighting

- **Manual LED Control**: Toggle for manual override
  - When enabled, race events won't affect LED settings
  - Useful for keeping LEDs in specific state during practice

#### System Setup Section
- **Battery Monitoring**: Toggle on/off
  - When enabled, shows voltage and low battery alarm threshold
  
- **Low Battery Alarm**: Voltage threshold for warnings
  - Set to your battery's safe minimum (e.g., 3.3V for 1S)

- **Theme**: Choose from 23 Material Theme color schemes
  - **Material Themes**: Lighter, Oceanic (default), Darker, Palenight, Deep Ocean, Forest, Sky Blue, Sandy Beach, Volcano, Space
  - **Classic Dark**: Monokai Pro, Dracula, Arc Dark, One Dark, Night Owl, Moonlight, SynthWave '84
  - **Classic Light**: GitHub, GitHub Dark, One Light, Solarized Dark/Light, Light Owl
  - Logo automatically adjusts (black/white) based on theme brightness

- **Config Management**:
  - **Download Config**: Export all settings as JSON backup
  - **Import Config**: Restore settings from JSON file
  - Includes both backend (frequency, thresholds) and frontend (theme, audio, LED) settings

#### System Diagnostics Section
- **System Self-Test**: Comprehensive hardware and software validation
  - Tests: RX5808 RSSI Module, Lap Timer, Audio/Buzzer, Configuration, Race History, Web Server, OTA Updates, Storage (LittleFS), EEPROM, WiFi, Battery Monitor, RGB LED
  - Click **"Run System Self-Test"** to validate all components
  - Visual pass/fail indicators with test duration and detailed messages
  - Use for troubleshooting hardware issues or verifying correct setup

**What the Self-Test Validates:**
-  RX5808 module responding and reading RSSI (checks GPIO wiring)
-  Lap Timer can communicate with RX5808
-  Audio/Buzzer functional and audio files present
-  Configuration values in valid ranges (frequency, RSSI thresholds)
-  Race History storage accessible
-  Web Server files loaded (index.html, script.js, style.css)
-  OTA update space available (>100KB)
-  LittleFS filesystem mounted and accessible
-  EEPROM read/write working
-  WiFi initialized and active
-  Battery monitor reading voltage
-  RGB LED all channels functional (R, G, B)

**Don't forget to click "Save Configuration" after making changes!**

### Calibration

**Calibration is critical for accurate timing.** Follow these steps carefully:

#### Step 1: Prepare
1. Power on FPVGate and your drone
2. Wait **30 seconds** for the VTx to reach operating temperature
3. Navigate to the **Calibration** tab in the web interface

#### Step 2: Observe Baseline RSSI
1. Place your drone **one gate distance away** from FPVGate
   - For living room: ~3-4 feet
   - For outdoor track: ~6-8 feet
2. Watch the **RSSI graph** - note the peak value as you hold the drone at gate distance

#### Step 3: Set Thresholds
1. **Enter RSSI**: Set to **2-5 points below** the observed peak
   - This is when FPVGate starts "watching" for a lap
   
2. **Exit RSSI**: Set to **8-10 points below** Enter RSSI
   - This is when FPVGate stops "watching" and records the lap

3. Click **"Save RSSI Thresholds"**

#### Understanding the Graph
- **Blue Area** = Clear zone (no drone nearby)
- **Green Area** = Crossing zone (drone passing through gate)
- **Red Line** = Enter RSSI threshold
- **Orange Line** = Exit RSSI threshold

#### Good vs Bad Calibration

** Good Calibration:**
```
RSSI  │     /\
      │    /  \
      │   /    \     ← Single clean peak
Enter ├──/──────\───
      │ /        \
Exit  ├/──────────\─
      └─────────────── Time
```

** Bad Calibration (thresholds too low):**
```
RSSI  │   /\/\    ← Multiple peaks = multiple laps!
      │  /    \
Enter ├─/──────\───
      │/        \
Exit  /──────────\─
      └─────────────── Time
```

#### Tips
- **Flying with others?** Lower both thresholds by 3-5 points to account for RF noise
- **Lots of false laps?** Increase Exit RSSI or increase Minimum Lap Time
- **Missing laps?** Lower Enter RSSI threshold
- **Test your calibration** by flying a few practice laps and watching the graph

### Racing

1. Navigate to the **Race** tab
2. Click **"Start Race"**
   - Button turns orange and pulses
   - Hear countdown: "Arm your quad... Starting on the tone in less than five"
   - Race begins with a beep
3. **Fly!** Each lap is recorded automatically
   - Lap times appear in the table
   - Voice announces lap time (if enabled)
   - RGB LED flashes white
4. **Manual Lap Entry**: Click "Add Lap" to manually record a lap at any time
5. Click **"Stop Race"** when finished
6. Use **"Clear Laps"** to reset the table

### Race Table Columns
- **Lap No**: Lap number (0 = hole shot)
- **Lap Time**: Individual lap time
- **2 Lap Time**: Combined time of current + previous lap
- **3 Lap Time**: Combined time of current + previous 2 laps

### Lap Analysis

Below the lap table, you'll find visual lap analysis:

**Stats Boxes** (automatically calculated):
- **Fastest Lap**: Your quickest single lap
- **Median Lap**: Middle lap time (consistency indicator)
- **Best 3 Laps**: Sum of your 3 fastest laps with lap numbers

**Charts** (toggle between):
- **Lap History**: Bar chart of your last 10 laps with color coding
- **Fastest Round (3 Laps)**: Bar chart of your best consecutive 3-lap sequence

### Race History

Navigate to the **Race History** tab to view saved races:

#### Features
- **Auto-save**: Races automatically save when you stop or clear laps
- **Custom Names**: Add descriptive names (e.g., "Morning Practice")
- **Tags**: Categorize races (e.g., "training", "race", "freestyle")
- **Persistent Storage**: Races survive reboots (stored in flash memory)
- **Download/Import**: Export races as JSON for backup or sharing
  - Download all races at once
  - Download individual races
  - Import races from other devices
- **Visual Details**: Click any race to view full statistics and bar charts

#### Managing Races
1. **Edit**: Click "Edit" to add/modify race name and tag
2. **Download**: Click "Download" to export a single race as JSON
3. **Delete**: Remove individual races you no longer need
4. **Clear All**: Bulk delete all saved races (with confirmation)

**Note**: Race history is erased when you upload the filesystem (`uploadfs`). Download your races first if you're reflashing!

## Troubleshooting

### WiFi Connection Issues
**Problem**: Can't find FPVGate network  
**Solution**: 
- Make sure device is powered on (5V to VBUS)
- Wait 10 seconds after power-on for network to appear
- Check for network name: `FPVGate_XXXX`

**Problem**: Wrong password  
**Solution**: Password is `fpvgate1` (8 characters, all lowercase)

**Problem**: Can't access web interface  
**Solution**: Try both URLs:
- `http://www.fpvgate.xyz`
- `http://192.168.4.1`

### Flashing/Upload Issues
**Problem**: "Port doesn't exist" error  
**Solution**: 
- Use a **data-capable** USB-C cable (some are charge-only)
- Try different USB ports
- Check Device Manager (Windows) for COM port

**Problem**: "Timed out waiting for packet header" error  
**Solution**: 
- Disconnect RX5808 RSSI wire from GPIO4 temporarily
- GPIO3 is a strapping pin - never connect to it
- Hold BOOT button while plugging in USB

### Timing/Calibration Issues
**Problem**: Missing laps  
**Solution**: 
- Lower Enter RSSI threshold by 5 points
- Ensure VTx has warmed up (30 seconds minimum)
- Check that Band/Channel matches your drone

**Problem**: Too many false laps  
**Solution**: 
- Increase Minimum Lap Time to 12-15 seconds
- Raise Exit RSSI threshold by 3-5 points
- Move timer further from flight path

**Problem**: Inconsistent lap detection  
**Solution**: 
- Ensure stable 5V power supply
- Check for loose RX5808 connections
- Re-calibrate when flying with other pilots

### RGB LED Issues
**Problem**: External LEDs not working  
**Solution**: 
- Verify 5V power to LED strip (VBUS pin)
- Check data wire connection to GPIO18
- Ensure `NUM_LEDS` in `rgbled.h` matches your strip
- WS2812 LEDs need 5V, not 3.3V

**Problem**: Wrong colors or random behavior  
**Solution**: 
- Confirm WS2812 LED type (not WS2811 or SK6812)
- Check wiring: VBUS=5V, GND=GND, GPIO18=Data
- Add 100-330Ω resistor on data line if experiencing issues

## Default Settings

- **WiFi SSID**: `FPVGate_XXXX`
- **WiFi Password**: `fpvgate1`
- **Default Channel**: RaceBand 8 (5917 MHz)
- **Web Address**: `http://www.fpvgate.xyz` or `http://192.168.4.1`
- **Minimum Lap**: 5 seconds
- **Default Lap Count**: Infinite (0)
- **Default Theme**: Material Oceanic
- **Default Pilot Color**: Blue
- **RGB LED Pin**: GPIO18

## Project Structure

```
FPVGate/
├── data/                  # Web interface files
│   ├── index.html        # Main web app
│   ├── script.js         # UI logic and race control
│   ├── usb-transport.js  # USB Serial CDC transport
│   ├── style.css         # Material Design themes
│   └── ...               # Supporting libraries
├── docs/                  # Documentation
│   ├── MULTI_VOICE_SETUP.md
│   ├── VOICE_GENERATION_README.md
│   └── SD_CARD_MIGRATION_GUIDE.md
├── electron/              # Desktop application
│   ├── main.js           # Electron main process
│   ├── preload.js        # Preload script
│   └── package.json      # Electron dependencies
├── lib/
│   ├── CONFIG/           # Configuration & EEPROM
│   ├── LAPTIMER/         # Core timing logic
│   ├── RACEHISTORY/      # Race storage & persistence
│   ├── RGBLED/           # RGB LED control (ESP32-S3)
│   ├── RX5808/           # VRx SPI communication
│   ├── TRANSPORT/        # Transport abstraction layer
│   ├── USB/              # USB Serial CDC transport
│   ├── WEBSERVER/        # WiFi & web server
│   ├── SELFTEST/         # System diagnostics
│   ├── KALMAN/           # RSSI filtering
│   ├── BUZZER/           # Audio feedback
│   └── BATTERY/          # Voltage monitoring
├── release/               # Prebuilt firmware releases
│   ├── v1.2.1/           # Latest release
│   └── v1.2.0/           # Previous release
├── src/
│   └── main.cpp          # Main application entry
├── targets/
│   ├── ESP32S3.ini       # ESP32-S3 build config
│   └── custom_8mb.csv    # Custom partition table
├── tools/                 # Python utilities
│   ├── generate_voice_files.py
│   ├── upload_sounds_to_sd.py
│   └── ...               # Voice generation scripts
└── platformio.ini        # PlatformIO configuration
```

## Technical Details

### Pin Configuration (ESP32-S3)
| GPIO | Function |
|------|----------|
| 1 | Battery voltage sense |
| 2 | Status LED (onboard) |
| 4 | RX5808 RSSI |
| 5 | Buzzer |
| 10 | RX5808 CH1 (DATA) |
| 11 | RX5808 CH2 (SELECT) |
| 12 | RX5808 CH3 (CLOCK) |
| 18 | External RGB LED (WS2812) |

### Memory Usage
- **RAM**: ~15% (49KB / 328KB)
- **Flash**: ~28% (940KB / 3.3MB)

### Libraries Used
- AsyncTCP - Async TCP library for ESP32
- ESPAsyncWebServer - Async web server
- ArduinoJson - JSON serialization
- ElegantOTA - OTA updates
- FastLED - RGB LED control

## Contributing

Contributions are welcome! If you'd like to improve FPVGate:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## Credits

FPVGate is a heavily modified fork of [PhobosLT](https://github.com/phobos-/PhobosLT) by phobos-. 

The original PhobosLT project provided the foundation for RSSI-based lap timing. FPVGate adds ESP32-S3 support, RGB LED indicators, a modernized web interface, and various improvements for personal use.

Portions of the timing logic are inspired by [RotorHazard](https://github.com/RotorHazard/RotorHazard).
