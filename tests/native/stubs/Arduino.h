// Host stand-in for the Arduino core: a settable clock and no-op spinlocks.
#pragma once
#include <stdint.h>
#include <string.h>

extern uint64_t g_nowUs;
inline uint32_t micros() { return (uint32_t)g_nowUs; }
inline uint32_t millis() { return (uint32_t)(g_nowUs / 1000); }

struct portMUX_TYPE { int unused; };
#define portMUX_INITIALIZER_UNLOCKED {0}
#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
