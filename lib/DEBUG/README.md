# DEBUG library

The current public macro is `DEBUG(format, ...)`, defined in `debug.h` through
`debuglogger.h`. It uses printf-style arguments and writes the same formatted
message to CDC/serial and a 100-entry in-memory ring buffer.

```cpp
#include "debug.h"
DEBUG("Receiver state=%s, samples=%lu\n", state, sampleCount);
```

Each entry contains a millisecond timestamp and `char message[256]`, so at
most 255 message bytes plus terminator are retained. Serial output is
`[timestamp] message`. Include a newline when you want one.

## API

```cpp
DebugLogger& logger = DebugLogger::getInstance();
const std::vector<DebugLogger::LogEntry>& entries = logger.getBuffer();
logger.clear();
```

`log(const char*, ...)` is the class logging method. There is no
`logWithLevel` or implemented `LOG_ERROR/LOG_WARN/LOG_INFO/LOG_SUCCESS/LOG_DEBUG`
macro set. The previous color-level examples were not supported by this header.
Prefixes are not ANSI color sequences.

## Configuration and limits

`DEBUG_BUFFER_SIZE` is 100; `SERIAL_BAUD` in `debug.h` is 460800.
The LCD target's monitor setting is 921600. USB CDC line coding is not a
physical UART bit rate; match UART monitor settings to the actual build.
Startup also has an early serial initialization before DEBUG initialization.

The buffer is volatile, not persisted across reboot, and the header does not
provide a synchronization primitive for concurrent writers/readers.
Avoid logging from interrupts or high-rate sample loops. Check lifetime and
thread safety before retaining a reference while another task logs/clears.

`GET /api/debuglog` exposes the retained log to the diagnostics page.
Capture useful output with firmware stage, board, receiver and reproduction
details. Avoid logging keys or passwords.
