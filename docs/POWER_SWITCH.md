# Physical Power Toggle Switch (Deep Sleep)

## Overview

This optional feature adds a physical ON/OFF slide switch to the Waveshare ESP32-S3-Touch-LCD-2 that puts the device into deep sleep mode, giving you a "real power switch" experience without cutting battery power or breaking the charge circuit.

## Features

- **Physical ON/OFF switch** - Instant tactile control
- **Deep sleep mode** - Device draws ~100-300µA when OFF (vs ~80-150mA when ON)
- **Instant wake** - Flip switch back to ON, device boots immediately
- **No power cut** - Charging and battery management still work when "OFF"
- **Graceful shutdown** - Config is saved before entering sleep
- **Works with USB power** - If you plug in USB while switch is OFF, firmware immediately goes back to sleep (no screen flicker)

## Hardware Requirements

### Components

- 1× **3-pin SPDT slide switch** (standard small slide switch, like SS12D00G3)
- 1× **100nF ceramic capacitor** (optional but recommended for debounce)
- Wire (22-26 AWG)

### Wiring Diagram

```
Waveshare ESP32-S3-LCD-2 Header:

GPIO7 (middle header pin) ───┐
                              │
                         ┌────┴────┐
                         │  SPDT   │  Slide Switch
                         │  SWITCH │  (3 pins)
                         └─┬─────┬─┘
                           │     │
                     GND ──┘     └── NC (not connected)
                           
Optional debounce:
GPIO7 ──┤├── GND  (100nF capacitor, close to ESP32)
```

### Switch Position Logic

- **ON position**: GPIO7 is floating → internal pullup makes it HIGH → device runs normally
- **OFF position**: GPIO7 is connected to GND → reads LOW → device enters deep sleep

### Why GPIO7?

- GPIO7 is available on the header (not used by LCD, SD, or RX5808)
- GPIO7 is RTC-capable on ESP32-S3 (supports wake from deep sleep)
- GPIO7 is in the safe range (GPIO0-GPIO21) for wake sources

## Firmware Setup

### Step 1: Enable the Feature

When building the firmware, add the build flag `-DENABLE_POWER_SWITCH` to your `platformio.ini`:

```ini
[env:WaveshareESP32S3LCD2]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino

build_flags = 
    -DWAVESHARE_ESP32S3_LCD2
    -DBOARD_ESP32_S3_TOUCH
    -DENABLE_LCD_UI=1
    -DENABLE_POWER_SWITCH    ; <-- Add this line
    ; ... other flags ...

; ... rest of config ...
```

### Step 2: Build and Upload

```bash
pio run -e WaveshareESP32S3LCD2 -t upload
```

### Step 3: Install the Switch

1. Wire the switch as shown in the diagram above
2. Mount the switch in an accessible location on your device enclosure
3. Optional: Add a 100nF capacitor from GPIO7 to GND for noise filtering

## Expected Behavior

### Boot Sequence

1. **Switch ON at power-up**:
   - Device boots normally
   - LCD backlight turns on
   - Serial output: `[PowerManager] Switch state: ON`
   - Application starts

2. **Switch OFF at power-up**:
   - Serial output: `[PowerManager] Switch is OFF - will enter deep sleep`
   - LCD backlight turns off immediately
   - Device enters deep sleep (~100-300µA)
   - No boot process occurs

### During Operation

1. **Flip switch from ON to OFF**:
   - Serial output: `[PowerManager] Switch OFF detected - debouncing...`
   - After 200ms: `[PowerManager] Switch confirmed OFF - initiating shutdown`
   - Config is saved
   - LCD backlight turns off
   - Device enters deep sleep

2. **Flip switch from OFF to ON** (while in deep sleep):
   - GPIO7 goes HIGH (wake source triggers)
   - ESP32 wakes from deep sleep (effectively a reboot)
   - Device boots normally as if powered on

### USB Power Behavior

If you connect USB power while the switch is in the OFF position:

1. Device powers up briefly
2. Firmware detects switch is OFF (within ~10ms)
3. Immediately enters deep sleep (before LCD turns on)
4. Appears "off" to the user

## Power Draw Measurements

Typical current draw (at 3.7V LiPo):

