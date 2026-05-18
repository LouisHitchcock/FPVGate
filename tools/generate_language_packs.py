#!/usr/bin/env python3
"""Generate language-specific FPVGate voice packs and SD card ZIPs.

This tool copies the generated voice assets into per-language packaging
folders and creates a ZIP archive for each language pack so the website can
later offer language-specific downloads.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_VOICE_SOURCE = ROOT / "SD_Card"
DEFAULT_OUTPUT_DIR = ROOT / "release" / "v1.7.3"

# Language packs are intentionally metadata-driven so the website/tooling can
# later choose the right pack without changing the packaging logic here.
# For now we package the same SD-card structure, but the generator records the
# target locale so the website can later wire each language button to the right
# archive.
LANGUAGE_PACKS = {
    "en": {
        "label": "English",
        "locale": "en",
        "source_dir": "voice_en",
        "zip_name": "SD_Card_en.zip",
        "description": "English voice pack",
    },
    "fr": {
        "label": "French",
        "locale": "fr",
        "source_dir": "voice_fr",
        "zip_name": "SD_Card_fr.zip",
        "description": "French voice pack",
    },
    "es": {
        "label": "Spanish",
        "locale": "es",
        "source_dir": "voice_es",
        "zip_name": "SD_Card_es.zip",
        "description": "Spanish voice pack",
    },
    "de": {
        "label": "German",
        "locale": "de",
        "source_dir": "voice_de",
        "zip_name": "SD_Card_de.zip",
        "description": "German voice pack",
    },
}


def copy_tree(src: Path, dst: Path) -> int:
    if not src.exists():
        raise FileNotFoundError(f"Missing source directory: {src}")
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    return sum(1 for p in dst.rglob("*") if p.is_file())


def make_zip(source_dir: Path, zip_path: Path) -> int:
    if zip_path.exists():
        zip_path.unlink()
    count = 0
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zf:
        for path in source_dir.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(source_dir.parent))
                count += 1
    return count


def build_language_pack(lang: str, voice_root: Path, output_root: Path) -> tuple[Path, Path, int]:
    if lang not in LANGUAGE_PACKS:
        raise KeyError(f"Unsupported language code: {lang}")

    pack = LANGUAGE_PACKS[lang]
    source_dir = voice_root / pack["source_dir"]
    stage_dir = output_root / f"sd_card_{lang}"
    stage_voice_dir = stage_dir / pack["source_dir"]

    copied_files = copy_tree(source_dir, stage_voice_dir)

    # Stamp the pack with a tiny manifest so the ZIP identifies its language.
    manifest = stage_dir / "LANGUAGE.txt"
    manifest.write_text(f"language={lang}\nlabel={pack['label']}\nlocale={pack['locale']}\n", encoding="utf-8")

    zip_path = output_root / pack["zip_name"]
    zipped_files = make_zip(stage_dir, zip_path)

    return stage_dir, zip_path, max(copied_files, zipped_files)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate language-specific SD card ZIPs for FPVGate voice packs")
    parser.add_argument(
        "--languages",
        nargs="+",
        default=list(LANGUAGE_PACKS.keys()),
        help="Language codes to package (default: en fr es de)",
    )
    parser.add_argument(
        "--voice-root",
        type=Path,
        default=DEFAULT_VOICE_SOURCE,
        help="Root folder containing voice asset directories (default: ./data)",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Output folder for generated release artifacts (default: ./release/v1.7.3)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)

    print("Generating language-specific SD card packs...")
    print(f"Voice root: {args.voice_root}")
    print(f"Output root: {args.output_root}")
    print("Note: using the current generated voice asset set for each language pack.")

    failures = 0
    for lang in args.languages:
        pack = LANGUAGE_PACKS.get(lang)
        if not pack:
            print(f"[SKIP] {lang}: unsupported language code")
            failures += 1
            continue

        try:
            stage_dir, zip_path, count = build_language_pack(lang, args.voice_root, args.output_root)
            print(f"[OK] {lang} ({pack['label']}): {count} files -> {zip_path.name}")
            print(f"     staged at {stage_dir}")
        except Exception as exc:
            print(f"[ERR] {lang} ({pack['label']}): {exc}")
            failures += 1

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
