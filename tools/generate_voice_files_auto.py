#!/usr/bin/env python3
"""
FPVGate Voice File Generator - Auto-run version
This version skips the confirmation prompt for scripted runs
"""

import os
from generate_voice_files import generate_audio_files, VOICES, SELECTED_VOICE, PILOT_NAME, PHONETIC_NAME, TOP_NAMES

def main():
    """Main entry point - auto-run without confirmation"""
    
    print("\n" + "="*60)
    print("FPVGate Voice File Generator (Auto-run)")
    print("="*60)
    
    # Check for API key
    api_key = os.getenv("ELEVENLABS_API_KEY")
    
    if not api_key:
        print("\nERROR: ELEVENLABS_API_KEY not found\n")
        print("Set environment variable:")
        print("   Windows (PowerShell): $env:ELEVENLABS_API_KEY='your_key_here'")
        return 1
    
    print(f"\nAPI key found: {api_key[:8]}...{api_key[-4:]}")
    print(f"Personal pilot name: {PILOT_NAME} (pronounced: {PHONETIC_NAME})")
    print(f"Selected voice: {VOICES[SELECTED_VOICE]['name']}")
    print(f"Generating audio for {len(TOP_NAMES)} common pilot names")
    print("Generating numbers 0-99 for natural time announcements")
    
    try:
        generate_audio_files(api_key)
        print("\nDone. Audio files are ready.")
        print("\nNext steps:")
        print("1. Review the generated files in SD_Card/voice_<voice>_en/")
        print("2. Copy the desired voice folder to your SD card")
        print("3. Test the voice system in FPVGate")
        return 0
        
    except Exception as e:
        print(f"\nError: {e}")
        return 1

if __name__ == "__main__":
    exit(main())
