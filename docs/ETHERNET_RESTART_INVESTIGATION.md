# Ethernet restart investigation — 6 November 2026

## Premature DHCP fallback fixed

The rc.5 Ethernet gate appeared to hang after a software restart: HTTP, ping
and ARP stopped answering at its usual DHCP address. The SD log recovered
after a power cycle showed that boot 6 logged link-up at 3959 ms, then chose
the fixed fallback address at 3971 ms while claiming to have waited 45 seconds.
Heap logs continued until 1265253 ms. That boot was still running on a
different IP; the earlier outage without this evidence remains unproven.

The main loop samples its clock before calling `ethnet_update()`. An Ethernet
event can record a newer link timestamp before the update uses that sample.
Unsigned subtraction then produces an enormous age, immediately stopping
DHCP and selecting `192.168.8.1`. The faulty check exists in soaked rc.4
commit `18b1f15` and the initial Ethernet commit `542c633`; it predates rc.5.
This evidence does not implicate the new logger. Ethernet startup already
pulses the W5500 hardware reset pin.

Fix `e61891a` uses signed elapsed time and records the link timestamp before
publishing link-up. The native regression covers a newer event timestamp,
timeout boundaries and clock wrap; the old calculation fails the same test.

## Validation and remaining blocker

- 34 Python tests and 166 Jest tests passed; WaveshareS3ETH firmware built.
- App-only OTA recovered in 5.64 seconds. Configuration, race history, Event
  and receiver firmware 1.2.5 were verified preserved; filesystem untouched.
- Patched firmware SHA256:
  `7fb8de2726bc57414f06ccc6e065e21d1e237a4e9796b5cf251ac5083e2a3f87`.
- A planned 20-restart check passed the first six with DHCP and exact saved
  data comparisons. One needed two SD mount retries and took 24.8 seconds;
  the others took about 6.7 seconds.
- Restart seven obtained DHCP at 4234 ms and kept serving HTTP, but failed
  all five SD mount attempts. Event retrieval returned 404 without the card,
  so the full restart check **failed after six passes**.
- One further software restart restored SD access and logging. Configuration,
  history and Event exactly matched the pre-loop baseline. No further power
  cycle was required.

The intermittent SD mount failure remains unresolved. This is not a completed
soak or release qualification. The physical no-DHCP/direct-cable fallback
still needs validation; its timer is covered by the native regression.
Existing post-flash power-cycle advice does not remove the need for reliable
ordinary software restarts.

Raw bench evidence is retained locally under
`.dev/rc-evidence/eth-dhcp-fix-20261106/`; configuration backups and device
logs are not published with this report.

## SD reset recovery follow-up

The original patched production firmware also failed mounting with SD logging
disabled: 13 complete restarts passed, then restart 14 failed all five mount
attempts. The new logger is therefore not a necessary trigger. Manual SD init
could remount the card, but that endpoint did not reload the history cache;
a normal software restart restored all 11 saved records, config and Event.

A temporary diagnostic image captured invalid responses to CMD0
(`GO_IDLE_STATE`), followed by the driver's mount error. That boot eventually
mounted at 32 seconds. This locates the failure in the SD SPI reset handshake;
an interrupted transaction leaving the powered card in a prior state is an
explanation consistent with the observations, not a separately proven cause.

