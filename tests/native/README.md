# Native (PC) harnesses

Run commands from the FPVGate repository root. Install `npm install --prefix tests`
for Jest, and put C++17 `g++` on PATH. The PowerShell build script calls `g++`
directly; `CXX` is supported by the Jest config test, not that script.

`rh_timing_sim` runs the gate's real C5 lap detection (`lib/C5LINK/c5multipilot.*`)
on the PC with stub Arduino, `Config` and `C5Link` headers, and prints the
`rhPass` and `rhRssi` events the RotorHazard plugin would receive.

```bash
bash tests/native/build_rh_timing_sim.sh   # prints the path of the built .exe
```

For bench isolation only, `bash tests/native/build_rh_timing_sim.sh --no-s3-ema`
builds a separate `rh_timing_sim_no_ema.exe` without replacing the default
simulator. The corresponding hardware environment is
`FPVGateC5MKAIO_EMAProbe`, labelled `1.9.0-alpha-5-ema-probe`. It bypasses the
additional S3 EMA throughout the C5 detector/UI pipeline; it is not a shipping
target or an established accuracy fix. Restore released firmware after testing.

The fpvgate-rh-plugin repo's `tests/test_history_timing.py` uses it to check that
RotorHazard's Marshal recalculation lands on the live pass times
(`GATE_RH_SIM=<that path>`).

For current limitations see [the validation plan](../../tools/VALIDATION_PLAN.md)
and [the post-soak evidence](../../docs/RH_POST_SOAK_INVESTIGATION.md).
The offline Python suite can be run with
`python -m unittest discover -s tests/native -p test_post_soak_diagnostics.py -v`.
Cross-project cases skip unless `RH_SOURCE`/`C5_SOURCE` and the C5 simulator
are provided; report skips separately from passes.

The timing and race-control harnesses share their Arduino/Config/C5Link
stand-ins, with explicit settings in the RH timing simulator so integration
does not silently change its thresholds or clocks.

`build_race_control.ps1` compiles the production C5 detector and race controller
and runs gate completion/history/retry checks. It also verifies that RH's raw
pass stream continues after the local gate race finishes. This is a simulated
timer/history writer, not a physical SD or FreeRTOS scheduling test.

The Jest suite's `config-c5mk-aio.test.js` now compiles the production config
header and selected Config methods for all six shipping boards. It needs a
C++17 compiler (`g++` by default, or set `CXX`) and checks board identity,
C5 UART pins, receiver defaults, saved-config loading and all setter inputs.

```powershell
./tests/native/build_race_control.ps1
./tests/native/build_event_director.ps1
npm test --prefix tests -- --runInBand
```

The Event harness requires real ArduinoJson headers (installed by a firmware
build), or `-ArduinoJsonPath <ArduinoJson/src>`. It compiles the production Event
director/controller/detector and checks schedule progression, journal/reboot
recovery, large histories, revisions and retry without duplicate results.
Storage/history are simulated. Jest's `storage-replacement.test.js` separately
compiles production replacement/recovery methods with filesystem fault injection.
Neither test proves physical media durability. See
[Event progression](../../docs/GATE_EVENT_PROGRESSION.md).
