#ifndef VERSION_H
#define VERSION_H

// FPVGate Firmware Version
#define FPVGATE_VERSION "1.7.2"
#define FPVGATE_VERSION_STAGE ""  // Options: "dev", "alpha", "beta", "" (empty for release)

// Build version string helper
#define FPVGATE_VERSION_STRING() \
    (String(FPVGATE_VERSION) + (strlen(FPVGATE_VERSION_STAGE) > 0 ? String("-") + String(FPVGATE_VERSION_STAGE) : String("")))

#endif // VERSION_H
