# Changelog

All notable changes to FPVGate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2025-12-01

### Added
- **System Self-Test Functionality**: Comprehensive diagnostics for hardware and software validation
  - Tests: RX5808 RSSI module, Lap Timer, Audio/Buzzer, Configuration, Race History, Web Server, OTA Updates, Storage (LittleFS), EEPROM, WiFi, Battery Monitor, RGB LED
  - Accessible via "System Diagnostics" section in Configuration page
  - Visual pass/fail indicators with test duration and detailed error messages
  - REST API endpoint `/api/selftest` for programmatic access
- **PiperTTS Integration**: Lower latency text-to-speech option
  - **Exclusive Mode**: When PiperTTS is selected, it's used exclusively for all announcements (no pre-recorded file attempts)
  - **Fallback Mode**: ElevenLabs voices now fall back to PiperTTS only when pre-recorded files fail
  - Added to Voice dropdown as "PiperTTS (Lower Latency)"
  - Automatic TTS engine selection based on voice choice
- **Enhanced LED Presets**:
  - Renamed "Custom Color" to "Solid Colour" and moved to position 1
  - **Color Pickers**: Added for Solid Colour, Color Fade, and Strobe presets
  - **New Preset**: "Pilot Colour" - uses pilot's color from Pilot Info section
  - **Slowed Effects**: Police (20x slower) and Strobe (15x slower), scaled by effect speed
  - Removed redundant presets: Red Pulse, Green Solid, Blue Pulse, White Solid
- **Enhanced Config Import/Export**: Now includes all frontend settings
  - Theme, Audio settings (format, voice, TTS engine)
  - Pilot settings (callsign, phonetic, color)
  - LED settings (preset, colors, speed, manual override)
  - Battery monitoring toggle state

### Changed
- **UI Organization**: Created dedicated "TTS Settings" section in Configuration page
  - Groups: Announcer Type, Lap Announcement Format, Voice, Announcer Rate, Voice Control buttons
  - Improved logical organization of audio-related settings
- **Voice Selection Logic**: Automatically sets TTS engine based on selected voice
  - PiperTTS voice → sets engine to 'piper'
  - ElevenLabs voices → sets engine to 'webspeech'
- **LED Preset Organization**: Reordered for better usability
  - Order: Off, Solid Colour, Rainbow, Color Fade, Fire, Ocean, Police, Strobe, Comet, Pilot Colour
- **Battery Monitoring**: Now unchecked by default

### Fixed
- **Audio Infinite Loop Bug**: Fixed recursive `speak()` calls when pilot-specific audio files weren't found
  - Changed to direct `useTtsFallback()` calls in `speakComplexWithPilot()` and `speakComplexLapTime()`
  - Prevents infinite recursion when custom pilot audio is missing
- **Voice Control Button Styling**: Removed opacity from disabled state for better visibility
- **Toggle Switch Stretching**: Fixed CSS selector to exclude toggle switches from min-width rule
- **Include Guards**: Added proper include guards to RX5808.h, kalman.h, and laptimer.h
  - Prevents redefinition errors during compilation
  - Enables modular header inclusion

### Removed
- **TTS Fallback Engine Dropdown**: Removed from UI (now automatically determined by voice selection)

### Technical
- **Memory Usage**: Flash: 54.3% (996,581 bytes), RAM: 16.7% (54,632 bytes)
- **New Test Infrastructure**: SelfTest class with 13 individual test methods
- **Forward Declarations**: Used in selftest.h to avoid circular dependencies
- **Filesystem**: 4,653,056 bytes (1,792,357 compressed) - includes updated UI and audio files

## [1.1.0] - 2025-11-28

### Added - Natural Voice TTS System
- **Hybrid TTS System** with three-tier fallback:
  - Primary: ElevenLabs pre-recorded audio (natural, high-quality)
  - Secondary: Piper TTS via WASM (good quality, offline)
  - Fallback: Web Speech API (browser default)
- **Natural Number Pronunciation**: Numbers 0-99 spoken naturally
  - "11.44" → "eleven point forty-four" (not "one one point four four")
  - Instant audio transitions with <50ms gaps between clips
- **Voice Generation Scripts**:
  - `generate_voice_files.py` - Main generator with ElevenLabs API
  - `generate_all_voices.py` - Generate all 4 voice options
  - Support for 4 voices: Sarah (energetic), Rachel (calm), Adam (male), Antoni (male)
