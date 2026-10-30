#!/usr/bin/env bash
# Builds rh_timing_sim from the real lib/C5LINK/c5multipilot.* and the host
# stubs. The sources are copied next to the stubs so their #include "c5link.h"
# finds the stub rather than the real C5Link.
set -euo pipefail
cd "$(dirname "$0")"
out=../../.pio/hosttest
mkdir -p "$out"
cp ../../lib/C5LINK/c5multipilot.h ../../lib/C5LINK/c5multipilot.cpp stubs/*.h "$out"/
cp -r stubs/freertos "$out"/
flags=()
name=rh_timing_sim
if [[ "${1:-}" == "--no-s3-ema" ]]; then
    flags+=(-DC5_TIMING_DIAGNOSTIC_NO_S3_EMA=1)
    name=rh_timing_sim_no_ema
elif [[ $# -ne 0 ]]; then
    echo "Usage: $0 [--no-s3-ema]" >&2
    exit 2
fi
g++ -std=c++17 -O1 -Wall -Wextra "${flags[@]}" -I "$out" "$out"/c5multipilot.cpp rh_timing_sim.cpp -o "$out/$name.exe"
echo "$out/$name.exe"
