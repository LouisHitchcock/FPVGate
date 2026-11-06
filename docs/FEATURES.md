# FPVGate feature reference

Current scope: `V1.9.0-alpha`, normal build label `1.9.0-alpha-5`.
This page describes implemented behavior and its limits. It replaces older
serial/Electron and pre-SD specifications. See [User guide](USER_GUIDE.md)
for operating steps and [Hardware](HARDWARE_GUIDE.md) for board differences.

## Connectivity

| Transport | Implemented behavior |
| --- | --- |
| Wi-Fi AP | `FPVGate_XXXX`, `fpvgate1`, `192.168.4.1`; 2.4 GHz, channel 6, maximum four AP clients |
| Wi-Fi station | Saved SSID/password, router-assigned IP, initial failure fallback to AP |
| USB RNDIS | `192.168.7.1/24`, Windows/Linux, six shipping environments |
| Ethernet | W5500 on S3-ETH, DHCP then fixed `192.168.8.1/24` after 45 s without a lease |

HTTP is port 80; the browser uses SSE `/events`. CDC serial remains for
diagnostics/flashing, not the current browser connection. USB is full-speed;
12 Mbit/s signaling is not a measured application throughput guarantee.
RNDIS is not supported by macOS. On S3-ETH, Ethernet link-up suspends USB
networking while Wi-Fi remains available.

## Receiver modules and timing

RX5808/Novacore provide the conventional single-receiver path. Novacore filter
controls apply to that path. A separate ESP32-C5 provides up to eight channels
to the S3, which runs per-pilot detection. Supported C5 frequencies are
5180–5917 MHz, so E7/E8 are unavailable. The link is 921600-baud UART with
CRC-protected scan records and a legacy ASCII fallback.

Typical scan mode is about 1 kHz per pilot with eight enabled slots; the
measured status counters show actual rates and dropped samples. Scan slots
are time-sliced on one RF receiver, not eight independent RF front ends.
C5MK AIO has a dedicated build identity and fixed C5 receiver.

Each crossing uses an RSSI peak timestamp. C5 keeps a pass open across brief
dips, requiring 300 ms below Exit before finalizing it. Gate 1 is the first
crossing; real lap times are differences between later crossings.
Minimum lap is 0.1–20.0 seconds, default 2.0. High timestamp resolution and
live/Marshal agreement do not establish absolute physical timing accuracy.

## Calibration and diagnostics

RX5808 capture supports baseline/pass recording, ignored regions and editable
calculated thresholds. C5 has per-slot live traces, gain, Enter/Exit, pilot
identity, Race participation and multi-pilot calibration. Changes are blocked
while racing where they would alter the C5 detection setup.

The diagnostics page exposes logs, debug RSSI and an 18-check self-test.
Tests report Pass/Fail/Skip based on available capabilities; they can write
temporary storage files and test the buzzer. The small legacy debug overlay is
for conventional RSSI; C5 has its own multi-trace debug window.

## Race management and synchronization

| Workflow | Authority and limits |
| --- | --- |
| C5 Multi | S3 owns start, per-pilot finish, heat timeout and one history save |
| Conventional Personal/Master/Slave | Retains the previous browser-dependent completion/save workflow |
| Event Mode | Unreleased source records results/loads next heat on the gate; published Alpha 5 still uses browser processing |
| RotorHazard | Plugin controls node tuning and consumes timestamped passes; RH applies its race rules |

C5 is exclusively Multi even with one racer; it cannot be daisy-chained as a
Master/Slave. Conventional sync supports up to five configured peers.
C5 limits are frozen at start. Zero max laps/heat means unlimited within the
64-crossing-per-pilot storage cap; more than 63 requested real laps is rejected.
Save failure keeps the session in RAM, blocks Start/Clear and permits Stop retry.
See [completion contract](GATE_RACE_COMPLETION.md).

## Event Mode

C5 Event Mode supports a roster, groups of up to eight, channel overrides,
formats, repeated/rotating heat order, result records, import/export and
seeding by roster/random/Elo/best lap/best consecutive three.
Unreleased source adds browser-free result association and next-heat loading,
with revision checks and recovery from already saved history. Editing, seeding
and speech still use a page. See [Event progression](GATE_EVENT_PROGRESSION.md)
for limits and remaining hardware qualification; existing published images
are not updated by this source change.

