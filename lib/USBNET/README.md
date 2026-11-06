# USB networking implementation

RNDIS + CDC for the shipping Arduino-ESP32 2.0.17 builds, enabled by
`FPVGATE_USB_NET`. The six shipping target files enable it; this is no longer
an AIO-only candidate. USB is `192.168.7.1/24` and Wi-Fi AP `192.168.4.1/24`.
S3-ETH suspends USB networking when Ethernet link is up.

See [current usage and diagnostics](../../docs/USB_NETWORKING.md) and
[historical investigation](../../docs/archive/USB_NETWORKING_INVESTIGATION.md).
Earlier notes saying a particular candidate is awaiting a reconnect described
specific experiments and are not the current integration state.

## Current architecture

Registration occurs before Arduino USB startup. lwIP/DHCP readiness gates
receive delivery. TX uses nine frame buffers (eight queued, one in flight);
callback ownership prevents reuse after a diagnostic timeout. Queue/pool
bounds keep lwIP enqueue nonblocking, but do not establish a universal
end-to-end timeout.

The target flags enable the vendored controller driver and FIFO, interrupt
and task-affinity wrappers. Keep their link configuration together with the
source and verify the link map when changing toolchain/library versions.
RNDIS occupies Arduino's unused MSC registration slot: do not also enable
USBMSC or compile another copy of the TinyUSB core.

## Vendored sources

`tinyusb/` contains TinyUSB 0.16.0 sources (MIT notices retained):

- `src/class/net/ecm_rndis_device.c`
- `lib/networking/rndis_reports.c`
- `lib/networking/rndis_protocol.h`
- `lib/networking/ndis.h`

Upstream: https://github.com/hathach/tinyusb/tree/0.16.0

Local changes: `rndis_reports.c` is guarded by `FPVGATE_USB_NET` so other
targets cannot pull in RNDIS symbols. The device source includes `class/net/net_device.h` from the
Arduino framework instead of a sibling header. It also contains temporary
RX rearm/completion counters and an endpoint-state diagnostic accessor. The framework supplies all
other TinyUSB headers and the USB core; do not compile a second USB core.

`tinyusb/dcd_esp32sx.c` is the ESP32-S2/S3 controller driver exactly as
Arduino-ESP32 2.0.17 builds it (MIT): espressif/esp32-arduino-lib-builder
`release/v4.4`, `components/arduino_tinyusb/src/dcd_esp32sx.c`, upstream
commit 3eb9cb0, SHA-256 of the unmodified file
`e76f7ff75e0bb9d2a4dce47650cf5d5293f0436abb134c53bd8293d98b06630c`. It is not
upstream TinyUSB's file. Three fixes are marked `FPVGate:` (DIEPEMPMSK
spinlock, no local reset on DIEPINT bit 15, GINTSTS cleared write-1 only); see
`docs/USB_NETWORKING.md`, "Root causes found". It replaces the archive's copy
at link time; `usbnet_txfe.c` references it so the linker takes it.

`idf/dhcpserver.inc` is a vendored copy of
`components/lwip/apps/dhcpserver/dhcpserver.c` from ESP-IDF v4.4.7 (Apache-2.0):
https://github.com/espressif/esp-idf/blob/v4.4.7/components/lwip/apps/dhcpserver/dhcpserver.c

Upstream SHA256: `A7FF751CF191DE080F60BF592DE26A3B8768785C774E4CE9BD1B824B4CB7C8C4`.
Local change: return UDP bind errors so startup can report and clean up failures.
The `.inc` suffix keeps PlatformIO from compiling it separately.
`usbnet_dhcp.c` namespaces its exported symbols, binds it to USB, and runs its
lease timer on lwIP. This avoids IDF 4.4's singleton DHCP state colliding with
WiFi AP. USB does not advertise itself as an Internet gateway.

## Verification

A build proves compile/link compatibility, not enumeration, DHCP, sustained
transfer integrity or RF timing. Run the page-load and reliability procedures
in [the validation plan](../../tools/VALIDATION_PLAN.md) and record exact
target/commit/host details. Diagnostic status query options may change repairs;
plain status reads are different from A/B controls.

There is no single current hardware validation state implied by this source
README. Dated measurements and unresolved issues remain in the investigation
record and release notes.
