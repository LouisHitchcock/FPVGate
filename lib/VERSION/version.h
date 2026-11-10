#ifndef VERSION_H
#define VERSION_H

// FPVGate Firmware Version
#define FPVGATE_VERSION "1.9.0"
#if defined(C5_SHARED_MEDIAN_MS) && C5_SHARED_MEDIAN_MS > 0
#define FPVGATE_VERSION_STAGE "rc.5-c5mk130-parity-8d99548"
#elif defined(C5_TIMING_DIAGNOSTIC_NO_S3_EMA)
#define FPVGATE_VERSION_STAGE "rc.5-ema-probe"
#else
#define FPVGATE_VERSION_STAGE "rc.5"
#endif

// Build version string helper
#define FPVGATE_VERSION_STRING() \
    (String(FPVGATE_VERSION) + (strlen(FPVGATE_VERSION_STAGE) > 0 ? String("-") + String(FPVGATE_VERSION_STAGE) : String("")))

#endif // VERSION_H
