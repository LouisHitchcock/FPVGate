# AIO USB networking

Experimental RNDIS + CDC integration for the Arduino-ESP32 2.0.17 build.
Enabled only by `FPVGATE_USB_NET` on `FPVGateAIO`. USB uses
`192.168.7.1/24`; WiFi SoftAP keeps `192.168.4.1/24`.

Current bench status: DHCP and initial ping pass after restarting the Windows
RNDIS adapter to clear Code 10. A later boot enumerated automatically and
returned HTTP 200 with a partial page before RX stopped progressing. CDC
and TX remain alive; the complete web UI is unverified. Temporary five-second serial diagnostics report packet
counters, lwIP flags, startup status, and port-80 listener count. Endpoint
diagnostics also count RX rearm failures/errors and sample OUT busy/stall state
on the TinyUSB task. A host adapter restart did not recover a stalled RX path.

The RNDIS descriptor occupies Arduino's unused MSC registration slot so its
interfaces precede CDC. Do not enable USBMSC on this target. Registration
runs before Arduino starts USB, while `usbnet_begin()` starts Ethernet/DHCP
after the application initializes WiFi's network stack.

Transmit frames are copied into an eight-frame queue. A worker schedules
TinyUSB operations on the USB task and retries busy endpoints for 100 ms.
Receive buffers are copied before being passed to the Ethernet netstack;
returning false tells the RNDIS driver to renew its receive transfer.

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

`idf/dhcpserver.inc` is a vendored copy of
`components/lwip/apps/dhcpserver/dhcpserver.c` from ESP-IDF v4.4.7 (Apache-2.0):
https://github.com/espressif/esp-idf/blob/v4.4.7/components/lwip/apps/dhcpserver/dhcpserver.c

Upstream SHA256: `A7FF751CF191DE080F60BF592DE26A3B8768785C774E4CE9BD1B824B4CB7C8C4`.
Local change: return UDP bind errors so startup can report and clean up failures.
The `.inc` suffix keeps PlatformIO from compiling it separately.
`usbnet_dhcp.c` namespaces its exported symbols, binds it to USB, and runs its
lease timer on lwIP. This avoids IDF 4.4's singleton DHCP state colliding with
WiFi AP. USB does not advertise itself as an Internet gateway.

Hardware validation is tracked in `.dev/PROGRESS.md`. A successful build alone
does not establish USB enumeration, DHCP, HTTP, or flashing compatibility.

RNDIS transmit is gated on the host enabling a nonzero packet filter. Bus
reset, INITIALIZE, RESET and HALT clear the stored state/filter. This local
protocol fix is built/flashed but awaiting runtime verification. Endpoint
state diagnostics include bit 16 for RNDIS data-ready.

Bench recovery: the latest RNDIS state-gating candidate showed repeated USB
reconnects about six seconds apart (user reported boot looping). Reset cause
was not captured. The archived pre-USB baseline has been restored with hash
verification; a subsequent 30-second serial capture showed steady uptime with no reset. Experimental source
is retained and currently differs from the board firmware.
