// Runs the gate's C5MultiPilot (lib/C5LINK) on the PC and prints the
// RotorHazard plugin events it would send, shaped as in
// Webserver::sendRhUpdates. Built by build_rh_timing_sim.sh.
//
// stdin, one per line, in time order:
//   sample <us> <pilot> <raw 0-1023>   a C5 sample (taken at <us>)
//   poll <us>                          the web task's 20 Hz RotorHazard update
// stdout: one "rhPass <json>" or "rhRssi <json>" per event.
#include <stdio.h>
#include <string.h>

#include "c5multipilot.h"

uint64_t g_nowUs = 0;

int main() {
    Config config;
    C5Link link;
    C5MultiPilot multi;
    multi.begin(&config, &link);
    multi.setPassStream(true);
    char cmd[16];
    unsigned long long us;
    while (scanf("%15s %llu", cmd, &us) == 2) {
        g_nowUs = us;
        if (!strcmp(cmd, "sample")) {
            unsigned pilot, raw;
            if (scanf("%u %u", &pilot, &raw) != 2) return 2;
            link.queue[pilot].push_back({(uint16_t)raw, (uint32_t)us});
            multi.update((uint32_t)(us / 1000));
            continue;
        }
        multi.update((uint32_t)(us / 1000));
        C5Pass pass;
        while (multi.takePass(pass)) {
            const uint32_t now = (uint32_t)us;
            printf("rhPass {\"node\":%u,\"us\":%llu,\"peak\":%u,\"rawPeak\":%u,\"levelUs\":%llu}\n", pass.pilot,
                   us - (uint32_t)(now - pass.crossingUs), pass.peak / 4, pass.peak, us - (uint32_t)(now - pass.levelUs));
        }
        C5Peak peaks[C5Link::C5_MAX_PILOTS];
        for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) peaks[i] = multi.takeRhPeak(i);
        const uint32_t now = (uint32_t)us;
        printf("rhRssi {\"rssi\":[");
        for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) printf(i ? ",%u" : "%u", peaks[i].level);
        printf("],\"raw\":[");
        for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i) printf(i ? ",%u" : "%u", peaks[i].value);
        printf("],\"us\":%llu,\"peakAge\":[", us);
        for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i)
            printf(i ? ",%lu,%lu" : "%lu,%lu", (unsigned long)(now - peaks[i].firstUs), (unsigned long)(now - peaks[i].lastUs));
        printf("],\"levelPeakAge\":[");
        for (uint8_t i = 0; i < C5Link::C5_MAX_PILOTS; ++i)
            printf(i ? ",%lu,%lu" : "%lu,%lu", (unsigned long)(now - peaks[i].levelFirstUs),
                   (unsigned long)(now - peaks[i].levelLastUs));
        printf("],\"in\":%u}\n", multi.inside(0) ? 1u : 0u);
    }
    return 0;
}
