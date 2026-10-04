# FPVGate ESP32-C5 RF Node — Agent Build Specification

## Mission

Build the separate ESP32-C5 firmware that acts as FPVGate's RF co-processor.
The FPVGate S3 remains responsible for Wi-Fi, web UI, race state, pilot
configuration, and lap presentation. The C5 is responsible for tuning its
5.8 GHz receiver path and continuously reporting a normalized RSSI value.

The C5 must support one active RF receiver being time-sliced across up to eight
pilot frequencies. It must never report samples while a retune is in progress.

The S3-side implementation is in `lib/C5LINK/` and is selected with
`receiverRadio = 2`.

## Hardware and UART

Default wiring to an FPVGate ESP32-S3:

| FPVGate S3 | ESP32-C5 | Notes |
|---|---|---|
| GPIO43 TX | C5 RX | Crossed UART data line |
| GPIO44 RX | C5 TX | Crossed UART data line |
| GND | GND | Required |
| 5 V / suitable supply | C5 supply | Use the carrier's regulated supply limits |

The S3 pin definitions can be overridden with `C5_UART_RX_PIN` and
`C5_UART_TX_PIN`. The UART is:

* 921600 baud
* 8 data bits, no parity, 1 stop bit
* No hardware flow control
* Newline-terminated ASCII messages

The C5 firmware must not mix debug text into this UART. Use a separate USB
console or compile-time debug output that is disabled on the link UART.

## Line framing

Every line has this form:

```text
<payload>*<HH>\n
```

`HH` is two uppercase hexadecimal digits containing the XOR of every byte in
`payload`, excluding `*`, the checksum, and the newline.

Example:

```text
S,5732,40,OK,1*61\n
```

The receiver must:

1. Accumulate until `\n`.
2. Strip an optional `\r`.
3. Split at the final `*`.
4. Verify exactly two hexadecimal checksum characters.
5. Drop malformed or checksum-invalid lines.
6. Recover cleanly at the next newline after an invalid/oversized line.

Maximum expected line length is under 96 bytes.

## Messages

### S3 → C5 commands

| Payload | Meaning | Required response/behavior |
|---|---|---|
| `F,<MHz>` | Tune RF center frequency | Validate range, enter `TUNING`, stop `R` samples, retune, then emit `S,<MHz>,<gain>,OK,<fw>` or an error state |
| `G,<gain>` | Set fixed RF gain index | Accept 0–89. Apply it before returning to `OK`. |
| `Q` | Status request | Immediately emit a status line. |

The C5 must reject frequencies outside **5180–5885 MHz** with `ERR_FREQ`.
It must not emit RSSI samples for an invalid frequency.

The S3 may send `F` followed immediately by `G`. The C5 should process both
commands in order and emit a final `OK` status after both have taken effect.

### C5 → S3 samples

```text
R,<sequence>,<rssi>
```

* `sequence`: unsigned 8-bit counter, wrapping 255 → 0.
* `rssi`: unsigned integer 0–255.
* Target rate: approximately 1 kHz while in `OK` state.
* Do not send `R` while `TUNING`, `ERR_FREQ`, or `ERR_RF`.

The S3 associates incoming samples with the currently selected pilot slot.
Therefore, after reporting `OK`, the C5 must keep reporting samples for that
frequency until it receives another valid tune command.

### C5 → S3 status

```text
S,<MHz>,<gain>,<state>,<firmware>
```

Valid states:

* `OK` — measuring at the reported frequency.
* `TUNING` — retune in progress; no `R` lines are sent.
* `ERR_FREQ` — requested frequency is outside 5180–5885 MHz.
* `ERR_RF` — RF/PHY retune or initialization failed.

Send status:

* Once during boot after RF initialization.
* After every `F` or `G` command.
* At least once per second as a heartbeat.
* Immediately after `Q`.

`firmware` should be a short version string or integer with no commas. The
current S3 parser expects the first four fields and tolerates the final field.

## RF measurement requirements

The RF implementation is platform-specific, but its external behavior must be:

1. Initialize the ESP32-C5 5 GHz receive path without enabling Wi-Fi AP/STA
   traffic.
2. Tune to the requested FPV frequency.
3. Disable/freeze packet AGC if required for stable analog-carrier power
   measurement.
4. Capture a repeatable power estimate.
5. Convert that estimate to a monotonic 0–255 RSSI value.
6. Stream samples at a stable approximately 1 kHz cadence.

