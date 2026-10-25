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
6. [Track Management](#track-management)
7. [Webhooks & Integration](#webhooks--integration)
8. [Race History & Data Management](#race-history--data-management)
9. [Multi-Client Support](#multi-client-support)
10. [Self-Test System](#self-test-system)
12. [Configuration Management](#configuration-management)
13. [Technical Architecture](#technical-architecture)

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
- **DNS:** Captive portal to `fpvgate.local`
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
+--------------+         USB Cable        +--------------+
�   Computer   � ?----------------------? �  ESP32-S3    �
�              �                           �              �
�  Electron    �   JSON Command Protocol   �  Transport   �
�  Browser     �   {"method":"POST"...}    �  Manager     �
�              �                           �              �
� USB-Transport�                           �  Webserver   �
�    .js       �                           �  Handlers    �
+--------------+                           +--------------+
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
            ? Commands
       +---------+
       � ESP32-S3�
       +---------+
         ?     ?
    WiFi  WiFi  WiFi
     ?     ?     ?
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
   - RSSI rises above **Enter Threshold** ? Start watching
   - RSSI peaks ? Record timestamp
   - RSSI falls below **Exit Threshold** ? Lap confirmed

**State Machine:**

```
     IDLE
      ? (RSSI > Enter)
   CROSSING
      ? (RSSI peaks)
   RECORD_TIME
      ? (RSSI < Exit)
   LAP_CONFIRMED ? Broadcast event
      ?
   COOLDOWN (minimum lap time)
      ?
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
| **RSSI Sampling Rate** | �5ms | 100Hz sampling |
| **Peak Detection** | �10ms | 3-point average |
| **System Timer** | �1ms | millis() function |
| **WiFi Latency** | 20-30ms | Use USB mode |

**Expected Accuracy:**
- **Best Case (USB):** �10-15ms
- **WiFi Mode:** �30-40ms
- **For Comparison:** MultiGP standard is �50ms

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
  +-- arm.mp3
  +-- gate1.mp3
  +-- lap1.mp3 ... lap50.mp3
  +-- 0.mp3 ... 99.mp3 (numbers)
  +-- fastest.mp3
  +-- racecomplete.mp3
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
- ElevenLabs voice selected but files missing ? Auto-switches to PiperTTS
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
- 1.5 = 66150 Hz (1.5� faster)

---

## LED Visual Effects

### WS2812B Control

**Technology:**  
Individually addressable RGB LEDs using single-wire protocol.

**Technical Details:**
- **Protocol:** WS2812B (NeoPixel)
- **Data Rate:** 800 kHz
- **Color Depth:** 24-bit (8 bits per channel � RGB)
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
| **Race Start** | Flash green (3�, 200ms each) |
| **Lap Detected** | Flash white (1�, 150ms) |
| **Race Stop** | Flash red (3�, 200ms each) |
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

### Multi-Pilot Race Analysis (Sync Modes)

When operating in Master or Slave mode, the analysis section switches to "Race Analysis" with multi-pilot comparison charts.

#### Lap Times Chart (SVG Line Chart)

**Rendering Function:** enderLapTimesChart(pilots)

**Chart Specifications:**
- **Type:** SVG line chart
- **Dimensions:** 800x300 viewBox, responsive
- **X-Axis:** Lap numbers (1 to max laps)
- **Y-Axis:** Time in seconds (auto-scaled with 10% padding)
- **Lines:** One per pilot, using pilot's configured color
- **Markers:** Circle markers at each lap time
- **Grid:** Horizontal and vertical grid lines

**Data Processing:**
`javascript
pilots.forEach(pilot => {
  const validLaps = pilot.lapTimes.slice(1); // Skip gate 1
  // Calculate min/max times for Y-axis scaling
  // Build SVG path for each pilot
});
`

**SVG Structure:**
`xml
<svg viewBox="0 0 800 300">
  <g class="grid"><!-- Grid lines --></g>
  <g class="y-axis"><!-- Time labels --></g>
  <g class="x-axis"><!-- Lap labels --></g>
  <g class="lines">
    <path d="M x1,y1 L x2,y2..." stroke="#FF6384" />
    <circle cx="x" cy="y" r="4" fill="#FF6384" />
  </g>
</svg>
`

#### Consistency Chart (Box-and-Whisker Plot)

**Rendering Function:** enderConsistencyChart(pilots)

**Chart Specifications:**
- **Type:** SVG box-and-whisker plot
- **Dimensions:** 800x300 viewBox, responsive
- **X-Axis:** Pilot names
- **Y-Axis:** Time in seconds
- **Box:** Interquartile range (Q1 to Q3)
- **Whiskers:** Min to Q1, Q3 to Max
- **Median Line:** Inside box
- **Individual Points:** Circles for each lap time

**Statistics Calculated:**
`javascript
function calculateStats(lapTimes) {
  const sorted = [...lapTimes].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1: sorted[Math.floor(sorted.length * 0.25)],
    median: sorted[Math.floor(sorted.length * 0.5)],
    q3: sorted[Math.floor(sorted.length * 0.75)]
  };
}
`

**Visual Components:**
- **Box:** Rectangle from Q1 to Q3 (filled with pilot color at 30% opacity)
- **Median Line:** Horizontal line at median value
- **Whiskers:** Vertical lines from box to min/max
- **End Caps:** Horizontal lines at min/max
- **Data Points:** Small circles for each lap time

#### Race Analysis Legend

**Rendering Function:** enderRaceAnalysisLegend(pilots)

**Legend Format:**
`html
<div style="border-left: 4px solid {pilot.color}">
  <span>{pilot.name}{pilot.isLocal ? ' *' : ''}</span>
  <span>{lapCount} laps, best: {fastest}s</span>
</div>
`

**Information Displayed:**
- Pilot name with color indicator
- Asterisk (*) for local pilot
- Total lap count
- Fastest lap time

#### Analysis Section Visibility

**Toggle Function:** updateAnalysisSectionVisibility()

`javascript
if (raceSyncMode === 1 || raceSyncMode === 2) {
  // Sync mode - show Race Analysis
  lapAnalysis.style.display = "none";
  raceAnalysis.style.display = "block";
  updateRaceAnalysisView();
} else {
  // Personal mode - show Lap Analysis
  lapAnalysis.style.display = "block";
  raceAnalysis.style.display = "none";
  updateAnalysisView();
}
`
### Lap Table Features

**Columns:**
1. **Lap #** - "Gate 1", "Lap 1", "Lap 2"...
2. **Lap Time** - MM:SS.ss format
3. **Delta** - Difference from previous lap (�)

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

## Track Management

### Overview

![Track Management](../images/screenshots/12-12-2025/Config%20Screen%20-%20Track%20Info%2012-12-2025.png)

FPVGate includes a comprehensive track management system for organizing and tracking your racing locations.

**Features:**
- Create and manage up to 50 tracks
- Track metadata (name, location, notes)
- Distance configuration for lap distance calculations
- Track selection (persists to EEPROM)
- Track association with race history

### Creating Tracks

**Access:** Configuration ? Track Data ? "Create New Track"

**Required Fields:**
- **Name:** Track identifier (e.g., "Backyard Track", "MultiGP Chapter")
- **Distance:** Track length in meters (used for distance calculations)

**Optional Fields:**
- **Location:** Physical location or address
- **Notes:** Track layout description, difficulty rating, etc.
- **Image:** Track map or photo (base64 encoded)

### Track Selection

**How It Works:**
1. Enable "Track Feature" toggle in Configuration
2. Select active track from dropdown
3. Selection persists to EEPROM (survives reboots)
4. Distance calculations automatic during racing

**Distance Display:**
- **Total Distance:** Cumulative distance traveled
- **Distance Remaining:** Calculated if Max Laps set
- **Real-time Updates:** Distance shown on main race screen

### Track Management UI

**Features:**
1. **Track List** - View all created tracks
2. **Edit** - Modify track information
3. **Delete** - Remove track (confirmation required)
4. **Select** - Set as active racing track

**Storage:**
- Stored on SD card (`/tracks.json`) or LittleFS fallback
- Includes all metadata and settings
- Race history includes track association

---

## Webhooks & Integration

### Overview

![Webhooks Configuration](../images/screenshots/12-12-2025/Config%20Screen%20-%20Webhooks%2012-12-2025.png)

FPVGate can send HTTP POST webhooks to external devices on your network, perfect for integrating with external LED controllers, displays, or automation systems.

**Use Cases:**
- Trigger gate LED flashes during race events
- Sync external lighting with race timing
- Integrate with home automation systems
- Control multiple LED setups simultaneously

### Webhook Configuration

**Access:** Configuration ? Webhooks

**Setup Steps:**
1. **Enable Webhooks:** Toggle webhook system on/off
2. **Add IP Addresses:** Configure up to 10 webhook targets
3. **Test:** Send test webhook to verify connectivity

**IP Format:** Standard IPv4 (e.g., `192.168.0.75`)

### Webhook Endpoints

FPVGate sends HTTP POST requests to the following endpoints:

| Endpoint | Trigger | Description |
|----------|---------|-------------|
| `/RaceStart` | Race starts | 2� Green flashes |
| `/RaceStop` | Race stops | 2� Red flashes |
| `/Lap` | Lap detected | White flash (0.5s) |
| `/GhostLap` | Future feature | White flash (0.5s) |
| `/off` | Manual | Turn off LEDs |
| `/flash` | Manual test | White flash |

**Request Format:**
```http
POST http://<IP>/<Endpoint>
Content-Length: 0
```

**Example:**
```
POST http://192.168.0.75/RaceStart
```

### Gate LED Controls

**Access:** Configuration ? LED Setup ? Gate LEDs (Webhooks)

**Master Control:**
- **Enable Gate LEDs:** Master on/off switch for webhook system
- Must be enabled for any webhooks to fire

**Granular Controls:**
1. **Race Start Flash:** Enable/disable `/RaceStart` webhook
2. **Race Stop Flash:** Enable/disable `/RaceStop` webhook  
3. **Lap Flash:** Enable/disable `/Lap` webhook

**Behavior:**
- Webhooks only fire if both master switch AND individual toggle enabled
- Settings persist to EEPROM
- Manual lap additions also trigger `/Lap` webhook when enabled

**Configuration Flow:**
```
Enable Gate LEDs (Master) ? ON
   ?
Race Start Flash ? ON
Race Stop Flash ? ON  
Lap Flash ? ON
   ?
Webhooks fire during race events
```

### Webhook Manager API

**GET /webhooks**  
List configured webhooks and enabled status

**Response:**
```json
{
  "enabled": true,
  "webhooks": ["192.168.0.75", "192.168.0.80"]
}
```

**POST /webhooks/add**  
Add webhook IP address

**Body:**
```json
{"ip": "192.168.0.75"}
```

**POST /webhooks/remove**  
Remove webhook IP address

**Body:**
```json
{"ip": "192.168.0.75"}
```

**POST /webhooks/clear**  
Clear all configured webhooks

**POST /webhooks/enable**  
Enable/disable webhook system

**Body:**
```json
{"enabled": "1"}
```

**POST /webhooks/trigger/flash**  
Manually trigger test flash to all webhooks

### Implementation Details

**Technical Specifications:**
- **Protocol:** HTTP/1.1 POST requests
- **Timeout:** 500ms per webhook
- **Max Webhooks:** 10 simultaneous targets
- **Retry Logic:** None (fire-and-forget)
- **Thread Safety:** Non-blocking execution

**Network Requirements:**
- All devices must be on same network as FPVGate
- Standard ports (80 for HTTP)
- No authentication required

**Example LED Controller Setup:**

ESP8266/ESP32 LED controller:
```cpp
server.on("/RaceStart", HTTP_POST, []() {
  flashGreen(2);  // 2� green flashes
  server.send(200, "text/plain", "OK");
});

server.on("/Lap", HTTP_POST, []() {
  flashWhite(500);  // 0.5s white flash
  server.send(200, "text/plain", "OK");
});
```

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

## Race Synchronization (Multi-Timer)

### Overview

FPVGate supports synchronizing multiple timer devices for multi-pilot racing scenarios. This allows race directors to control multiple gates from a central master device while collecting all pilot lap times in one place.

### Architecture

`
                     WiFi Network
                          |
    +---------------------+---------------------+
    |                     |                     |
+--------+          +--------+           +--------+
| Master |  <----   | Slave  |   ---->   | Slave  |
| Timer  |  SSE     | Timer  |   HTTP    | Timer  |
+--------+          +--------+           +--------+
    |                   |                    |
  Pilot A            Pilot B              Pilot C
`

**Master Device:**
- Controls race timing (start/stop/clear)
- Receives lap events from all slaves
- Maintains unified multi-pilot race view
- Saves complete race history with all pilots

**Slave Devices:**
- Follow master's race commands via SSE
- Detect local pilot's laps
- Send lap data to master via HTTP POST
- Local voice/LED feedback still works

### Sync Mode States

**raceSyncMode Variable:**
-   - Personal mode (default, no sync)
- 1 - Master mode (controls race, receives laps)
- 2 - Slave mode (follows master, sends laps)

### SSE Event Protocol

Slave devices listen for Server-Sent Events from master:

**Race Start Event:**
`json
event: raceState
data: {"state": "started"}
`

**Race Stop Event:**
`json
event: raceState
data: {"state": "stopped"}
`

**Laps Cleared Event:**
`json
event: raceState
data: {"state": "cleared"}
`

### HTTP Lap Reporting

Slaves send lap times to master via HTTP POST:

**Endpoint:** POST http://<master-ip>/sync/lap

**Request Body:**
`json
{
  "lapTimeMs": 12340,
  "pilotName": "Louis",
  "pilotPhonetic": "Louie",
  "pilotColor": 16744448,
  "slaveHostname": "192.168.4.100"
}
`

**Master Response:**
`json
{"success": true}
`

### Remote Pilots Data Structure

Master maintains state for all remote pilots:

`javascript
remotePilots = {
  "192.168.4.100": {
    pilotName: "Louis",
    pilotPhonetic: "Louie",
    pilotColor: 0xFF6B00,
    lapTimes: [8.45, 12.34, 11.98],
    lapNo: 2
  },
  "192.168.4.101": {
    pilotName: "Sarah",
    pilotPhonetic: "Sarah",
    pilotColor: 0x36A2EB,
    lapTimes: [9.12, 13.01],
    lapNo: 1
  }
}
`

### Sync Device Configuration

**Data Structure:**
`javascript
syncDevices = [
  { address: "192.168.4.1", role: "master", isThisDevice: true },
  { address: "192.168.4.100", role: "slave", isThisDevice: false },
  { address: "192.168.4.101", role: "slave", isThisDevice: false }
]
`

**Role Options:**
- "disabled" - Not participating in sync
- "master" - Only one device can be master
- "slave" - Follows master commands

### Multi-Pilot Race View

When in sync mode, the UI switches to multi-pilot view:

**Lap Table Structure:**
`html
<thead>
  <tr>
    <th>Lap</th>
    <th style="border-left: 3px solid #FF6B00">Louis</th>
    <th style="border-left: 3px solid #36A2EB">Sarah</th>
  </tr>
</thead>
<tbody>
  <tr>
    <td>0</td>
    <td>8.45s</td>
    <td>9.12s</td>
  </tr>
</tbody>
`

### Race History Multi-Pilot Format

**Single-Pilot Race:**
`json
{
  "timestamp": 1707951234,
  "pilotName": "Louis",
  "lapTimes": [8450, 12340, 11980],
  "fastestLap": 11980,
  "syncMode": 0
}
`

**Multi-Pilot Race (Master saves):**
`json
{
  "timestamp": 1707951234,
  "syncMode": 1,
  "pilots": [
    {
      "name": "Louis",
      "callsign": "Louis",
      "color": 16744448,
      "lapTimes": [8450, 12340, 11980],
      "fastestLap": 11980,
      "isLocal": true
    },
    {
      "name": "Sarah",
      "callsign": "Sarah",
      "color": 3580651,
      "lapTimes": [9120, 13010, 12450],
      "fastestLap": 12450,
      "isLocal": false
    }
  ]
}
`

### Network Requirements

- All devices must be on same network subnet
- Port 80 must be accessible between devices
- Recommended: Use wired network or strong WiFi
- Typical latency: 50-100ms for sync commands

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
Client ? ws://192.168.4.1:81 ? ESP32 WebSocket Server
ESP32 ? Broadcast event ? All connected clients
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

![System Diagnostics](../images/screenshots/12-12-2025/Config%20Screen%20Diagnostics%2012-12-2025.png)

Comprehensive diagnostic system validates all hardware components and software features.

**Access:** Configuration ? System Settings ? Diagnostics ? "Run All Tests"

**Duration:** ~10-15 seconds  
**Total Tests:** 19 comprehensive checks

### Test Categories

#### Hardware Tests
1. **RX5808 Module** - SPI communication, RSSI readings
2. **RGB LED** - All color channels (R,G,B flash test)
3. **Battery Monitor** - Voltage reading functionality
4. **Audio/Buzzer** - Beep test and audio file verification

#### Storage Tests  
5. **EEPROM** - Read/write test with verification
6. **LittleFS** - File system mount and capacity
7. **SD Card** - Detection, R/W test, voice files, free space
8. **Storage Manager** - Unified storage abstraction

#### Connectivity Tests
9. **WiFi** - AP mode, MAC address, connection status
10. **USB Serial CDC** - USB connection and transport
11. **Transport Layer** - USB/WiFi availability and transport JS

#### Software Tests
12. **Configuration** - Valid settings, RSSI threshold validation
13. **Lap Timer** - Timer functionality and RSSI communication
14. **Race History** - Storage capacity and race count
15. **Track Manager** - Track file existence and functionality
16. **Webhooks** - HTTP client availability
17. **Web Server** - Required files (index.html, script.js, style.css)
18. **OTA Updates** - Partition space and update capability

### Detailed Test Descriptions

#### RX5808 Module Test

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

#### RGB LED Test (ESP32-S3)

**Checks:**
- FastLED library initialized
- All color channels functional
- Animation system working

**Procedure:**
1. Flash red (200ms)
2. Flash green (200ms)
3. Flash blue (200ms)
4. Return to rainbow wave

**Pass Criteria:** All three color channels visible

**Details Shown:** "All channels tested (R,G,B)"

**Failure Modes:**
- Data pin not connected
- Power supply insufficient
- Individual color channel failure

#### SD Card Test (ESP32-S3)

**Checks:**
- Card detection and initialization
- Read/write operations
- Voice directory presence
- Audio file availability
- Free space

**Procedure:**
1. Check SD card availability
2. Test file creation and write
3. Read back and verify data
4. Delete test file
5. Scan for voice directories (sounds_*)
6. Check sample audio files

**Pass Criteria:** R/W successful

**Details Shown:**
- Card size (MB)
- Free space (MB)
- Voice directories found (0-4)
- Audio files found (0-2)
- R/W status

**Failure Modes:**
- Card not inserted
- Wrong format (not FAT32)
- Write-protected
- Corrupted file system

#### Configuration Test

**Checks:**
- Config loading successful
- Valid frequency range (5600-5950 MHz)
- RSSI threshold validation (Enter > Exit)

**Pass Criteria:**
- Frequency in valid range
- Enter RSSI > Exit RSSI

**Details Shown:**
- Current frequency
- Enter RSSI value
- Exit RSSI value

**Failure Modes:**
- Invalid frequency
- Enter RSSI = Exit RSSI
- Corrupt configuration

#### Track Manager Test

**Checks:**
- Storage availability
- Track file existence

**Pass Criteria:** Storage accessible

**Details Shown:**
- "Tracks file found" or "No tracks configured yet"

#### Webhooks Test

**Checks:**
- HTTP client availability
- Network stack functional

**Pass Criteria:** HTTP client ready

**Details Shown:** "HTTP client ready"

#### Transport Layer Test

**Checks:**
- WiFi status
- USB CDC availability
- Transport JavaScript loaded

**Pass Criteria:** At least one transport active (WiFi or USB)

**Details Shown:**
- WiFi active/off
- USB connected/disconnected
- Transport JS loaded/missing

#### Buzzer Test

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
+-- main.cpp              # Entry point, setup/loop
+-- lib/
�   +-- CALIBRATION/      # RSSI calibration logic
�   +-- CONFIG/           # Configuration management
�   +-- FASTLED/          # LED control
�   +-- FREQUENCY/        # Band/channel/frequency
�   +-- RACEHISTORY/      # Race data storage
�   +-- RACELOGIC/        # Timing state machine
�   +-- RX5808/           # RX5808 SPI driver
�   +-- SELFTEST/         # Diagnostic system
�   +-- TRANSPORT/        # Transport abstraction
�   +-- TTS/              # Text-to-speech
�   +-- USB/              # USB Serial CDC transport
�   +-- WEBSERVER/        # HTTP + WebSocket server
�   +-- WIFIMAN/          # WiFi management
```

### Web Interface Structure

```
data/
+-- index.html            # Single-page app structure
+-- style.css             # Responsive styles, themes
+-- script.js             # Main UI logic, race control
+-- usb-transport.js      # USB Serial CDC communication
+-- themes.css            # 23 color themes
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

