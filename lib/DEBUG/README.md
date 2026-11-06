# DEBUG library

`DEBUG(format, ...)` (from `debug.h`) takes printf-style arguments. Each call
writes `[millis] message` to serial and to a log ring. Include a newline when
you want one; a line is cut at 255 bytes.

```cpp
#include "debug.h"
DEBUG("Receiver state=%s, samples=%lu\n", state, sampleCount);
```

## The log ring

`logring.h` holds the ring: 8 KB of the newest log text, kept in RAM that the
ESP32 does not clear on a crash, watchdog or software reset. A checksum tells a
ring left by the previous boot from power-on contents, so after a crash the
lines that led up to it are still there. A power loss clears it. Each boot
starts with a line giving the boot number and reset reason.

`DebugLogger` copies into and out of the ring under a short critical section,
so any task can log. It never holds the lock around I/O.

## Saving to the SD card

Off by default. When `/logs/enabled` exists on the SD card, a priority-1 task
on core 0 appends the ring to `/logs/log.txt` every 5 seconds, in chunks of up
to 2 KB, through `Storage` and its SPI lock. At 256 KB the file becomes
`/logs/log.1.txt` (replacing the older one). The first write after a crash
saves what the crash left unsaved. Nothing is written without a card, so the
log never wears the board's flash. Messages logged by the writer task itself
(storage diagnostics) go to serial only.

## Endpoints

- `GET /api/debuglog`: recent lines as `{logs: [{seq, timestamp, message}]}`.
  `seq` orders lines across boots, where timestamps restart from zero.
- `GET /api/log/status`: whether saving is on, bytes saved, unsaved, lost and
  failed writes, and file sizes.
- `POST /api/log/sd?enabled=1|0`: turn saving on or off (needs a card).
- `GET /api/log/file?part=0|1`: download `log.txt` or `log.1.txt`.

The Diagnostics screen's **Download log.txt** combines these with system, C5
and crash information into one file for bug reports.
