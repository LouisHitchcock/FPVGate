# AIO USB networking

Experimental RNDIS + CDC integration for the Arduino-ESP32 2.0.17 build.
Enabled only by `FPVGATE_USB_NET` on `FPVGateAIO`. USB uses
`192.168.7.1/24`; WiFi SoftAP keeps `192.168.4.1/24`.

Current bench status: complete HTTP assets have transferred in prior runs, but
USB networking remains unstable. In the latest verified run, the first page
stalled at 29,925 bytes while serial uptime and RX continued. TX remained
blocked with `can_xmit` false. See `docs/USB_NETWORKING.md`'s verification
update for current evidence and corrections to the earlier reset diagnosis.
The diagnostic firmware adds read-only bulk IN endpoint register snapshots;
it is built/flashed but awaiting a normal reconnect and runtime testing.

The RNDIS descriptor occupies Arduino's unused MSC registration slot so its
interfaces precede CDC. Do not enable USBMSC on this target. Registration
runs before Arduino starts USB, while `usbnet_begin()` starts Ethernet/DHCP
with an explicit lwIP initialization and a receive-readiness gate.

Transmit frames use a fixed pool of nine packets, with up to eight packet
pointers queued and one in flight. This avoids a 1516-byte automatic frame on
lwIP's 2560-byte stack. A worker schedules TinyUSB operations on the USB task,
with up to three attempts spaced 10 ms apart. A callback delay beyond 200 ms
is counted, but its packet stays owned until completion to prevent reuse by a
late callback. A stalled USB task can block the worker; the bounded pool keeps
lwIP enqueue nonblocking. The packet-pool candidate is flashed with hash verification; runtime testing
is pending a normal reconnect from the bootloader.
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

RNDIS data readiness is currently diagnostic only: `tud_network_can_xmit`
returns `can_xmit` without testing the packet filter. Earlier notes describing
a state-gated candidate or restored baseline no longer describe current source.

The AIO target now wraps `dcd_edpt_open` to correct the bundled
`dcd_esp32sx.c` FIFO-register indexing mismatch. See `usbnet_fifo.c` and the
latest FIFO mapping entry in `docs/USB_NETWORKING.md`. The wrapper is built,
linked and flashed, with simulated-register tests passing. Hardware testing
still failed after three full pages with CDC capture active. The next test
will keep serial closed; this is not yet a validated stability fix. The
framework installation is unchanged.

Latest candidate splits bulk IN into 64-byte DCD submissions to avoid the old
controller driver's multi-packet refill path. Build and host framing checks
passed; flashed with hash verification, awaiting runtime testing. The preceding
FIFO-wrapper firmware still stalled after 17 pages with serial closed.

The single-packet test still stalled at request 42. The flashed candidate also
pins the unpinned usbd task to its creator's core (CPU0), to prevent concurrent
transfer re-arming against the legacy DCD ISR. Build, wrapper tests and link
verification passed.

Affinity runtime results, one run each. Network-only: 60/60 pages, no failure.
Mixed traffic with CDC capture active: stalled at request 12. Mixed traffic with
CDC closed: 80 requests (~9.5 MB), then a task-watchdog reset (`reset_reason=6`)
that the device recovered from unaided, unlike every earlier unrecoverable TX
stall. `async_tcp` is the only TWDT subscriber and heap minimum fell to 66 KB,
so the remaining failure may not be a USB fault. Four candidates are enabled
together, so no single one is credited. See the affinity runtime section in
`docs/USB_NETWORKING.md` for the evidence and its limits.
