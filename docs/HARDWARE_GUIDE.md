# FPVGate hardware guide

This guide describes `V1.9.0-alpha` (currently `1.9.0-alpha-5`).
Board wiring comes from `lib/CONFIG/config.h`; build capabilities come from
`targets/*.ini` and `platformio.ini`. A source target is not a promise that a
prebuilt alpha image exists.

## Choose a timer and receiver

The timer is an ESP32-S3. Use an SPI-enabled RX5808 for one pilot, or a separate
ESP32-C5 running [FPVGate C5MK](https://github.com/LouisHitchcock/FPVGateC5MK)
for up to eight pilot slots. The C5 is a receiver co-processor, not a replacement
for the S3 running this repository. Novacore remains a conventional receiver
option in settings; its filter controls do not configure the C5.

| PlatformIO environment | Configured flash | Filesystem offset | Alpha 5 package | USB networking |
| --- | --- | --- | --- | --- |
| `ESP32S3` | 8 MB | `0x410000` | Yes | Yes |
| `SeeedXIAOESP32S3` | 8 MB | `0x410000` | Yes | Yes |
| `FPVGateAIO` | 8 MB | `0x410000` | Yes | Yes |
| `FPVGateSolo` | 8 MB | `0x410000` | Yes | Yes |
| `FPVGateC5MKAIO` | 8 MB | `0x410000` | Yes | Yes |
| `WaveshareS3ETH` | 16 MB | `0x610000` | Yes | Yes, while Ethernet is disconnected |
| `XIAOS3Plus` | 16 MB | `0x610000` | No | No |
| `ESP32S3SuperMini` | 4 MB | `0x290000` | No | No |
| `LilyGOTEnergyS3` | 8 MB layout | `0x410000` | No | No |
| `WaveshareESP32S3LCD2` | 16 MB chip; 8 MB layout | `0x410000` | No | No |

USB networking requires `FPVGATE_USB_NET`; a USB-C connector or a CDC serial port
alone does not provide it. All of the six shipping environments define it.
`FPVGateLCDAIO.ini` is not included by `platformio.ini` and is not an available
release environment.

The [Seeed XIAO S3 family documentation](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)
distinguishes the 8 MB S3 and 16 MB Plus variants. Check the actual module before
choosing an image. The `ESP32S3` build deliberately does not enable PSRAM on the
DevKitC-1 N8. GPIO35–37 used for its external SD card are unsuitable on an
octal-PSRAM module. Do not substitute an N8R8 board without reviewing its pins.

The [LilyGO T-Energy S3 V1.0](https://github.com/Xinyuan-LilyGO/T-Energy-S3)
has 16 MB flash, 8 MB octal PSRAM and battery ADC GPIO3. FPVGate's retained target
uses an 8 MB layout and does not enable that PSRAM. Its SD wiring needs a board
revision/pin-reservation check; see [the LilyGO guide](LILYGO_TENERGY_S3_WIRING.md).
The Super Mini target is retained for existing builds; board quality and
brownouts have made it unsuitable as the default recommendation.

## Components and power

A DIY build needs a matching S3, receiver and antenna, regulated power, common
ground, and wiring suitable for the selected board. A FAT32 microSD card is
needed for the full voice library and recorded RSSI traces. LEDs and a buzzer
are optional; they are not timing sensors.

Keep these three electrical connections distinct:

| Connection | Requirement |
| --- | --- |
| S3 / C5 development-board supply | Regulated input appropriate to that board; C5 external builds use 5 V/VUSB |
| UART, SPI and ADC signals | 3.3 V logic; do not apply 5 V to S3 inputs |
| SD card | 3.3 V at the card; a breakout with a regulator may require a different supply at its VCC input |

Check the SD breakout's circuit rather than powering every module the same way.
An RX5808 carrier may accept 5 V through its regulator; a bare receiver or
different carrier must be powered to its own specification. Confirm RSSI stays
within the S3 ADC input limit. See the
[original RX5808 SPI modification guide](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html)
for the actual module revision; do not blindly bridge a component called R16.

Do not put a flight pack directly on a 5 V or ADC pin. Use an appropriate
regulator for power and a separate divider for sensing. Size the supply for the
receiver, S3, SD and LED load; published runtime and current figures from older
builds are not guarantees for a C5 configuration.

## Wiring guides

- [Seeed XIAO ESP32S3 and XIAO pin labels](wiring/Seeed-XIAO-ESP32S3.md)
- [ESP32-S3 DevKitC-1, 8 MB / no octal PSRAM](wiring/ESP32-S3-DevKitC-1.md)
- [Waveshare ESP32-S3-ETH and onboard Ethernet/SD](WAVESHARE_S3_ETH.md)
- [ESP32-C5 UART and receiver-specific pins](C5_MULTI_PILOT.md#what-you-need)
- [LilyGO T-Energy S3](wiring/LilyGO-T-Energy-S3.md)
- [ESP32-S3 Super Mini](wiring/ESP32-S3-SuperMini.md)
- [Waveshare ESP32-S3-LCD-2](wiring/Waveshare-ESP32-S3-LCD-2.md)

There is no physical Wi-Fi/RotorHazard mode switch in the alpha workflow.
The plugin connects to the gate's HTTP API. Old diagrams assigning GPIO9 to
that switch should not be used.

## RGB LEDs and buzzer

LED count and output pin are board-specific `NUM_LEDS` and `PIN_RGB_LED` in
`lib/CONFIG/config.h`. Defaults are two for most external strips, three on AIO
and C5MK AIO, five on Solo, one on S3-ETH, and none on the LCD board. Budget LED
power separately when expanding a strip; do not drive its supply from a GPIO.
Use a suitable signal resistor, shared ground and level shifting where the
LED's input specification requires it.

The normal targets use an active buzzer. The LCD board defines `BUZZER_PASSIVE`
and a 2700 Hz PWM default on GPIO15. A high-current buzzer needs a driver
transistor. A buzzer is not an I2S speaker: stock alpha targets do not enable
the unfinished MAX98357A speaker path.

## Battery monitoring circuit

Connect battery positive through R1 to the ADC midpoint, and R2 from the
midpoint to ground:

```text
Battery+ --- R1 ---+--- ADC
                  |
                  R2
                  |
Battery- -------- GND
```

The settings ratio is `(R1 + R2) / R2`. Size it for the fully charged pack,
with headroom below 3.3 V at the ADC, then calibrate against a meter.
A 2:1 divider is for a 1S pack, not a fully charged 2S or larger pack.
Battery sensing does not make a board's power input accept the measured pack
voltage. The bare XIAO S3 needs an external divider on D0/GPIO1.
See [battery monitoring](BATTERY_MONITORING.md) for per-board enablement,
calibration and the browser-only low-voltage alert.

## Storage and assembly checks

Format a suitable card as FAT32; 4–32 GB cards are a convenient starting point.
Copy the contents of a generated `SD_Card/` folder to the card root, retaining
`voice_*` directories. Do not create an extra `SD_Card` parent directory on
the card. See [SD setup and migration](SD_CARD_MIGRATION_GUIDE.md).

Before powering a new build, check board revision, polarity, supply voltage,
common ground, ADC divider and absence of shorts. Test the S3 alone first,
then the receiver, SD, and optional peripherals. Disconnect power before
rewiring; disconnect a C5 that shares XIAO D3/D4 with RX5808 control before
changing receiver types.

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| Will not boot or repeatedly resets | Stable supply, USB cable, BOOT button, strapping pins and PSRAM pin conflicts |
| No RSSI / receiver offline | Correct build, receiver selection, antenna, supply, UART crossing or RX5808 SPI wiring |
| SD absent | FAT32, board-specific pins, breakout supply and common ground |
| Voice absent | Enable browser audio; check the selected `voice_*` directory and phone mute/volume |
| USB has only a COM port | Native USB connector and a target that defines `FPVGATE_USB_NET` |
| Double laps | Separate Enter/Exit thresholds, minimum lap time and receiver gain |
| Missing saved race | SD/storage health and, for C5, `saveFailed`; retry Stop before Clear or reboot |

Run Diagnostics' self-test after assembly. Its 18 checks report pass/fail/skip
by capability, and include temporary storage writes and a buzzer test. A pass
does not establish real RF accuracy or certify an eight-transmitter setup.
