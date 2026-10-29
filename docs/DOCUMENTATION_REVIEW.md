# Alpha documentation review, 25 October 2026

Reviewed against the alpha source following repository cleanup commit
`d5f16b9`. Documentation changes do not rebuild existing release images,
deploy the website/bot, flash hardware or change the firmware.

## Subsequent blocker implementation, same day (unreleased)

The follow-on code pass now implements gate-side C5 Event result recording,
schedule progression, frozen roster/rules, revision conflict protection and
reconciliation with already saved history after reboot. See
[Event progression](GATE_EVENT_PROGRESSION.md) for the contract and hardware
checklist. It also repairs the manual release workflow: filesystem failure is
fatal, the canonical packager supplies actual bootloaders/partition offsets and
boot_app0, and all delivered layouts receive checksums. Missing inputs fail
before a release directory is written.

The original audit below describes the findings before these fixes. The Event
and workflow code remains local/unpublished; published Alpha 5 images and
historical verification are unchanged. Physical storage/power-loss, timing
accuracy and six-board qualification remain open. Current software checks add
the native Event/real-ArduinoJson harness, compiled Storage fault injection,
frontend revision/reconnect tests and packaging tests. The modified Actions
workflow still needs its first remote run.

Follow-on software verification: 126 Jest checks across 11 suites, both native
race/Event harnesses and two offline packaging tests pass. Firmware builds
pass for ESP32S3, FPVGateC5MKAIO and WaveshareS3ETH; this is three-board compile
coverage, not all-six-board or physical qualification. No firmware was flashed
and no release package or tag was published by this implementation pass.

## Coverage

Reviewed all tracked Markdown: the root README/contributors/changelog,
the current `docs/` guides and five wiring references, tools/runbooks,
native-test and library READMEs, the integration README, and versioned
release notes. Current procedures were reconciled with code; attribution
and dated release/experiment results remain historical records.

The [documentation index](README.md) links the current guide set. Main changes:

| Area | Correction |
| --- | --- |
| Hardware/wiring | Board-specific GPIOs, source versus shipping scope, PSRAM reservations, active/passive buzzer, optional sensing |
| Build/flash | Correct environment names, alpha clone, matching app/filesystem, partition paths/offsets, boot selector |
| Networking | HTTP/SSE, four AP clients, per-build USB support, Ethernet fallback/arbitration |
| C5 races | Frozen settings, Gate 1, completion/save authority, limits, save retry and browser-dependent Events/speech |
| Audio/SD | Canonical voice folders, five English voices, localized packs, Web Speech fallback, API generation versus SD copy |
| RotorHazard | Plugin-initiated API, node mapping, tested version pair, split API requirements and clock-estimate limits |
| Release | Three layouts, explicit publication, manual workflow's actual artifact-only behavior |
| Tests/logging | Current production/native coverage, CLI arguments, self-test side effects, real DEBUG API |

The old USB engineering diary is preserved under `docs/archive/` with explicit
historical scope, replacing its conflicting "current candidate" claims in the
active guide. An embedded NUL in the old Features guide was removed by rewriting
it as a current plain-text reference.

## Original audit findings (before the follow-on code pass)

| Issue | Evidence and implication |
| --- | --- |
| Manual release workflow | `workflow_dispatch` only; no GitHub Release/repository publication. Filesystem build can fail without stopping the job; flash reference hardcodes `0x410000` and omits `boot_app0.bin`. |
| Super Mini pin conflict | `PIN_LED=2` and `PIN_SD_SCK=2` in config. It is a retained custom target, not qualified wiring for both peripherals. |
| LilyGO capacity/pins | Manufacturer V1.0 has 16 MB/8 MB PSRAM, target uses an 8 MB layout without PSRAM. SD pins 35–37 require revision/module-reservation review. |
| LCD target metadata | Physical specification is 16 MB flash/8 MB PSRAM; target selects the 8 MB partition table and has a stale 2 MB PSRAM comment. The docs distinguish these facts. |
| Speaker | Configuration fields remain, but stock target flags/pins do not enable the I2S path. |
| Battery enablement | Some boards have a defined sense pin but no default `HAS_BATTERY_MONITOR`. A setting alone cannot add compiled capability. |
| Browser responsibilities | Event result/next-heat processing, speech and conventional completion still need a page. |
| Release provenance | Alpha 5 verifier demands exact recorded production source. Target-path cleanup invalidates that source equality; do not relabel old binaries as rebuilt. |
| Physical qualification | Six-board/storage recovery and independent multi-transmitter/camera timing tests remain separate from software checks. |

These are visible implementation constraints, not undocumented firmware fixes.
No new performance measurements are asserted by this pass.

## Verification performed

- Audited 87 Markdown files and resolved 233 local file/section/image links;
  no missing targets or anchors were found. No Markdown files retain NUL bytes.
- Jest: 9 suites, 118 tests passed, using the existing installed runner with
  this worktree's test configuration.
- Native C5 race controller: completion, limits, persistence retry/idempotency
  and continued RotorHazard pass-stream checks passed.
- Offline post-soak diagnostics: nine standalone checks passed; eight
  simulator/cross-project cases were skipped for missing prerequisites.
- No device was flashed, RF transmitted, device storage manipulated or release
  artifact rebuilt. Manufacturer/companion references were checked separately
  from source definitions.

## Manufacturer and companion references

- [Seeed XIAO S3 family](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)
- [LilyGO T-Energy-S3](https://github.com/Xinyuan-LilyGO/T-Energy-S3)
- [Waveshare LCD-2](https://docs.waveshare.com/ESP32-S3-LCD-2)
- [Waveshare S3-ETH](https://www.waveshare.com/wiki/ESP32-S3-ETH)
- [C5MK link reference](https://github.com/LouisHitchcock/FPVGateC5MK/blob/main/docs/LINK_PROTOCOL.md)
- [RotorHazard companion plugin](https://github.com/LouisHitchcock/fpvgate-rh-plugin)

Local source remains authoritative for this branch; a newer external project
may have different capabilities. Physical specifications and compiled layout
must be checked independently.
