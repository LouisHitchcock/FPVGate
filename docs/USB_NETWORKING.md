# USB Networking on ESP32-S3 — findings

Record of the investigation into presenting FPVGate over USB-C as a network
interface, so the existing web UI is reachable at a URL without WiFi.

Status: **the full FPVGate web UI now loads over USB-C on the AIO target**,
but the firmware resets after sustained load. See section 5 for the exact
state, what is proven, and what is still open.

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

`test/ncm_idf/components/usbnet/` supplies what `esp_tinyusb` does not:

- `usbnet_descriptors.c` — device, configuration and string descriptors,
  plus the `tud_network_mac_address` definition
- `usbnet_glue.c` — vendored copy of `esp_tinyusb`'s `tinyusb_net.c`

The application side (`esp_netif` with `ESP_NETIF_DHCP_SERVER`, the DHCP
server, and `esp_http_server`) is unchanged from the reference.

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
not usable here. The `USBNET_USE_NCM` switch in `usbnet_descriptors.c` is kept
at 0 so it can be retried against a future Windows or TinyUSB version.

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

A coredump partition was added (`custom_8mb_coredump.csv`, AIO only, at
0x510000/0x10000). The Arduino core already sets
`CONFIG_ESP_COREDUMP_ENABLE_TO_FLASH=y`, but the stock partition table gave it
nowhere to write, so every panic was previously silent. Read and decode with:

```
esptool ... --after no_reset read_flash 0x510000 0x10000 coredump.bin
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