## Race analysis and history

The live multi-pilot view includes standings, per-pilot lap columns and charts.
Fastest Lap/Fastest 3 Consecutive select the best eligible pilot; Best 3 Laps
and Median use the leader's laps for the summary. Gate 1 is excluded.

History stores identities, channels, per-pilot laps, race rules/metadata,
notes and summary statistics. SD recording adds RSSI sidecars for visual review.
C5 v2 captures eight physical slots as peak-held bytes with elapsed timestamps
at a nominal 20 ms interval. The 45,000-frame cap is about 15 minutes;
recording can truncate or show gaps without extending detector precision.

The editor can add/remove/move/recalculate crossings per pilot and saves all
pilots together. Missing/corrupt/legacy remote traces use typed entry.
Race JSON exports do not include binary sidecars; keep SD backups for traces.

## Audio and LEDs

The browser uses pre-recorded SD MP3s and Web Speech fallback. Packs include
five English voices and German/Spanish/French directory mappings; Web Speech
is also selectable directly. The old Piper ID normalizes to default and is
not an installed synthesis engine. Speech needs an enabled browser, and OS
voice availability determines fallback/offline behavior.

Consecutive callouts use rolling two-/three-lap totals per pilot, excluding
Gate 1. Voice rate/volume and hardware buzzer volume are independent.
Stock alpha targets do not enable the unfinished I2S speaker path.

Ten RGB presets, colors, brightness, speed and manual override are available
on boards with configured RGB hardware. External gate-controller webhooks
are separate network integrations. Full pilot-specific onboard LED/LCD/OSD
parity is not established merely because the browser has eight pilot cards.

## Tracks and user interface

Up to 50 track profiles hold distance, notes and image metadata. Selected
track metadata is frozen for a C5 race; legacy distance summaries may use the
leader. Interface locales are English, German, Spanish, French and Simplified
Chinese, with incomplete translation of newer C5/Event strings. Themes and
custom colors are separate from pilot colors and voice language.

Overlay routes include `/vert-OSD` and `/handcamOverlay`. They primarily use
single-pilot events; verify the selected race mode before streaming them.

## Storage and configuration management

Config is EEPROM schema v24 with migrations. Web assets live in LittleFS and
are gzipped during the build. Canonical voice folders are `voice_*` at SD root.
Race/event/track storage uses the storage layer; an SD failure does not
guarantee that every feature or missing voice will transparently recover.

| Partition table | App slot size | LittleFS offset | LittleFS size |
| --- | --- | --- | --- |
| `custom_4mb.csv` | `0x140000` | `0x290000` | `0x160000` |
| `custom_8mb.csv` | `0x200000` | `0x410000` | `0x3E0000` |
| `custom_16mb.csv` | `0x300000` | `0x610000` | `0x200000` |

All tables are in `targets/partitions/`. The LCD source target uses the 8 MB
layout despite its 16 MB chip. A filesystem upload replaces that partition;
an OTA update cannot change the partition table. Export settings and races,
and separately back up sidecars/event data.

## Updates and integrations

Device updates use board identity and installed app/filesystem sizes to select
compatible images. C5 link updates require a compatible C5 boot/update protocol,
matching receiver-board firmware and stable power. Updating this repository
does not publish/download firmware automatically.

The [RotorHazard guide](ROTORHAZARD_INTEGRATION.md) documents plugin v2:
the plugin connects to always-available HTTP endpoints, tunes nodes and reads
its own SSE stream. Version 1 gate-to-RH posting and physical mode switches
are obsolete for alpha operation. The independent Discord webhook worker
lives under `integrations/` and has no role in device timing.

## Validation limits

Bench results depend on board, receiver firmware and network. Neither a build,
a self-test nor identical-input simulation proves RF/camera timing accuracy.
Read [validation](../tools/VALIDATION_PLAN.md),
[multi-pilot status](MULTI_PILOT_REVIEW.md) and
[post-soak evidence](RH_POST_SOAK_INVESTIGATION.md) before making performance
or release-readiness claims.