RSSI does not need to be calibrated in dBm. FPVGate only needs a repeatable
relative signal level suitable for per-pilot enter/exit thresholds. Avoid
changing gain during a pass; gain is configured before racing.

The recommended measurement shape is a short IQ power window:

```text
power = mean(I² + Q²)
rssi  = clamp(log-scaled power, 0, 255)
```

The exact window size and scaling can be tuned experimentally, but the mapping
must not jump or wrap and must remain stable at idle for calibration.

## Retune and timing contract

The S3 currently advances pilot slots every 20 ms and sends a new `F` command
for the next configured frequency. The C5 must:

* Stop `R` output as soon as a valid `F` command is accepted.
* Emit `TUNING` promptly.
* Complete the retune and settle the receiver before emitting `OK`.
* Resume `R` only after `OK`.
* Remain on that frequency until the next `F` command.
* Avoid emitting stale samples from the previous frequency after `TUNING`.

If retuning cannot settle within the current 20 ms slot, report `TUNING` or
`ERR_RF` rather than sending samples that could be assigned to the wrong pilot.
The S3 will tolerate missing samples but must not receive mislabelled samples.

On boot, the C5 should remain idle or use its last known safe configuration,
then accept the S3's initial `Q`, `F`, and `G` commands. Do not require a
special handshake beyond the line protocol.

## Persistence and recovery

Recommended behavior:

* Store the last valid frequency and gain in C5 NVS after successful tuning.
* On C5 reboot, initialize RF safely and send a status line.
* The S3 resends configuration periodically, so the C5 must be safe if it
  starts with no active frequency.
* Never report `OK` for a frequency that failed validation or RF setup.
* Continue sending heartbeat status even when no valid frequency is active.

## Reference command examples

```text
# S3 requests status
Q*51

# S3 selects pilot frequency R3 and gain 40
F,5732*60
G,40*74

# C5 reports tuning then ready
S,5732,40,TUNING,1*??
S,5732,40,OK,1*61

# C5 reports samples
R,0,12*??
R,1,14*??
R,2,143*??
```

Do not copy the `??` values: calculate checksums programmatically. The exact
checksum algorithm is XOR, not CRC.

## Host-side acceptance tests

The C5 agent should provide a host-testable protocol module or a Python test
tool that can run without hardware. At minimum test:

### Framing

* Valid line accepted.
* Wrong checksum rejected.
* Missing checksum rejected.
* Lowercase/non-hex checksum rejected or normalized consistently.
* Oversized line discarded and parser resynchronizes at the next newline.
* CRLF input accepted.

### Commands

* `F,5180` accepted.
* `F,5885` accepted.
* `F,5179` returns `ERR_FREQ` and no `R` samples.
* `F,5886` returns `ERR_FREQ` and no `R` samples.
* `G,0`, `G,40`, and `G,89` accepted.
* Invalid gain is rejected or clamped deterministically.
* `Q` returns a status immediately.

### Runtime

* No `R` samples during `TUNING`.
* `R` resumes only after `OK`.
* Sequence wraps from 255 to 0.
* Heartbeat appears at least once per second.
* A failed retune produces `ERR_RF`, not false `OK`.
* A tune followed by a second tune cannot leak samples from the first
  frequency after the second `TUNING` begins.

### Bench validation

With a known FPV video transmitter:

1. Tune to a supported channel and verify the idle RSSI is stable.
2. Move the transmitter through the gate and verify one clear RSSI peak.
3. Repeat at low and high transmitter power.
4. Retune repeatedly between at least four channels and verify each status
   frequency matches the requested frequency.
5. Run eight configured slots and verify each slot produces samples without
   corrupting the next slot's frequency assignment.

## Definition of done

The C5 side is ready for FPVGate integration when:

* It builds and flashes on the target ESP32-C5 board.
* UART framing and checksums pass host tests.
* `Q`, `F`, and `G` work at 921600 baud.
* RSSI samples are monotonic, bounded 0–255, and approximately 1 kHz in `OK`.
* No samples are emitted during tuning/error states.
* Four-channel and eight-channel round-robin bench tests complete without
  parser desynchronization or frequency/sample mix-ups.
* The agent supplies the C5 firmware repository/path, build command, flash
  command, UART pin overrides if different from the defaults, and test logs.

## Important scope boundary

Do not merge C5 RF implementation code into the FPVGate S3 firmware. Keep the
RF-node firmware as a separate program with the protocol above as its stable
interface. The S3-side integration is intentionally independent of the RF
implementation details.