- **Comprehensive Audio Library**:
  - 100 number files (0-99) for natural time announcements
  - Race control phrases (arm_your_quad, starting_tone, gate_1, race_complete)
  - Lap numbers 1-50 for "Lap X" announcements
  - Pilot-specific audio (pilot_lap.mp3, test_sound.mp3)
- **Optimized Audio Playback**:
  - 1.3x playback speed for faster announcements
  - Audio caching for instant replay
  - `preservesPitch = false` for better quality at higher speeds
  - Early audio completion detection (50ms before end)

### Added - UI/UX Improvements
- **Redesigned Lap Table**:
  - New columns: Lap No | Lap Time | Gap | Total Time
  - Gap column shows difference from previous lap (+0.23s or -0.15s)
  - Total Time shows cumulative race time
  - Data attributes for lap indexing
- **Fastest Lap Highlighting**:
  - Gold/orange highlight (#f39c12) on fastest lap row
  - Subtle glow effect for visual distinction
  - Dynamically updates as new laps are completed
  - Excludes Gate 1 from fastest lap calculation
- **Enhanced Lap Analysis Stats**:
  - **Fastest Lap**: Shows lap number (e.g., "Lap 5" or "Gate 1")
  - **Fastest 3 Consecutive**: NEW - RaceGOW format support (e.g., "G1-L1-L2")
  - **Best 3 Laps**: Sum of 3 fastest individual laps (non-consecutive)
  - **Median Lap**: Statistical middle lap time
- **Configurable Lap Announcement Formats**:
  - Full: "Louis Lap 5, 12.34"
  - Lap + Time: "Lap 5, 12.34"
  - Time Only: "12.34"
  - Saved to localStorage for persistence

### Changed
- **"Hole Shot" → "Gate 1"**: More intuitive terminology
- **Race Start Audio**: Fixed timing - beep now plays AFTER voice announcements complete
- **Stop Race**: Now clears audio queue to prevent race start sounds
- **Audio File Organization**: Custom 3.94MB filesystem partition for expanded storage
- **Partition Table**: Custom 8MB layout (2MB app0 + 2MB app1 + 3.94MB filesystem)

### Fixed
- **Race stop beep bug**: Removed unwanted start beep when stopping race
- **Audio gaps**: Eliminated 200ms pauses between audio clips
- **Queue processing**: Removed 100ms gaps between announcements
- **Fastest lap color**: Changed from primary theme color to gold for distinction
- **Lap time gaps**: Now calculated correctly (difference from previous lap, not total)

### Technical
- **Audio Caching**: Map-based caching system for instant audio replay
- **Smart Preloading**: `oncanplay` event for faster first-play
- **Filesystem**: Upgraded from 1.5MB to 3.94MB partition
- **Audio Files**: 217 total files, 3.1MB (2.3MB compressed on device)
- **API Usage**: ~5,000 characters of ElevenLabs API (50% of free tier)

### Documentation
- Added `VOICE_GENERATION_README.md` - Complete voice setup guide
- Added `CHANGELOG.md` - Version history tracking
- Updated README.md with v1.1.0 features

### Developer Experience
- Python scripts for voice generation with progress tracking
- Auto-save configuration for voice selection and lap format
- localStorage persistence for frontend-only settings
- Comprehensive console logging for audio debugging

## [1.0.0] - 2025-11-XX

### Initial Release
- Single-node RSSI-based lap timing
- ESP32-S3 support with RX5808 module
- RGB LED indicators (NeoPixel support)
- Web interface with 23 themes
- Basic voice announcements (Web Speech API)
- Real-time RSSI calibration graph
- Race history with lap analysis
- WiFi Access Point mode
- OTA firmware updates
- Battery monitoring with alarms
- Configurable lap count (finite/infinite)
- Pilot profiles with callsigns
- Manual lap entry
- Config import/export

---

## Version Numbering

FPVGate follows [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes or complete rewrites
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, minor improvements

[1.2.0]: https://github.com/LouisHitchcock/FPVGate/releases/tag/v1.2.0
[1.1.0]: https://github.com/LouisHitchcock/FPVGate/releases/tag/v1.1.0
[1.0.0]: https://github.com/LouisHitchcock/FPVGate/releases/tag/v1.0.0