`scripts/patch_sd_warm_reset.py` backports the two-CMD0 handshake and 20 ms
settling delays from [Espressif's driver](https://github.com/espressif/arduino-esp32/blob/c1b72ee2654e7ef298e23a681dd01fb245f0748d/libraries/SD/src/sd_diskio.cpp).
It compiles a build-local driver copy for WaveshareS3ETH, leaves the installed
framework untouched and refuses an unexpected source layout. No platform
upgrade or filesystem formatting is involved. The second reset still must
succeed; the backport does not suppress a failed mount.

Three new native/Python checks cover first-command rejection, valid ordinary
responses, refusal when the second reset fails, exact/idempotent patching and
preservation of the installed framework. All 37 Python tests pass. The normal
patched app built and installed, with all saved data verified intact:
SHA256 `bc3cf8a51320d32bf0cac792132bb6570c240bddfdf293ce35ee581fa3cdc0cb`.

The normal build passed 20 consecutive restarts with SD logging enabled. Each
mounted on the first SD attempt, obtained DHCP and preserved all saved data.
The logging-off comparison also passed 20 restarts with saved data intact.
Three boots needed the existing SD mount retries; the slowest was ready after
51.41 seconds, mounting on the fifth attempt. Those recovered retries remain
explicit evidence, not first-attempt successes. A final-combination soak is
still pending. The temporary diagnostic hook is excluded from the normal build. The earlier
failed runs remain failures; diagnostic-image successes do not qualify this
production candidate.

A separate 300-second read-only AIO idle monitor recorded 280 fresh requests,
294 held requests and 290 pings with no failures. This does not clear the USB
interruptions or low-heap finding from the earlier race-day workload.

### Heap investigation checkpoint, 6 November

The subsequent retry was stopped on qualification failure; no overnight run is
active. The harness now stops on its first FAIL/ERROR and accepts an external
stop file so heap and network monitors can stop it and restore saved data.
The existing 40,000-byte internal-heap qualification floor remains unchanged.

An isolated AIO history request with a 33,567-byte response reduced internal
heap to 37,152 bytes. An experimental immutable history snapshot, allocating
its JSON tree and response in PSRAM where available, raised that isolated
minimum to 70,960 bytes while preserving the response contents. This is a
partial improvement, not a qualified fix. Five concurrent history/static-file
responses with a drained RotorHazard event stream still reached 35,112 bytes
after an additional experimental PSRAM response-buffer change. That check
failed and no long soak followed it. Both candidate application installs
passed configuration, history and Event preservation checks.

At the next diagnostic attempt, the AIO's USB network adapter and COM23 were
absent from Windows; its first HTTP connection timed out and ping failed.
The probe stopped before sending any further workload. Ethernet remained
reachable. Whether the AIO was physically disconnected or failed in firmware
has not yet been established. Do not attribute this disappearance to the
candidate without that distinction. Evidence is held locally under
`.dev/rc-evidence/heap-investigation-20261106/`.


## Confirmed Ethernet UART FIFO overflow ? 7 November 2026

Run-06-uart-diagnostic reproduced the failure at 12:53:40 UTC during one-pilot RH heat 21, about 13m43s into its diagnostic phase. At the same event the driver reported **one UART FIFO overflow**, the parser reported **two CRC errors**, and sequence-discontinuity events rose by two. Invalid lengths, invalid record shapes, driver ring-buffer-full, sample queue drops, framing, parity and break counts were all zero. Receiver stayed online. Both lanes stopped and gate config/history plus native scanner restoration passed. Run-05 is preserved as a preflight-only 503 busy failure; no races started there.

Confirmed mechanism: bytes lost at the S3 UART hardware FIFO. This explains this test failure; it does NOT establish the cause of the older Ethernet warm-restart hang, or rule out a separate AIO hardware fault. The exact critical section/interrupt delay causing overflow is not yet isolated. No EEPROM write appears immediately around either observed active-race failure.

Candidate mitigation: configure the C5 UART RX-full interrupt at 64 bytes instead of Arduino core default 120, retaining 921600 baud and the existing 16 KB software ring. On a 128-byte FIFO, nominal remaining wire time increases from roughly 87 us to 694 us. Startup refuses to continue if configuring the threshold fails. Retain hardware and CRC/length/shape counters and fail on their increase. Tradeoff: more frequent RX interrupts; a long mixed-workload regression is required. Do not claim fixed/qualified before results.

Only Ethernet firmware is changed; AIO remains parked. Next run: Ethernet + standalone COM29, 20-minute rehearsal then eight hours if it passes, strict first-failure stop and baseline restoration. Physical RF coverage remains excluded.
