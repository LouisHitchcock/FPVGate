# Generating voice packs

Run the tools from the repository root. They generate MP3 files on the computer
using ElevenLabs, then you copy the folders to the gate's SD card.
They do not upload the LittleFS web image or synthesize speech on the S3.

## Setup

Use Python 3.10+ (the generator uses modern type syntax; CI uses 3.11).
Install the voice dependencies:

```sh
python -m pip install -r requirements.txt
```

Set your own ElevenLabs API key without committing it:

```powershell
$env:ELEVENLABS_API_KEY = 'your_key_here'
```

On POSIX shells use `export ELEVENLABS_API_KEY='your_key_here'`.
The main generator also loads a local `.env` via dotenv. Generation calls a
paid/quota-limited external API; account quotas, pricing and voice access
depend on the current provider plan. Inspect the phrase list before running.
There is no fixed "ten free regenerations per month" guarantee.

## Generate one voice or language

```sh
python tools/generate_voice_files.py --language en --voice matilda
python tools/generate_voice_files.py --language fr --voice default
```

Options are `--language en|fr|es|de`, `--voice default|rachel|adam|antoni|matilda`,
`--output-root <directory>` and `--api-key` (prefer the environment variable
to avoid exposing a key in shell history/process arguments).
The script default voice is Matilda; device playback defaults to Sarah/default.
The preset IDs and synthesis model are defined in the script, not guaranteed
to be available on every account.

English output is `SD_Card/voice_<voice>_en`. French, Spanish and German use
`voice_french_fr`, `voice_spanish_es` and `voice_german_de` regardless of the
chosen synthesis preset. Change `PILOT_NAME`/`PHONETIC_NAME` in the generator
when customizing its personal-name phrases; additional common names and
number/control phrases come from the source phrase table.

The generator writes its phrase files into the selected directory. Keep a
backup of customized files before regenerating. File count, size, quota usage
and duration depend on the actual phrases/model; do not use the old 125-file
estimate as a completeness check.

## Generate several packs

`tools/generate_all_voices.py` generates the five English voice variants.
`tools/generate_sd_card_languages.py` generates localized directories for
English/French/Spanish/German. Those are API-generating tools too.
Use each script's `--help` and inspect its defaults before starting a batch.

Package already-generated language files without synthesis:

```sh
python tools/generate_language_packs.py --voice-root SD_Card --output-root release/v1.9.0-alpha-5 --languages en fr es de
```

The explicit output path matters: that packaging script still defaults to
`release/v1.7.3`. It creates language ZIPs and staging directories, not a
firmware release. Pick a new output folder if preserving existing archives.

## Install and test

Copy the generated voice directories to the FAT32 card root, not into a nested
`SD_Card` directory. Select the corresponding voice in Settings, enable browser
audio and test race/countdown, Gate 1, lap numbers, times and pilot pronunciation.
See [voice mapping](MULTI_VOICE_SETUP.md) for exact IDs and fallback behavior.

There is no `uploadfs` step for voice packs: that command replaces the device
web filesystem, not the card's MP3 directories. Missing files may fall back to
Web Speech; test without Internet if offline operation is required.

For unexpected pronunciation, inspect the phonetic name and the actual phrase
filename/text. For a 404, check directory placement and case first. Do not
regenerate an entire paid pack to diagnose a browser audio permission issue.
