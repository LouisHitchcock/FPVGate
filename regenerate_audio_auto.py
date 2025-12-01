#!/usr/bin/env python3
"""Auto-run version - regenerates all audio files without prompts"""

import os
import sys
from pathlib import Path
from typing import Dict
from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs

OUTPUT_DIR = Path("data/sounds")
PILOT_NAME = "Louis"
PHONETIC_NAME = "Louie"
VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'
VOICE_NAME = 'Sarah (Energetic Female)'

VOICE_SETTINGS = VoiceSettings(
    stability=0.5,
    similarity_boost=0.75,
    style=0.0,
    use_speaker_boost=True
)

TOP_NAMES = [
    "Alex", "Andrew", "Ben", "Brandon", "Brian", "Carlos", "Chad", "Chris", 
    "Daniel", "Dave", "David", "Derek", "Eric", "Evan", "Frank", "George",
    "Jack", "James", "Jason", "Jeff", "John", "Jordan", "Josh", "Justin",
    "Kevin", "Kyle", "Lucas", "Mark", "Matt", "Michael", "Mike", "Nick",
    "Patrick", "Paul", "Peter", "Rob", "Ryan", "Sam", "Scott", "Sean",
    "Steve", "Thomas", "Tim", "Tom", "Tony", "Tyler", "Will", "Zach",
    "Emma", "Sarah"
]

def get_phrases_to_generate() -> Dict[str, str]:
    phrases = {
        "arm_your_quad.mp3": "Arm your quad",
        "starting_tone.mp3": "Starting on the tone in less than five",
        "race_complete.mp3": "Race complete",
        "race_stopped.mp3": "Race stopped",
        "gate_1.mp3": "Gate 1",
        f"test_sound_{PILOT_NAME.lower()}.mp3": f"Testing sound for pilot {PHONETIC_NAME}",
        "lap.mp3": "Lap",
        "laps.mp3": "laps",
        "two_laps.mp3": "2 laps",
        "three_laps.mp3": "3 laps",
        f"{PILOT_NAME.lower()}_lap.mp3": f"{PHONETIC_NAME} lap",
        f"{PILOT_NAME.lower()}_2laps.mp3": f"{PHONETIC_NAME} 2 laps",
        f"{PILOT_NAME.lower()}_3laps.mp3": f"{PHONETIC_NAME} 3 laps",
        **{f"num_{i}.mp3": str(i) for i in range(100)},
        "point.mp3": "point",
        **{f"lap_{i}.mp3": f"Lap {i}" for i in range(1, 51)},
        **{f"{name.lower()}_lap.mp3": f"{name} lap" for name in TOP_NAMES},
    }
    return phrases

api_key = os.getenv("ELEVENLABS_API_KEY")
if not api_key:
    print("ERROR: ELEVENLABS_API_KEY not set")
    sys.exit(1)

print(f"\n{'='*60}")
print("Regenerating Audio Files")
print(f"{'='*60}\n")

# Clean
if OUTPUT_DIR.exists():
    count = 0
    for file in OUTPUT_DIR.glob("*.mp3"):
        file.unlink()
        count += 1
    print(f"Deleted {count} existing files")
else:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Generate
client = ElevenLabs(api_key=api_key)
phrases = get_phrases_to_generate()
total = len(phrases)
success = 0
error = 0

print(f"\nGenerating {total} files with {VOICE_NAME}\n")

for i, (filename, text) in enumerate(phrases.items(), 1):
    output_path = OUTPUT_DIR / filename
    try:
        print(f"[{i}/{total}] {filename}")
        audio = client.text_to_speech.convert(
            voice_id=VOICE_ID,
            optimize_streaming_latency="0",
            output_format="mp3_44100_128",
            text=text,
            model_id="eleven_turbo_v2_5",
            voice_settings=VOICE_SETTINGS,
        )
        with open(output_path, "wb") as f:
            for chunk in audio:
                if chunk:
                    f.write(chunk)
        success += 1
    except Exception as e:
        print(f"   ERROR: {e}")
        error += 1

total_size = sum(f.stat().st_size for f in OUTPUT_DIR.glob("*.mp3"))
print(f"\n{'='*60}")
print(f"Success: {success}/{total}")
if error > 0:
    print(f"Errors: {error}")
print(f"Total: {total_size / 1024 / 1024:.2f} MB")
print(f"{'='*60}\n")
