# ESP32-C5 receiver integration contract

This is the alpha S3/C5 integration reference, replacing the early
single-frequency-only build specification. C5 firmware is maintained separately
in [FPVGateC5MK](https://github.com/LouisHitchcock/FPVGateC5MK).
The S3 implementation is `lib/C5LINK/c5link.h/.cpp` and
`c5multipilot.h/.cpp`; the external
[link protocol](https://github.com/LouisHitchcock/FPVGateC5MK/blob/main/docs/LINK_PROTOCOL.md)
is the byte-level companion reference.

## Responsibilities and wiring

The C5 tunes/captures RF samples. The S3 owns pilot configuration, per-pilot
peak detection, browser/API presentation and C5 race completion/storage.
Select `receiverRadio=2`; C5MK AIO enforces this value.

UART is 921600 baud, 8N1, no hardware flow control, 3.3 V logic.
Cross TX/RX and share ground. Host pins are board-specific: XIAO S3/AIO/Solo
use TX GPIO4/RX GPIO5; DevKitC and S3-ETH use TX43/RX44.
C5 RX/TX depend on its board (XIAO C5 GPIO23/24 versus C5-Zero GPIO4/5).
The [user wiring guide](C5_MULTI_PILOT.md#what-you-need) has the connection table.
Do not inject debug output into the link UART.

## Protocol capabilities

Protocol capability numbers are distinct from the semantic firmware version.

| Capability | S3 behavior |
| --- | --- |
| 1 | Legacy `F`/`G`/`Q` text commands and host-controlled slot cycling |
| 2+ | `P` pilot list and binary multi-slot scan records |
| 3+ | Reported board/version and chunked application update over UART |

A current scanner serves up to eight enabled slots on one time-sliced RF path.
A typical eight-slot rate is about 1 kHz per pilot, but validate measured
throughput, sequence gaps and queue drops rather than assuming a fixed rate.
The valid range is **5180–5917 MHz**, replacing the old 5885 MHz ceiling.

## Text framing

Text uses `<payload>*<HH>\n`, where HH is the two-digit uppercase XOR of the
payload bytes. Lines and binary records share the stream; the parser must
recover after invalid lengths/checksums and keep binary payload bytes intact.

| Command/status | Purpose |
| --- | --- |
| `Q` | Request status / detect capabilities |
| `G,<gain>` | Fixed gain (0–89 for the supported receiver contract) |
| `F,<MHz>` | Legacy single-frequency tuning |
| `P,<MHz>,...` | One frequency per slot; 0 disables a slot |
| `S,<MHz>,<gain>,<state>,<fw>[,<version>,<board>]` | Status and capability/version/board |
| `R,<seq>,<rssi>` | Legacy single-frequency sample |

Use reported status and current firmware scale handling instead of assuming
that every `R` sample is permanently 0–255. Scan values are 10-bit.
State names include SCAN, TUNING, OK and error/update states.

## Binary scan record consumed by C5Link

```text
0xA5, length, payload[length], crc8
payload:
  'M'          type
  seq          uint8 cycle counter
  t0           uint32 little endian
  slotMask     uint8
  per enabled slot, in physical slot order:
    value      uint16 little endian
    dt         uint16 little endian
```

CRC-8 covers length and payload (polynomial 0x07, initial value 0).
Value bits 0–9 contain RSSI 0–1023; bit 15 marks a failed capture, which is
discarded as a sample. `t0 + dt` represents that slot's sample time, not host
arrival time. Validate length, mask and checksum before using a record.
Track sequence loss separately from queue overflow and malformed data.

S3 reception uses a 16 KB UART buffer, bounded polling chunks (1024 bytes)
and sample queues of 128 per pilot. Long HTTP/SD stalls can still exceed
those bounds. The nominal online timeout is 2500 ms.

## Detection and race timing

The S3 filters samples and detects each pilot independently using stored
Enter/Exit thresholds scaled by four from the 0–255 configuration range.
A C5 pass stays open across brief dips and closes after 300 ms below Exit.
Peak samples, not message arrival, determine pass timestamps.

Nominal 20 ms SD review frames are a separate, lower-resolution recording
pipeline. Their plotted peaks must not be treated as the full-rate detector
input or proof of absolute physical timing accuracy.
The production EMA remains enabled; `FPVGateC5MKAIO_EMAProbe` is diagnostic
only. See [the post-soak evidence](RH_POST_SOAK_INVESTIGATION.md).

## Firmware update contract

The S3 checks the receiver's reported board and image metadata, starts an
update with `U,<bytes>,<sha256>`, waits for ready, sends acknowledged
`0xA6` records containing `'W'`, a uint32 offset and data, then finishes with
`E`. Update replies begin `u,`. Success requires the expected new version and
a working link after reboot, not merely an HTTP upload response.
Do not send an S3 image or a different C5 board's image.

Use Settings' supported update flow on compatible C5 firmware.
The C5's rollback/confirmation behavior is implemented in its own repository;
validate that exact receiver version before relying on it during recovery.

## Acceptance checks

Validate text/binary framing, corrupt CRC/length, sequence wrap, sparse masks,
stale data, all slots Off, frequency bounds, queue pressure and reconnect.
Use the native detector/race harnesses for deterministic timing/state tests,
then exercise real UART, RF, SD and network contention on hardware.

Test all eight *independent* transmitters before claiming eight-pilot RF
qualification. Four same-frequency slots or identical-input fixtures exercise
different properties. [Validation plan](../tools/VALIDATION_PLAN.md).
