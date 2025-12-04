# FPVGate Development Guide

Guide for building, modifying, and contributing to FPVGate.

** Navigation:** [Home](../README.md) | [Getting Started](GETTING_STARTED.md) | [User Guide](USER_GUIDE.md) | [Hardware Guide](HARDWARE_GUIDE.md) | [Features](FEATURES.md)

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Building from Source](#building-from-source)
3. [Project Structure](#project-structure)
4. [Firmware Development](#firmware-development)
5. [Web Interface Development](#web-interface-development)
6. [Electron App Development](#electron-app-development)
7. [Testing](#testing)
8. [Contributing](#contributing)
9. [Release Process](#release-process)
10. [Troubleshooting Build Issues](#troubleshooting-build-issues)

---

## Development Setup

### Prerequisites

**Required Tools:**

| Tool | Version | Purpose |
|------|---------|---------|
| **PlatformIO** | Latest | ESP32 firmware compilation |
| **Python** | 3.7+ | Build scripts, TTS generation |
| **Node.js** | 14+ | Electron app (optional) |
| **Git** | 2.0+ | Version control |
| **VS Code** | Latest | Recommended IDE |

### Installing PlatformIO

**Option 1: VS Code Extension (Recommended)**

1. Install VS Code
2. Open Extensions (Ctrl+Shift+X)
3. Search "PlatformIO IDE"
4. Click Install
5. Restart VS Code

**Option 2: CLI Only**

```bash
pip install platformio
```

### Installing Python Dependencies

```bash
cd FPVGate
pip install -r requirements.txt
```

**Included Packages:**
- `elevenlabs` - TTS generation
- `esptool` - ESP32 flashing
- `pyserial` - Serial communication

### Cloning the Repository

```bash
git clone https://github.com/LouisHitchcock/FPVGate.git
cd FPVGate
```

---

## Building from Source

### Quick Build

**Using PlatformIO IDE (VS Code):**

1. Open FPVGate folder in VS Code
2. PlatformIO sidebar → PROJECT TASKS
3. `esp32-s3-devkitc-1` → General → Build
4. Wait for compilation (~2-3 minutes first time)

**Using CLI:**

```bash
pio run -e esp32-s3-devkitc-1
```

### Uploading Firmware

**With USB Connected:**

```bash
# Auto-detect port and upload
pio run -e esp32-s3-devkitc-1 -t upload

# Or specify port
pio run -e esp32-s3-devkitc-1 -t upload --upload-port COM12
```

**Manual Upload (esptool):**

```bash
# Erase flash first (clean install)
python -m esptool --port COM12 erase_flash

# Upload firmware
python -m esptool --port COM12 --baud 460800 write_flash 0x0 .pio/build/esp32-s3-devkitc-1/firmware.bin
```

### Build Targets

**platformio.ini Environments:**

```ini
[env:esp32-s3-devkitc-1]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
```

**Available Targets:**

| Target | Description |
|--------|-------------|
| `build` | Compile firmware only |
| `upload` | Compile and upload |
| `uploadfs` | Upload filesystem (LittleFS) |
| `monitor` | Open serial monitor |
| `clean` | Clean build cache |
| `erase` | Erase entire flash |

### Building Filesystem

**LittleFS contains:**
- Web interface files (data/)
- Configuration defaults
- PiperTTS model

**Build and Upload:**

```bash
# Build filesystem image
pio run -e esp32-s3-devkitc-1 -t buildfs

# Upload to ESP32
pio run -e esp32-s3-devkitc-1 -t uploadfs
```

**Note:** Uploadfs erases `/config.json` and `/races.json` - backup first!

---

## Project Structure

### Firmware Architecture

```
FPVGate/
├── src/
│   └── main.cpp                  # Entry point
├── lib/                          # Custom libraries
│   ├── CALIBRATION/
│   │   ├── calibration.h
│   │   └── calibration.cpp       # RSSI calibration logic
│   ├── CONFIG/
│   │   ├── config.h
│   │   └── config.cpp            # Configuration management
│   ├── FASTLED/
│   │   ├── fastled_control.h
│   │   └── fastled_control.cpp   # LED animations
│   ├── FREQUENCY/
│   │   ├── frequency.h
│   │   └── frequency.cpp         # Band/channel/MHz conversion
│   ├── RACEHISTORY/
│   │   ├── racehistory.h
│   │   └── racehistory.cpp       # Race storage, export/import
│   ├── RACELOGIC/
│   │   ├── racelogic.h
│   │   └── racelogic.cpp         # Timing state machine
│   ├── RX5808/
│   │   ├── rx5808.h
│   │   └── rx5808.cpp            # RX5808 SPI driver
│   ├── SELFTEST/
│   │   ├── selftest.h
│   │   └── selftest.cpp          # Hardware diagnostics
│   ├── TRANSPORT/
│   │   ├── transport.h           # Transport abstraction
│   │   └── transport.cpp
│   ├── TTS/
│   │   ├── tts.h
│   │   └── tts.cpp               # Text-to-speech management
│   ├── USB/
│   │   ├── usb.h
│   │   └── usb.cpp               # USB Serial CDC transport
│   ├── WEBSERVER/
│   │   ├── webserver.h
│   │   └── webserver.cpp         # HTTP + WebSocket server
│   └── WIFIMAN/
│       ├── wifiman.h
│       └── wifiman.cpp           # WiFi AP management
├── data/                         # Web interface (uploaded to LittleFS)
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── usb-transport.js
│   └── themes.css
├── tools/                        # Python utilities
│   ├── tts_generator.py
│   ├── upload_to_sd.py
│   └── ...
├── electron/                     # Desktop app
│   ├── main.js
│   ├── preload.js
│   └── package.json
├── platformio.ini                # PlatformIO config
└── README.md
```

### Key Files

#### main.cpp

**Entry point** - Setup and main loop.

**Key Functions:**
- `setup()` - Initialize all subsystems
- `loop()` - Main event loop

**Subsystem Init Order:**
1. Serial (debug output)
2. LittleFS (filesystem)
3. Config (load settings)
4. RX5808 (SPI + frequency)
5. FastLED (RGB LEDs)
6. WiFi (Access Point)
7. WebServer (HTTP + WebSocket)
8. USB (Serial CDC)
9. TTS (voice system)

#### lib/RACELOGIC/racelogic.cpp

**Core timing logic** - State machine for lap detection.

**States:**
- `IDLE` - Waiting for RSSI rise
- `CROSSING` - In gate, watching for peak
- `COOLDOWN` - Minimum lap time delay

**Key Methods:**
- `update()` - Called every loop (~100Hz)
- `startRace()` - Begin countdown
- `stopRace()` - End race, save
- `addManualLap()` - Force lap at current time

#### lib/WEBSERVER/webserver.cpp

**HTTP + WebSocket server** - API endpoints and real-time events.

**API Endpoints:**
- `GET /` - Serve index.html
- `GET /api/config` - Get configuration
- `POST /api/config/...` - Update settings
- `POST /timer/start` - Start race
- `POST /timer/stop` - Stop race
- `POST /timer/lap` - Manual lap
- `POST /timer/clear` - Clear laps

**WebSocket Events:**
- `lap` - Lap detected
- `raceStart` - Race starting
- `raceStop` - Race stopped
- `rssiUpdate` - RSSI value (calibration)

#### lib/USB/usb.cpp

**USB Serial CDC transport** - JSON command/event protocol.

**Command Format:**
```json
{"method":"POST","path":"timer/start","data":{}}
```

**Event Format:**
```json
EVENT:{"type":"lap","data":{...}}
```

---

## Firmware Development

### Adding a New Feature

**Example: Add "Fastest Lap Voice Callout"**

#### Step 1: Update Core Logic

**lib/RACELOGIC/racelogic.cpp:**

```cpp
void RaceLogic::addLap(unsigned long lapTime) {
  // Existing code...
  laps.push_back(lap);
  
  // NEW: Check if fastest lap
  if (lapTime < fastestLap || fastestLap == 0) {
    fastestLap = lapTime;
    
    // Trigger TTS announcement
    TTS::announceMessage("Fastest lap!");
  }
  
  // Broadcast event
  TransportManager::broadcast(/* ... */);
}
```

#### Step 2: Add API Endpoint (if needed)

**lib/WEBSERVER/webserver.cpp:**

```cpp
server.on("/api/race/fastest", HTTP_GET, [](AsyncWebServerRequest *request) {
  StaticJsonDocument<200> doc;
  doc["fastest_lap"] = RaceLogic::getFastestLap();
  doc["lap_number"] = RaceLogic::getFastestLapNumber();
  
  String response;
  serializeJson(doc, response);
  request->send(200, "application/json", response);
});
```

#### Step 3: Update Frontend

**data/script.js:**

```javascript
function handleLapEvent(data) {
  // Existing lap handling...
  
  // Check if fastest lap
  if (data.isFastestLap) {
    showNotification(" Fastest Lap!");
  }
}
```

#### Step 4: Test

1. Build and upload firmware
2. Test in browser
3. Verify voice announcement
4. Check API response

### Debugging Techniques

#### Serial Monitor

**Enable Debug Output:**

```cpp
// main.cpp
#define DEBUG_MODE 1

#ifdef DEBUG_MODE
  Serial.println("RX5808 initialized");
  Serial.printf("RSSI: %d\n", rssi);
#endif
```

**View Output:**

```bash
pio device monitor -b 115200
```

#### LED Debugging

**Use LEDs for status:**

```cpp
void showDebugStatus() {
  if (wifiConnected) {
    FastLED::showColor(CRGB::Green);
  } else {
    FastLED::showColor(CRGB::Red);
  }
  delay(500);
  FastLED::clear();
}
```

#### Remote Logging

**Send debug messages to web clients:**

```cpp
void debugLog(String message) {
  StaticJsonDocument<200> doc;
  doc["type"] = "debug";
  doc["message"] = message;
  
  String output;
  serializeJson(doc, output);
  TransportManager::broadcast(output);
}
```

### Memory Optimization

**Check Memory Usage:**

```cpp
void printMemoryStats() {
  Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());
  Serial.printf("Largest free block: %d bytes\n", ESP.getMaxAllocHeap());
  Serial.printf("Flash size: %d bytes\n", ESP.getFlashChipSize());
}
```

**Optimize Techniques:**
- Use `PROGMEM` for large const data
- Minimize String usage (use char[])
- Free unused memory promptly
- Use `const` and `static` where possible

---

## Web Interface Development

### Live Development Workflow

**Option 1: Direct Edit on ESP32**

1. Edit `data/` files locally
2. Upload filesystem: `pio run -t uploadfs`
3. Refresh browser

**Option 2: Local HTTP Server (Faster Iteration)**

1. Start local server:
   ```bash
   cd data/
   python -m http.server 8000
   ```

2. Update API calls to point to ESP32:
   ```javascript
   const API_BASE = 'http://192.168.4.1';
   ```

3. Open `http://localhost:8000` in browser

4. When done, revert API_BASE and upload to ESP32

### Adding a New UI Component

**Example: Add "Total Race Time" Display**

#### Step 1: HTML Structure

**data/index.html:**

```html
<div class="race-controls">
  <!-- Existing controls -->
  
  <div class="stat-box">
    <h3>Total Time</h3>
    <p id="totalRaceTime">00:00:00</p>
  </div>
</div>
```

#### Step 2: Styling

**data/style.css:**

```css
.stat-box {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  text-align: center;
}

.stat-box h3 {
  font-size: 0.9rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.stat-box p {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--accent-color);
}
```

#### Step 3: JavaScript Logic

**data/script.js:**

```javascript
function updateTotalRaceTime() {
  const totalMs = laps.reduce((sum, lap) => sum + lap.time, 0);
  const formatted = formatTime(totalMs);
  document.getElementById('totalRaceTime').textContent = formatted;
}

// Call on lap events
function handleLap(data) {
  // Existing code...
  updateTotalRaceTime();
}
```

### Theme Development

**Adding a New Theme:**

**data/themes.css:**

```css
/* Custom Dark Blue Theme */
[data-theme="dark-blue"] {
  --bg-primary: #0a1929;
  --bg-secondary: #132f4c;
  --card-bg: #1a3a52;
  --text-primary: #e7ebf0;
  --text-secondary: #b0bec5;
  --accent-color: #3399ff;
  --accent-hover: #2288ee;
  --border-color: #2d4a63;
  --success-color: #4caf50;
  --warning-color: #ff9800;
  --error-color: #f44336;
}
```

**Update Theme Selector:**

**data/script.js:**

```javascript
const themes = [
  // Existing themes...
  { value: 'dark-blue', label: 'Dark Blue' }
];
```

---

## Electron App Development

### Setup

```bash
cd electron/
npm install
```

### Development Mode

**Run with hot reload:**

```bash
npm start
```

**File Watcher:**

```bash
# In separate terminal
npm run watch
```

### Building Distributable

**Windows:**
```bash
npm run build:win
```

**macOS:**
```bash
npm run build:mac
```

**Linux:**
```bash
npm run build:linux
```

**Output:** `electron/dist/`

### Electron Main Process

**electron/main.js:**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load web interface
  win.loadFile('../data/index.html');
}

app.whenReady().then(createWindow);
```

### USB Serial Integration

**electron/preload.js:**

```javascript
const { contextBridge } = require('electron');
const { SerialPort } = require('serialport');

contextBridge.exposeInMainWorld('electronAPI', {
  // List available ports
  listPorts: async () => {
    return await SerialPort.list();
  },
  
  // Open serial connection
  openPort: (path, baudRate) => {
    return new SerialPort({ path, baudRate });
  }
});
```

**Usage in Renderer:**

```javascript
// Get available COM ports
const ports = await window.electronAPI.listPorts();

// Connect to selected port
const port = window.electronAPI.openPort('COM12', 115200);

port.on('data', (data) => {
  // Handle incoming events
  if (data.startsWith('EVENT:')) {
    const event = JSON.parse(data.substring(6));
    handleEvent(event);
  }
});

// Send command
port.write(JSON.stringify({
  method: 'POST',
  path: 'timer/start',
  data: {}
}));
```

---

## Testing

### Unit Tests (Future)

**Framework:** PlatformIO Unit Testing

**Example Test:**

```cpp
// test/test_frequency.cpp
#include <unity.h>
#include "frequency.h"

void test_frequency_calculation() {
  int freq = Frequency::calculate('R', 1);
  TEST_ASSERT_EQUAL(5658, freq);
}

void test_invalid_band() {
  int freq = Frequency::calculate('Z', 1);
  TEST_ASSERT_EQUAL(-1, freq);
}

void setup() {
  UNITY_BEGIN();
  RUN_TEST(test_frequency_calculation);
  RUN_TEST(test_invalid_band);
  UNITY_END();
}

void loop() {}
```

**Run Tests:**

```bash
pio test -e esp32-s3-devkitc-1
```

### Integration Testing

**Manual Test Checklist:**

- [ ] WiFi AP starts and accepts connections
- [ ] Web interface loads correctly
- [ ] Race start/stop functions
- [ ] Lap detection works (real VTx)
- [ ] RSSI calibration accurate
- [ ] LED animations smooth
- [ ] Voice announcements play
- [ ] Configuration saves/loads
- [ ] Race history export/import
- [ ] USB connection works (ESP32-S3)
- [ ] Multi-client sync (WiFi + USB)

### Hardware-in-Loop Testing

**Automated RSSI Simulation:**

```cpp
// test/simulate_race.cpp
void simulateRace() {
  Serial.println("Simulating race...");
  
  // Simulate race start
  RaceLogic::startRace();
  delay(5000);
  
  // Simulate 5 laps with varying RSSI
  for (int i = 0; i < 5; i++) {
    // Simulate RSSI rise
    for (int rssi = 80; rssi < 150; rssi += 5) {
      RaceLogic::update(rssi);
      delay(50);
    }
    
    // Simulate RSSI fall
    for (int rssi = 150; rssi > 80; rssi -= 5) {
      RaceLogic::update(rssi);
      delay(50);
    }
    
    delay(2000); // Inter-lap delay
  }
  
  RaceLogic::stopRace();
  Serial.println("Simulation complete");
}
```

---

## Contributing

### Contribution Workflow

1. **Fork Repository**
   ```bash
   # Click "Fork" on GitHub
   git clone https://github.com/YOUR_USERNAME/FPVGate.git
   ```

2. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make Changes**
   - Write code
   - Test thoroughly
   - Update documentation

4. **Commit Changes**
   ```bash
   git add .
   git commit -m "Add: Brief description of change"
   ```

   **Commit Message Format:**
   - `Add:` - New feature
   - `Fix:` - Bug fix
   - `Update:` - Modify existing feature
   - `Docs:` - Documentation only
   - `Refactor:` - Code restructure

5. **Push to Fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create Pull Request**
   - Go to original repository on GitHub
   - Click "Pull Requests" → "New Pull Request"
   - Select your fork and branch
   - Describe changes
   - Submit

### Code Style Guidelines

**C++ (Firmware):**

```cpp
// Use camelCase for variables
int currentLapTime = 0;

// Use PascalCase for classes
class RaceLogic {
  // Public first, then private
  public:
    void startRace();
  
  private:
    int lapCount;
};

// Use UPPER_CASE for constants
const int MAX_LAPS = 50;

// Comment complex logic
void calculateStatistics() {
  // Sort laps by time for median calculation
  std::sort(laps.begin(), laps.end());
  
  // Find middle value
  int medianIndex = laps.size() / 2;
  medianLap = laps[medianIndex];
}
```

**JavaScript (Web Interface):**

```javascript
// Use camelCase for variables and functions
let currentLapTime = 0;

function startRace() {
  // Clear existing state
  clearLaps();
  
  // Send start command to ESP32
  fetch('/timer/start', { method: 'POST' })
    .then(response => response.json())
    .then(data => console.log('Race started', data))
    .catch(error => console.error('Error:', error));
}

// Use descriptive names
function calculateMedianLapTime(laps) {
  const sorted = [...laps].sort((a, b) => a.time - b.time);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1].time + sorted[mid].time) / 2
    : sorted[mid].time;
}
```

### Documentation Standards

**Code Documentation:**

```cpp
/**
 * Calculate median lap time from array of laps
 * 
 * @param laps Vector of lap times in milliseconds
 * @return Median lap time, or 0 if no laps
 * 
 * @note Excludes "Gate 1" from calculation
 */
unsigned long calculateMedianLap(std::vector<unsigned long>& laps) {
  // Implementation...
}
```

**README Updates:**

- Add new features to feature list
- Update wiring diagrams if hardware changes
- Include screenshots for UI changes
- Update version number

---

## Release Process

### Version Numbering

**Semantic Versioning:** `MAJOR.MINOR.PATCH`

- **MAJOR:** Breaking changes
- **MINOR:** New features (backward compatible)
- **PATCH:** Bug fixes

**Example:** `v1.2.1`

### Creating a Release

#### Step 1: Update Version

**platformio.ini:**
```ini
build_flags = 
  -D VERSION="1.3.0"
```

**package.json (Electron):**
```json
{
  "version": "1.3.0"
}
```

#### Step 2: Update CHANGELOG.md

```markdown
## [1.3.0] - 2024-12-04

### Added
- Fastest lap voice callout
- Total race time display
- New "Dark Blue" theme

### Fixed
- RSSI calibration edge case
- LED flicker on startup
- USB disconnect handling

### Changed
- Improved race history performance
- Updated voice announcement timing
```

#### Step 3: Build Release Binaries

**Firmware:**
```bash
pio run -e esp32-s3-devkitc-1
cp .pio/build/esp32-s3-devkitc-1/firmware.bin release/fpvgate_v1.3.0_firmware.bin
```

**Filesystem:**
```bash
pio run -e esp32-s3-devkitc-1 -t buildfs
cp .pio/build/esp32-s3-devkitc-1/littlefs.bin release/fpvgate_v1.3.0_filesystem.bin
```

**Electron App:**
```bash
cd electron/
npm run build:win
npm run build:mac
npm run build:linux
```

#### Step 4: Create GitHub Release

1. Go to GitHub repository
2. Releases → "Draft a new release"
3. Tag: `v1.3.0`
4. Title: `FPVGate v1.3.0`
5. Description: Copy from CHANGELOG
6. Attach binaries:
   - `fpvgate_v1.3.0_firmware.bin`
   - `fpvgate_v1.3.0_filesystem.bin`
   - `FPVGate-Setup-1.3.0.exe` (Windows)
   - `FPVGate-1.3.0.dmg` (macOS)
   - `FPVGate-1.3.0.AppImage` (Linux)
7. Publish release

#### Step 5: Announce

- GitHub Discussions
- Project README
- Social media (if applicable)

---

## Troubleshooting Build Issues

### PlatformIO Issues

**Problem:** `Error: Could not find the package with 'espressif32' requirements`

**Solution:**
```bash
pio platform install espressif32
```

**Problem:** `Error: Please upgrade PlatformIO`

**Solution:**
```bash
pio upgrade
```

**Problem:** `Upload failed`

**Solution:**
- Check USB cable (data cable, not charge-only)
- Hold BOOT button while uploading
- Try different USB port
- Manually specify port: `--upload-port COM12`

### Compilation Errors

**Problem:** `fatal error: WiFi.h: No such file or directory`

**Solution:** Ensure `framework = arduino` in platformio.ini

**Problem:** `undefined reference to 'FastLED'`

**Solution:** Add to platformio.ini:
```ini
lib_deps = 
  fastled/FastLED@^3.6.0
```

**Problem:** `region 'iram0_0_seg' overflowed`

**Solution:** Enable PSRAM or reduce code size:
```ini
board_build.arduino.memory_type = qio_opi
board_build.partitions = custom_8mb.csv
```

### Filesystem Upload Issues

**Problem:** `Error: File system image not found`

**Solution:**
```bash
pio run -t buildfs
```

**Problem:** `Upload failed: No such file or directory`

**Solution:** Ensure ESP32 connected and in download mode

### Electron Build Issues

**Problem:** `Cannot find module 'serialport'`

**Solution:**
```bash
cd electron/
npm install serialport --save
```

**Problem:** `Electron build fails on macOS`

**Solution:** Install Xcode Command Line Tools:
```bash
xcode-select --install
```

---

## Next Steps

 **Ready to develop**   
 **[User Guide](USER_GUIDE.md)** - Master the features first  
 **[Hardware Guide](HARDWARE_GUIDE.md)** - Understand the hardware  
 **[Features Guide](FEATURES.md)** - Learn the architecture

---

**Questions? [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions) | [Report Issues](https://github.com/LouisHitchcock/FPVGate/issues)**
