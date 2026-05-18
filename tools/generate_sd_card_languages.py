#!/usr/bin/env python3
"""Generate language-specific SD card voice folders with ElevenLabs.

This script creates:
- SD_Card/voice_en
- SD_Card/voice_fr
- SD_Card/voice_es
- SD_Card/voice_de

Each folder contains localized announcements generated from ElevenLabs using
language-specific phrases.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path
from typing import Dict

from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs

ROOT = Path(__file__).resolve().parent.parent
SD_CARD_ROOT = ROOT / "SD_Card"

PILOT_NAME = "Louis"
PHONETIC_NAME = "Louie"

VOICE_SETTINGS = VoiceSettings(
    stability=0.5,
    similarity_boost=0.75,
    style=0.0,
    use_speaker_boost=True,
)

# Pick one ElevenLabs voice per language. These are the existing voices in the repo.
LANGUAGE_TO_VOICE = {
    "en": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "voice_name": "Sarah", "folder": "voice_en", "note": "default voice"},
    "fr": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "voice_name": "Sarah", "folder": "voice_fr", "note": "fallback voice for free-plan generation"},
    "es": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "voice_name": "Sarah", "folder": "voice_es", "note": "fallback voice for free-plan generation"},
    "de": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "voice_name": "Sarah", "folder": "voice_de", "note": "fallback voice for free-plan generation"},
}

TOP_NAMES = [
    "Alex", "Andrew", "Ben", "Brandon", "Brian", "Carlos", "Chad", "Chris",
    "Daniel", "Dave", "David", "Derek", "Eric", "Evan", "Frank", "George",
    "Jack", "James", "Jason", "Jeff", "John", "Jordan", "Josh", "Justin",
    "Kevin", "Kyle", "Lucas", "Mark", "Matt", "Michael", "Mike", "Nick",
    "Patrick", "Paul", "Peter", "Rob", "Ryan", "Sam", "Scott", "Sean",
    "Steve", "Thomas", "Tim", "Tom", "Tony", "Tyler", "Will", "Zach",
    "Emma", "Sarah",
]

PROFILE = {
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
        "lap_template": "Lap {n}",
        "name_template": "{name} lap",
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
        "name_suffix_lap": " tour",
        "name_suffix_2laps": " 2 tours",
        "name_suffix_3laps": " 3 tours",
        "lap_template": "Tour {n}",
        "name_template": "{name} tour",
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
        "name_suffix_lap": " vuelta",
        "name_suffix_2laps": " 2 vueltas",
        "name_suffix_3laps": " 3 vueltas",
        "lap_template": "Vuelta {n}",
        "name_template": "{name} vuelta",
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
        "name_suffix_lap": " runde",
        "name_suffix_2laps": " 2 runden",
        "name_suffix_3laps": " 3 runden",
        "lap_template": "Runde {n}",
        "name_template": "{name} runde",
    },
}


def get_phrases(language: str) -> Dict[str, str]:
    profile = PROFILE[language]
    phrases: Dict[str, str] = {
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
        **{f"num_{i}.mp3": str(i) for i in range(100)},
        "point.mp3": profile["point"],
        **{f"lap_{i}.mp3": profile["lap_template"].format(n=i) for i in range(1, 51)},
        **{f"{name.lower()}_lap.mp3": profile["name_template"].format(name=name) for name in TOP_NAMES},
    }
    return phrases


def clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def generate_language_pack(api_key: str, language: str) -> Path:
    if language not in LANGUAGE_TO_VOICE:
        raise KeyError(f"Unsupported language: {language}")

    cfg = LANGUAGE_TO_VOICE[language]
    output_dir = SD_CARD_ROOT / cfg["folder"]
    clean_dir(output_dir)

    client = ElevenLabs(api_key=api_key)
    phrases = get_phrases(language)
    total = len(phrases)

    print(f"\n=== {language.upper()} -> {cfg['folder']} ({cfg['voice_name']}) ===")
    print(f"Output: {output_dir}")
    print(f"Files: {total}")
    print(f"Voice note: {cfg.get('note', '')}")

    for idx, (filename, text) in enumerate(phrases.items(), 1):
        out_path = output_dir / filename
        print(f"[{idx}/{total}] {filename}")
        audio = client.text_to_speech.convert(
            voice_id=cfg["voice_id"],
            optimize_streaming_latency="0",
            output_format="mp3_44100_128",
            text=text,
            model_id="eleven_turbo_v2_5",
            voice_settings=VOICE_SETTINGS,
        )
        with open(out_path, "wb") as f:
            for chunk in audio:
                if chunk:
                    f.write(chunk)

    manifest = output_dir / "LANGUAGE.txt"
    manifest.write_text(f"language={language}\nvoice={cfg['voice_name']}\n", encoding="utf-8")
    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--languages", nargs="+", default=["en", "fr", "es", "de"])
    args = parser.parse_args()

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        print("ELEVENLABS_API_KEY not set")
        return 1

    SD_CARD_ROOT.mkdir(parents=True, exist_ok=True)

    for language in args.languages:
        generate_language_pack(api_key, language)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
