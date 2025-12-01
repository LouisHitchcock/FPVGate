#!/usr/bin/env python3
"""
Clean and regenerate all FPVGate audio files with compression

This script:
1. Deletes all existing audio files
2. Regenerates them using a single consistent ElevenLabs voice
3. Compresses them to reduce filesystem size
"""

import os
import sys
import shutil
from pathlib import Path
from typing import Dict
from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs

# Configuration
OUTPUT_DIR = Path("data/sounds")
PILOT_NAME = "Louis"  # Change this to your name
PHONETIC_NAME = "Louie"  # How you want it pronounced

# Use Sarah voice (default) for consistency
VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'  # Sarah - Energetic female
VOICE_NAME = 'Sarah (Energetic Female)'

VOICE_SETTINGS = VoiceSettings(
    stability=0.5,
    similarity_boost=0.75,
    style=0.0,
    use_speaker_boost=True
)

# Top 50 most common FPV pilot names
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
    """Returns all phrases that need to be generated as {filename: text}"""
    
    phrases = {
        # Race control phrases
        "arm_your_quad.mp3": "Arm your quad",
        "starting_tone.mp3": "Starting on the tone in less than five",
        "race_complete.mp3": "Race complete",
        "race_stopped.mp3": "Race stopped",
        "gate_1.mp3": "Gate 1",
        
        # Test voice phrase
        f"test_sound_{PILOT_NAME.lower()}.mp3": f"Testing sound for pilot {PHONETIC_NAME}",
        
        # Lap phrases
        "lap.mp3": "Lap",
        "laps.mp3": "laps",
        "two_laps.mp3": "2 laps",
        "three_laps.mp3": "3 laps",
        
        # Your personal pilot name
        f"{PILOT_NAME.lower()}_lap.mp3": f"{PHONETIC_NAME} lap",
        f"{PILOT_NAME.lower()}_2laps.mp3": f"{PHONETIC_NAME} 2 laps",
        f"{PILOT_NAME.lower()}_3laps.mp3": f"{PHONETIC_NAME} 3 laps",
        
        # Numbers 0-99
        **{f"num_{i}.mp3": str(i) for i in range(100)},
        
        # Punctuation
        "point.mp3": "point",
        
        # Ordinal numbers for laps 1-50
        **{f"lap_{i}.mp3": f"Lap {i}" for i in range(1, 51)},
        
        # Top 50 common pilot names
        **{f"{name.lower()}_lap.mp3": f"{name} lap" for name in TOP_NAMES},
    }
    
    return phrases


def clean_audio_directory():
    """Delete all existing audio files"""
    if OUTPUT_DIR.exists():
        print(f"\n🗑️  Cleaning existing audio files in {OUTPUT_DIR}...")
        count = 0
        for file in OUTPUT_DIR.glob("*.mp3"):
            file.unlink()
            count += 1
        print(f"   Deleted {count} existing audio files")
    else:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        print(f"\n📁 Created new directory: {OUTPUT_DIR}")


def generate_audio_files(api_key: str):
    """Generate all audio files using ElevenLabs API with compression"""
    
    # Initialize client
    client = ElevenLabs(api_key=api_key)
    
    # Get all phrases to generate
    phrases = get_phrases_to_generate()
    
    total = len(phrases)
    print(f"\n🎤 Generating {total} audio files with ElevenLabs...")
    print(f"   Voice: {VOICE_NAME} ({VOICE_ID})")
    print(f"   Format: MP3 @ 44.1kHz, 128kbps (compressed)")
    print(f"   Output: {OUTPUT_DIR}\n")
    
    success_count = 0
    error_count = 0
    
    for i, (filename, text) in enumerate(phrases.items(), 1):
        output_path = OUTPUT_DIR / filename
        
        try:
            print(f"[{i}/{total}] 🔊 Generating: {filename} -> \"{text}\"")
            
            # Generate audio with compression settings
            audio_generator = client.text_to_speech.convert(
                voice_id=VOICE_ID,
                optimize_streaming_latency="0",
                output_format="mp3_44100_128",  # MP3, 44.1kHz, 128kbps - good quality, small size
                text=text,
                model_id="eleven_turbo_v2_5",  # Fast and high quality
                voice_settings=VOICE_SETTINGS,
            )
            
            # Save to file
            with open(output_path, "wb") as f:
                for chunk in audio_generator:
                    if chunk:
                        f.write(chunk)
            
            size_kb = output_path.stat().st_size / 1024
            print(f"          ✅ Success: {size_kb:.1f}KB")
            success_count += 1
            
        except Exception as e:
            print(f"          ❌ Error: {e}")
            error_count += 1
    
    # Summary
    print(f"\n{'='*60}")
    print(f"✅ Successfully generated: {success_count}/{total}")
    if error_count > 0:
        print(f"❌ Errors: {error_count}")
    
    total_size = sum(f.stat().st_size for f in OUTPUT_DIR.glob("*.mp3"))
    total_mb = total_size / 1024 / 1024
    print(f"📦 Total size: {total_mb:.2f} MB")
    print(f"📁 Location: {OUTPUT_DIR.absolute()}")
    print(f"{'='*60}\n")
    
    # Estimate character usage
    total_chars = sum(len(text) for text in phrases.values())
    print(f"📊 ElevenLabs API Usage:")
    print(f"   Characters used: ~{total_chars:,}")
    print(f"   Free tier limit: 10,000/month")
    if total_chars > 10000:
        print(f"   ⚠️  WARNING: Exceeds free tier by {total_chars - 10000:,} characters")
    else:
        print(f"   Remaining: ~{10000 - total_chars:,}")
    print()


def main():
    """Main entry point"""
    
    print("\n" + "="*60)
    print("🎤 FPVGate Audio Regeneration Tool")
    print("="*60)
    
    # Check for API key
    api_key = os.getenv("ELEVENLABS_API_KEY")
    
    if not api_key:
        print("\n❌ ERROR: ELEVENLABS_API_KEY not found!\n")
        print("Setup instructions:")
        print("1. Sign up at: https://elevenlabs.io/")
        print("2. Get API key at: https://elevenlabs.io/app/settings/api-keys")
        print("3. Set environment variable:")
        print("   PowerShell: $env:ELEVENLABS_API_KEY='your_key_here'")
        print("\n   OR create a .env file with:")
        print("   ELEVENLABS_API_KEY=your_key_here")
        print()
        sys.exit(1)
    
    print(f"\n✅ API key found: {api_key[:8]}...{api_key[-4:]}")
    print(f"📝 Personal pilot name: {PILOT_NAME} (pronounced: {PHONETIC_NAME})")
    print(f"🎙️ Voice: {VOICE_NAME}")
    print(f"👥 Generating audio for {len(TOP_NAMES)} common pilot names")
    
    # Warn about deletion
    if OUTPUT_DIR.exists() and any(OUTPUT_DIR.glob("*.mp3")):
        existing_count = len(list(OUTPUT_DIR.glob("*.mp3")))
        print(f"\n⚠️  WARNING: This will delete {existing_count} existing audio files!")
    
    # Confirm before proceeding
    response = input("\n🚀 Continue? (y/n): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return
    
    try:
        # Clean existing files
        clean_audio_directory()
        
        # Generate new files
        generate_audio_files(api_key)
        
        print("✅ Done! Your audio files are ready to use.")
        print("\nNext steps:")
        print("1. Review the audio files in data/sounds/")
        print("2. Upload filesystem to ESP32: pio run -e ESP32S3 -t uploadfs")
        print("3. Test the new voice system in FPVGate!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()  # Load .env file if exists
    except ImportError:
        pass  # dotenv is optional
    
    main()
