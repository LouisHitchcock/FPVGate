# FPVGate tools

Run the examples from the repository root on `V1.9.0-alpha`.
Tools include voice generation, packaging, device load tests and offline
timing diagnostics. Use each tool's `--help` for its actual arguments.

## Voice generation

Install `python -m pip install -r requirements.txt` and set
`ELEVENLABS_API_KEY` before API generation. These scripts contact ElevenLabs
and can consume quota:

```sh
python tools/generate_voice_files.py --language en --voice matilda
python tools/generate_voice_files.py --language fr --voice default
```

`generate_all_voices.py` generates the five English variants;
`generate_sd_card_languages.py` generates English/French/Spanish/German.
Outputs use canonical `SD_Card/voice_*` directories.
[Generation guide](../docs/VOICE_GENERATION_README.md) and
[playback mapping](../docs/MULTI_VOICE_SETUP.md).

`generate_language_packs.py` packages existing files without API synthesis:

```sh
python tools/generate_language_packs.py --voice-root SD_Card --output-root release/v1.9.0-alpha-5 --languages en fr es de
```

Always choose the output path: the retained default is `release/v1.7.3`.
Outputs include `SD_Card_english_en.zip`, `SD_Card_french_fr.zip`,
`SD_Card_spanish_es.zip` and `SD_Card_german_de.zip` plus staging folders.
The `*_auto.py`/regeneration/upload scripts are specialized helpers; inspect
their defaults before using them on customized packs or an attached device.

## Release packaging

```sh
python tools/package_release.py --version vX.Y.Z-alpha-N
```

This builds app/filesystem for the six shipping boards, writes three binary
layouts, board instructions and the shared `boot_app0.bin`.
It validates version/environment names and requires every image and partition
offset before writing a release directory, then generates `SHA256SUMS` across
all delivered layouts. It does not publish a release or generate source provenance.
See [Release process](../docs/RELEASE_PROCESS.md), including the limitations
of the manual Actions workflow and the Alpha 5 verifier.

## Validating a device

Read [the validation plan](VALIDATION_PLAN.md) first. Durations are examples,
not guarantees.

| Tool | Device effects | Main purpose |
| --- | --- | --- |
| `race_day_sim.py --components-only` | Writes config/history/tracks, then cleanup | Functional component checks |
| `race_day_sim.py` | Repeated writes and cleanup | Race/storage workflow |
| `reliability_check.py` | Read load plus self-test's temporary writes/buzzer | Sustained reachability/integrity |
| `stress_test.py` | Read load | Mixed concurrent requests |
| `soak_test.py` | Read load | Liveness and bursts |
| `concurrent_load.py` | Read load | Synchronized startup asset requests |

Most load tools accept `--usb`/`--wifi` and optional `--bind`. The exception
is `concurrent_load.py`, which uses `--host`. `--bind` names your host adapter
address, not the gate, and is normally unnecessary when routes are correct.
USB is `192.168.7.1` only on enabled builds. S3-ETH with Ethernet link up needs
its Ethernet IP instead.

Examples (replace the Wi-Fi/IP values with your device):

```sh
python tools/concurrent_load.py --host 192.168.7.1 --rounds 8
python tools/reliability_check.py --usb 192.168.7.1 --duration 14400
python tools/race_day_sim.py --wifi 192.168.0.225 --i-know-this-writes --components-only
```

The race-day tool requires its write acknowledgement, even for
`--components-only`. Back up real results and use a bench device.
Cleanup aims to remove its generated data; it is not a guarantee that
interrupted runs cannot leave artifacts. The legacy race-day workflow is
not a complete C5 gate-managed/Events test: use native tests and the
[physical C5 checklist](../docs/GATE_RACE_COMPLETION.md#verification) too.

Check the tool's exit code and actual report. Do not assume every tool uses
the same 0/1/2 exit-code scheme: `concurrent_load.py` returns 0/1, for example.

## Reliability and transfer integrity

[The runbook](RELIABILITY_RUNBOOK.md) explains thresholds and reporting.
An HTTP 200 with an incomplete body is a failed transfer, so the load tools
check Content-Length. Concurrent page bursts can expose memory/queue faults
that sequential probes miss. A clean short run is not proof that intermittent
failures are absent.

## Offline timing diagnostics

`rh_timing_diagnostics.py`, `rh_usb_poll_diagnostics.py` and related helpers
compare controlled input paths. They need the documented separate RH/C5MK
sources for cross-project tests. Do not confuse them with RF/device orchestration.
See [the investigation](../docs/RH_POST_SOAK_INVESTIGATION.md) and
[native harnesses](../tests/native/README.md).

Native software equivalence, live/Marshal consistency and absolute RF timing
accuracy are distinct measurements. Diagnostic EMA bypass is not a shipping fix.

