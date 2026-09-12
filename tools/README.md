# FPVGate Tools
Python utility scripts for voice generation and SD card language pack packaging.

## Prerequisites
```bash
pip install -r ../requirements.txt
```

## Voice Generation
### generate_voice_files.py
Generates one voice pack with canonical folder naming.

Usage examples:
```bash
python generate_voice_files.py --language en --voice matilda
python generate_voice_files.py --language fr --voice default
```

Output folders:
- English voices: `SD_Card/voice_<voice>_en` (for example `voice_matilda_en`)
- French: `SD_Card/voice_french_fr`
- Spanish: `SD_Card/voice_spanish_es`
- German: `SD_Card/voice_german_de`

### generate_voice_files_auto.py
Non-interactive helper that runs `generate_voice_files.py` defaults.

### generate_all_voices.py
Generates all English voice variants in one run:
- `SD_Card/voice_default_en`
- `SD_Card/voice_rachel_en`
- `SD_Card/voice_adam_en`
- `SD_Card/voice_antoni_en`
- `SD_Card/voice_matilda_en`

## SD Card Language Pack Packaging
### generate_sd_card_languages.py
Generates multilingual voice folders directly in `SD_Card`:
- `voice_default_en`
- `voice_french_fr`
- `voice_spanish_es`
- `voice_german_de`

### generate_language_packs.py
Builds release-ready language pack folders and ZIP archives in `release/v1.7.3`.

Generated staging folders:
- `sd_card_english_en`
- `sd_card_french_fr`
- `sd_card_spanish_es`
- `sd_card_german_de`

Generated ZIPs:
- `SD_Card_english_en.zip`
- `SD_Card_french_fr.zip`
- `SD_Card_spanish_es.zip`
- `SD_Card_german_de.zip`

Usage:
```bash
python generate_language_packs.py
```

## Voice File Layout
Each voice folder contains files like:
```text
voice_<...>/
├── arm_your_quad.mp3
├── starting_tone.mp3
├── race_complete.mp3
├── race_stopped.mp3
├── gate_1.mp3
├── lap_1.mp3
├── ...
├── num_0.mp3
├── ...
├── point.mp3
└── test_sound_<pilot>.mp3
```

## Notes
- ElevenLabs API key is read from `ELEVENLABS_API_KEY`.
- Scripts are compatible with Windows PowerShell and Linux shells.
- Legacy `sounds_*` folder naming is deprecated in tooling output.

## See Also
- `../docs/VOICE_GENERATION_README.md`
- `../docs/MULTI_VOICE_SETUP.md`
- `../docs/SD_CARD_MIGRATION_GUIDE.md`

## stress_test.py

Whole-system stress test against a running gate. Drives every significant HTTP
path at once, over USB networking and WiFi simultaneously if both are available,
verifies each response against its Content-Length, and samples the device heap
throughout.

```
python tools/stress_test.py --usb 192.168.7.1 --bind 192.168.7.2
python tools/stress_test.py --usb 192.168.7.1 --bind 192.168.7.2     --wifi 192.168.0.225 --duration 900 --workers 3 --out report.json
```

`--bind` is required for USB: without a source address the request can leave via
the wrong interface. The marshal RSSI endpoint is discovered automatically from
`/races` and included if any race has a stored trace, since that is the chunked
response path. Exits non-zero if any request failed.

A truncated body is the signature of the RNDIS transmit stall and does not raise
on its own, so responses are checked against their declared length rather than
just their status code.

