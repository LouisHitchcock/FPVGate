#!/usr/bin/env python3
"""
FPVGate Voice File Generator using ElevenLabs API

This script generates all necessary audio files for FPVGate's voice announcements
using ElevenLabs' high-quality neural TTS.

Requirements:
    pip install elevenlabs python-dotenv

Setup:
    1. Sign up for ElevenLabs: https://elevenlabs.io/
    2. Get your API key from: https://elevenlabs.io/app/settings/api-keys
    3. Create a .env file with: ELEVENLABS_API_KEY=your_key_here
    4. Run: python generate_voice_files.py

The free tier gives you 10,000 characters/month which is plenty for this!
"""

import os
import sys
from pathlib import Path
from typing import List, Dict
from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs

# Configuration
OUTPUT_DIR = Path("data/sounds")
PILOT_NAME = "Louis"  # Change this to your name for personalized files
PHONETIC_NAME = "Louie"  # How you want it pronounced

# Voice options - select one below or use VOICE_ID directly
VOICES = {
    'default': {  # Sarah - Energetic female
        'id': 'EXAVITQu4vr4xnSDxMaL',
        'name': 'Sarah (Energetic Female)'
    },
    'rachel': {  # Rachel - Calm female
        'id': '21m00Tcm4TlvDq8ikWAM',
        'name': 'Rachel (Calm Female)'
    },
    'adam': {  # Adam - Deep male
        'id': 'pNInz6obpgDQGcFmaJgB',
        'name': 'Adam (Deep Male)'
    },
    'antoni': {  # Antoni - Well-rounded male
        'id': 'ErXwobaYiN019PkySvjV',
        'name': 'Antoni (Male)'
    },
    'matilda': {  # Matilda - Warm female
        'id': 'ZF6FPAbjXT4488VcRRnw',
        'name': 'Matilda (Warm Female)'
    }
}

# Select voice - change 'default' to 'rachel', 'adam', 'antoni', or 'matilda'
SELECTED_VOICE = 'matilda'
VOICE_ID = VOICES[SELECTED_VOICE]['id']

VOICE_SETTINGS = VoiceSettings(
    stability=0.5,        # Lower = more expressive, Higher = more stable
    similarity_boost=0.75, # How close to the original voice
    style=0.0,            # Style exaggeration (0 to 1)
    use_speaker_boost=True
)

# Top 50 most common FPV pilot names (first names)
TOP_NAMES = [
    "Alex", "Andrew", "Ben", "Brandon", "Brian", "Carlos", "Chad", "Chris", 
    "Daniel", "Dave", "David", "Derek", "Eric", "Evan", "Frank", "George",
    "Jack", "James", "Jason", "Jeff", "John", "Jordan", "Josh", "Justin",
    "Kevin", "Kyle", "Lucas", "Mark", "Matt", "Michael", "Mike", "Nick",
    "Patrick", "Paul", "Peter", "Rob", "Ryan", "Sam", "Scott", "Sean",
    "Steve", "Thomas", "Tim", "Tom", "Tony", "Tyler", "Will", "Zach",
    "Emma", "Sarah"  # Including some common female names
]

