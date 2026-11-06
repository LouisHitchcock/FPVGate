# FPVGate development guide

For the `V1.9.0-alpha` branch. The normal build label is
`1.9.0-alpha-5`; `FPVGateC5MKAIO_EMAProbe` is a diagnostic variant.
Version strings come from `lib/VERSION/version.h`, not `platformio.ini`.

## Development setup

Use Git and Python with PlatformIO Core (or the VS Code PlatformIO extension).
CI currently uses Python 3.11. Node.js is required for the Jest tests and Node
verification tools. A C++17 `g++` compiler is needed for native/config tests.
The PowerShell native script calls `g++` directly; the Jest config test also
supports `CXX`.

```sh
git clone --branch V1.9.0-alpha https://github.com/LouisHitchcock/FPVGate.git
cd FPVGate
python -m pip install platformio
npm install --prefix tests
```

`requirements.txt` contains ElevenLabs and dotenv for voice generation.
It does not install PlatformIO, esptool or pyserial. Device serial diagnostic
tools may require `python -m pip install pyserial` separately. Install the
voice requirements only when generating packs. On Windows use PowerShell
for PlatformIO builds; the package tools can reject an MSys/Git Bash environment.

## Build targets

Select the environment explicitly:

| Environment | Purpose |
| --- | --- |
| `ESP32S3` | DevKitC-1 N8, 8 MB, no PSRAM |
| `SeeedXIAOESP32S3` | Seeed XIAO S3, 8 MB |
| `FPVGateAIO` | AIO, 8 MB |
| `FPVGateSolo` | Solo, 8 MB |
| `FPVGateC5MKAIO` | Dual-XIAO AIO, fixed C5 receiver, 8 MB |
| `WaveshareS3ETH` | W5500 Ethernet board, 16 MB |
| `ESP32S3SuperMini` | Retained 4 MB custom target |
| `LilyGOTEnergyS3` | Retained custom target, 8 MB layout |
| `WaveshareESP32S3LCD2` | Retained LCD target, pioarduino, 8 MB layout on 16 MB flash |
| `XIAOS3Plus` | Retained 16 MB custom target |
| `FPVGateC5MKAIO_EMAProbe` | Bench isolation only, inherited C5MK AIO environment |

