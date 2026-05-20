#!/usr/bin/env python3
"""
FPVGate voice file generator using ElevenLabs API.

This script generates announcement MP3s in canonical folder names:
- English voice variants: SD_Card/voice_<voice>_en
- French: SD_Card/voice_french_fr
- Spanish: SD_Card/voice_spanish_es
- German: SD_Card/voice_german_de
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Dict

from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT / "SD_Card"

PILOT_NAME = "Louis"
PHONETIC_NAME = "Louie"

VOICES = {
    "default": {
        "id": "EXAVITQu4vr4xnSDxMaL",
        "name": "Sarah (Energetic Female)",
    },
    "rachel": {
        "id": "21m00Tcm4TlvDq8ikWAM",
        "name": "Rachel (Calm Female)",
    },
    "adam": {
        "id": "pNInz6obpgDQGcFmaJgB",
        "name": "Adam (Deep Male)",
    },
    "antoni": {
        "id": "ErXwobaYiN019PkySvjV",
        "name": "Antoni (Male)",
    },
    "matilda": {
        "id": "ZF6FPAbjXT4488VcRRnw",
        "name": "Matilda (Warm Female)",
    },
}

LANGUAGE_FOLDER_MAP = {
    "fr": "voice_french_fr",
    "es": "voice_spanish_es",
    "de": "voice_german_de",
}

SELECTED_VOICE = "matilda"
VOICE_ID = VOICES[SELECTED_VOICE]["id"]

VOICE_SETTINGS = VoiceSettings(
    stability=0.5,
    similarity_boost=0.75,
    style=0.0,
    use_speaker_boost=True,
)

TOP_NAMES = [
    "Alex", "Andrew", "Ben", "Brandon", "Brian", "Carlos", "Chad", "Chris",
    "Daniel", "Dave", "David", "Derek", "Eric", "Evan", "Frank", "George",
    "Jack", "James", "Jason", "Jeff", "John", "Jordan", "Josh", "Justin",
    "Kevin", "Kyle", "Lucas", "Mark", "Matt", "Michael", "Mike", "Nick",
    "Patrick", "Paul", "Peter", "Rob", "Ryan", "Sam", "Scott", "Sean",
    "Steve", "Thomas", "Tim", "Tom", "Tony", "Tyler", "Will", "Zach",
    "Emma", "Sarah",
]

def number_to_words(number: int, language: str = "en") -> str:
    if number < 0 or number > 99:
        raise ValueError("number_to_words only supports 0-99")

    language = language.lower()

    if language == "en":
        units = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
        teens = {
            10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen", 14: "fourteen",
            15: "fifteen", 16: "sixteen", 17: "seventeen", 18: "eighteen", 19: "nineteen",
        }
        tens = {20: "twenty", 30: "thirty", 40: "forty", 50: "fifty", 60: "sixty", 70: "seventy", 80: "eighty", 90: "ninety"}

        if number < 10:
            return units[number]
        if number < 20:
            return teens[number]
        ten, unit = divmod(number, 10)
        return tens[ten * 10] if unit == 0 else f"{tens[ten * 10]}-{units[unit]}"

    if language == "fr":
        units = {
            0: "zéro", 1: "un", 2: "deux", 3: "trois", 4: "quatre",
            5: "cinq", 6: "six", 7: "sept", 8: "huit", 9: "neuf",
        }
        teens = {
            10: "dix", 11: "onze", 12: "douze", 13: "treize", 14: "quatorze",
            15: "quinze", 16: "seize", 17: "dix-sept", 18: "dix-huit", 19: "dix-neuf",
        }
        tens = {20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante"}

        if number < 10:
            return units[number]
        if number < 20:
            return teens[number]
        if number < 70:
            ten = (number // 10) * 10
            unit = number % 10
            if unit == 0:
                return tens[ten]
            if unit == 1:
                return f"{tens[ten]} et un"
            return f"{tens[ten]}-{units[unit]}"
        if number < 80:
            remainder = number - 60
            if remainder == 11:
                return "soixante et onze"
            return f"soixante-{teens[remainder]}"
        if number == 80:
            return "quatre-vingts"
        remainder = number - 80
        if remainder == 1:
            return "quatre-vingt-un"
        if remainder < 10:
            return f"quatre-vingt-{units[remainder]}"
        return f"quatre-vingt-{teens[remainder]}"

    if language == "es":
        units = {
            0: "cero", 1: "uno", 2: "dos", 3: "tres", 4: "cuatro",
            5: "cinco", 6: "seis", 7: "siete", 8: "ocho", 9: "nueve",
        }
        teens = {
            10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce",
            15: "quince", 16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
        }
        twenties = {
            20: "veinte", 21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro",
            25: "veinticinco", 26: "veintiséis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve",
        }
        tens = {30: "treinta", 40: "cuarenta", 50: "cincuenta", 60: "sesenta", 70: "setenta", 80: "ochenta", 90: "noventa"}

        if number < 10:
            return units[number]
        if number < 20:
            return teens[number]
        if number < 30:
            return twenties[number]
        ten = (number // 10) * 10
        unit = number % 10
        if unit == 0:
            return tens[ten]
        return f"{tens[ten]} y {units[unit]}"

    if language == "de":
        units = {
            0: "null", 1: "eins", 2: "zwei", 3: "drei", 4: "vier",
            5: "fünf", 6: "sechs", 7: "sieben", 8: "acht", 9: "neun",
        }
        teens = {
            10: "zehn", 11: "elf", 12: "zwölf", 13: "dreizehn", 14: "vierzehn",
            15: "fünfzehn", 16: "sechzehn", 17: "siebzehn", 18: "achtzehn", 19: "neunzehn",
        }
        tens = {20: "zwanzig", 30: "dreißig", 40: "vierzig", 50: "fünfzig", 60: "sechzig", 70: "siebzig", 80: "achtzig", 90: "neunzig"}

        if number < 10:
            return units[number]
        if number < 20:
            return teens[number]
        ten = (number // 10) * 10
        unit = number % 10
        if unit == 0:
            return tens[ten]
        unit_word = "ein" if unit == 1 else units[unit]
        return f"{unit_word}und{tens[ten]}"

    return number_to_words(number, "en")


def get_language_profile(language: str = "en") -> Dict[str, str]:
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
            "two_laps": "deux tours",
            "three_laps": "trois tours",
            "point": "virgule",
            "test_sound": "Test du son pour le pilote",
            "name_suffix_lap": " tour",
            "name_suffix_2laps": " deux tours",
            "name_suffix_3laps": " trois tours",
        },
        "es": {
            "arm_your_quad": "Arma tu quad",
            "starting_tone": "Salida al tono en menos de cinco",
            "race_complete": "Carrera completada",
            "race_stopped": "Carrera detenida",
            "gate_1": "Puerta 1",
            "lap": "Vuelta",
            "laps": "vueltas",
            "two_laps": "dos vueltas",
            "three_laps": "tres vueltas",
            "point": "punto",
            "test_sound": "Probando sonido para el piloto",
            "name_suffix_lap": " vuelta",
            "name_suffix_2laps": " dos vueltas",
            "name_suffix_3laps": " tres vueltas",
        },
        "de": {
            "arm_your_quad": "Bewaffne deinen Quad",
            "starting_tone": "Start beim Ton in weniger als fünf",
            "race_complete": "Rennen abgeschlossen",
            "race_stopped": "Rennen gestoppt",
            "gate_1": "Tor 1",
            "lap": "Runde",
            "laps": "Runden",
            "two_laps": "zwei Runden",
            "three_laps": "drei Runden",
            "point": "Komma",
            "test_sound": "Tonprüfung für Piloten",
            "name_suffix_lap": " runde",
            "name_suffix_2laps": " zwei runden",
            "name_suffix_3laps": " drei runden",
        },
    }
    return profiles.get(language, profiles["en"])


def get_phrases_to_generate(language: str = "en") -> Dict[str, str]:
    profile = get_language_profile(language)
    phrases = {
        "arm_your_quad.mp3": profile["arm_your_quad"],
        "starting_tone.mp3": profile["starting_tone"],
        "race_complete.mp3": profile["race_complete"],
        "race_stopped.mp3": profile["race_stopped"],
        "gate_1.mp3": profile["gate_1"],
        f"test_sound_{PILOT_NAME.lower()}.mp3": f"{profile['test_sound']} {PHONETIC_NAME}",
        "lap.mp3": profile["lap"],
        "laps.mp3": profile["laps"],
        "two_laps.mp3": profile["two_laps"],
        "three_laps.mp3": profile["three_laps"],
        f"{PILOT_NAME.lower()}_lap.mp3": f"{PHONETIC_NAME}{profile['name_suffix_lap']}",
        f"{PILOT_NAME.lower()}_2laps.mp3": f"{PHONETIC_NAME}{profile['name_suffix_2laps']}",
        f"{PILOT_NAME.lower()}_3laps.mp3": f"{PHONETIC_NAME}{profile['name_suffix_3laps']}",
        **{f"num_{i}.mp3": number_to_words(i, language) for i in range(100)},
        "point.mp3": profile["point"],
        **{f"lap_{i}.mp3": f"{profile['lap']} {number_to_words(i, language)}" for i in range(1, 51)},
        **{f"{name.lower()}_lap.mp3": f"{name}{profile['name_suffix_lap']}" for name in TOP_NAMES},
    }
    return phrases


def get_output_folder(language: str, selected_voice: str) -> str:
    language = language.lower()
    if language == "en":
        return f"voice_{selected_voice}_en"
    if language in LANGUAGE_FOLDER_MAP:
        return LANGUAGE_FOLDER_MAP[language]
    raise ValueError(f"Unsupported language: {language}")


def generate_audio_files(api_key: str, language: str = "en", output_dir: Path | None = None) -> Path:
    global VOICE_ID

    language = language.lower()
    if SELECTED_VOICE not in VOICES:
        raise ValueError(f"Unsupported voice key: {SELECTED_VOICE}")

    VOICE_ID = VOICES[SELECTED_VOICE]["id"]
    voice_name = VOICES[SELECTED_VOICE]["name"]
    base_output = Path(output_dir) if output_dir else OUTPUT_DIR
    folder_name = get_output_folder(language, SELECTED_VOICE)
    voice_dir = base_output / folder_name
    voice_dir.mkdir(parents=True, exist_ok=True)

    client = ElevenLabs(api_key=api_key)
    phrases = get_phrases_to_generate(language)
    total = len(phrases)

    print(f"\nGenerating {total} audio files")
    print(f"Voice: {voice_name} ({VOICE_ID})")
    print(f"Language: {language}")
    print(f"Output: {voice_dir}\n")

    for i, (filename, text) in enumerate(phrases.items(), 1):
        output_path = voice_dir / filename
        print(f"[{i}/{total}] {filename}")
        audio_generator = client.text_to_speech.convert(
            voice_id=VOICE_ID,
            optimize_streaming_latency="0",
            output_format="mp3_44100_128",
            text=text,
            model_id="eleven_turbo_v2_5",
            voice_settings=VOICE_SETTINGS,
        )
        with open(output_path, "wb") as f:
            for chunk in audio_generator:
                if chunk:
                    f.write(chunk)

    return voice_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate FPVGate voice files")
    parser.add_argument(
        "--language",
        choices=["en", "fr", "es", "de"],
        default="en",
        help="Language code to generate (default: en)",
    )
    parser.add_argument(
        "--voice",
        choices=list(VOICES.keys()),
        default=SELECTED_VOICE,
        help="Voice preset to use for TTS generation",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=OUTPUT_DIR,
        help="Base output directory (default: ./SD_Card)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="ElevenLabs API key (defaults to ELEVENLABS_API_KEY env var)",
    )
    return parser.parse_args()


def main() -> int:
    global SELECTED_VOICE
    global VOICE_ID

    args = parse_args()
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    api_key = args.api_key or os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("ELEVENLABS_API_KEY not set")
        return 1

    SELECTED_VOICE = args.voice
    VOICE_ID = VOICES[SELECTED_VOICE]["id"]

    try:
        output = generate_audio_files(api_key, language=args.language, output_dir=args.output_root)
        print(f"\nDone. Files written to {output}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())