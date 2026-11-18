# USB networking

Current alpha exposes RNDIS networking and CDC serial together on the six
shipping targets: `ESP32S3`, `SeeedXIAOESP32S3`, `FPVGateAIO`, `FPVGateSolo`,
`FPVGateC5MKAIO` and `WaveshareS3ETH`. It is enabled by `FPVGATE_USB_NET`;
retained Plus, LCD, LilyGO and Super Mini targets do not define that flag.

## Connect

Use a data cable on the S3's native USB port. Windows/Linux should enumerate
a network adapter and serial port. The gate is `192.168.7.1/24` and normally
leases `192.168.7.2` to the host. Open `http://192.168.7.1`; there is no
COM-port connection step in the browser. The serial port is for diagnostics
and flashing. macOS cannot use this RNDIS transport; use Wi-Fi or Ethernet.

Wi-Fi remains available. S3-ETH suspends USB networking while an Ethernet
link is connected; its USB descriptors/serial port can remain visible even
when the USB network interface has no address. For direct Ethernet use
[the separate setup](WAVESHARE_S3_ETH.md).

After flashing, power-cycle if the board stays in its bootloader. Check the
native-versus-UART connector and close serial monitors before trying another
flash. BOOT recovery is available if normal firmware does not start.
See [user connection instructions](USER_GUIDE.md#connecting-to-fpvgate).

## Implementation

The shipping legacy-core environments use espressif32 6.9.0 / Arduino-ESP32
2.0.17. Their target flags select native TinyUSB, RNDIS and CDC and enable
linker wrappers. Do not assume those fixes can be dropped unchanged into the
pioarduino LCD target.

`lib/USBNET/` registers the composite interface, initializes lwIP and a private
DHCP instance, and copies network frames into a bounded transmit pool.
A readiness gate prevents the USB receive callback from feeding lwIP before
the netif is ready. There are nine TX frames: up to eight queued plus one
in flight. Late callbacks retain ownership of their buffers.

The vendored DCD fixes FIFO interrupt synchronization, the legacy local-reset
path and write-one-to-clear interrupt handling. Additional FIFO/ISR/task
wrappers and repair telemetry are in `usbnet_fifo.c`, `usbnet_txfe.c` and
`usbnet_task.c`. See [source provenance](../lib/USBNET/README.md).
Do not enable USBMSC in the descriptor slot used for networking or compile
a second TinyUSB core into these builds.

## Diagnostics and validation

Useful endpoints include:

| Endpoint | Purpose |
| --- | --- |
| `/api/usbnet/status` | Interface/readiness, pool and transfer counters |
| `/api/usbnet/regs` | Low-level endpoint/register diagnostics |
| `/api/system/info` | Board/build, memory, app and filesystem sizes |
| `/version` | Device firmware label |

Some query parameters change repair settings or clear diagnostics; a plain
read is different from requesting those actions. Use the actual route source
before treating a diagnostic tool as non-mutating.

A stalled transfer can return HTTP 200 headers and an incomplete body. Check
received length against Content-Length; status alone is insufficient.
Use `tools/concurrent_load.py` for synchronized page-asset bursts and
`tools/reliability_check.py` for longer mixed load. The latter calls the
self-test, which performs temporary hardware/storage checks.

Do not describe past failures or a particular clean run as the current state
of every board. Record firmware commit, target, receiver firmware, host/driver,
transport, duration, failures and whether recovery was unaided.
The [validation plan](../tools/VALIDATION_PLAN.md) explains remaining gaps.

## Historical investigation

The earlier engineering diary, including superseded hypotheses and measured
bench runs, is preserved in
[USB networking investigation](archive/USB_NETWORKING_INVESTIGATION.md).
Its "pending" statements are historical, not present release status.
The alpha source includes the fixes; this documentation pass does not flash
a board or requalify USB on every target.

## Core dumps

For 8 MB layouts, the coredump partition is `0x7F0000` / `0x10000`.
The current 16 MB partition table has no coredump entry. Read the installed
partition table before issuing a dump command; do not apply an 8 MB address
to every board.

Decode with the matching ELF/build and toolchain. An unchanged dump only says
no new dump was recorded; it does not prove that a failed transfer could not
have involved a reset. CDC reconnects can themselves affect boot/reset state,
so avoid repeated uncontrolled serial open/close cycles during an experiment.
