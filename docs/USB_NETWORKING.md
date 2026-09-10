# USB Networking on ESP32-S3 — findings

Record of the investigation into presenting FPVGate over USB-C as a network
interface, so the existing web UI is reachable at a URL without WiFi.

Status: **working in a standalone ESP-IDF spike** (`test/ncm_idf/`). Not yet
integrated into the FPVGate firmware.

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

### 4.1 Arduino framework — abandoned

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

**Important:** `esp_tinyusb`'s NCM descriptors also place CDC first with NCM
at `MI_02`. Given §3, that failure was very likely the same ordering quirk
rather than an NCM/Windows incompatibility. **This is untested and worth
retrying** — see §7.

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

1. **Does NCM work when placed first?** If so it replaces RNDIS and restores
   macOS support. Highest-value next test.
2. **Protocol coverage.** RNDIS: Windows + Linux, **not macOS**. NCM:
   Windows 11 + macOS + Linux. A dual-configuration device (config 1 RNDIS,
   config 2 ECM) is the belt-and-braces answer if both matter.
3. **FPVGate integration is not started.** Everything above is the ESP-IDF
   reference app. FPVGate is Arduino — ~16k lines across 23 modules, plus
   `ESPAsyncWebServer`, ElegantOTA, LVGL, TFT_eSPI, FastLED, ESP8266Audio,
   arduinoWebSockets. The likely bridge is Arduino-as-an-ESP-IDF-component,
   which also affects the release and web-flasher pipeline. Needs scoping.
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
