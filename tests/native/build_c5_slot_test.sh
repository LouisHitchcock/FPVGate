#!/usr/bin/env bash
# Builds and runs c5_clock_mapped_slots against the real lib/C5LINK sources
# and the host stubs, once with the legacy EMA and once with the shared
# median (C5_SHARED_MEDIAN_MS=95, the FPVGateC5MKAIO setting). Fails if any
# C5 slot loses its RSSI under realistic clock-mapped sample times.
set -euo pipefail
cd "$(dirname "$0")"
out=../../.pio/hosttest-slots
mkdir -p "$out"
cp ../../lib/C5LINK/c5multipilot.h ../../lib/C5LINK/c5multipilot.cpp \
   ../../lib/C5LINK/jump_reject.h ../../lib/C5LINK/rssi_filter.h ../../lib/C5LINK/rssi_median.h \
   stubs/*.h "$out"/
cp -r stubs/freertos "$out"/
status=0
for mode in legacy median95; do
    flags=()
    [[ $mode == median95 ]] && flags+=(-DC5_SHARED_MEDIAN_MS=95)
    g++ -std=c++17 -O1 -Wall -Wextra "${flags[@]}" -I "$out" "$out"/c5multipilot.cpp c5_clock_mapped_slots.cpp \
        -o "$out/c5_clock_mapped_slots_$mode.exe"
    echo "== $mode"
    "$out/c5_clock_mapped_slots_$mode.exe" || status=1
done
exit $status
