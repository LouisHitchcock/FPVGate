#!/usr/bin/env bash
# Builds rh_timing_sim from the real lib/C5LINK/c5multipilot.* and the host
# stubs. The sources are copied next to the stubs so their #include "c5link.h"
# finds the stub rather than the real C5Link.
set -euo pipefail
cd "$(dirname "$0")"
out=../../.pio/hosttest
mkdir -p "$out"
cp ../../lib/C5LINK/c5multipilot.h ../../lib/C5LINK/c5multipilot.cpp stubs/*.h "$out"/
g++ -std=c++17 -O1 -Wall -Wextra -I "$out" "$out"/c5multipilot.cpp rh_timing_sim.cpp -o "$out"/rh_timing_sim.exe
echo "$out/rh_timing_sim.exe"
