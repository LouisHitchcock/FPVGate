# USB Networking on ESP32-S3 — findings

> **Looking for how to use USB networking?** See
> [USER_GUIDE.md § USB Connection](USER_GUIDE.md#usb-connection-esp32-s3-firmware-180-and-later)
> for connecting, supported systems and troubleshooting. This document is an
> engineering log of how the feature was built and what failed on the way; it is
> written for whoever maintains the USB code, not for people using a gate.

Record of the investigation into presenting FPVGate over USB-C as a network
interface, so the existing web UI is reachable at a URL without WiFi.

Status: **the full FPVGate web UI now loads over USB-C on the AIO target**,
but the firmware resets after sustained load. See section 5 for the exact
state, what is proven, and what is still open.

### Verification update ? 2026-09-11, follow-up session

This update supersedes the causal conclusions in the earlier handoff below.
After a user power cycle, a USB-bound HTTP request returned 200 but stalled
at **29,925 bytes** and timed out after eight seconds. Serial was untouched
until after that request. A single subsequent CDC capture showed:

- uptime increasing from 35 to 50 seconds, `reset_reason=1` (power-on);
- RX increasing from 715 to 730, TX frozen at 47, drops increasing 30 to 44;
- `state=0x115`: USB ready and RNDIS data-ready, but `can_xmit` clear;
- `in_done=45`, `in_fail=0`, `defer_lost=0` throughout.

This proves a TX stall during a live boot in this run; it does not establish
the cause of earlier USB disconnects. Identical archived dumps prove only
that no new dump was saved, not that a panic was impossible. Re-enumeration
alone does not distinguish a USB reset from a CPU reboot.

The `in_done` increment is in the bulk IN completion branch. Its displayed
value can be stale: snapshots are taken only after the TX queue has been idle
for a second. The earlier assertion that the counter is misplaced is unsupported.

The bundled FreeRTOS `osal_queue_send` uses an indefinite queue wait for
non-ISR callers. Therefore `usbd_defer_func(..., false)` is not silently
lost on a full queue as previously claimed, and the 200 ms semaphore timeout
does not bound the preceding defer call. ISR event enqueue can fail, but queue
flooding as the cause of this stall remains a hypothesis.

A diagnostic-only firmware adds `[USB IN]` with software busy/stall flags,
last submitted/completed lengths and read-only S3 DWC2 IN registers. It built
successfully and was flashed at 0x10000 with hash verification. The board
remained in the bootloader after the uploader reset; runtime validation is
pending a normal reconnect. No TX recovery behavior has been added.

### Confirmed task-watchdog reset ? follow-up load test

The diagnostic firmware served 12 complete 104,486-byte pages. The thirteenth
connection failed and CDC disconnected. After re-enumeration, one serial open
captured `reset_reason=6` at uptime 35, 40 and 45 seconds. This confirms a
**task-watchdog reset in this run**. It does not identify the responsible task
or explain the earlier TX-only stall. Logs are in `.dev/verification-watchdog-confirmed.log`
and `.dev/verification-after-failure.log`.

The next diagnostic revision samples endpoint state on every TX attempt as
well as idle periods, and reports task watchdog subscriptions, task states,
and stack high-water marks. It does not disable or feed the watchdog. This
revision built successfully and was flashed with hash verification; runtime
validation is pending a normal reconnect from bootloader COM11.

### Packet-pool candidate ? flashed, runtime validation pending

Task diagnostics showed `async_tcp` subscribed to TWDT, while IDLE0, IDLE1,
loopTask, usbd and usbnet_tx were not. The next run completed one page and
stalled on the second; output stopped after the heap line, before the USB
status line (whose first operation waits synchronously on lwIP). This narrows
the investigation but is not a stack trace of the blocked task.

Source review found a 1516-byte automatic Packet in `transmit()`, called on
lwIP's 2560-byte stack. The candidate replaces frame-by-value queuing with a
nine-packet static pool (eight queued plus one in flight). The compiled
`transmit()` stack frame is now 48 bytes. It also retains each request until
its deferred callback acknowledges completion: a 200 ms timeout records the
delay, but cannot release/reuse a buffer that a late callback still owns.
The worker waits in blocked semaphore calls; lwIP continues to enqueue without
waiting, or returns an error when the pool/queue is full.

This removes stack pressure and a callback lifetime race; neither is yet
proven to cause the observed watchdog reset. Diagnostics now print task state
and stack watermarks, including lwIP's `tiT`, before waiting on lwIP status.
The AIO build and `git diff --check` pass. The candidate was flashed via ROM
COM11 at 0x10000 with hash verification (`.dev/usbnet-pool-flash.log`). The
board remains in the bootloader after uploader reset; a normal reconnect is
needed before runtime validation.

### FIFO mapping candidate ? flashed, runtime validation pending

The packet-pool firmware still stalled on its first page. It remained alive
through uptime 35 seconds, with `reset_reason=1`, lwIP `tiT` stack headroom
1588, and USB control/RX progressing. Bulk IN reported busy=1, stalled=0,
submit=1534, complete=102, ctl=0x80898040, size=0x00b00000, FIFO free=256.
The captured log is `.dev/usbnet-pool-runtime.log`. Thus the pool change does
not fix the hardware TX stall, and watchdog stability remains unproven.

The map/disassembly establishes that Arduino links **dcd_esp32sx.c**, not
portable/synopsys/dwc2/dcd_dwc2.c. The old driver selects TXFNUM using FIFO
allocation order but writes its size/offset at `dieptxf[epnum - 1]`. These
indices differ in this composite: RNDIS notification EP3 is assigned FIFO1,
RNDIS bulk EP1 FIFO2, and CDC bulk EP4 FIFO3. EP5 is the dedicated notification
endpoint in the bundled driver. This is an allocation mapping problem, not
proof that five IN endpoints exceed the S3's capacity.

Source: https://raw.githubusercontent.com/hathach/tinyusb/0.16.0/src/portable/espressif/esp32sx/dcd_esp32sx.c
(the bundled binary also includes an EP5 special case).

The AIO-only `--wrap=dcd_edpt_open` candidate in `usbnet_fifo.c` records the
size/offset produced by the original driver and restores it to the selected
FIFO after each open. Previously assigned FIFOs are restored too, because a
subsequent open can overwrite them. The first FIFO allocation clears saved
state after reset/close-all. No framework package files are patched. Hardware
validation is still pending; this mapping bug is not yet a proven explanation
for all earlier failures.

Validation: AIO build passed; disassembly confirms `usbd_edpt_open` calls the
wrapper. A host C harness compiled the actual wrapper with simulated registers
and passed composite mapping, overwrite restoration, dedicated EP5/OUT/EP0,
failed-open and reset cases. `git diff --check` passed. The candidate was flashed
at 0x10000 via COM11 with hash verification (`.dev/usbnet-fifo-flash.log`).
The device remains in the bootloader and needs a normal reconnect for testing.

### FIFO candidate runtime ? still failing

The FIFO wrapper firmware loaded three complete pages (104,486 bytes each),
then the fourth timed out before a response. Serial output stopped too, but
CDC COM18 remained present. A subsequent USB-bound GET /status timed out and
ping failed 2/2. This run does not establish whether the CPU rebooted.

Before load, the IN snapshot showed `config=0x002f0073`, FIFO free=47, versus
256 in the preceding stalled build. Thus the intended register change took
effect, but the wrapper is **not a validated stability fix**. The run used
continuous serial capture. Next comparison: power-cycle and load-test with
CDC completely closed, before making any additional firmware changes.
Log: `.dev/usbnet-fifo-runtime.log`.

### Serial-closed test and single-packet candidate

With CDC unopened throughout the load, the FIFO-wrapper build completed 17
pages before request 18 timed out. A single subsequent serial capture showed
uptime 55?60 seconds, reset_reason=1, continued RX, sent=1481, in_done=1480,
and bulk IN busy on submit=1534 with size=0x00b00000. lwIP stack headroom
remained 1588. This proves the TX-only stall also occurs without CDC capture.
Logs: `.dev/usbnet-network-only.log`, `.dev/usbnet-network-only-after.log`.

The next candidate splits RNDIS bulk IN into one 64-byte USB packet per DCD
submission, advancing on completion. Only the final short packet or ZLP ends
the frame. This avoids the old controller driver's multi-packet refill path;
it is a workaround under test, not a proven root-cause fix. It retains the
packet pool and FIFO wrapper for a controlled comparison against this run.

Build passed. A host harness using the production submission/completion code
passed lengths 0, 1, 63, 64, 65, 128 and 1534, payload ordering, final short/ZLP,
and submission failure. Firmware was flashed at 0x10000 with hash verification
(`.dev/usbnet-single-packet-flash.log`). Device remains on ROM COM11 and needs
a normal reconnect before the next serial-closed load test.

### Single-packet result and USB task affinity candidate

The single-packet firmware completed 41 pages, then request 42 timed out.
CDC remained unopened during load. Afterwards, uptime 80?85 seconds and
reset_reason=1 confirmed the same boot. IN was busy on submit=64, complete=64,
size=0x00080040, FIFO free=47. RX/control still progressed and lwIP retained
1588 bytes of stack headroom. Logs: `.dev/usbnet-single-packet-runtime.log`
and `.dev/usbnet-single-packet-after.log`. Splitting transfers therefore did
not eliminate the stall; the pending submission had not filled its FIFO.

The next candidate pins Arduino's `usbd` task to its creator's core. The
configured main task runs on CPU0 and installs TinyUSB/its interrupt before
creating an unpinned `usbd`. The legacy DCD ISR continues examining transfer
state after queuing a completion; an unpinned USB task can process that event
and re-arm the endpoint concurrently on the other core. This is a plausible
race matching the empty, enabled endpoint, not yet a proven runtime cause.

`usbnet_task.c` wraps xTaskCreatePinnedToCore only for an unpinned task named
usbd. Other tasks and explicit affinities pass through unchanged. Host tests
of the actual wrapper passed task selection, argument/result forwarding and
preservation of explicit affinity. Task diagnostics now print affinity.
The packet pool, FIFO wrapper and single-packet submissions remain in this
candidate to change only affinity for the next comparison. The AIO build
passed, and disassembly confirms tinyusb_init calls the task wrapper. Firmware
was flashed at 0x10000 with hash verification (`.dev/usbnet-affinity-flash.log`).
Runtime validation is pending a normal reconnect from ROM COM11.

### USB task affinity runtime - best result so far, not a proven fix

The affinity firmware was load-tested in three configurations.

Network-only (CDC never opened): 60 consecutive 104,486-byte pages, all
HTTP 200, ~1.0 s each, no failure. The test ended because it ran out of
iterations, not because the device stalled. Previous best was 41.
Log: `.dev/usbnet-affinity-network-only.log`.

Mixed traffic with CDC capture active: HTML, JavaScript (322,198 bytes),
CSS and API endpoints in rotation. Request 12 timed out after 299,008 of
322,198 bytes. Bulk IN showed the familiar busy=1, stalled=0, submit=64,
size=0x00080000. Log: `.dev/usbnet-affinity-mixed.log`.

Mixed traffic with CDC never opened: 80 requests completed, roughly 9.5 MB,
before request 81 failed with a TCP reset rather than a timeout. The device
recovered on its own: ping 1 ms, `/status` 200 three times, and two complete
322,198-byte `/script.js` transfers immediately afterwards. A single serial
capture then showed `reset_reason=6` at uptime 30 s. The failure was therefore
a task-watchdog reset the device recovered from, not the unrecoverable TX
stall seen in every earlier run. Logs: `.dev/usbnet-affinity-mixed-noserial.log`,
`.dev/usbnet-affinity-mixed-noserial-after.log`.

Evidence pointing away from USB for this particular failure: `async_tcp` is the
only task subscribed to the TWDT (`wdt=ESP_OK`); IDLE0, IDLE1, loopTask, tiT,
usbd and usbnet_tx all report `ESP_ERR_NOT_FOUND`. Heap minimum-free-ever fell
from 140 KB to 66 KB during the post-failure window, with `dropped=43` and
`pending=3`. The `usbd` stack high-water mark stayed healthy at 2868-2952.

Limits of this evidence. This is one run per configuration. The affinity change
sits on top of the packet pool, the FIFO wrapper and single-packet submissions,
all still enabled, so the improvement cannot be attributed to any single
candidate. One snapshot at uptime 40 s showed `busy=1 size=0x00080000` again,
which a single sample cannot distinguish from a normal in-flight transfer, so
the TX stall is not established as eliminated. No stack trace names the task
that tripped the watchdog; async_tcp is a correlation, not a confirmed cause.

User-reported bench behaviour: ordinary interactive use of the page with a
serial terminal open behaves normally, but the serial monitor silently stopped
and needed a disconnect/reconnect while the web page kept working. That matches
the one-directional silent stall signature and is consistent with the CDC
channel stalling rather than the board resetting, though it was not measured.

Next planned step: repeat the CDC-closed mixed test two to three times. Failure
clustering near 80 requests with `reset_reason=6` and a ~66 KB heap floor would
isolate async_tcp heap pressure as the remaining blocker, separate from USB.


### DHCP no longer advertises the gate as a DNS server - fixed and verified

The user reported losing desktop Internet access while the board was attached.
Host inspection showed the RNDIS interface listing `192.168.7.1` as its DNS
server, while WiFi and Ethernet correctly used the ISP resolvers. Routing was
not at fault: the USB interface has no default route and an interface metric of
55, well below WiFi's 35.

Cause: in `add_offer_options()` the bundled IDF DHCP server emits
`DHCP_OPTION_DNS_SERVER` unconditionally, and when `dhcps_dns_enabled()` is
false it falls through to `ipadd`, the server's own address. The existing
`dhcps_offer_t` option API therefore cannot suppress the option. `usbnet_dhcp.c`
already suppressed the ROUTER option, but no equivalent existed for DNS.

Fix: `lib/USBNET/idf/dhcpserver.inc` now omits the option entirely when no
resolver is configured, gated behind `DHCPS_OMIT_DNS_WHEN_UNSET`, which
`usbnet_dhcp.c` defines before the include. That file is a private USB-only copy
with all symbols prefixed `usb_`, so the WiFi AP DHCP server is unaffected.

Verified on hardware after reflash and replug: the RNDIS interface no longer
appears in `Get-DnsClientServerAddress` at all, still receives `192.168.7.2` by
DHCP, the gate answers ping and serves the full 104,486-byte page, and the host
retains Internet reachability and working name resolution.

Note this was fixed on the strength of a clearly incorrect advertisement rather
than a reproduction: Internet access happened to be working at the moment of
measurement, so the causal link to the user's reported outage is likely but not
proven.


USB uses `192.168.7.1/24`, deliberately distinct from the WiFi SoftAP's
`192.168.4.1/24`.

---

## 1. Goal

Plug USB-C into the timer and have it behave as a second network interface:

- host sees a USB network adapter, **no driver install**, no COM-port picking
- device runs a DHCP server; host gets an address automatically
- browse to the device's IP and get the **existing web UI, unmodified** —
  all ~70 HTTP routes and the SSE `/events` stream
- WiFi and USB live simultaneously, from one firmware

The point of a *network* interface rather than a serial protocol: the web app
doesn't need to know which way a request arrived. There is no parallel command
table to maintain, so a route added for WiFi works over USB automatically.

**Success criterion used throughout:** open `http://<device-ip>/` in a browser
with WiFi never started, so the page can only have arrived over the cable.

---

## 2. What works

Verified on a Seeed XIAO ESP32-S3 against Windows 11 Home, build 10.0.26200.

| Check | Result |
|---|---|
| Network function | `Remote NDIS based Internet Sharing Device`, `CM_PROB_NONE` |
| Adapter | up, MAC `02:02:84:74:72:4C` (ours) |
| DHCP | host leased `192.168.4.2` |
| ICMP | 3/3 replies, 0 ms |
| HTTP | `200 OK` from `http://192.168.4.1/` |
| Serial | `USB Serial Device (COMxx)` present **at the same time** |

### Toolchain

| Component | Version |
|---|---|
| ESP-IDF | 5.4 (container `espressif/idf:release-v5.4`) |
| `espressif/esp_tinyusb` | 1.7.6~2 (pristine, unpatched) |
| `espressif/tinyusb` | 0.21.0~1 |
| Base project | `ESPNetkit/esp_usbnet_usbserial_with_web` |

Built in Docker, flashed from Windows with PlatformIO's bundled esptool.
Docker is only a build environment — nothing about it ships.

### Descriptor layout (the part that matters)

```
Device descriptor: bDeviceClass/SubClass/Protocol = EF / 02 / 01  (IAD composite)

Configuration 1
├─ RNDIS IAD                       <-- MUST BE FIRST
│  ├─ Interface 0  RNDIS control   ep 0x83 (interrupt IN, 8)
│  └─ Interface 1  RNDIS data      ep 0x04 (bulk OUT), 0x84 (bulk IN), 64
└─ CDC-ACM IAD
   ├─ Interface 2  CDC control     ep 0x81 (interrupt IN, 8)
   └─ Interface 3  CDC data        ep 0x02 (bulk OUT), 0x82 (bulk IN), 64
```

Five IN endpoints in use (EP0, 0x81, 0x82, 0x83, 0x84) — exactly
`ep_in_count` for the S3, and that is fine.

### Key sdkconfig

```
CONFIG_TINYUSB_NET_MODE_ECM_RNDIS=y
CONFIG_TINYUSB_CDC_ENABLED=y
CONFIG_TINYUSB_INIT_IN_DEFAULT_TASK=y
CONFIG_TINYUSB_TASK_AFFINITY_CPU0=y
```

DWC2 mode (`CONFIG_TINYUSB_MODE_DMA` vs `_SLAVE`) is **irrelevant** — see §4.

### Component structure

The reference app added a small `components/usbnet/` supplying what
`esp_tinyusb` does not:

- `usbnet_descriptors.c` — device, configuration and string descriptors,
  plus the `tud_network_mac_address` definition
- `usbnet_glue.c` — vendored copy of `esp_tinyusb`'s `tinyusb_net.c`

The application side (`esp_netif` with `ESP_NETIF_DHCP_SERVER`, the DHCP
server, and `esp_http_server`) is unchanged from the reference.

That ESP-IDF spike has since been removed; the shipped implementation is
the Arduino/PlatformIO integration in `lib/USBNET/` (see
`lib/USBNET/README.md`).

---

## 3. Why it works: RNDIS must be the first function

**This is the single finding that unlocked everything.**

There is a Windows quirk with ACM + RNDIS composite devices: RNDIS fails to
start with **Code 10 / `CM_PROB_FAILED_START`** unless it is the *first*
function in the configuration. CDC-ACM works in either position.

Evidence, with endpoint addresses held constant so position was the only
variable:

| Build | RNDIS position | IN endpoints | Network | CDC |
|---|---|---|---|---|
| CDC + RNDIS, DMA mode | `MI_02` | 5 | ❌ Code 10 | ✅ |
| CDC + RNDIS, slave mode | `MI_02` | 5 | ❌ Code 10 | ✅ |
| RNDIS only | `MI_00` | 2 | ✅ | n/a |
| **RNDIS first + CDC** | **`MI_00`** | **5** | ✅ | ✅ |

The last row is decisive: five IN endpoints works. Position was the cause.

### A wrong turn worth recording

For a while the conclusion was "5 IN endpoints is the ceiling, so you must
choose between USB networking and a COM port". That was wrong, and it came
from comparing RNDIS-only against CDC + RNDIS — which changed **two variables
at once** (RNDIS moved from `MI_02` to `MI_00`, *and* endpoint count dropped
from 5 to 2). Both explanations fit every observation until the confound was
broken by moving RNDIS first while keeping five endpoints.

The practical lesson: when a fix involves changing more than one thing, the
resulting "explanation" is a guess until the variables are separated.

---

## 4. What did not work, and why

### 4.1 Arduino framework — initial attempt and revised approach

`arduino-esp32` excludes the USB networking classes by design.
`libarduino_tinyusb.a` contains no `ncm_device.c` / `ecm_rndis_device.c`, and
`CFG_TUD_NCM` is never defined. Confirmed by
[arduino-esp32 #12053](https://github.com/espressif/arduino-esp32/issues/12053)
(same situation for USB Audio: *"no workaround within the Arduino framework
without rebuilding the entire core from source"*) and
[Adafruit_TinyUSB_Arduino #517](https://github.com/adafruit/Adafruit_TinyUSB_Arduino/discussions/517)
(no Arduino wrapper supports RNDIS/ECM/NCM).

Four real bugs were found and fixed while attempting it anyway. They are all
genuine and worth remembering if the Arduino path is ever revisited:

1. **The board manifest hardcodes `-DARDUINO_USB_MODE=1`** in
   `build.extra_flags`, and `build_unflags` **cannot strip flags from there**.
   Both `=0` and `=1` reached the compiler, so TinyUSB never started at all.
   Fix: override `board_build.extra_flags` wholesale.
2. **`ARDUINO_USB_ON_BOOT` is derived from `ARDUINO_USB_CDC_ON_BOOT`**
   (`USB.h:23`), so the core calls `USB.begin()` in `app_main()` *before*
   `setup()`. `tinyusb_enable_interface()` then refuses with "TinyUSB has
   already started" and the descriptor is frozen. Fix: register from a global
   constructor, exactly as `USBCDC` does for itself.
3. **`tinyusb_add_string_descriptor()` stores the pointer, not a copy.**
   Passing a stack buffer leaves a dangling pointer that the host dereferences
   during enumeration.
4. **`tud_network_recv_cb()` must not call `tud_network_recv_renew()`** —
   the driver calls the callback from inside renew, so this recurses and
   overflows the stack ([TinyUSB #2711](https://github.com/hathach/tinyusb/issues/2711)).

Also learned: under `ARDUINO_USB_MODE=0` there is **no USB-Serial-JTAG
console**, because USB-Serial-JTAG and USB-OTG are separate peripherals
sharing the same pins. Panics go to UART0 (GPIO43/44), which is unwired on
most boards. Debugging without a UART adapter is close to impossible.

### 4.2 NCM on ESP-IDF — failed, but probably for the same ordering reason

Espressif's reference NCM firmware enumerated correctly and Windows bound its
own inbox driver (`MatchingDeviceId: USB\Class_02&SubClass_0d&Prot_00`,
service `UsbNcm`), then failed with Code 10.

Ruled out at the time: stale descriptor cache (fresh VID/PID each attempt),
first-install timing, the `const ntb_parameters` flash-DMA workaround (moved
to RAM, no change), and wrong-speed descriptors (the 64-byte full-speed
variant is correctly selected).

**Retested with NCM placed first (the arrangement that fixes RNDIS): still
Code 10.** So NCM has a genuine, separate incompatibility with this host, and
the ordering quirk is RNDIS-specific:

| Build | Net position | Network | CDC |
|---|---|---|---|
| RNDIS first + CDC | `MI_00` | works | works |
| NCM first + CDC | `MI_00` | **Code 10** | works |

This vindicates the original NCM diagnosis and matches TinyUSB #2660. NCM is
not usable here. The spike kept a `USBNET_USE_NCM` switch (default 0) so it
could be retried against a future Windows or TinyUSB version; that spike has
since been removed.

### 4.3 DWC2 slave vs buffer-DMA mode — no effect

`CONFIG_TINYUSB_MODE_SLAVE=y` was tested (confirmed in
`build/config/sdkconfig.h`). CDC + RNDIS at `MI_02` fails identically under
both modes. Not a factor.

### 4.4 FIFO exhaustion — ruled out numerically

The S3 has 256 words (1024 bytes) of USB FIFO RAM. A CDC + RNDIS composite
uses roughly 128 of them including the RX FIFO and DMA metadata — about half.
Also, `fifo_size *= 2` in `dfifo_alloc()` is **not** unconditional for bulk
endpoints; it is gated on `bm_double_buffered`, which defaults to zero.

---

## 5. `esp_tinyusb` gotchas

- **Its Kconfig offers ECM/NCM/RNDIS, but its descriptor generator only
  implements NCM.** Every network block in its `usb_descriptors.c` is guarded
  by `#if CFG_TUD_NCM`, and `tusb_get_mac_string_id()` exists only there.
  Selecting `CONFIG_TINYUSB_NET_MODE_ECM_RNDIS` therefore fails to link.
  Confirmed still true in 1.7.6; reportedly also in 2.2.1.
- **`tinyusb_net.c` is only added to the build for NCM**
  ([idf-extra-components #313](https://github.com/espressif/idf-extra-components/pull/313)).
- **`tud_network_mac_address` must be defined by the application** under
  RNDIS; `esp_tinyusb` defines it only on the NCM path.
- **`fs_configuration_descriptor` only exists under `TUD_OPT_HIGH_SPEED`.**
  On a full-speed-only part like the S3 the field is
  `configuration_descriptor`.
- The descriptor pointers live in **anonymous unions**, so a designated
  initializer trips `-Werror=missing-braces`. Assign fields individually.
- Custom descriptors are supplied through `tinyusb_config_t` — a supported
  API. **Do not patch `managed_components/`**; any dependency update silently
  overwrites it.

---

## 6. Diagnostics that proved useful

- **`tud_mounted()` / `tud_connected()` reported over CDC.**
  `process_set_config()` calls each class driver's `open()` in descriptor
  order and zeroes `_usbd_dev.cfg_num` if any fails. So `tud_mounted() == 1`
  means every device-side endpoint open succeeded and any remaining fault is
  host-side. Cheaper than instrumenting `dcd_dwc2.c`.
- **`Get-PnpDevice -PresentOnly`** is trustworthy; `Win32_PnPEntity` returns
  stale phantom entries. Confirmed by sampling across an unplug/replug —
  entries tracked the cable exactly.
- **`HKLM:\HARDWARE\DEVICEMAP\SERIALCOMM`** is authoritative for whether a COM
  port is actually live. A port can appear in Device Manager while unusable.
- **A CDC echo test** (write `PING`, expect `PING`) separates "firmware dead"
  from "host driver unhappy" in one step.
- Always use a **fresh PID** when changing descriptors, or Windows may serve
  a cached configuration.

---

## 7. Open questions

1. ~~Does NCM work when placed first?~~ **Answered: no.** Tested, still
   Code 10. NCM is off the table on this host.
2. **macOS support.** RNDIS covers Windows + Linux but **not macOS**, and NCM
   is unusable, so a **dual-configuration device** (config 1 RNDIS for
   Windows, config 2 ECM for macOS, host picks) is the only remaining route
   if Mac support is required. TinyUSB's `net_lwip_webserver` example
   implements exactly that pattern. Decide whether Mac matters before
   building FPVGate around single-config RNDIS.
3. **FPVGate integration is awaiting hardware validation.** The AIO-only
   Arduino build now contains RNDIS + CDC and an Ethernet/DHCP interface.
   It keeps the existing web server and toolchain. Arduino-as-an-ESP-IDF-component
   remains a fallback if the vendored class approach fails on hardware.
4. **Recovery flow.** With CDC present the web flasher still works, so this is
   less pressing than it appeared. `usb_persist_restart(RESTART_BOOTLOADER)`
   as a "reboot into flash mode" button remains a possible refinement.

---

## 8. References

- [ESPNetkit/esp_usbnet_usbserial_with_web](https://github.com/ESPNetkit/esp_usbnet_usbserial_with_web) — base project
- [esp32-open-source/usb-netif-example](https://github.com/esp32-open-source/usb-netif-example) — reusable `usb-netif` component
- [ESP-IDF `tusb_ncm` example](https://github.com/espressif/esp-idf/tree/v5.4/examples/peripherals/usb/device/tusb_ncm)
- [TinyUSB #2660](https://github.com/hathach/tinyusb/issues/2660) — NCM Code 10 on Windows 11
- [TinyUSB #2711](https://github.com/hathach/tinyusb/issues/2711) — NCM receive recursion
- [idf-extra-components #313](https://github.com/espressif/idf-extra-components/pull/313) — `tinyusb_net.c` not built for RNDIS
- [arduino-esp32 #12053](https://github.com/espressif/arduino-esp32/issues/12053) — USB classes disabled in prebuilt libs
- [microsoft/NCM-Driver-for-Windows](https://github.com/microsoft/NCM-Driver-for-Windows) — the inbox NCM driver's source

### Pending startup correction

The vendored class previously allowed TX as soon as endpoints opened,
independent of the host packet filter. TX now waits for RNDIS data-initialized;
reset/halt clear the stored state. The change is built and flashed but has no
runtime verdict yet; it is not a proven explanation for Code 10 or RX stalls.
See [Microsoft RNDIS state definitions](https://learn.microsoft.com/en-us/windows-hardware/drivers/network/remote-ndis-concepts-and-definitions).

Bench recovery: the latest RNDIS state-gating candidate showed repeated USB
reconnects about six seconds apart (user reported boot looping). Reset cause
was not captured. The archived pre-USB baseline has been restored with hash
verification; a subsequent 30-second serial capture showed steady uptime with no reset. Experimental source
is retained and currently differs from the board firmware.

---

## 5. Arduino integration on FPVGateAIO — current state

The spike above proved the *concept* on ESP-IDF. This section covers bringing
it into the real FPVGate firmware, which is Arduino (core 2.0.17 / IDF 4.4)
with `ESPAsyncWebServer`, on the `FPVGateAIO` target only.

### 5.1 How it is wired in

No custom Arduino core is required. `lib/USBNET/` vendors the TinyUSB **0.16.0**
RNDIS class (matching the core's bundled version) and registers it at runtime:

- `ecm_rndis_device.c`, `rndis_reports.c`, `rndis_protocol.h`, `ndis.h` are
  vendored; `net_device.h` comes from the core's include tree and was verified
  byte-identical.
- `usbd_app_driver_get_cb` is an **undefined weak reference** in the core, so
  defining it registers the `netd_*` class driver without patching anything.
- **Interface order is solved by slot choice.** The core emits interfaces in
  `tinyusb_interface_t` enum order. `USB_INTERFACE_MSC` is slot 0 and
  `USB_INTERFACE_CDC` is slot 4, so registering the RNDIS descriptor under the
  MSC slot puts RNDIS at interfaces 0/1 and CDC at 2/3 — the layout section 3
  proves is required. **USBMSC therefore cannot be used on this target.**
- Registration happens in a **global constructor**, because
  `ARDUINO_USB_ON_BOOT` is derived from `ARDUINO_USB_CDC_ON_BOOT`, so the core
  calls `USB.begin()` in `app_main()` before `setup()` runs.
- `targets/FPVGateAIO.ini` overrides `board_build.extra_flags` to set
  `ARDUINO_USB_MODE=0` (keeping `ARDUINO_USB_CDC_ON_BOOT=1`) and adds
  `CFG_TUD_ECM_RNDIS` / `CFG_TUD_NET_MTU`. `build_unflags` cannot strip flags
  that come from the board manifest, hence the wholesale override.
- IDF 4.4's DHCP server keeps its interface, server address and lease pool in
  **global state** shared with the WiFi SoftAP, so `usbnet_dhcp.c` compiles a
  namespaced private copy (`idf/dhcpserver.inc`, IDF v4.4.7, Apache-2.0) bound
  to the USB netif, leaving WiFi's server untouched.

### 5.2 What is proven working

Verified on a XIAO ESP32-S3 against Windows 11 build 26200:

| Check | Result |
|---|---|
| Enumeration | composite + RNDIS + CDC, all `CM_PROB_NONE` |
| DHCP | host leased `192.168.7.2` |
| ICMP | 3/3 at 1 ms |
| `GET /` | `200`, **104,486 bytes** (complete page) |
| `GET /script.js` | `200`, 322,198 bytes |
| `GET /style.css` | `200`, 49,230 bytes |
| `/config` `/status` `/races` `/version` | all `200` |
| Repeatability | best run **10/10** consecutive full page loads, ~1 s each |
| Serial | CDC COM port present throughout |

So the web UI genuinely transfers over the cable, and the COM port needed by
the web flasher survives alongside it.

### 5.3 Bugs found and fixed (both ours, both evidence-backed)

**1. lwIP readiness race — proven by core dump.**

```
Crashed task 'usbd'
assert failed: tcpip_inpkt lwip/src/api/tcpip.c:258 (Invalid mbox)
  tud_network_recv_cb -> esp_netif_receive -> tcpip_input -> tcpip_inpkt
```

The receive callback gated on the `netif` **pointer**, which is assigned before
bring-up completes. Since the core starts USB in `app_main()`, RNDIS can reach
*data_initialized* and the host can start sending before `usbnet_begin()` even
runs. Any packet in that window was pushed into a not-yet-ready lwIP, which
`abort()`s. Fixed with a `netifReady` flag set only after DHCP start succeeds,
plus an `esp_netif_init()` call so USB does not depend on WiFi having
initialised the stack.

**2. TinyUSB event-queue flooding — proven by reading `usbd.c`.**

`usbd_defer_func()` posts into the **same 16-entry queue**
(`CFG_TUD_TASK_QUEUE_SZ`) that carries `DCD_EVENT_XFER_COMPLETE`, and it
returns `void`, so a full queue drops the request silently. The TX retry loop
was posting ~80 defers/second, starving the completion event that re-arms
`can_xmit`; TX then wedged, which made the loop spin harder. A dropped defer
also meant `xSemaphoreTake(..., portMAX_DELAY)` blocked forever. Fixed by
capping retries at 3 spaced 10 ms apart, bounding every semaphore wait at
200 ms, and moving the TX buffers off the stack so a late callback cannot
corrupt a reused frame.

### 5.4 The open issue

**The firmware resets after roughly 15-35 full page loads (~2-3 MB).**

Everything looks healthy right up to the moment it goes:

```
heap 158-160 KB free, min 144 KB     no leak
rx   934 -> 1165 -> 1399             flowing
sent 371 -> 802 -> 1232              ~69 packets/page x 17 pages, correct
dropped=2 (constant)  defer_lost=0   in_fail=0
state=0x11d  (can_xmit + data_ready) rndis state=2
```

It is **not an ESP-IDF panic** — the coredump partition contents were byte
identical across three separate failures, so the panic handler never ran. The
device drops off USB and then re-enumerates cleanly, so it is resetting rather
than hanging. That points at a watchdog or brownout.

**Next step:** capture `reset_reason` on the boot immediately *after* a load
failure. The periodic `[USB SYS]` status line reports it, so the first status
line after recovery gives the answer. 4=PANIC, 5=INT_WDT, 6=TASK_WDT, 7=WDT,
9=BROWNOUT.

### 5.5 Diagnostics and tooling notes

This work originally carried its own partition table,
`custom_8mb_coredump.csv`, to add a coredump partition at 0x510000. That table
is gone: `custom_8mb.csv` now carries a coredump partition for every 8MB board
at **0x7F0000/0x10000**, alongside a much larger spiffs. The Arduino core already
sets `CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH=y`, but the stock table gave it nowhere
to write, so every panic was previously silent. Read and decode with:

```
esptool ... --after no_reset read_flash 0x7F0000 0x10000 coredump.bin
docker run --rm -v "<dir>:/w" -w /w espressif/idf:release-v5.4 \
  bash -lc "esp-coredump --chip esp32s3 info_corefile -t raw \
            -c /w/coredump.bin /w/firmware.elf"
```
`--chip` is a **global** option and must precede the subcommand. Always compare
the dump's hash against the previous one — an unchanged dump means no new panic
was recorded, not that the old backtrace is current.

**Serial capture will reset the board if done carelessly.** Arduino's `USBCDC`
watches the esptool DTR/RTS sequence (`USBCDC.cpp` ~205-233):

```
IDLE --(!dtr,rts)--> LINE_1 --(dtr,rts)--> LINE_2
     --(dtr,!rts)--> LINE_3 --(!dtr,!rts)--> usb_persist_restart(RESTART_BOOTLOADER)
```

Repeated open/close cycles can walk that path and reboot the device into the
ROM bootloader. This produced a completely bogus "crashes after one page"
conclusion during development. Capture with **DTR asserted and RTS low, a
single open, and no loops** — and prefer running network tests with the serial
port untouched entirely. Note DTR must be asserted or the CDC treats the host
as disconnected and suppresses output.

### 5.6 Known-imperfect diagnostics

`in_done` (IN-transfer completions) reported 27 while `sent` reached 1232 and
traffic was demonstrably flowing, so that counter is misplaced. Do not draw
conclusions from it until it is fixed.
