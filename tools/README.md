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

## Validating a device

Four harnesses, in the order you would use them. **If you have been asked to
validate a device and nothing else, read `VALIDATION_PLAN.md` first** — it says
what each layer proves and, more usefully, what it does not.

| Script | Writes to device? | Duration | Use it to |
|---|---|---|---|
| `race_day_sim.py --components-only` | **yes** | ~2 min | check every component once |
| `race_day_sim.py` | **yes** | 1-4 h | simulate a full race day |
| `reliability_check.py` | no | 4 h+ | prove it stays up under load |
| `stress_test.py` | no | minutes | concurrency and throughput |
| `soak_test.py` | no | hours | liveness across both transports |

All of them take `--usb <gate ip> --bind <host ip>` and/or `--wifi <gate ip>`, and
need at least one. The gate is always `192.168.7.1` over USB; `--bind` is your
own address on the USB network adapter, normally `192.168.7.2`. **Without
`--bind`, USB requests can leave via the wrong interface and appear to fail.**

Every one of them exits `0` for pass, `1` for fail, `2` for could-not-run.
Exit `2` is not a firmware failure — it means the check never got far enough to
judge, usually a wrong address or an unplugged cable.

### Start here

```
# 1. Is the device healthy and is every component working?   ~2 min
python tools/race_day_sim.py --usb 192.168.7.1 --bind 192.168.7.2     --wifi 192.168.0.225 --i-know-this-writes --components-only

# 2. Does it stay up under sustained load?                    4 h
python tools/reliability_check.py --usb 192.168.7.1 --bind 192.168.7.2     --wifi 192.168.0.225 --duration 14400
```

Step 1 must pass before step 2 is worth starting.

### race_day_sim.py

Drives real heats — start timer, post laps, stop, save — then verifies the race
persisted, the RSSI sidecar was written and serves correctly, lap editing
recalculates the statistics, history is ordered newest-first, and deletion
removes both race and sidecar. Also checks config round-trips and that both
transports serve identical data.

**This creates and deletes races.** It refuses to run without
`--i-know-this-writes`, and removes everything it created afterwards, including
on Ctrl-C. Do not point it at a gate holding results that matter.

### reliability_check.py

Read-only. Preflight, the device's own 18-check self test, an endpoint probe,
then hours of sustained mixed load with liveness probing. Reaches its own
PASS/FAIL verdict against explicit criteria. See `RELIABILITY_RUNBOOK.md` for
running it unattended and what to report back.

Safe against a gate with real race data, since it mutates nothing.

### stress_test.py

Concurrency and throughput across both transports at once, verifying every
response against its `Content-Length`. Useful for comparing USB against WiFi, or
for reproducing load-dependent faults quickly.

### soak_test.py

Long liveness watch: probes both transports on an interval, with periodic bursts
of race-shaped traffic, and reports outages and whether they recovered unaided.

### Why Content-Length is checked everywhere

The RNDIS transmit stall presents as a response body that stops partway with
**HTTP 200 already sent**. A status-only check reports success on exactly the
fault being hunted, so every harness compares bytes received against the declared
length. For the same reason the load mixes are weighted towards large transfers:
small requests keep working right through a stall.

