# FPVGate User Guide

Complete guide to using all features of your FPVGate lap timer.

** Navigation:** [Home](../README.md) | [Getting Started](GETTING_STARTED.md) | [Hardware Guide](HARDWARE_GUIDE.md) | [Features](FEATURES.md)

---

## Table of Contents

1. [Connecting to FPVGate](#connecting-to-fpvgate)
2. [Web Interface Overview](#web-interface-overview)
3. [Configuration](#configuration)
4. [Calibration](#calibration)
5. [Racing](#racing)
6. [Race Analysis](#race-analysis)
7. [Race History](#race-history)
8. [LED Control](#led-control)
9. [Voice Settings](#voice-settings)
10. [Advanced Features](#advanced-features)

---

## Connecting to FPVGate

### WiFi Connection (Default)

FPVGate creates its own WiFi Access Point on startup.

**Steps:**

1. **Power on** your FPVGate device
2. **Wait 10-15 seconds** for WiFi network to appear
3. **Connect** to network: `FPVGate_XXXX` 
   - (XXXX = last 4 digits of MAC address)
4. **Enter password:** `fpvgate1`
5. **Open browser** and navigate to:
   - `http://www.fpvgate.xyz` (recommended)
   - `http://192.168.4.1` (direct IP)

**Connection Tips:**
- Works with any WiFi-enabled device (phone, tablet, laptop)
- No internet connection required
- No apps to download
- Multiple devices can connect simultaneously
- Forget network after use to avoid auto-reconnecting

### USB Connection (ESP32-S3 Only)

Direct USB connection provides lower latency and eliminates WiFi issues.

**Option A: Electron Desktop App**

1. Download [Electron app from releases](https://github.com/LouisHitchcock/FPVGate/releases)
2. Extract and run `FPVGate.exe` (Windows) or equivalent
3. Connect ESP32-S3 via USB-C cable
4. In Configuration → System Setup:
   - Connection mode selector appears
   - Click "USB" mode
   - Select your COM port from dropdown
5. App automatically uses USB transport

**Option B: Web Browser (Chrome/Edge)**

1. Connect ESP32-S3 via USB
2. Open Chrome or Edge browser
3. Navigate to `http://192.168.4.1` (still via WiFi) or use local file
4. Click USB connection mode in Configuration
5. Grant serial port permissions when prompted
6. Select COM port

**USB Benefits:**
- Zero WiFi latency
- Works completely offline
- More reliable for race control
- WiFi remains available for spectators/timing screens

---

## Web Interface Overview

The web interface has four main tabs:

![Race Screen](../screenshots/Race%20Screen%2005-12-2025.png)

### Race Tab

**Main racing interface** - Start races, view live lap times, lap analysis.

**Key Elements:**
- **Timer Display** - Current race time (MM:SS:SS format)
- **Lap Counter** - Current lap / Max laps
- **Control Buttons:**
  - Start Race - Begin countdown and race
  - Stop Race - End race and save
  - Add Lap - Manually add lap at current time
  - Clear Laps - Reset lap table
- **Lap Table** - Shows all recorded laps with times and gaps
- **Statistics** - Fastest lap, median, best 3 laps
- **Charts** - Visual lap history and fastest round

### Configuration Tab

![Configuration Menu](../screenshots/Config%20Menu%2005-12-2025.png)

**All settings and diagnostics** - Organized into sections:

1. **Race Setup** - Lap count, minimum lap time
2. **TTS Settings** - Voice announcements, rate, format
3. **Pilot Info** - Name, callsign, frequency, color
4. **LED Setup** - Presets, colors, brightness
5. **System Setup** - Battery, theme, config backup
6. **System Diagnostics** - Self-test and status

### Calibration Tab

![Calibration Screen](../screenshots/Calibration%20Screen%2005-12-2025.png)

**RSSI threshold setup** - Critical for accurate timing.

**Features:**
- Live RSSI graph
- Enter/Exit threshold sliders
- Peak/valley indicators
- Save/load thresholds
- Real-time preview

### Race History Tab

![Race History](../screenshots/Race%20History%2005-12-2025.png)

**Saved races archive** - View, edit, export past races.

**Features:**
- Race list with dates and stats
- Detail view with analysis
- Edit race names and tags
- Export individual or all races
- Import races from backup
- Clear all races

---

## Configuration

### Race Setup Section

#### Number of Laps

Set how many laps constitute a complete race.

**Options:**
- **0** - Infinite mode (race until manually stopped)
- **1-50** - Specific lap count (auto-stops when reached)

**Settings:**
- Default: 0 (Infinite)
- Race auto-stops when lap count is reached
- Lap counter shows "Lap X / Y" or "Lap X" for infinite

**Use Cases:**
- **Infinite:** Practice sessions, testing
- **5 laps:** MultiGP standard format
- **3 laps:** Quick races, RaceGOW format
- **1 lap:** Time trials

#### Minimum Lap Time

Prevents false lap detection from crashes or lingering in gate.

**Recommended Settings:**
- **5-8 seconds** - Tight indoor tracks
- **10-15 seconds** - Normal outdoor tracks
- **15-20 seconds** - Large tracks

**How it Works:**
- System ignores lap triggers within minimum time
- Prevents double-counting if you crash near gate
- Prevents re-triggering during slow fly-throughs

### TTS Settings Section

#### Announcer Type

Choose how lap times are announced.

**Options:**

| Type | Behavior | Best For |
|------|----------|----------|
| **None** | Silent | Focus flying, no distractions |
| **Beep** | Short beep only | Minimal audio feedback |
| **Lap Time** | "Lap 3, 12.45" | Standard racing (recommended) |
| **2 Consecutive** | Every 2 laps combined | Longer races |
| **3 Consecutive** | Every 3 laps combined | Consistency tracking |

#### Lap Announcement Format

Choose what information is announced.

**Formats:**

1. **Pilot + Lap + Time** (Full)
   - Example: "Louis Lap 5, 12.34"
   - Best for multi-pilot events
   
2. **Lap + Time**
   - Example: "Lap 5, 12.34"
   - Shorter, still informative
   
3. **Time Only** (Fastest)
   - Example: "12.34"
   - Minimal distraction, focus on flying

#### Voice Selection

Choose TTS engine and voice character.

**Options:**

| Voice | Style | Engine | Notes |
|-------|-------|--------|-------|
| **Sarah (Energetic)** | High energy, excited | ElevenLabs | Default, natural |
| **Rachel (Calm)** | Smooth, measured | ElevenLabs | Relaxed vibe |
| **Adam (Deep Male)** | Authoritative | ElevenLabs | Deep voice |
| **Antoni (Male)** | Friendly | ElevenLabs | Warm tone |
| **PiperTTS** | Synthetic | PiperTTS | Lower latency |

**How Voices Work:**
- **ElevenLabs voices:** Use pre-recorded MP3s from SD card or LittleFS
- **PiperTTS:** Real-time synthesis, no pre-recording needed
- **Fallback:** If ElevenLabs files missing, PiperTTS used automatically

#### Announcer Rate

Control speech playback speed.

**Range:** 0.1 (very slow) to 2.0 (very fast)  
**Default:** 1.0 (normal)  
**Recommended:** 1.2-1.4 for racing

**Effect:**
- Lower = Clearer but slower
- Higher = Faster but may be unclear
- Adjust based on track size and preference

#### Voice Control Buttons

**Enable Audio** - Activate voice announcements  
**Disable Audio** - Mute all voice announcements  
**Generate Audio** - Test current voice with pilot name

**Visual Feedback:**
- Active button is highlighted orange
- Inactive button is dimmed

### Pilot Info Section

#### Band & Channel

Set to match your drone's VTx frequency.

**Supported Bands:**
- **A (Boscam A)** - 5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725
- **B (Boscam B)** - 5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866
- **E (Boscam E)** - 5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945
- **F (Fatshark)** - 5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880
- **R (RaceBand)** - 5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917
- **L (LowBand)** - 5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621

**Frequency Auto-Calculation:**
- Frequency (MHz) displays below selection
- Updates immediately when changed
- Must match your VTx exactly for best results

#### Pilot Name

Full name used in voice announcements and race history.

**Examples:** "Louis Hitchcock", "Sarah Chen"  
**Max Length:** 50 characters  
**Used For:** Voice callouts, race records

#### Pilot Callsign

Short display name for UI and race table.

**Examples:** "Louis", "SChen", "Pilot1"  
**Max Length:** 10 characters  
**Used For:** UI display, compact views

#### Phonetic Name

How TTS should pronounce your name.

**Purpose:** Correct pronunciation for natural speech  
**Max Length:** 30 characters  
**Fallback:** Uses Pilot Name if empty

**Examples:**
- "Louis" → "Louie"
- "Xavier" → "Zavier"  
- "Nguyen" → "Win"
- "Siobhan" → "Shiv-awn"

#### Pilot Color

Your racing color for UI elements and LED preset.

**15 Colors Available:**
Red, Orange, Gold, Green, Cyan, Blue, Purple, Magenta, Pink, White, Gray, Black, Brown, Spring Green, Hot Pink

**Used For:**
- Color preview in UI
- Race history identification
- "Pilot Colour" LED preset (matches this color)

---

## Calibration

** Most Important Step** - Proper calibration is critical for accurate timing.

### Understanding RSSI Thresholds

FPVGate detects laps by monitoring RSSI (signal strength) changes:

1. **Enter RSSI** - Threshold to START watching for a lap
2. **Exit RSSI** - Threshold to STOP watching and record lap

**The Peak:**
- RSSI peaks when drone is closest to gate
- Time of peak = lap time recorded
- Lap only counts if RSSI rises above Enter, peaks, then falls below Exit

### Calibration Procedure

#### Step 1: Prepare

1. **Power on drone** and wait 30 seconds (VTx warm-up)
2. **Check frequency** - Configuration → Pilot Info → Band/Channel
3. **Position drone** - One gate distance away (~3-6 feet)
4. **Navigate** to Calibration tab

#### Step 2: Observe RSSI

1. **Watch the graph** - Real-time RSSI value shown
2. **Move drone to gate** - Note the peak RSSI value
3. **Move drone away** - Note the valley RSSI value

**Example Readings:**
- At gate: Peak = 150
- Away: Valley = 80-100

#### Step 3: Set Thresholds

**Enter RSSI:**
- Set **2-5 points below** observed peak
- Example: Peak = 150 → Enter = 145

**Exit RSSI:**
- Set **8-10 points below** Enter RSSI
- Example: Enter = 145 → Exit = 135

**Rule:** Enter must always be higher than Exit

#### Step 4: Test

1. **Fly drone through gate** - Watch for green crossing zone
2. **Check lap table** - Should register one clean lap
3. **Adjust if needed:**
   - Missing laps? Lower Enter by 5
   - False laps? Raise Exit by 5

### Good vs Bad Calibration

** Good Calibration:**
```
RSSI  │     /\
      │    /  \
      │   /    \     ← Single clean peak
Enter ├──/──────\───
      │ /        \
Exit  ├/──────────\─
      └─────────────── Time
Result: 1 lap counted 
```

** Bad Calibration (Thresholds too low):**
```
RSSI  │   /\/\        ← Multiple peaks!
      │  /    \
Enter ├─/──────\───
      │/        \
Exit  /──────────\─
      └─────────────── Time
Result: 3 laps counted 
```

### Calibration Tips

**Missing Laps:**
- Lower Enter RSSI by 5 points
- Check VTx frequency matches
- Ensure VTx warmed up (30 seconds)
- Verify antenna on RX5808

**False Laps (Too Many):**
- Increase Minimum Lap Time (Configuration)
- Raise Exit RSSI by 5 points
- Move timer further from flight path
- Reduce RF interference

**Inconsistent Detection:**
- Wait for VTx to fully warm up
- Check power supply stability
- Re-calibrate when flying with others (RF noise)
- Verify RX5808 connections

**Flying with Other Pilots:**
- Lower both thresholds by 3-5 points
- Accounts for RF noise from other VTxs
- May need per-session adjustment

---

## Racing

### Starting a Race

1. **Navigate** to Race tab
2. **Click "Start Race"** button
3. **Listen** to countdown:
   - "Arm your quad"
   - "Starting on the tone in less than five"
   - Random delay (1-5 seconds)
   - Start beep (880 Hz tone)
4. **Fly!**

**Race Start Behavior:**
- Button turns orange and pulses during countdown
- RGB LED flashes green
- Timer starts on beep
- First gate pass = "Gate 1" (hole shot)
- Subsequent passes = Lap 1, 2, 3...

### During Race

**Live Information:**
- **Timer** - Shows current race time
- **Lap Counter** - Current lap / Max laps (if set)
- **Lap Table** - Updates as laps are detected
- **Voice** - Announces each lap (if enabled)
- **LED** - Flashes white on each lap

**Manual Lap Button:**
- Click "Add Lap" to manually record a lap
- Uses current timer value
- Useful if detection missed a pass
- Lap broadcasts to all connected clients

### Stopping a Race

**Click "Stop Race"** button

**What Happens:**
- Timer stops
- Race auto-saves to history
- Voice announces "Race stopped"
- Button states reset
- Lap data remains in table

**Auto-Stop:**
- If max laps set (not infinite)
- Race auto-stops when lap count reached
- Voice announces "Race complete"

### Clearing Laps

**Click "Clear Laps"** button

**What Happens:**
- Auto-saves current race (if laps exist)
- Clears lap table
- Resets timer to 00:00:00
- Resets lap counter
- Clears analysis charts

---

## Race Analysis

FPVGate provides real-time analysis of your performance.

### Statistics Boxes

Located below the lap table, four key metrics:

#### Fastest Lap
- **Shows:** Your quickest single lap time
- **Lap Number:** Which lap was fastest
- **Example:** "12.34s (Lap 3)"
- **Use:** Track personal bests

#### Median Lap
- **Shows:** Middle lap time (consistency indicator)
- **Calculation:** Sorted lap times, middle value
- **Example:** "14.56s"
- **Use:** Gauge overall consistency

#### Best 3 Laps (Sum)
- **Shows:** Sum of your 3 fastest individual laps
- **Lap Numbers:** Which laps contributed
- **Example:** "39.87s (L2, L4, L7)"
- **Use:** Compare across sessions

#### Fastest 3 Consecutive
- **Shows:** Best consecutive 3-lap sequence
- **Lap Range:** Which laps (e.g., "L3-L5")
- **Example:** "41.23s (L3-L5)"
- **Use:** RaceGOW format scoring

### Visual Charts

Toggle between two chart views:

#### Lap History Chart
- **Shows:** Last 10 laps as colored bars
- **Colors:** Each lap has unique color
- **Width:** Proportional to lap time
- **Use:** Identify trends, tire wear

#### Fastest Round Chart  
- **Shows:** Your best 3 consecutive laps
- **Bars:** Individual times for each lap
- **Total:** Combined time displayed
- **Use:** Optimize 3-lap runs

### Fastest Lap Highlighting

- Fastest lap row has **gold background**
- Updates automatically as you fly
- Excludes "Gate 1" (hole shot)
- Visual indicator of personal best

---

## Race History

All races are automatically saved when you stop or clear laps.

### Viewing Races

**Navigate** to Race History tab

**Race List Shows:**
- Date and time
- Lap count
- Fastest lap time
- Race name (if set)
- Race tag (if set)
- Pilot callsign
- Frequency/channel

### Race Details

**Click any race** to view full analysis:

**Statistics:**
- Fastest lap with lap number
- Median lap time
- Best 3 laps total

**Charts:**
- Lap history (last 10 laps)
- Fastest round (3 consecutive)

### Editing Races

**Click "Edit"** button on race card

**Editable Fields:**
- **Race Name** - Descriptive title ("Morning Practice", "Qualifier 1")
- **Race Tag** - Category ("training", "race", "freestyle")

**Click "Save"** to update race

### Exporting Races

**Single Race:**
1. Click "Download" on race card
2. Saves as JSON file
3. Filename: `race_<timestamp>.json`

**All Races:**
1. Click "Download All Races" at top
2. Saves complete history as JSON
3. Filename: `fpvgate_races_<date>.json`

**JSON Format:**
- Compatible with other tools
- Can be re-imported
- Includes all lap data and metadata

### Importing Races

**Click "Import Races"** button

1. Select JSON file (exported from FPVGate)
2. System merges with existing races
3. Duplicates are skipped
4. Import confirmation shown

**Use Cases:**
- Restore from backup
- Transfer between devices
- Combine race data from multiple timers

### Deleting Races

**Single Race:**
- Click "Delete" on race card
- Confirmation prompt appears
- Permanent deletion

**All Races:**
- Click "Clear All Races"
- Confirmation prompt (important!)
- Removes all saved races

** Warning:** Deletions are permanent! Export before clearing.

---

## LED Control

Configure RGB LED behavior and visual effects.

### LED Presets

10 built-in effects available:

| Preset | Description | Speed Control |
|--------|-------------|---------------|
| **Off** | LEDs disabled | No |
| **Solid Colour** | Static single color | No |
| **Rainbow Wave** | Smooth rainbow animation | Yes |
| **Color Fade** | Fade to/from color | Yes |
| **Fire** | Flickering fire effect | Yes |
| **Ocean** | Blue wave pattern | Yes |
| **Police** | Red/blue alternating | Yes |
| **Strobe** | Fast flashing | Yes |
| **Comet** | Chasing light | Yes |
| **Pilot Colour** | Uses your pilot color | No |

### Solid Colour Preset

**Select:** Solid Colour preset  
**Color Picker Appears:** Choose any color  
**Apply:** Color displays immediately

**Use Cases:**
- Team colors
- Venue lighting requirements
- Personal preference

### Color Fade Preset

**Select:** Color Fade preset  
**Color Picker Appears:** Choose target color  
**Effect:** Smoothly fades between colors

**Parameters:**
- **Animation Speed:** 1-20 (controls fade rate)

### Strobe Preset

**Select:** Strobe preset  
**Color Picker Appears:** Choose strobe color  
**Effect:** Rapid flashing

** Warning:** Slowed for visibility, may still be bright

### Pilot Colour Preset

**Select:** Pilot Colour preset  
**Effect:** Uses color from Configuration → Pilot Info → Pilot Color

**Updates:**
- Changes automatically when you change pilot color
- Syncs with race identification

### Animation Speed

**Range:** 1 (slow) - 20 (fast)  
**Default:** 5  
**Affects:** Rainbow, Fade, Fire, Ocean, Police, Strobe, Comet

**Tip:** Lower speeds are more elegant, higher speeds more energetic

### LED Brightness

**Range:** 0 (off) - 255 (max)  
**Default:** 80  
**Effect:** Overall brightness of all presets

**Use Cases:**
- **80-120:** Indoor use
- **150-200:** Outdoor daylight
- **255:** Maximum visibility

**Power:** Higher brightness = more current draw

### Manual LED Control

**Toggle:** "Manual LED Control" switch

**When Enabled:**
- Race events DON'T affect LEDs
- LED settings remain constant
- Good for practice/testing

**When Disabled (Default):**
- Race start → Green flash
- Lap detected → White flash  
- Race stop → Red triple flash
- Preset continues between events

---

## Voice Settings

Advanced voice configuration options.

### Phonetic Pronunciation

Customize how names and numbers are spoken.

**Pilot Name Pronunciation:**
- Set in Configuration → Pilot Info → Phonetic Name
- Falls back to Pilot Name if empty
- Examples in [Configuration section](#pilot-info-section)

### Lap Format Customization

Choose what information is announced per lap.

**Access:** Configuration → TTS Settings → Lap Announcement Format

**Three Options:**
1. Full details (pilot + lap + time)
2. Moderate (lap + time)
3. Minimal (time only)

**Example Announcements:**

| Format | Gate 1 | Lap 3, 12.34s |
|--------|--------|---------------|
| **Full** | "Gate 1, 8.45" | "Louis Lap 3, 12.34" |
| **Lap+Time** | "Gate 1, 8.45" | "Lap 3, 12.34" |
| **Time Only** | "8.45" | "12.34" |

### Voice Engine Selection

**ElevenLabs Voices:**
- Use pre-recorded MP3 files
- Natural, human-like
- Requires SD card or LittleFS space
- Auto-falls back to PiperTTS if files missing

**PiperTTS:**
- Real-time synthesis
- Lower latency (~200ms faster)
- Slightly more robotic
- No storage required
- Exclusive mode (doesn't try ElevenLabs files)

**Switching Engines:**
- Configuration → TTS Settings → Voice
- Change takes effect immediately
- No restart required

---

## Advanced Features

### OSD Overlay

Display race information on live video stream.

**Access:** Click "Open OSD" button in Configuration

**Features:**
- Clean, minimal overlay
- Shows current lap time
- Shows lap number
- Updates in real-time
- Transparent background for easy keying

**Setup for OBS:**
1. Click "Open OSD" - opens in new tab
2. Copy URL (auto-copied to clipboard)
3. In OBS: Add "Browser Source"
4. Paste URL
5. Set width: 1920, height: 1080
6. Check "Shutdown source when not visible"
7. Position overlay on stream

### Battery Monitoring

Track battery voltage during races.

**Enable:** Configuration → System Setup → Battery Monitoring toggle

**When Enabled:**
- Current voltage displayed
- Low battery alarm threshold setting
- Audio/visual alerts when low
- Voltage updates every 2 seconds

**Wiring:**
- Connect battery sense to GPIO1
- Use voltage divider for >3.3V batteries
- 1S: Direct connection OK
- 2S+: Voltage divider required

### Theme Selection

23 color schemes available.

**Access:** Configuration → System Setup → Theme

**Categories:**
- **Material Themes:** Modern, colorful (10 options)
- **Classic Dark:** Popular dark themes (7 options)
- **Classic Light:** Bright themes (6 options)

**Logo Adaptation:**
- Black logo for light themes
- White logo for dark themes
- Automatic switching

### Config Backup & Restore

Save and restore all settings.

**Download Config:**
1. Configuration → System Setup
2. Click "Download Config"
3. Saves as JSON file
4. Includes ALL settings (backend + frontend)

**Import Config:**
1. Click "Import Config"
2. Select JSON file
3. Settings applied immediately
4. Page reloads automatically

**Backup Includes:**
- Frequency, RSSI thresholds
- Pilot information
- LED settings
- Theme, voice settings
- All frontend preferences

---

## Keyboard Shortcuts

**Race Tab:**
- `Space` - Start/Stop race
- `L` - Add manual lap
- `C` - Clear laps

**Global:**
- `Tab` - Cycle through tabs
- `Esc` - Close modal dialogs
- `?` - Show help (if implemented)

---

## Tips & Best Practices

### For Accurate Timing

 **DO:**
- Let VTx warm up 30+ seconds
- Recalibrate when flying with others
- Use minimum lap time to prevent false triggers
- Keep power supply stable (good battery)
- Use Solid mounting for RX5808

 **DON'T:**
- Change frequency without recalibrating
- Use damaged/weak antennas
- Fly with cold VTx
- Ignore false lap triggers

### For Better Performance

- Use USB connection for zero latency
- Enable voice for faster lap awareness
- Set lap count for race format training
- Review race history regularly
- Export races before firmware updates

### For Troubleshooting

- Run self-test first (Configuration → System Diagnostics)
- Check Serial Monitor for debug info
- Verify all connections with multimeter
- Test with known-good components
- Ask community before replacing hardware

---

## Next Steps

 **Master the features**   
 **[Hardware Guide](HARDWARE_GUIDE.md)** - Advanced hardware info  
 **[Features Guide](FEATURES.md)** - Deep dive into capabilities  
 **[Development Guide](DEVELOPMENT.md)** - Contribute to project

---

**Questions? [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions) | [Report Issues](https://github.com/LouisHitchcock/FPVGate/issues)**
