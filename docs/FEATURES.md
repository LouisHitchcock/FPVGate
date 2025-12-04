# FPVGate Features Guide

In-depth documentation of all FPVGate capabilities and technical details.

** Navigation:** [Home](../README.md) | [Getting Started](GETTING_STARTED.md) | [User Guide](USER_GUIDE.md) | [Hardware Guide](HARDWARE_GUIDE.md)

---

## Table of Contents

1. [Connectivity](#connectivity)
2. [Lap Timing System](#lap-timing-system)
3. [Voice Announcements](#voice-announcements)
4. [LED Visual Effects](#led-visual-effects)
5. [Race Analysis](#race-analysis)
6. [Race History & Data Management](#race-history--data-management)
7. [Multi-Client Support](#multi-client-support)
8. [Self-Test System](#self-test-system)
9. [Configuration Management](#configuration-management)
10. [Technical Architecture](#technical-architecture)

---

## Connectivity

### WiFi Access Point Mode

**Overview:**  
FPVGate creates its own WiFi network for wireless connectivity.

**Technical Specifications:**
- **SSID Format:** `FPVGate_XXXX` (XXXX = last 4 MAC digits)
- **Security:** WPA2-PSK
- **Default Password:** `fpvgate1`
- **IP Address:** `192.168.4.1` (static)
- **DNS:** Captive portal to `www.fpvgate.xyz`
- **Channel:** Auto-select (1-11, 2.4GHz)
- **Max Clients:** 8 simultaneous connections

**How It Works:**
1. ESP32-S3 boots, initializes WiFi hardware
2. Soft AP (Access Point) mode configured
3. DNS server started for captive portal
4. WebSocket server starts on port 81
5. HTTP server starts on port 80
6. mDNS responder broadcasts `fpvgate.local`

**Advantages:**
- No router required
- Works anywhere
- No internet needed
- Simple setup

**Limitations:**
- ~20-30ms latency (WiFi overhead)
- Range limited (~30-50 feet)
- Interference from other 2.4GHz devices

**Power Consumption:** ~150-200mA during active WiFi

### USB Serial CDC Mode (ESP32-S3 Only)

**Overview:**  
Direct USB connection for zero-latency control.

**Technical Specifications:**
- **Interface:** USB Serial CDC (Communication Device Class)
- **Baud Rate:** 115200 (for monitoring)
- **Protocol:** JSON over serial
- **Latency:** <5ms (vs 20-30ms WiFi)
- **Data Rate:** ~12 Mbps (USB 2.0 Full Speed)

**Architecture:**

```
┌──────────────┐         USB Cable        ┌──────────────┐
│   Computer   │ ←──────────────────────→ │  ESP32-S3    │
│              │                           │              │
│  Electron    │   JSON Command Protocol   │  Transport   │
│  Browser     │   {"method":"POST"...}    │  Manager     │
│              │                           │              │
│ USB-Transport│                           │  Webserver   │
│    .js       │                           │  Handlers    │
└──────────────┘                           └──────────────┘
```

**Command Protocol:**

Commands sent as JSON objects:

```json
{
  "method": "POST",
  "path": "timer/start",
  "data": {}
}
```

**Event Protocol:**

Events broadcast with `EVENT:` prefix:

```json
EVENT:{"type":"lap","data":{"lapTime":12345,"lapNumber":3}}
```

**Supported Commands:**
- `timer/start` - Start race countdown
- `timer/stop` - Stop current race
- `timer/lap` - Manually add lap
- `timer/clear` - Clear lap data
- `led/preset` - Set LED effect
- `led/color` - Set solid color
- `led/brightness` - Adjust brightness
- `led/speed` - Set animation speed
- `led/override` - Manual control toggle
- `led/fadecolor` - Set fade target
- `led/strobecolor` - Set strobe color
- `config/*` - Configuration endpoints

**Benefits:**
- Zero WiFi latency
- More reliable connection
- Works offline completely
- WiFi still available for other clients

**Electron Desktop App:**
- Bundles web interface with USB support
- Auto-detects COM ports
- Cross-platform (Windows, macOS, Linux)
- Includes all dependencies

### Hybrid Mode

**Unique Feature:**  
USB and WiFi can operate simultaneously!

**Use Cases:**
1. **Race Director:** USB connection (zero latency)
2. **Spectators:** WiFi connection (view race)
3. **Timing Screen:** WiFi connection (OSD overlay)

**How It Works:**
- Transport abstraction layer routes events to all clients
- USB client receives events via JSON
- WiFi clients receive events via WebSocket
- Commands from any source processed identically

**Example Scenario:**
```
     Race Director (USB)
            ↓ Commands
       ┌─────────┐
       │ ESP32-S3│
       └─────────┘
         ↓     ↓
    WiFi  WiFi  WiFi
     ↓     ↓     ↓
  Phone Laptop  OSD
```

---

## Lap Timing System

### RSSI-Based Detection

**Principle:**  
Drone VTx signal strength (RSSI) peaks when passing through gate.

**How It Works:**

1. **Tuning:** RX5808 tuned to pilot's frequency via SPI
2. **Monitoring:** RSSI sampled at ~100Hz (every 10ms)
3. **Detection Logic:**
   - RSSI rises above **Enter Threshold** → Start watching
   - RSSI peaks → Record timestamp
   - RSSI falls below **Exit Threshold** → Lap confirmed

**State Machine:**

```
     IDLE
      ↓ (RSSI > Enter)
   CROSSING
      ↓ (RSSI peaks)
   RECORD_TIME
      ↓ (RSSI < Exit)
   LAP_CONFIRMED → Broadcast event
      ↓
   COOLDOWN (minimum lap time)
      ↓
     IDLE
```

**Advantages:**
- No additional hardware on drone
- Works with any VTx
- Accurate to ~10ms
- No line-of-sight issues (unlike IR)

**Calibration Requirements:**
- **Enter RSSI:** 2-5 points below peak
- **Exit RSSI:** 8-10 points below Enter
- **Minimum Lap Time:** Prevents false triggers

### Frequency Management

**Supported Bands:**
- **A (Boscam A):** 8 channels (5865-5725 MHz)
- **B (Boscam B):** 8 channels (5733-5866 MHz)
- **E (Boscam E):** 8 channels (5705-5945 MHz)
- **F (Fatshark):** 8 channels (5740-5880 MHz)
- **R (RaceBand):** 8 channels (5658-5917 MHz)
- **L (LowBand):** 8 channels (5362-5621 MHz)

**Total:** 48 unique frequencies (some overlap)

**Tuning Process:**
1. User selects band + channel in Configuration
2. Frequency calculated from lookup table
3. RX5808 programmed via SPI commands
4. Confirmation read from module
5. RSSI monitoring begins

**SPI Communication:**
- **Clock:** 1 MHz (GPIO15)
- **Data:** Single wire (GPIO13)
- **Chip Select:** GPIO14
- **Protocol:** 25-bit register writes

**Register Format:**
```
| R/W (1) | Address (4) | Data (20) |
```

### Timing Accuracy

**Factors Affecting Accuracy:**

| Factor | Impact | Mitigation |
|--------|--------|------------|
| **RSSI Sampling Rate** | ±5ms | 100Hz sampling |
| **Peak Detection** | ±10ms | 3-point average |
| **System Timer** | ±1ms | millis() function |
| **WiFi Latency** | 20-30ms | Use USB mode |

**Expected Accuracy:**
- **Best Case (USB):** ±10-15ms
- **WiFi Mode:** ±30-40ms
- **For Comparison:** MultiGP standard is ±50ms

### Gate Pass Classification

**Gate 1 (Hole Shot):**
- First pass after race start
- Timer already running
- Shows as "Gate 1" in lap table
- Not included in fastest lap calculation

**Subsequent Laps:**
- Numbered Lap 1, 2, 3...
- Delta time calculated from previous lap
- Included in statistics

**Why Separate Gate 1:**
- Reflects actual racing terminology
- First pass timing is less consistent (starting position varies)
- Best lap comparison should exclude hole shot

---

## Voice Announcements

### Text-to-Speech Engines

FPVGate supports two TTS engines:

#### 1. ElevenLabs (Pre-recorded)

**Technology:**  
High-quality neural TTS, pre-generated MP3 files.

**Voices Available:**
- **Sarah** - Energetic female (default)
- **Rachel** - Calm female
- **Adam** - Deep male
- **Antoni** - Friendly male

**Characteristics:**
- Natural, human-like speech
- Emotional inflection
- Consistent quality
- Pre-recorded = instant playback

**File Structure:**
```
/audio/elevenlabs/sarah/
  ├── arm.mp3
  ├── gate1.mp3
  ├── lap1.mp3 ... lap50.mp3
  ├── 0.mp3 ... 99.mp3 (numbers)
  ├── fastest.mp3
  └── racecomplete.mp3
```

**Generation:**
- Use `tools/tts_generator.py`
- Requires ElevenLabs API key (free tier: 10k chars/month)
- Pre-generates all needed phrases
- Upload to SD card or LittleFS

**Storage Requirements:**
- ~150 files per voice
- ~3-5 MB per voice
- Supports multiple voices simultaneously

#### 2. PiperTTS (Real-time)

**Technology:**  
Fast, lightweight neural TTS with real-time synthesis.

**Characteristics:**
- Synthesizes speech on-demand
- Slightly robotic but clear
- ~200ms faster than ElevenLabs (no file I/O)
- No pre-generation needed
- No storage required

**Model:**
- **en_US-lessac-medium** (default)
- 17MB model file in LittleFS
- Neural architecture optimized for ESP32

**Use Cases:**
- SD card not available
- Custom pilot names (dynamic synthesis)
- Prototyping/testing
- Lower latency requirements

**Fallback Behavior:**
- ElevenLabs voice selected but files missing → Auto-switches to PiperTTS
- Seamless degradation

### Announcement Formats

Three levels of verbosity:

#### Format 1: Pilot + Lap + Time (Full)

**Example:** "Louis Lap 5, 12.34"

**Components:**
1. Phonetic pilot name (or pilot name if not set)
2. "Lap" literal
3. Lap number
4. Lap time (seconds.milliseconds)

**Audio Construction:**
```
phonetic_name.mp3 + lap.mp3 + 5.mp3 + time_12_34.mp3
```

**Best For:** Multi-pilot events, spectators

#### Format 2: Lap + Time

**Example:** "Lap 5, 12.34"

**Components:**
1. "Lap" literal
2. Lap number
3. Lap time

**Best For:** Single pilot, less distraction

#### Format 3: Time Only (Minimal)

**Example:** "12.34"

**Components:**
1. Lap time only

**Best For:** Focus on flying, minimal audio

### Phonetic Name System

**Purpose:**  
Ensure correct pronunciation of pilot names.

**How It Works:**
1. User enters "Phonetic Name" in Configuration
2. If empty, falls back to "Pilot Name"
3. Name sent to TTS engine
4. ElevenLabs: Pre-generated with name
5. PiperTTS: Synthesizes in real-time

**Examples:**

| Pilot Name | Phonetic Name | TTS Output |
|------------|---------------|------------|
| Louis | Louie | "Louie Lap 5..." |
| Xavier | Zavier | "Zavier Lap 5..." |
| Nguyen | Win | "Win Lap 5..." |
| Siobhan | Shiv-awn | "Shiv-awn Lap 5..." |

**Tips:**
- Spell phonetically (how it sounds)
- Use hyphens for syllable breaks
- Test with "Generate Audio" button

### Announcer Types

#### None
- Silent mode
- Only buzzer for race start
- Minimal distraction

#### Beep Only
- Short beep on each lap
- No voice
- Audio cue without speech

#### Lap Time (Standard)
- Announces every lap
- Full details per format setting
- **Most popular mode**

#### 2 Consecutive Laps
- Announces every 2 laps combined
- Example: "Laps 3 and 4, 25.67 seconds"
- Good for longer races (10+ laps)

#### 3 Consecutive Laps
- Announces every 3 laps combined
- Example: "Laps 3, 4, and 5, 38.91 seconds"
- Consistency-focused racing

### Playback Speed Control

**Range:** 0.1 - 2.0  
**Default:** 1.0 (normal)  
**Recommended:** 1.2 - 1.4

**Effect:**
- Speeds up or slows down pre-recorded audio
- Does not affect pitch (time-stretching)
- Faster = less audio overlap on quick laps

**Implementation:**
- I2S audio playback with adjustable sample rate
- 1.0 = 44100 Hz
- 1.5 = 66150 Hz (1.5× faster)

---

## LED Visual Effects

### WS2812B Control

**Technology:**  
Individually addressable RGB LEDs using single-wire protocol.

**Technical Details:**
- **Protocol:** WS2812B (NeoPixel)
- **Data Rate:** 800 kHz
- **Color Depth:** 24-bit (8 bits per channel × RGB)
- **Update Rate:** ~60 FPS
- **Max LEDs:** 256 (practical limit ~100 for smooth animation)

**Data Format:**
Each LED receives 24 bits: `GRB` (Green-Red-Blue order)

**Library:** FastLED (optimized for ESP32)

### Preset Effects

#### Off
- All LEDs disabled
- Saves power
- **Current:** ~0mA

#### Solid Colour
- All LEDs same static color
- User-selectable via color picker
- **Use:** Team colors, venue requirements
- **Current:** ~60mA per LED (full brightness)

#### Rainbow Wave
- Smooth HSV rainbow animation
- Travels along strip
- **Speed:** 1-20 (controls hue rotation rate)
- **Formula:** `hue = (base_hue + (i * 255 / NUM_LEDS) + offset) % 256`

#### Color Fade
- Fades from current color to target color
- User-selectable target via color picker
- **Speed:** 1-20 (fade rate)
- **Implementation:** Linear interpolation (lerp) in RGB space

#### Fire
- Flickering fire effect (red/orange/yellow)
- Random brightness variation
- Heat simulation algorithm
- **Speed:** 1-20 (flame intensity)

#### Ocean
- Blue wave pattern
- Sine wave brightness modulation
- Calming effect
- **Speed:** 1-20 (wave frequency)

#### Police
- Red/blue alternating
- Split strip in half
- Flashing pattern
- **Speed:** 1-20 (flash rate)

#### Strobe
- Fast flashing all LEDs
- User-selectable color
- **Warning:** Can be intense, slowed for safety
- **Speed:** 1-20 (flash rate, capped for visibility)

#### Comet
- Chasing light with tail
- Single bright LED with fading trail
- **Speed:** 1-20 (comet velocity)
- **Implementation:** Fade-to-black + advancing bright pixel

#### Pilot Colour
- Static color matching pilot's configured color
- Auto-updates when pilot color changed
- **Use:** Identify pilot from distance

### Race Event LED Feedback

**When Manual LED Control is OFF:**

| Event | LED Behavior |
|-------|--------------|
| **Race Start** | Flash green (3×, 200ms each) |
| **Lap Detected** | Flash white (1×, 150ms) |
| **Race Stop** | Flash red (3×, 200ms each) |
| **Between Events** | Resume selected preset |

**Implementation:**
- Events trigger `overrideLED()` function
- Preset paused temporarily
- Event pattern played
- Preset resumes with state preserved

### Brightness Control

**Range:** 0 - 255  
**Default:** 80  
**Power Impact:**

| Brightness | Power (30 LEDs) | Visibility |
|------------|-----------------|------------|
| 50 | ~1.0A | Dim indoor |
| 80 | ~1.6A | Normal indoor |
| 120 | ~2.4A | Bright indoor |
| 200 | ~4.0A | Outdoor daylight |
| 255 | ~5.0A | Maximum |

**Implementation:**
```cpp
FastLED.setBrightness(brightness);
FastLED.show();
```

**Note:** Brightness scales all RGB values proportionally

---

## Race Analysis

### Real-Time Statistics

FPVGate calculates four key metrics during racing:

#### 1. Fastest Lap

**Calculation:**
```cpp
for each lap (excluding Gate 1):
  if lap_time < fastest_lap:
    fastest_lap = lap_time
    fastest_lap_number = lap_number
```

**Display:** "12.34s (Lap 5)"

**Visual:** Gold background on fastest lap row

#### 2. Median Lap

**Calculation:**
```cpp
sorted_laps = sort(all_laps)
if odd number of laps:
  median = sorted_laps[middle_index]
else:
  median = average(sorted_laps[middle_index], sorted_laps[middle_index + 1])
```

**Purpose:** Consistency indicator (less affected by outliers than average)

**Display:** "14.56s"

#### 3. Best 3 Laps (Individual Sum)

**Calculation:**
```cpp
sorted_laps = sort(all_laps)
best_3_sum = sorted_laps[0] + sorted_laps[1] + sorted_laps[2]
```

**Purpose:** MultiGP-style scoring, rewards consistent fast laps

**Display:** "39.87s (L2, L4, L7)"

#### 4. Fastest 3 Consecutive Laps

**Calculation:**
```cpp
best_consecutive_sum = infinity
for i in range(0, num_laps - 2):
  sum = laps[i] + laps[i+1] + laps[i+2]
  if sum < best_consecutive_sum:
    best_consecutive_sum = sum
    best_consecutive_start = i
```

**Purpose:** RaceGOW format, tests sustained pace

**Display:** "41.23s (L3-L5)"

### Visual Charts

#### Lap History Chart

**Type:** Horizontal bar chart  
**Data:** Last 10 laps  
**Colors:** Unique color per lap (hue rotation)

**Implementation:**
- Each bar width proportional to lap time
- Fastest lap highlighted differently
- Tooltip shows exact time
- Auto-scales X-axis to fit data

**Purpose:** Identify trends (tire wear, battery sag, improving pace)

#### Fastest Round Chart

**Type:** Vertical bar chart  
**Data:** 3 consecutive laps with best sum  
**Colors:** Distinct per lap

**Implementation:**
- Shows individual lap times
- Total time displayed above
- Lap numbers labeled below

**Purpose:** Visualize consistency within best round

### Lap Table Features

**Columns:**
1. **Lap #** - "Gate 1", "Lap 1", "Lap 2"...
2. **Lap Time** - MM:SS.ss format
3. **Delta** - Difference from previous lap (±)

**Fastest Lap Highlight:**
- Gold background (#FFD700)
- Bold text
- Excludes "Gate 1"

**Auto-Scroll:**
- Table auto-scrolls to latest lap
- Keeps newest entries visible

**Export:**
- Table data included in race JSON export
- Compatible with external analysis tools

---

## Race History & Data Management

### Automatic Race Saving

**Triggers:**
1. "Stop Race" button clicked
2. "Clear Laps" button clicked (if laps exist)
3. Max lap count reached (auto-stop)

**Data Saved:**
- Timestamp (ISO 8601 format)
- Pilot info (name, callsign, color)
- Frequency (band + channel)
- All lap times (array)
- Statistics (fastest, median, best 3, etc.)
- Race settings (max laps, min lap time)

**Storage:**
- LittleFS file system (`/races.json`)
- Persistent across reboots
- Max ~500 races (depends on available flash)

**JSON Format:**
```json
{
  "id": "race_1703001234567",
  "timestamp": "2024-12-04T14:30:45Z",
  "pilot": {
    "name": "Louis Hitchcock",
    "callsign": "Louis",
    "color": "#FF6B35"
  },
  "frequency": {
    "band": "R",
    "channel": 1,
    "mhz": 5658
  },
  "laps": [
    {"number": 0, "time": 8450, "name": "Gate 1"},
    {"number": 1, "time": 12340, "name": "Lap 1"},
    {"number": 2, "time": 11980, "name": "Lap 2"}
  ],
  "stats": {
    "fastest_lap": 11980,
    "fastest_lap_number": 2,
    "median": 12160,
    "best_3_sum": 37900,
    "best_consecutive_3": 38120
  },
  "settings": {
    "max_laps": 5,
    "min_lap_time": 10
  }
}
```

### Race History UI

**Features:**
1. **List View** - All races with summary info
2. **Detail View** - Click to expand full analysis
3. **Edit** - Modify race name and tag
4. **Delete** - Remove individual race
5. **Download** - Export single race JSON
6. **Download All** - Export complete history
7. **Import** - Merge races from JSON file
8. **Clear All** - Delete entire history (with confirmation)

**Search/Filter (Future):**
- By date range
- By pilot
- By frequency
- By tag

### Export Formats

#### Individual Race Export

**Filename:** `race_<timestamp>.json`  
**Content:** Single race object (as shown above)

**Use Cases:**
- Share specific race with others
- Backup important races
- Import into analysis tools

#### Complete History Export

**Filename:** `fpvgate_races_<date>.json`  
**Content:** Array of all race objects

**Use Cases:**
- Full backup before firmware update
- Transfer between devices
- Long-term archival

#### Import Behavior

**Duplicate Handling:**
- Races matched by ID
- If ID exists, skip (no overwrite)
- New races added to history

**Validation:**
- JSON schema validation
- Corrupted files rejected
- Partial imports allowed (valid races only)

---

## Multi-Client Support

### WebSocket Architecture

**Server:**
- WebSocket server on port 81
- Up to 8 simultaneous clients
- Broadcast events to all clients
- Clients can send commands

**Connection Flow:**
```
Client → ws://192.168.4.1:81 → ESP32 WebSocket Server
ESP32 → Broadcast event → All connected clients
```

**Event Types:**
- `lap` - Lap detected
- `raceStart` - Race starting
- `raceStop` - Race stopped
- `configUpdate` - Config changed
- `rssiUpdate` - RSSI value (calibration)

**Message Format:**
```json
{
  "type": "lap",
  "data": {
    "lapTime": 12340,
    "lapNumber": 3,
    "totalLaps": 3,
    "timestamp": 45678
  }
}
```

### Use Cases

#### 1. Race Director + Spectators

**Setup:**
- Race director uses USB (Electron app)
- Spectators connect via WiFi (phones, tablets)

**Behavior:**
- Director controls race (low latency)
- Spectators view live updates
- All see same data synchronously

#### 2. Pilot + Timing Display

**Setup:**
- Pilot views on phone (WiFi)
- External monitor shows OSD overlay (WiFi)

**Behavior:**
- Pilot starts/stops race
- Timing display shows lap times
- Clean separation of concerns

#### 3. Multiple Timing Screens

**Setup:**
- Multiple monitors around track
- All connected via WiFi

**Behavior:**
- Synchronized race display
- Different views possible (table, charts, OSD)

### Transport Abstraction

**Design:**
- `TransportManager` class handles all clients
- Broadcasts to WiFi + USB simultaneously
- Commands from any transport processed equally

**Code Structure:**
```cpp
class TransportManager {
  std::vector<Transport*> transports;
  
  void broadcast(String event) {
    for (auto transport : transports) {
      transport->send(event);
    }
  }
  
  void handleCommand(String command) {
    // Process command (same for all transports)
  }
};
```

**Benefits:**
- Add new transport types easily (Bluetooth future?)
- Unified command handling
- Consistent behavior across connections

---

## Self-Test System

### Overview

Built-in diagnostic system validates all hardware components.

**Access:** Configuration → System Diagnostics → "Run Self-Test"

**Duration:** ~10 seconds

### Test Sequence

#### 1. WiFi Test

**Checks:**
- WiFi hardware initialized
- Access Point started
- IP address assigned
- SSID broadcasting

**Pass Criteria:** AP mode active, clients can connect

**Failure Modes:**
- WiFi hardware fault
- Antenna disconnected
- Software configuration error

#### 2. RX5808 Test

**Checks:**
- SPI communication working
- Module responds to commands
- Frequency tuning functional
- RSSI pin readable

**Procedure:**
1. Send SPI read command
2. Verify expected response
3. Tune to test frequency (R1 - 5658 MHz)
4. Read back frequency register
5. Read RSSI value

**Pass Criteria:** All SPI operations successful, RSSI > 0

**Failure Modes:**
- SPI mod not done (R16 not bridged)
- Loose connections
- Module damaged
- Wrong pin assignments

#### 3. LED Test

**Checks:**
- FastLED library initialized
- Data pin functional
- LEDs responsive

**Procedure:**
1. Set all LEDs to red
2. Delay 500ms
3. Set all LEDs to green
4. Delay 500ms
5. Set all LEDs to blue
6. Delay 500ms
7. Turn off

**Pass Criteria:** User observes color changes

**Failure Modes:**
- Data pin not connected
- Power supply insufficient
- First LED damaged (breaks data chain)

#### 4. SD Card Test

**Checks:**
- SPI communication
- Card detected
- FAT32 file system
- Read/write functional

**Procedure:**
1. Initialize SD library
2. Check card presence
3. Verify FAT32 format
4. Create test file
5. Write data
6. Read data back
7. Verify data matches
8. Delete test file

**Pass Criteria:** All operations successful

**Failure Modes:**
- Card not inserted
- Wrong format (not FAT32)
- Card write-protected
- Module connections loose

#### 5. Buzzer Test

**Checks:**
- GPIO pin functional
- Buzzer responsive

**Procedure:**
1. Play 440 Hz tone (A note)
2. Duration 500ms
3. User should hear beep

**Pass Criteria:** Audible tone

**Failure Modes:**
- Wrong buzzer type (active vs passive)
- Polarity reversed
- Damaged buzzer

#### 6. USB Test (ESP32-S3 Only)

**Checks:**
- USB CDC functional
- Serial port accessible
- JSON command parsing

**Procedure:**
1. Check USB CDC initialized
2. Send test command
3. Verify response

**Pass Criteria:** USB communication working

**Failure Modes:**
- Drivers not installed
- USB cable data lines broken
- Firmware USB disabled

### Test Results Display

**Format:**

```
System Diagnostics
==================

 WiFi: PASS - AP mode active (192.168.4.1)
 RX5808: PASS - SPI communication OK, RSSI = 127
 LED: PASS - Animation test successful
 SD Card: FAIL - Card not detected
 Buzzer: PASS - Tone played
 USB: PASS - Serial CDC active

Overall: 5/6 tests passed
```

**Action Buttons:**
- Re-run test
- Download diagnostic log
- View detailed error messages

---

## Configuration Management

### Backend Configuration (ESP32)

**Stored in:** LittleFS `/config.json`

**Parameters:**
- Frequency (band, channel, MHz)
- RSSI thresholds (enter, exit)
- Race settings (max laps, min lap time)
- Pilot info (name, callsign, color, phonetic)
- LED settings (preset, color, brightness, speed)
- TTS settings (voice, rate, format, enabled)

**Persistence:**
- Survives reboots
- Survives firmware updates (if flash not erased)

### Frontend Configuration (Browser)

**Stored in:** Browser LocalStorage

**Parameters:**
- Theme selection
- Tab state
- UI preferences
- Chart settings

**Persistence:**
- Per-browser (not shared across devices)
- Cleared if user clears browser data

### Configuration Backup

**Download Config:**
- Fetches backend + frontend settings
- Saves as JSON file
- Filename: `fpvgate_config_<date>.json`

**Import Config:**
- Select JSON file
- Validates schema
- Applies backend settings (API calls)
- Applies frontend settings (LocalStorage)
- Page reloads automatically

**Use Cases:**
- Backup before firmware update
- Transfer settings to new device
- Share optimal config with others
- Revert to known-good configuration

### API Endpoints

**GET /api/config**  
Returns current configuration

**POST /api/config**  
Updates configuration

**POST /api/config/frequency**  
Set frequency only

**POST /api/config/rssi**  
Set RSSI thresholds

**POST /api/config/race**  
Update race settings

**POST /api/config/pilot**  
Update pilot information

**POST /api/config/led**  
Change LED settings

**POST /api/config/tts**  
Modify TTS options

---

## Technical Architecture

### Firmware Structure

```
src/
├── main.cpp              # Entry point, setup/loop
├── lib/
│   ├── CALIBRATION/      # RSSI calibration logic
│   ├── CONFIG/           # Configuration management
│   ├── FASTLED/          # LED control
│   ├── FREQUENCY/        # Band/channel/frequency
│   ├── RACEHISTORY/      # Race data storage
│   ├── RACELOGIC/        # Timing state machine
│   ├── RX5808/           # RX5808 SPI driver
│   ├── SELFTEST/         # Diagnostic system
│   ├── TRANSPORT/        # Transport abstraction
│   ├── TTS/              # Text-to-speech
│   ├── USB/              # USB Serial CDC transport
│   ├── WEBSERVER/        # HTTP + WebSocket server
│   └── WIFIMAN/          # WiFi management
```

### Web Interface Structure

```
data/
├── index.html            # Single-page app structure
├── style.css             # Responsive styles, themes
├── script.js             # Main UI logic, race control
├── usb-transport.js      # USB Serial CDC communication
└── themes.css            # 23 color themes
```

### Memory Layout

**ESP32-S3 (8MB Flash):**

| Partition | Size | Contents |
|-----------|------|----------|
| Bootloader | 32 KB | ESP32 bootloader |
| Partition Table | 4 KB | Partition layout |
| App0 | 2 MB | Firmware binary |
| App1 | 2 MB | OTA update space |
| LittleFS | 1.5 MB | Web files, config, races |
| NVS | 20 KB | System settings |
| Coredump | 64 KB | Crash dumps |

**RAM Usage (512 KB SRAM):**
- Firmware: ~150 KB
- WiFi stack: ~80 KB
- Heap (dynamic): ~250 KB
- Stack: ~32 KB

### Performance Metrics

**Boot Time:**
- Cold boot: ~3-4 seconds
- WiFi AP ready: ~10-15 seconds

**RSSI Sampling:**
- Rate: 100 Hz (every 10ms)
- Resolution: 8-bit (0-255)
- Latency: <10ms

**WebSocket Latency:**
- WiFi: 20-30ms (client to ESP32)
- USB: <5ms

**LED Update Rate:**
- 30 LEDs: 60 FPS (smooth)
- 60 LEDs: 60 FPS
- 100 LEDs: 45-50 FPS

**File System Operations:**
- Config read: <10ms
- Config write: ~50ms
- Race save: ~100ms
- SD card read (audio): ~200ms

---

## Next Steps

 **Features explored**   
 **[Development Guide](DEVELOPMENT.md)** - Build and contribute  
 **[User Guide](USER_GUIDE.md)** - Master all features  
 **[Hardware Guide](HARDWARE_GUIDE.md)** - Technical specs

---

**Questions? [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions) | [Report Issues](https://github.com/LouisHitchcock/FPVGate/issues)**
