// Host Arduino stand-in shared by the timing and race-control simulations.
#pragma once
#include <cstdint>
#include <cstring>
#include <string>

extern uint64_t g_nowUs;
inline uint32_t micros() { return (uint32_t)g_nowUs; }
inline uint32_t millis() { return (uint32_t)(g_nowUs / 1000); }
class String : public std::string {
public:
    using std::string::string;
    String() = default;
    String(const std::string& s) : std::string(s) {}
    explicit String(int n) : std::string(std::to_string(n)) {}
};
struct portMUX_TYPE {};
#define portMUX_INITIALIZER_UNLOCKED {}
#define portENTER_CRITICAL(mux) ((void)(mux))
#define portEXIT_CRITICAL(mux) ((void)(mux))
