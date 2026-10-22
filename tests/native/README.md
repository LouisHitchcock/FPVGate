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
