# FPVGate Hardware Guide

Technical specifications, wiring diagrams, and hardware troubleshooting.

** Navigation:** [Home](../README.md) | [Getting Started](GETTING_STARTED.md) | [User Guide](USER_GUIDE.md) | [Features](FEATURES.md)

---

## Table of Contents

1. [Hardware Requirements](#hardware-requirements)
2. [ESP32 Board Selection](#esp32-board-selection)
3. [RX5808 Module](#rx5808-module)
4. [RGB LED Strip](#rgb-led-strip)
5. [SD Card Module](#sd-card-module)
6. [Buzzer](#buzzer)
7. [Power Supply](#power-supply)
8. [Complete Pin Reference](#complete-pin-reference)
9. [Hardware Assembly](#hardware-assembly)
10. [Troubleshooting](#troubleshooting)

---

## Hardware Requirements

### Required Components

| Component | Specification | Quantity | Est. Cost |
|-----------|--------------|----------|-----------|
| **ESP32-S3** | DevKit-C or compatible | 1 | $6-12 |
| **RX5808 Module** | 5.8GHz receiver | 1 | $3-6 |
| **WS2812B LED Strip** | 5V addressable RGB | 1 (20-60 LEDs) | $5-10 |
| **SD Card Module** | SPI interface | 1 | $1-3 |
| **MicroSD Card** | 4GB+ (FAT32) | 1 | $3-5 |
| **Passive Buzzer** | 5V, 2-pin | 1 | $1-2 |
| **Power Supply** | 5V 2A USB or barrel | 1 | $3-8 |
| **Jumper Wires** | Male-to-female | 20-30 | $2-5 |

**Total Cost:** ~$25-50 USD

### Optional Components

| Component | Purpose | Cost |
|-----------|---------|------|
| **LiPo Battery** | Portable power (2S-3S) | $10-20 |
| **Buck Converter** | Voltage regulation (7-24V → 5V) | $2-5 |
| **Enclosure** | Protection, mounting | $5-15 |
| **SMA Antenna** | Better reception | $3-8 |

---

## ESP32 Board Selection

### Recommended: ESP32-S3 DevKit-C

**Why ESP32-S3:**
- **USB Serial CDC** - Direct USB connectivity to PC
- **Dual-core** - Better performance for simultaneous WiFi + voice
- **More RAM** - 512KB SRAM (vs 320KB on original ESP32)
- **Better WiFi** - Improved antenna design
- **LittleFS support** - Store voice files without SD card

**Pinout Compatibility:**
- Uses same GPIO pins as original ESP32
- Drop-in replacement for existing builds

**Where to Buy:**
- **AliExpress:** $6-8 (search "ESP32-S3 DevKit-C")
- **Amazon:** $10-12 (faster shipping)
- **Adafruit:** $13 (quality assurance)

### Alternative: Original ESP32 DevKitC

**Still Supported:**
- All features work except USB connectivity
- WiFi-only operation
- Cheaper ($4-6)

**Limitations:**
- No USB Serial CDC (WiFi only)
- Less RAM (may limit voice files)
- Older architecture

### Not Recommended

**ESP32-C3:**
- Single-core (performance issues)
- Different pin layout

**ESP32-S2:**
- No Bluetooth (not used currently, but future-proof)
- Less popular (fewer resources)

**ESP8266:**
- Not compatible (different architecture)

---

## RX5808 Module

### Overview

The RX5808 is a 5.8GHz FPV receiver module that detects drone video signals.

**Key Specs:**
- **Frequency Range:** 5.645-5.945 GHz
- **Channels:** 40 (5 bands × 8 channels)
- **Interface:** SPI (for tuning)
- **RSSI Output:** Analog 0-3.3V
- **Power:** 5V, ~150mA

### SPI Modification

** CRITICAL:** RX5808 modules ship in parallel mode and must be modified for SPI.

**Procedure:**

1. **Locate R16 resistor** on module PCB (near chip)
2. **Carefully bridge R16** with solder blob
3. **Verify continuity** with multimeter
4. **Test:** SPI communication should work

**Why This is Needed:**
- Default parallel mode only reads, cannot tune frequency
- SPI mode allows software frequency control
- Without this, stuck on one frequency

**Visual Guide:**
- See [RX5808 SPI mod guide](https://github.com/sheaivey/rx5808-pro-diversity/blob/master/docs/rx5808-spi-mod.md)

### Pin Functions

| Pin | Function | ESP32 Connection |
|-----|----------|------------------|
| **VCC** | Power (5V) | 5V rail |
| **GND** | Ground | GND |
| **RSSI** | Signal strength | GPIO3 (ADC) |
| **SPI_CLK** | SPI clock | GPIO15 |
| **SPI_DATA** | SPI data | GPIO13 |
| **SPI_SEL** | Chip select | GPIO14 |

### Antenna Selection

**Included Antenna:**
- Usually small dipole or patch
- Works for 3-6 feet range

**Upgrade Options:**

| Antenna Type | Range | Best For |
|--------------|-------|----------|
| **Dipole** | 10-15 ft | Indoor tracks |
| **Patch** | 15-25 ft | Directional, tight gates |
| **Cloverleaf** | 20-30 ft | Circular polarization |
| **Helical** | 30-50 ft | Long-range outdoor |

**Connection:**
- Most RX5808 modules have U.FL or SMA connector
- Match your antenna connector type
- **Never power on without antenna!** (can damage receiver)

### Troubleshooting RX5808

**No RSSI Reading (always 0):**
- Check RSSI pin connection (GPIO3)
- Verify 5V power present
- Test with multimeter: RSSI should vary 0-3V

**Cannot Tune Frequency:**
- SPI mod not done or failed
- Check SPI pin connections
- Verify R16 bridge with continuity test

**Low/Weak RSSI:**
- Antenna not connected
- Wrong frequency selected
- VTx not powered/transmitting
- Module damaged

**Inconsistent Readings:**
- Poor power supply (voltage drops)
- Loose connections
- RF interference
- Bad module (replace)

---

## RGB LED Strip

### Specifications

**Type:** WS2812B (or compatible: SK6812, WS2813)

**Key Features:**
- **Individually addressable** - Each LED controlled separately
- **Protocol:** Single-wire data + power
- **Voltage:** 5V
- **Current:** ~60mA per LED at full white

**Strip Types:**

| Type | LEDs/m | Best For | Cost/m |
|------|--------|----------|--------|
| **30 LEDs/m** | 30 | Long strips, low density | $5 |
| **60 LEDs/m** | 60 | Standard (recommended) | $8 |
| **144 LEDs/m** | 144 | High density, short lengths | $15 |

### Recommended Configuration

**LED Count:** 20-60 LEDs
- **20 LEDs:** Minimal, gate frame only
- **30 LEDs:** Good balance
- **60 LEDs:** Full race gate + base

**Power Calculation:**
- 30 LEDs × 60mA = 1.8A max
- ESP32 = 500mA
- Total = 2.3A → Use 5V 3A supply

### Wiring

**3-Wire Connection:**

| Strip Wire | Color | ESP32 Pin |
|------------|-------|-----------|
| **Data (DIN)** | Green/White | GPIO7 |
| **Power (+5V)** | Red | 5V rail |
| **Ground (GND)** | Black/White | GND |

**Important:**
- **Short wires** - Keep data line under 6 inches if possible
- **Power injection** - For 60+ LEDs, inject 5V at both ends
- **Capacitor** - Optional 1000μF across power helps stability

### Data Line Issues

**LEDs glitchy/flickering:**
- Add 330Ω resistor inline with data pin
- Use shorter wire (< 6 inches)
- Add 0.1μF capacitor between data and GND at strip

**First LED wrong, rest OK:**
- Voltage drop on long wire
- Use level shifter (3.3V → 5V)
- Power LED strip separately from ESP32

**Some LEDs stuck/wrong color:**
- Power supply insufficient
- Bad LED in strip (data chain broken)
- Cut out bad LED, reconnect data line

### Power Injection

For 60+ LED strips:

```
                    5V Power Supply (5V 3A)
                           |
                    +------+------+
                    |             |
                 ESP32         LED Strip
                  (GND)        (GND, +5V)
                    |             |
                    +------+------+
                           |
                          GND
```

**Why:**
- Voltage drop along strip causes dim/wrong colors at end
- Injecting power at both ends maintains stable 5V
- Critical for 100+ LEDs

---

## SD Card Module

### Specifications

**Interface:** SPI  
**Voltage:** 3.3V logic (5V tolerant on most modules)  
**Speed:** 25 MHz SPI clock  
**Card Support:** microSD, microSDHC (up to 32GB)

### SD Card Formatting

**File System:** FAT32 (required)  
**Allocation Unit:** 4096 bytes (default)

**How to Format:**
1. Insert card into PC
2. Right-click drive → Format
3. File system: FAT32
4. Start

**Troubleshooting Format:**
- Cards >32GB need special FAT32 formatter
- Use "FAT32 Format" tool (Google for download)
- exFAT and NTFS are NOT supported

### Wiring

| SD Module Pin | ESP32 Pin |
|---------------|-----------|
| **CS** | GPIO10 |
| **SCK (CLK)** | GPIO12 |
| **MOSI (DI)** | GPIO11 |
| **MISO (DO)** | GPIO13 |
| **VCC** | 3.3V |
| **GND** | GND |

**Important:**
- Use **3.3V**, not 5V (can damage ESP32)
- MISO conflict with RX5808 SPI_DATA (GPIO13) is OK - they share SPI bus

### File Structure

**Expected Directory Layout:**

```
SD Card Root
├── audio/
│   ├── elevenlabs/
│   │   ├── sarah/
│   │   │   ├── arm.mp3
│   │   │   ├── gate1.mp3
│   │   │   ├── lap1.mp3
│   │   │   └── ...
│   │   ├── rachel/
│   │   ├── adam/
│   │   └── ...
│   └── piper/
│       └── (generated at runtime)
└── races/
    └── (auto-saved race files)
```

**Generating Audio Files:**
- Use `tools/tts_generator.py` to create voice files
- See [tools/README.md](../tools/README.md) for details

### Troubleshooting SD Card

**SD card not detected:**
- Check wiring (especially CS, CLK, MOSI, MISO)
- Verify FAT32 format
- Try different card (some cards incompatible)
- Check Serial Monitor for "SD card initialized"

**Files not found:**
- Verify folder structure matches above
- Check file names (case-sensitive!)
- Ensure files are MP3 format
- Re-copy files, safely eject

**Card works sometimes, not others:**
- Poor connection (reseat card)
- Bad SD module (try different one)
- Power supply issues (add capacitor)

---

## Buzzer

### Specifications

**Type:** Passive buzzer (recommended)  
**Alternative:** Active buzzer (always same tone)

**Passive Buzzer:**
- Requires PWM signal
- Variable tones/frequencies
- Used for countdown beep (880 Hz)

**Active Buzzer:**
- Just needs on/off signal
- Fixed frequency (~2kHz)
- Simpler but less flexible

### Wiring

| Buzzer Pin | ESP32 Pin |
|------------|-----------|
| **Signal (+)** | GPIO8 |
| **Ground (-)** | GND |

**Polarity:**
- Red/long leg = Signal (GPIO8)
- Black/short leg = Ground

**Optional:**
- Add 100Ω resistor in series to reduce volume

### Buzzer Behavior

**Race Start Countdown:**
- "Arm your quad"
- "Starting on the tone in less than five"
- Random delay (1-5 seconds)
- **Beep** - 880 Hz, 500ms

**Why 880 Hz:**
- Clear, distinct tone
- Easily heard over noise
- Not harsh/annoying

### Troubleshooting Buzzer

**No sound:**
- Check polarity (swap wires)
- Verify passive vs active type
- Test GPIO8 with LED (should flash during countdown)

**Distorted/weak sound:**
- Power supply issue
- Buzzer damaged
- Use active buzzer instead

**Always on/buzzing:**
- Active buzzer on PWM pin (swap to passive)
- Software bug (check Serial Monitor)

---

## Power Supply

### Requirements

**Voltage:** 5V ± 0.25V (4.75V - 5.25V)  
**Current:** 2-3A minimum  
**Connector:** USB-C (ESP32-S3) or Micro-USB (ESP32), or 5V barrel jack

### Power Budget

| Component | Current Draw |
|-----------|--------------|
| ESP32-S3 | 500mA (WiFi + processing) |
| RX5808 | 150mA |
| SD Card | 100mA |
| 30× WS2812B LEDs | 1800mA (full white) |
| Buzzer | 30mA |
| **Total** | **2580mA** |

**Recommendation:** 5V 3A power supply (3000mA)

### Power Supply Options

#### Option 1: USB Power (Simplest)

**Pros:**
- Easy to find
- Safe voltage
- Built-in protection

**Cons:**
- Requires USB cable nearby
- Limited portability

**Recommended Supplies:**
- Phone charger (5V 2A minimum)
- USB power bank (10,000mAh+)
- Powered USB hub

#### Option 2: Barrel Jack with Regulator

**Pros:**
- Use 7-24V battery (LiPo, SLA, etc.)
- Portable
- Higher power available

**Cons:**
- Requires buck converter (7-24V → 5V 3A)
- Extra component cost

**Recommended Buck Converter:**
- LM2596 module (3A, adjustable)
- MP1584 module (3A, compact)
- Pre-set to 5.0V before connecting ESP32

#### Option 3: LiPo Battery Direct (Advanced)

**Pros:**
- Most portable
- Clean power
- Rechargeable

**Cons:**
- Requires BEC or regulator
- Battery management
- Fire risk if mishandled

**Configuration:**
- 2S-3S LiPo (7.4V - 11.1V)
- 5V 3A BEC (e.g., Hobbywing UBEC)
- XT60 or Deans connector

### Power Wiring

**Shared Ground:**
- All components must share common ground
- Connect all GND pins together
- Use breadboard or distribution block

**Power Distribution:**

```
     5V Power Supply
           |
    +------+------+
    |      |      |
  ESP32  RX5808  LED Strip
   (5V)   (5V)    (5V)
    |      |      |
    +------+------+
           |
          GND (common)
```

### Troubleshooting Power

**Device resets randomly:**
- Insufficient current
- Voltage drop under load
- Use higher amperage supply
- Add bulk capacitor (1000μF) near ESP32

**LEDs dim at end of strip:**
- Voltage drop along wires
- Power inject at both ends
- Use thicker wire (lower gauge)

**WiFi drops frequently:**
- Power supply noise
- Add 100μF capacitor near ESP32
- Use filtered/regulated supply

**Everything works until LEDs turn on:**
- Current limit exceeded
- Upgrade to 3A supply
- Reduce LED count or brightness

---

## Complete Pin Reference

### ESP32-S3 DevKit-C Pinout

| GPIO | Component | Signal | Direction |
|------|-----------|--------|-----------|
| **GPIO3** | RX5808 | RSSI | Input (analog) |
| **GPIO7** | LED Strip | Data | Output |
| **GPIO8** | Buzzer | PWM | Output |
| **GPIO10** | SD Card | CS | Output |
| **GPIO11** | SD Card | MOSI | Output |
| **GPIO12** | SD Card | SCK | Output |
| **GPIO13** | SD Card + RX5808 | MISO / SPI_DATA | Input/Output |
| **GPIO14** | RX5808 | SPI_SEL (CS) | Output |
| **GPIO15** | RX5808 | SPI_CLK | Output |
| **GPIO1** | Battery (optional) | Voltage sense | Input (analog) |

**Power Pins:**

| Pin | Function |
|-----|----------|
| **5V** | Power output (USB powered) |
| **3.3V** | Regulated 3.3V output |
| **GND** | Ground (multiple pins available) |

**Notes:**
- Don't use GPIO0 (boot mode selection)
- Don't use GPIO46 (strapping pin)
- GPIO13 shared between SD and RX5808 (different SPI functions, OK)

### Connection Summary Table

| Component | Pin(s) | Voltage | Notes |
|-----------|--------|---------|-------|
| **RX5808** | GPIO3, 14, 15, 13 | 5V | RSSI + SPI |
| **LED Strip** | GPIO7 | 5V | Single data wire |
| **SD Card** | GPIO10, 11, 12, 13 | 3.3V | SPI bus |
| **Buzzer** | GPIO8 | 5V | Passive type |
| **Battery** | GPIO1 | 3.3V max | Optional, voltage divider |

---

## Hardware Assembly

### Step-by-Step Build

#### Step 1: Test Components Individually

Before final assembly, test each component:

1. **ESP32 alone** - Upload blink sketch, verify USB
2. **RX5808** - Connect, run self-test, check RSSI
3. **LED strip** - Connect, test with FastLED example
4. **SD card** - Format, connect, test with SD example
5. **Buzzer** - Connect, test with tone() function

#### Step 2: Plan Layout

**Considerations:**
- Keep RX5808 away from ESP32 WiFi antenna
- LED strip needs clearance (heat dissipation)
- SD card accessible for swapping
- Buzzer orientation (sound direction)

**Recommended Layout:**
```
    [RX5808 + Antenna]
           |
      [ESP32-S3]
           |
    [LED Strip connector]
           |
     [SD Card] [Buzzer]
```

#### Step 3: Solder or Breadboard

**Breadboard (Testing):**
- Quick, no soldering
- Easy to modify
- Less reliable (loose connections)

**Soldered Connections:**
- Permanent
- Reliable for racing
- Harder to troubleshoot

**Perfboard (Recommended):**
- Semi-permanent
- Organized layout
- Easy to trace connections

#### Step 4: Wire Management

**Best Practices:**
- Group wires by function (power, SPI, signals)
- Use different colors (red=5V, black=GND, etc.)
- Label wires with tape
- Strain relief on connectors
- Cable ties for neatness

#### Step 5: Enclosure

**3D Printable Case:**
- Search Thingiverse for "ESP32 race timer"
- Design your own (CAD skills)
- Ensure ventilation holes

**Commercial Enclosure:**
- Hammond plastic project box
- Cutouts for USB, antenna, LED strip
- Use Dremel or step drill

**Mounting:**
- Velcro to race gate
- Clamps or zip ties
- Ensure antenna has clear line-of-sight

---

## Troubleshooting

### No Power / Won't Boot

**Symptoms:**
- No lights on ESP32
- USB not detected by PC

**Solutions:**
- Check USB cable (try different one - data cable, not charge-only)
- Verify power supply (multimeter check 5V)
- Press BOOT button while plugging in USB
- Try different USB port

### WiFi Not Appearing

**Symptoms:**
- No "FPVGate_XXXX" network
- ESP32 powered but no connection

**Solutions:**
- Wait 15-20 seconds after boot
- Check Serial Monitor for WiFi messages
- Reflash firmware
- Erase flash first: `pio run -t erase`

### RSSI Always Zero

**Symptoms:**
- Calibration graph flat line
- No lap detection

**Solutions:**
- Verify RX5808 connections (especially RSSI on GPIO3)
- Check VTx is powered and transmitting
- Verify frequency match (band + channel)
- Test RSSI pin with multimeter (should show 0-3V)
- RX5808 may be damaged (swap module)

### LEDs Not Working

**Symptoms:**
- LEDs stay off
- Only first LED works
- Random colors/flickering

**Solutions:**
- Check data pin (GPIO7)
- Verify 5V power to strip
- Check ground connection
- Add 330Ω resistor on data line
- Reduce brightness in software
- Power supply may be insufficient

### SD Card Not Detected

**Symptoms:**
- Serial Monitor shows "SD card initialization failed"
- Voice files not playing

**Solutions:**
- Reformat SD card as FAT32
- Check all SPI pins (CS, SCK, MOSI, MISO)
- Try different SD card
- Verify 3.3V to SD module (not 5V!)
- Clean SD card contacts

### Voice Not Playing

**Symptoms:**
- Laps detected but no audio
- Buzzer works, voice doesn't

**Solutions:**
- Check SD card detected
- Verify audio files on SD (/audio/elevenlabs/...)
- Check file names match expected format
- Enable audio in Configuration
- Check I2S or DAC connections (if using external DAC)

### Frequent Crashes / Resets

**Symptoms:**
- ESP32 reboots randomly
- Watchdog timer resets

**Solutions:**
- Insufficient power (upgrade supply)
- Add decoupling capacitor (100μF near ESP32)
- Reduce LED count or brightness
- Check Serial Monitor for stack traces
- Reflash firmware (may be corrupted)

### USB Connection Issues (ESP32-S3)

**Symptoms:**
- COM port not detected
- Electron app can't find device

**Solutions:**
- Install CP2102 or CH340 drivers
- Use "USB CDC" in PlatformIO
- Check Device Manager (Windows)
- Try different USB cable
- Enable USB in device firmware

### Phantom Laps

**Symptoms:**
- Multiple laps triggered for one pass
- Laps without flying

**Solutions:**
- Raise Exit RSSI threshold
- Increase Minimum Lap Time
- Check for RF interference (move away from electronics)
- Recalibrate thresholds
- Shield RX5808 with metal enclosure

### Missed Laps

**Symptoms:**
- Fly through gate, no lap counted
- Inconsistent detection

**Solutions:**
- Lower Enter RSSI threshold
- Wait for VTx warm-up (30 seconds)
- Check antenna connected to RX5808
- Verify frequency match
- Move timer closer to flight path
- Increase transmission power on VTx

---

## Advanced Modifications

### External Amplifier for Buzzer

For louder races:

**Circuit:**
```
GPIO8 → NPN Transistor (2N2222) → Piezo Buzzer (12V)
         ↓ (Base)                    ↑
         10kΩ to GND              Power Supply
```

### High-Power LED Driver

For 100+ LED strips:

- Use external 5V 10A supply
- Level shifter for data (3.3V → 5V)
- Power inject every 50 LEDs
- Add 1000μF capacitor per injection point

### Battery Monitoring Circuit

Voltage divider for 2S-3S LiPo:

```
Battery+ ─┬─ 10kΩ ─┬─ GPIO1
          │        │
         GND     10kΩ
                  │
                 GND
```

**Calculation:**
- 2S LiPo = 8.4V max
- Divider ratio: 1/2 (10kΩ + 10kΩ)
- GPIO1 sees: 4.2V max
-  Exceeds 3.3V safe limit!

**Correct Divider (3S safe):**
```
Battery+ ─┬─ 22kΩ ─┬─ GPIO1
          │        │
         GND     10kΩ
                  │
                 GND
```

- 3S LiPo = 12.6V max
- Divider ratio: 10/(10+22) = 0.3125
- GPIO1 sees: 12.6V × 0.3125 = 3.94V (still too high!)

**Safe 3S Divider:**
```
Battery+ ─┬─ 33kΩ ─┬─ GPIO1
          │        │
         GND     10kΩ
                  │
                 GND
```

- Ratio: 10/(10+33) = 0.23
- GPIO1 sees: 12.6V × 0.23 = 2.9V 

---

## Next Steps

 **Hardware complete**   
 **[User Guide](USER_GUIDE.md)** - Learn to use all features  
 **[Features Guide](FEATURES.md)** - Deep dive into capabilities  
 **[Development Guide](DEVELOPMENT.md)** - Contribute to project

---

**Questions? [GitHub Discussions](https://github.com/LouisHitchcock/FPVGate/discussions) | [Report Issues](https://github.com/LouisHitchcock/FPVGate/issues)**
