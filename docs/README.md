# FPVGate alpha documentation

Current source branch: `V1.9.0-alpha`. Normal build label:
`1.9.0-alpha-5`. These guides describe the checked-in implementation,
not a declaration that every feature/board has been physically qualified.

## Start here

| Guide | Use it for |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Hardware choice, SD preparation, flashing and first race |
| [User guide](USER_GUIDE.md) | Settings, calibration, racing, history and recovery |
| [Hardware guide](HARDWARE_GUIDE.md) | Board scope, power, capability and wiring distinctions |
| [Features](FEATURES.md) | Implemented behavior, storage/timing limits and integrations |
| [Repository layout](REPOSITORY_LAYOUT.md) | Where source, configs, images and services belong |

## Receivers, networking and operation

- [ESP32-C5 multi-pilot](C5_MULTI_PILOT.md)
- [C5 link/integration contract](C5_RF_NODE_AGENT_SPEC.md)
- [Gate-managed C5 race completion](GATE_RACE_COMPLETION.md)
- [Gate-managed Event progression, unreleased source](GATE_EVENT_PROGRESSION.md)
- [RotorHazard plugin integration](ROTORHAZARD_INTEGRATION.md)
- [ELRS race control from a radio switch, unreleased source](ELRS_RACE_CONTROL.md)
- [USB networking](USB_NETWORKING.md)
- [Waveshare S3-ETH](WAVESHARE_S3_ETH.md)
- [Battery monitoring](BATTERY_MONITORING.md)
- [Power button and sleep](POWER_SWITCH.md)
- [SD setup and migration](SD_CARD_MIGRATION_GUIDE.md)
- [Voice packs](MULTI_VOICE_SETUP.md) and [generation](VOICE_GENERATION_README.md)

## Wiring references

- [XIAO ESP32S3](wiring/Seeed-XIAO-ESP32S3.md)
- [DevKitC-1, 8 MB](wiring/ESP32-S3-DevKitC-1.md)
- [Super Mini, retained custom target](wiring/ESP32-S3-SuperMini.md)
- [LilyGO T-Energy S3](wiring/LilyGO-T-Energy-S3.md):
  [compatibility](LILYGO_TENERGY_S3_WIRING.md),
  [migration](LILYGO_TENERGY_S3_CHANGES.md),
  [verification](LILYGO_TENERGY_S3_VERIFICATION.md)
- [Waveshare LCD-2, retained custom target](wiring/Waveshare-ESP32-S3-LCD-2.md)

## Development and testing

- [Development](DEVELOPMENT.md)
- [Release process](RELEASE_PROCESS.md)
- [Tools](../tools/README.md)
- [Validation plan](../tools/VALIDATION_PLAN.md)
- [Reliability runbook](../tools/RELIABILITY_RUNBOOK.md)
- [Native harnesses](../tests/native/README.md)
- [DEBUG implementation](../lib/DEBUG/README.md)
- [USB implementation/provenance](../lib/USBNET/README.md)
- [Independent Discord worker](../integrations/discord-bot/README.md)

## Evidence and historical records

[Multi-pilot review](MULTI_PILOT_REVIEW.md) distinguishes integrated changes
from outstanding qualification. [Post-soak investigation](RH_POST_SOAK_INVESTIGATION.md)
preserves the 25 October experiments and their limits.
[The USB investigation archive](archive/USB_NETWORKING_INVESTIGATION.md)
contains superseded candidates/hypotheses; use the current USB guide to operate
or maintain the shipped integration.

The root [changelog](../CHANGELOG.md) and versioned notes under `release/`
describe those releases. Paths, branch names, flash procedures, measured timings
and pending items in a historical note are not automatically current.
[Contributors](../CONTRIBUTORS.md) records attribution.

## Source of truth and open discrepancies

Use `lib/CONFIG/config.h` for pins/config schema, `targets/*.ini` and
`platformio.ini` for enabled build features, `lib/WEBSERVER/webserver.cpp`
for HTTP contracts, and `tools/package_release.py` for packaging.
The [documentation review](DOCUMENTATION_REVIEW.md) records scope and issues
that need code or physical qualification beyond this pass.