def get_language_profile(language: str = "en") -> Dict[str, str]:
    """Return localized phrases for a given language code."""
    profiles = {
        "en": {
            "arm_your_quad": "Arm your quad",
            "starting_tone": "Starting on the tone in less than five",
            "race_complete": "Race complete",
            "race_stopped": "Race stopped",
            "gate_1": "Gate 1",
            "lap": "Lap",
            "laps": "laps",
            "two_laps": "2 laps",
            "three_laps": "3 laps",
            "point": "point",
            "test_sound": "Testing sound for pilot",
            "name_prefix": "",
            "name_suffix_lap": " lap",
            "name_suffix_2laps": " 2 laps",
            "name_suffix_3laps": " 3 laps",
        },
        "fr": {
            "arm_your_quad": "Préparez votre quad",
            "starting_tone": "Départ au signal dans moins de cinq",
            "race_complete": "Course terminée",
            "race_stopped": "Course arrêtée",
            "gate_1": "Porte 1",
            "lap": "Tour",
            "laps": "tours",
            "two_laps": "2 tours",
            "three_laps": "3 tours",
            "point": "virgule",
            "test_sound": "Test du son pour le pilote",
            "name_prefix": "",
            "name_suffix_lap": " tour",
            "name_suffix_2laps": " 2 tours",
            "name_suffix_3laps": " 3 tours",
        },
        "es": {
            "arm_your_quad": "Arma tu quad",
            "starting_tone": "Salida al tono en menos de cinco",
            "race_complete": "Carrera completada",
            "race_stopped": "Carrera detenida",
            "gate_1": "Puerta 1",
            "lap": "Vuelta",
            "laps": "vueltas",
            "two_laps": "2 vueltas",
            "three_laps": "3 vueltas",
            "point": "punto",
            "test_sound": "Probando sonido para el piloto",
            "name_prefix": "",
            "name_suffix_lap": " vuelta",
            "name_suffix_2laps": " 2 vueltas",
            "name_suffix_3laps": " 3 vueltas",
        },
        "de": {
            "arm_your_quad": "Bewaffne deinen Quad",
            "starting_tone": "Start beim Ton in weniger als fünf",
            "race_complete": "Rennen abgeschlossen",
            "race_stopped": "Rennen gestoppt",
            "gate_1": "Tor 1",
            "lap": "Runde",
            "laps": "Runden",
            "two_laps": "2 Runden",
            "three_laps": "3 Runden",
            "point": "Komma",
            "test_sound": "Tonprüfung für Piloten",
            "name_prefix": "",
            "name_suffix_lap": " runde",
            "name_suffix_2laps": " 2 runden",
            "name_suffix_3laps": " 3 runden",
        },
    }
    return profiles.get(language, profiles["en"])


def get_phrases_to_generate(language: str = "en") -> Dict[str, str]:
    """Returns all phrases that need to be generated as {filename: text}"""
    profile = get_language_profile(language)

    phrases = {
        # Race control phrases
        "arm_your_quad.mp3": profile["arm_your_quad"],
        "starting_tone.mp3": profile["starting_tone"],
        "race_complete.mp3": profile["race_complete"],
        "race_stopped.mp3": profile["race_stopped"],
        "gate_1.mp3": profile["gate_1"],
        
        # Test voice phrase
        f"test_sound_{PILOT_NAME.lower()}.mp3": f"{profile['test_sound']} {PHONETIC_NAME}",
        
        # Lap phrases
        "lap.mp3": profile["lap"],
        "laps.mp3": profile["laps"],
        "two_laps.mp3": profile["two_laps"],
        "three_laps.mp3": profile["three_laps"],
        
        # Your personal pilot name (using phonetic pronunciation)
        f"{PILOT_NAME.lower()}_lap.mp3": f"{PHONETIC_NAME}{profile['name_suffix_lap']}",
        f"{PILOT_NAME.lower()}_2laps.mp3": f"{PHONETIC_NAME}{profile['name_suffix_2laps']}",
        f"{PILOT_NAME.lower()}_3laps.mp3": f"{PHONETIC_NAME}{profile['name_suffix_3laps']}",
        
        # Numbers 0-99 (for natural time announcements)
        **{f"num_{i}.mp3": str(i) for i in range(100)},
        
        # Punctuation
        "point.mp3": profile["point"],
        
        # Ordinal numbers for laps 1-50
        **{f"lap_{i}.mp3": f"{profile['lap']} {i}" for i in range(1, 51)},
        
        # Top 50 common pilot names (for multi-pilot support)
        **{f"{name.lower()}_lap.mp3": f"{name}{profile['name_suffix_lap']}" for name in TOP_NAMES},
    }
    
    return phrases


def generate_audio_files(api_key: str, language: str = "en", output_dir: Path | None = None):
    """Generate all audio files using ElevenLabs API"""
    
    # Initialize client
    client = ElevenLabs(api_key=api_key)
    
    voice_dir_base = output_dir or OUTPUT_DIR
    voice_dir = voice_dir_base / f"sounds_{SELECTED_VOICE}"
    voice_dir.mkdir(parents=True, exist_ok=True)
    
    # Get all phrases to generate
    phrases = get_phrases_to_generate(language)
    
    total = len(phrases)
    voice_name = VOICES[SELECTED_VOICE]['name']
    print(f"\n🎤 Generating {total} audio files with ElevenLabs...")
    print(f"   Voice: {voice_name} ({VOICE_ID})")
    print(f"   Language: {language}")
    print(f"   Output: {voice_dir}\n")
