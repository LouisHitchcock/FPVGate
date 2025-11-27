# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

PhobosLT is an FPV lap timing system for 5.8GHz FPV drones. It's an ESP32-based device that measures lap times by detecting RSSI peaks from drone video transmitters. The system creates a WiFi access point and serves a web interface for configuration and race management.

## Development Commands

### Build
```bash
# Build for default target (ESP32-DevKit)
pio run -e PhobosLT

# Build for specific targets
pio run -e ESP32C3
pio run -e ESP32S3
pio run -e LicardoTimerC3
pio run -e LicardoTimerS3
```

### Flash Firmware
```bash
# Flash firmware (Step 1 - always required)
pio run -e PhobosLT -t upload

# Flash filesystem image (Step 2 - required after data/ changes)
pio run -e PhobosLT -t uploadfs
```

### Development
```bash
# Clean build
pio run -e PhobosLT -t clean

# Monitor serial output
pio device monitor -b 460800
```

## Architecture

### Core System Design

PhobosLT uses a dual-core ESP32 architecture with task separation:

**Core 1 (main loop)**: Handles timing-critical lap detection via RSSI monitoring
- `LapTimer::handleLapTimerUpdate()` runs continuously in `loop()`
- Reads RSSI from RX5808 module
- Applies Kalman filtering for noise reduction
- Detects peaks using Enter/Exit RSSI thresholds

**Core 0 (parallel task)**: Handles non-critical peripherals and communications
- `parallelTask()` manages Buzzer, LED, WebServer, Config persistence, Frequency changes, Battery monitoring
- Runs with WDT disabled for stable operation

### Key Components

**RX5808** (`lib/RX5808/`): Controls the 5.8GHz video receiver module
- Uses SPI-modified RX5808 to tune frequencies and read RSSI
- Undervolted to 3.3V for better RSSI resolution and cooling
- Pin configuration: RSSI (33), DATA/CH1 (19), SELECT/CH2 (22), CLOCK/CH3 (23)

**LapTimer** (`lib/LAPTIMER/`): Core timing logic
- Implements state machine: STOPPED → WAITING → RUNNING
- Uses Kalman filter for RSSI smoothing (Q=2000, R=40)
- Peak detection: captures highest RSSI between Enter and Exit thresholds
- Lap recorded when RSSI drops below Exit threshold after peak
- Maintains circular buffer of 10 lap times and 100 RSSI readings
- Minimum lap time prevents false positives from gate crashes

**Config** (`lib/CONFIG/`): Configuration management with EEPROM persistence
- Stores: frequency, min lap time, battery alarm, announcer settings, RSSI thresholds, pilot name, WiFi credentials
- Auto-saves changes every 1 second when modified
- Board-specific pin definitions using preprocessor flags (ESP32C3, ESP32S3, or default ESP32)

**Webserver** (`lib/WEBSERVER/`): WiFi and web interface
- Creates access point `PhobosLT_xxxx` with password `phoboslt` (default)
- Can connect to existing WiFi network (stored in config)
- Serves static files from LittleFS filesystem (`data/` directory)
- REST API for configuration and race control
- WebSocket (Server-Sent Events) for real-time RSSI graph and lap notifications
- Uses captive portal for easy initial connection
- Supports ElegantOTA for wireless firmware updates

**Kalman Filter** (`lib/KALMAN/`): RSSI signal processing
- Single-dimensional Kalman filter reduces RSSI noise
- Critical for accurate peak detection in noisy RF environments

### Data Flow

1. RX5808 reads analog RSSI from 5.8GHz receiver
2. Kalman filter smooths RSSI signal
3. LapTimer detects peaks using Enter/Exit thresholds
4. Lap times calculated as time between peaks (with minimum lap filter)
5. Webserver broadcasts lap times to connected clients via Server-Sent Events
6. Browser plays voice callouts using articulate.js

### Pin Configuration

Standard ESP32 pinout (see `lib/CONFIG/config.h` for ESP32-C3 and ESP32-S3 variants):
- RX5808: RSSI=33, DATA=19, SELECT=22, CLOCK=23
- LED: 21
- Buzzer: 27
- Battery voltage: 35 (with 1:2 voltage divider for 1S Li-Ion)

### Web Interface

Static files in `data/`:
- `index.html`: Single-page application with 3 views (Race, Configuration, Calibration)
- `script.js`: Client-side logic, REST calls, WebSocket handling
- `smoothie.js`: Real-time RSSI graphing
- `articulate.js`: Voice synthesis for lap callouts
- Must be uploaded to ESP32 filesystem using `uploadfs` task

### Build System

PlatformIO-based with target configurations in `targets/`:
- Multiple board profiles (PhobosLT, ESP32C3, ESP32S3, LicardoTimer variants)
- LittleFS filesystem for web assets
- Common dependencies: AsyncTCP, ESPAsyncWebServer, ArduinoJson, ElegantOTA
- Build flags control board-specific features (ESP32C3/ESP32S3 defines)

## Development Guidelines

### Hardware Testing
When testing timing accuracy, remember:
- VTx needs 30 seconds to reach operating temperature for stable RSSI
- RSSI thresholds must be recalibrated when flying with other pilots (adjacent channel interference)
- Enter RSSI should be set 2-5 points below peak RSSI at gate distance
- Exit RSSI should be 8-10 points below Enter RSSI

### Code Organization
- Library structure: Each component is self-contained in `lib/COMPONENTNAME/`
- Headers define interfaces, CPP files implement logic
- Main entry point (`src/main.cpp`) initializes all components and starts tasks
- No cross-dependencies between peripheral libraries (BATTERY, BUZZER, LED)

### Filesystem Changes
Always run `uploadfs` task after modifying files in `data/` directory to update the ESP32's LittleFS partition.

### WiFi Modes
System automatically switches between AP and STA modes:
- Starts in AP mode if no WiFi credentials stored
- Attempts STA connection if credentials exist
- Falls back to AP mode after 30s connection timeout
- Uses long-range WiFi protocol (WIFI_PROTOCOL_LR) for better outdoor range
