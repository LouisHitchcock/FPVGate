# FPVGate

**Personal FPV Lap Timer for ESP32-S3**

A compact, self-contained lap timing solution for 5.8GHz FPV drones. FPVGate combines RSSI-based timing with RGB LED status indicators and a modern web interface for accurate single-pilot lap timing.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What is FPVGate?

FPVGate is a lap timer that measures the time it takes to complete a lap by detecting your drone's video transmitter signal strength (RSSI). When you fly through the gate, the timer detects the peak RSSI and records your lap time. It's perfect for:

- Personal practice sessions
- Small indoor tracks (even in your living room!)
- 2-3 inch whoops and micro quads
- Solo training and improvement tracking

## Confirmed Working Features

✅ **Single Node RSSI Timing** - Accurate lap detection via 5.8GHz signal strength  
✅ **ESP32-S3 Support** - Optimized for ESP32-S3-DevKitC-1  
✅ **RGB LED Indicators** - Visual feedback for race events (supports external NeoPixels)  
✅ **Web Interface** - Modern Material Design UI with 4 theme options  
✅ **Voice Announcements** - Lap time callouts with customizable pilot name  
✅ **Real-time RSSI Graph** - Visual calibration with live feedback  
✅ **Lap History** - 2-lap and 3-lap consecutive time tracking  
✅ **Manual Lap Entry** - Add laps manually during race  
✅ **WiFi Access Point** - No apps required, works with any device  
✅ **OTA Updates** - Update firmware wirelessly  
✅ **Battery Monitoring** - Low voltage alarm with audio/visual alerts  
✅ **Minimum Lap Time** - Prevent false triggers from crashes  

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

### Important Notes
- **GPIO4 for RSSI**: GPIO3 is a strapping pin and will prevent flashing if connected
- **5V Power**: Both ESP32-S3 and RX5808 run on 5V for this setup
- **External LEDs**: If using external RGB strip, you can use 1-2 WS2812 LEDs

## Software Setup

### Prerequisites
- [Visual Studio Code](https://code.visualstudio.com/)
- [PlatformIO Extension](https://platformio.org/install/ide?install=vscode)
- USB-C cable (data capable)

### Installation Steps

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

## Using FPVGate

### First Connection

1. **Power On** - Plug in your FPVGate device
2. **Connect to WiFi**
   - Look for network: `FPVGate_XXXX` (XXXX = last 4 digits of MAC)
   - Password: `fpvgate1`
3. **Open Web Interface**
   - Navigate to: `http://www.fpvgate.xyz` or `http://192.168.4.1`
   - The web interface should load automatically

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

#### Basic Settings
- **Band & Channel**: Set to match your VTx frequency
  - Default: **RaceBand 8** (5917 MHz)
  - Supported: A, B, E, F (Fatshark), R (RaceBand), L (LowBand)
- **Frequency**: Auto-calculated from band/channel selection

#### Race Settings
- **Minimum Lap Time**: Prevents false laps from crashes or multi-passes
  - Recommended: 10 seconds for tight tracks
  - Increase for larger tracks to avoid issues
  
- **Battery Alarm**: Low voltage warning threshold
  - Set to your battery's safe minimum (e.g., 3.3V for 1S)

#### Announcer Settings
- **Type**: Choose how lap times are announced
  - `None` - Silent
  - `Beep` - Short beep only
  - `Lap Time` - Voice announces your lap time
  - `2 Consecutive Laps` - Announces combined time of last 2 laps
  - `3 Consecutive Laps` - Announces combined time of last 3 laps
  
- **Announcer Rate**: Voice speed (0.1 = slow, 2.0 = fast)
  
- **Pilot Name**: Optional name for voice callouts
  - Leave empty for solo practice
  - Example: "Pilot1, 23.45 seconds"

#### Visual Settings
- **Theme**: Choose your preferred color scheme
  - Light - Clean bright theme
  - Dark - Pure dark theme
  - Material Oceanic - Blue-grey with teal accents
  - Material Deep Ocean - Dark navy with cyan accents

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

**✅ Good Calibration:**
```
RSSI  │     /\
      │    /  \
      │   /    \     ← Single clean peak
Enter ├──/──────\───
      │ /        \
Exit  ├/──────────\─
      └─────────────── Time
```

**❌ Bad Calibration (thresholds too low):**
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
- **Minimum Lap**: 10 seconds
- **RGB LED Pin**: GPIO18

## Project Structure

```
FPVGate/
├── data/                  # Web interface files
│   ├── index.html        # Main web app
│   ├── script.js         # UI logic and race control
│   ├── style.css         # Material Design themes
│   └── ...               # Supporting libraries
├── lib/
│   ├── CONFIG/           # Configuration & EEPROM
│   ├── LAPTIMER/         # Core timing logic
│   ├── RGBLED/           # RGB LED control (ESP32-S3)
│   ├── RX5808/           # VRx SPI communication
│   ├── WEBSERVER/        # WiFi & web server
│   ├── KALMAN/           # RSSI filtering
│   ├── BUZZER/           # Audio feedback
│   └── BATTERY/          # Voltage monitoring
├── src/
│   └── main.cpp          # Main application entry
├── targets/
│   └── ESP32S3.ini       # ESP32-S3 build config
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
