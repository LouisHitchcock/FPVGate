# Native (PC) harness

`rh_timing_sim` runs the gate's real C5 lap detection (`lib/C5LINK/c5multipilot.*`)
on the PC with stub Arduino, `Config` and `C5Link` headers, and prints the
`rhPass` and `rhRssi` events the RotorHazard plugin would receive.

```bash
bash tests/native/build_rh_timing_sim.sh   # prints the path of the built .exe
```

The fpvgate-rh-plugin repo's `tests/test_history_timing.py` uses it to check that
RotorHazard's Marshal recalculation lands on the live pass times
(`GATE_RH_SIM=<that path>`).

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
npm test --prefix tests -- --runInBand
```