Only the first six are packaged by `tools/package_release.py` and the manual
CI matrix. `FPVGateLCDAIO.ini` is not included in `extra_configs`.
See [hardware limitations](HARDWARE_GUIDE.md#choose-a-timer-and-receiver)
before treating retained targets as qualified builds.

## Building from source

```sh
pio run -e SeeedXIAOESP32S3
pio run -e SeeedXIAOESP32S3 -t buildfs
pio run -e SeeedXIAOESP32S3 -t upload
pio run -e SeeedXIAOESP32S3 -t uploadfs
pio device monitor -e SeeedXIAOESP32S3
```

Add `--upload-port COM3` (your actual port) to an upload when needed.
Replace the environment for your board. `python -m platformio` works when
the `pio` shim is unavailable in the active Python environment.

Build both firmware and filesystem. `scripts/gzip_assets.py` compresses a staged
copy of `data/` inside the build directory; edit uncompressed source assets.
`scripts/patch_async_event_source.py` applies the disconnect-race fix to the
downloaded web-server library. Do not hand-edit the PlatformIO dependency cache
as the permanent fix.

Uploading LittleFS replaces the partition. Back up SD/flash history and traces
first. EEPROM configuration is separate, and an erase/full reflash may also
lose it. Partition changes need a full wired flash, not OTA; see
[Getting started](GETTING_STARTED.md#upgrades-and-recovery).

## Project structure

[Repository layout](REPOSITORY_LAYOUT.md) is the directory reference.

| Source | Responsibility |
| --- | --- |
| `src/main.cpp` | Initialization, tasks and service polling |
| `lib/CONFIG` | Board pins, EEPROM v24 and migrations |
| `lib/LAPTIMER` | Conventional timer |
| `lib/RX5808` | Conventional RSSI receiver |
| `lib/C5LINK` | UART protocol, sample queues and per-pilot peak detector |
| `lib/RACECONTROL` | C5 lifecycle, frozen race settings, completion and persistence |
| `lib/RACEHISTORY` | History and RSSI sidecars |
| `lib/WEBSERVER` | HTTP routes, Wi-Fi and SSE |
| `lib/USBNET`, `lib/ETHNET` | RNDIS/CDC and W5500 networking |
| `lib/LCD_UI`, `lib/POWER` | Optional LCD/power behavior |
| `data/script.js` | Main page behavior |
| `data/c5-multipilot.js`, `data/event.js` | C5 setup and Event director |
| `data/race-editor.js`, `data/race-trace.js` | History editing and trace decoding |
| `data/audio-announcer.js` | Pre-recorded/browser speech |
| `data/i18n.js`, `data/locales/` | Locale loading and translations |

HTTP listens on port 80. Live browser data is `/events` SSE; RotorHazard uses
its separate `/api/rh/events` stream. The current UI does not need the old
Electron wrapper or Web Serial transport. Do not describe SSE as WebSocket
port 81.

## Firmware development

Board pin and feature definitions are in `lib/CONFIG/config.h`. Target build
flags determine USB networking, Ethernet, LCD, PSRAM and dependencies. A field
such as `speakerEnabled` surviving in EEPROM does not mean the feature is built.

For EEPROM changes, preserve layout/migration compatibility and review config
load, defaults, setters and JSON import/export together. Add board identity
in the environment, `FPVGATE_BOARD_ID` and release metadata together.
C5MK AIO must stay C5-only across every load/setter path.

Keep sample reception and peak detection independent of HTTP/SD latency.
C5 events carry sample-derived timestamps; host arrival time and the nominal
20 ms review graph are not substitutes. HTTP race commands queue work for
`C5RaceControl`; do not perform duplicate browser history saves for
`gateManaged` sessions. [Gate completion](GATE_RACE_COMPLETION.md) documents
asynchronous stop/save and retry semantics.

`lib/EVENTDIRECTOR/` binds loaded Event heats to C5 races, persists results and
loads the next group. Keep its lease, revision and journal boundaries intact;
see [Event progression](GATE_EVENT_PROGRESSION.md). Never mirror a gate-owned
Event result into a second browser-side record.

The raw board definitions expose unresolved custom-target pin conflicts.
Do not silently change an established wiring diagram by changing code during
a documentation pass; qualify any proposed hardware change separately.

## Web interface development

Edit the source in `data/`, run focused tests, build/upload LittleFS and reload
the browser. A simple static HTTP server can preview layout, but cannot supply
the device API, SSE or storage. Use fixtures for isolated page tests; a preview
alone does not validate timing or race persistence.

New visible strings should use locale keys. Add English and the other locale
entries or verify fallback behavior. Keep UI and firmware config units aligned:
minimum lap is tenths of a second; heat time is 30-second blocks; RSSI display,
raw C5 values and RH scaling differ.

For themes, follow the variables and class names in `data/themes.css` and the
existing UI selector. Test mobile layouts, an active race and history editing.
Browser audio requires a gesture and may use OS voices even with SD packs.

## Testing

From the repository root:

```sh
npm test --prefix tests -- --runInBand
```

The suite executes extracted production page logic and includes compiled
firmware configuration/race-controller coverage; it is no longer four
browser-only suites. Check the test runner for current counts.

Native C5 completion/history checks on Windows:

```powershell
./tests/native/build_race_control.ps1
./tests/native/build_event_director.ps1
python -m unittest discover -s tests -p test_package_release.py -v
```

RH timing simulator (Bash and `g++`):

```sh
bash tests/native/build_rh_timing_sim.sh
python -m unittest discover -s tests/native -p test_post_soak_diagnostics.py -v
```

The post-soak tests need separately checked-out RH/C5 sources and their
documented environment variables. See [native tests](../tests/native/README.md)
for diagnostic variants and [validation plan](../tools/VALIDATION_PLAN.md)
for device/load checks.

A native simulator does not test FreeRTOS timing, real SD media, RF peaks or a
camera timing reference. Read the [post-soak investigation](RH_POST_SOAK_INVESTIGATION.md)
before interpreting identical-input or live/Marshal comparisons as RF accuracy.

## Debugging

`DEBUG(...)` is the actual logging macro; `LOG_ERROR`/`LOG_WARN` macros described
in older docs are not implemented. The ring buffer holds 100 entries.
`lib/DEBUG/debug.h` sets 460800 baud; target monitor settings may differ
(the LCD target uses 921600). USB CDC does not have a physical UART baud rate.

Useful endpoints are `/version`, `/status`, `/api/system/info`,
`/api/debuglog` and `/api/c5/race`. Diagnostics may expose more detailed USB
and C5 traces; some options mutate/clear state, so read the implementation
before using them as passive probes.

## Contributing and release process

Keep changes scoped, explain behavior and validation, and update the relevant
current guide. Preserve historical release notes and dated experiments as
records rather than rewriting them as current instructions.
[Release process](RELEASE_PROCESS.md) is the single packaging/publishing guide.
Changing `FPVGATE_VERSION` alone neither builds nor publishes artifacts.