| State | Current Draw | Power |
|-------|--------------|-------|
| **Running (LCD on)** | ~150mA | ~0.5W |
| **Running (LCD dimmed)** | ~80mA | ~0.3W |
| **Deep Sleep (switch OFF)** | ~100-300µA | ~0.0004-0.001W |

**Battery life example** (with 1000mAh LiPo):
- Running: ~6-7 hours
- Deep sleep: ~4-10 months (board leakage dependent)

Note: Deep sleep does NOT achieve "zero drain" because:
- Board voltage regulator has quiescent current (~10-50µA)
- Battery charger IC draws some current (~50-100µA)
- ESP32 deep sleep current (~10-20µA)

For true "shelf storage" (months to years), disconnect the battery.

## Troubleshooting

### Device won't wake from sleep

- **Check wiring**: Ensure GPIO7 is connected to the switch middle pin
- **Check switch**: Use multimeter to verify OFF connects GPIO7 to GND, ON leaves it floating
- **Check GPIO7**: Measure voltage - should be ~3.3V when ON, ~0V when OFF

### Device sleeps immediately when booting

- **Switch is in OFF position**: Flip switch to ON
- **Wiring reversed**: Check that GND is connected to the "OFF" position outer pin
- **GPIO7 is shorted to GND**: Disconnect switch and verify GPIO7 reads HIGH (3.3V) when floating

### Device doesn't sleep when switch is OFF

- **Feature not enabled**: Verify `-DENABLE_POWER_SWITCH` build flag is set
- **Wrong board**: Feature only works on Waveshare ESP32-S3-LCD-2 with LCD enabled
- **Wiring issue**: Verify switch pulls GPIO7 to GND when in OFF position

### Switch is too sensitive / bounces

- Add a 100nF capacitor from GPIO7 to GND
- Increase debounce time in `lib/POWER/power.h` (change `DEBOUNCE_MS` from 200 to 500)

### Serial output shows warnings

If you see: `[PowerManager] WARNING: Deep sleep power switch not supported on this platform`

- This means you're not building for an ESP32-S3 board
- Feature only works on ESP32-S3, ESP32-S3 SuperMini, LilyGO T-Energy S3, or Waveshare ESP32-S3-LCD-2

## Advanced Configuration

### Change Debounce Time

Edit `lib/POWER/power.h`:

```cpp
static const uint32_t DEBOUNCE_MS = 200;  // Change to 500 for less sensitivity
```

### Change Check Interval

Edit `lib/POWER/power.h`:

```cpp
static const uint32_t CHECK_INTERVAL_MS = 100;  // Check switch every 100ms
```

### Add Wake Timer (Auto-Wake)

If you want the device to wake automatically after a certain time (e.g. for periodic checks), edit `lib/POWER/power.cpp`:

```cpp
void PowerManager::enterDeepSleep() {
    // ... existing code ...
    
    // Add timer wake source (e.g. wake after 1 hour)
    esp_sleep_enable_timer_wakeup(3600ULL * 1000000ULL);  // 3600 seconds in microseconds
    
    // ... rest of code ...
}
```

## Design Notes

### Why Not Cut Battery Power?

Cutting battery power requires:
- MOSFET or load switch IC between battery and board
- More complex wiring
- Breaks charge circuit (can't charge while "off")
- Higher current when OFF (MOSFET leakage + pulldowns)

Deep sleep approach:
- No extra components besides switch
- Charge circuit works when "off"
- Lower current than MOSFET approach
- Firmware-controlled (can add auto-wake, logging, etc.)

### Why GPIO7?

GPIO7 was chosen because:
- Available on header (not used by onboard peripherals)
- RTC domain GPIO (supports wake from deep sleep)
- No strapping pin conflicts
- Safe for pull-up (won't affect boot mode)

Other suitable alternatives: GPIO8, GPIO9 (but GPIO9 is already used for mode switch)

## References

- [ESP32-S3 Deep Sleep Documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/system/sleep_modes.html)
- [Waveshare ESP32-S3-LCD-2 Wiki](https://www.waveshare.com/wiki/ESP32-S3-LCD-2)
- FPVGate Power Management Library: `lib/POWER/`
