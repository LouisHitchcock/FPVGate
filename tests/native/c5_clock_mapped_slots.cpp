// Regression: every C5 slot must show RSSI when scan records are clock-mapped
// the way C5Link maps them.
//
// C5Link sets clockOffset = min(receipt - t0), so a record's first slot lands on
// its receipt time and slot i on receipt + dt_i: later slots are stamped up to a
// cycle ahead of the S3's clock when C5MultiPilot reads them. With the shared
// median, an unsigned sample age wrapped there, reset the per-slot filters on
// almost every sample and left R3-R8 at 0 on the AIO (fixed in 64e0559).
//
// Built twice by build_c5_slot_test.sh: with the legacy EMA and with
// C5_SHARED_MEDIAN_MS=95. Exit 0 only if all 8 slots are live at every
// receipt-to-processing delay.
#include "c5multipilot.h"
#include <cstdio>
#include <cstdlib>

uint64_t g_nowUs = 0;

static bool run(double cycleUs, int processMaxUs, bool print) {
    Config config;
    config.enter = 72;
    config.exit = 68;
    config.raceMask = 1;
    const uint16_t f[8] = {5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917};
    for (int i = 0; i < 8; ++i) config.frequencies[i] = f[i];
    C5Link link;
    C5MultiPilot multi;
    multi.begin(&config, &link);
    srand(1);
    double t0 = 1000000.0;
    unsigned live[8] = {};
    const int cycles = 4000, warm = 200;
    for (int cycle = 0; cycle < cycles; ++cycle) {
        const double receiptMin = t0 + cycleUs + 600.0;   // record sent after the cycle
        const double step = cycleUs / 8.0;
        for (int i = 0; i < 8; ++i) {
            const uint16_t level = (uint16_t)(110 + 10 * i + rand() % 9);
            link.samples[i].push_back({level, (uint32_t)(receiptMin + i * step)});
        }
        g_nowUs = (uint64_t)(receiptMin + rand() % 200 + 50 + rand() % processMaxUs);
        multi.update((uint32_t)(g_nowUs / 1000));
        if (cycle >= warm)
            for (int i = 0; i < 8; ++i) if (multi.rssi(i)) ++live[i];
        t0 += cycleUs;
    }
    bool ok = true;
    for (int i = 0; i < 8; ++i) ok &= live[i] >= (unsigned)(cycles - warm) * 9 / 10;
    if (print || !ok) {
        printf("cycle %.0f us, processing up to %d us: live cycles per slot", cycleUs, processMaxUs + 250);
        for (int i = 0; i < 8; ++i) printf(" %u", live[i]);
        printf(" -> %s\n", ok ? "ok" : "FAIL");
    }
    return ok;
}

int main() {
    bool ok = true;
    const double cycles[] = {925.0, 1381.0};
    const int processing[] = {150, 800, 1500, 3000};
    for (double c : cycles)
        for (int p : processing) ok &= run(c, p, true);
    printf("%s\n", ok ? "PASS: all 8 slots live" : "FAIL");
    return ok ? 0 : 1;
}
