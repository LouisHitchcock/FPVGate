# FPVGate v1.1.0 - Natural Voice TTS System 🎤

Major update introducing natural-sounding voice announcements powered by ElevenLabs TTS, enhanced lap analysis, and improved UI/UX.

## ✨ What's New

### 🗣️ Natural Voice TTS System
- **ElevenLabs Integration**: Pre-recorded audio using ElevenLabs API (100% offline after generation)
- **Natural Number Pronunciation**: Times like "11.44" are spoken as "eleven point forty-four" instead of robotic digit-by-digit
- **Ultra-Fast Playback**: <50ms gaps between audio clips with 1.3x faster playback
- **4 Voice Options**: Choose between Sarah (energetic), Rachel (calm), Adam (male), or Antoni (male)
- **217 Audio Files**: Comprehensive coverage including numbers 0-99, lap numbers 1-50, race control phrases

### 📊 Enhanced Lap Analysis
- **Fastest 3 Consecutive Laps**: New stat for RaceGOW format (e.g., "36.78s" across "G1-L1-L2")
- **Gold Highlighting**: Fastest lap now stands out with gold background and glow effect
- **Redesigned Lap Table**: New columns show Lap Time, Gap from previous lap, and Total Race Time
- **Lap-Specific Stats**: Each stat now shows which lap achieved it (e.g., "Fastest Lap: 12.34s - Lap 5")

### ⚙️ Configuration Improvements
- **Configurable Announcements**: Choose between:
  - Full: "Louis Lap 5, 12.34"
  - Lap + Time: "Lap 5, 12.34"
  - Time Only: "12.34"
- **Voice Selection**: Switch between 4 different voice personalities
- **Gate 1 Terminology**: Replaced "Hole Shot" with "Gate 1" for clarity

## 🔧 Technical Improvements

- **Custom 8MB Partition Table**: Expanded filesystem to 3.94MB (from 1.5MB) to accommodate audio files
- **Increased Stack Size**: ESP32-S3 parallel task stack increased from 3KB to 8KB to prevent overflow
- **Hybrid TTS Fallback**: ElevenLabs (primary) → Piper TTS (secondary) → Web Speech API (fallback)
- **Audio Caching**: Map-based caching for instant replay of recently used clips
- **Early Audio Completion**: Optimized event detection resolves 50ms before audio ends

## 🐛 Bug Fixes

- Fixed race start sound playing when stopping race
- Fixed race start timing to wait for audio announcements to complete
- Removed all unwanted gaps between audio clips

## 📦 Audio Files (217 total, 2.3MB compressed)

- Numbers 0-99 (num_0.mp3 through num_99.mp3)
- Lap numbers 1-50 (lap_1.mp3 through lap_50.mp3)
- Race control phrases: arm_your_quad.mp3, starting_tone.mp3, gate_1.mp3, race_complete.mp3, race_stopped.mp3
- Pilot-specific: louie_lap.mp3, louie_2laps.mp3, louie_3laps.mp3, test_sound_louis.mp3

## 📖 Documentation

- **NEW**: `CHANGELOG.md` - Complete version history
- **NEW**: `VOICE_GENERATION_README.md` - Comprehensive guide for generating custom voice files
- **UPDATED**: `README.md` - Now highlights v1.1.0 features

## 🚀 Installation

1. Download `firmware.bin` from the Assets section below
2. Flash to your ESP32-S3 using your preferred method (ESPTool, web flasher, or OTA)
3. Connect to the **FPVGate** WiFi network
4. Navigate to **192.168.4.1** in your browser
5. Enjoy natural voice announcements!

## 🎓 Generating Custom Voice Files

Want to customize pilot names or add more voices? See `VOICE_GENERATION_README.md` for complete instructions.

**Quick Start:**
```bash
pip install -r requirements.txt
python generate_voice_files.py
```

## 📝 Full Changelog

See [CHANGELOG.md](https://github.com/LouisHitchcock/FPVGate/blob/main/CHANGELOG.md) for complete details.

---

**Note**: This release uses ~5,000 characters of ElevenLabs API (50% of free tier). Custom voices can be generated using your own API key.
