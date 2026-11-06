# Waveshare ESP32-S3-LCD-2 wiring

The [manufacturer's LCD-2 specification](https://docs.waveshare.com/ESP32-S3-LCD-2)
lists a 240 × 320 ST7789T3 2-inch display, 16 MB flash and 8 MB PSRAM.
This is not the S3-ETH board. FPVGate's source environment is
`WaveshareESP32S3LCD2`; it is outside the six Alpha 5 release packages.

## Current firmware pins

These are the alpha definitions in `lib/CONFIG/config.h`, replacing the old
GPIO4/17/21/18 receiver diagram.

| Signal | GPIO |
| --- | --- |
| RX5808 RSSI | 8 |
| RX5808 DATA / SELECT / CLOCK | 2 / 4 / 6 |
| RX5808 high-side power control | 21 |
| Passive buzzer (2700 Hz default) | 15 |
| Power button, active low | 16 |
| Battery ADC | 5 |
| Built-in SD CS / SCK / MOSI / MISO | 41 / 39 / 38 / 40 |
| LCD backlight | 1 |
| LCD/touch I2C SDA / SCL | 48 / 47 |
| Shared panel reset | 0 |
| Touch interrupt | 46 |
| QMI8658 interrupt | 3 |

GPIO21 drives a PNP high-side power stage (emitter at 3.3 V, collector to the
receiver supply, LOW enables it). It is not an RX5808 SELECT line or a direct
receiver power source. Match the receiver supply circuit to the actual module.

No external status LED or NeoPixel is enabled (`PIN_LED=-1`,
`PIN_RGB_LED=-1`, `NUM_LEDS=0`). GPIO19/20 are native USB; do not repurpose them.
Avoid camera use alongside the receiver wiring. LCD and SD share SPI and use
the firmware's mutex and separate chip-select lines.

## Build differences and limitations

This target uses pioarduino, LVGL and the LCD/power-switch options.
It declares a 16 MB flash chip but selects `custom_8mb.csv`: filesystem offset
`0x410000` and size `0x3E0000`. Do not flash a 16 MB layout at `0x610000` merely
because the board has 16 MB of physical flash. The target's comment claiming
2 MB PSRAM conflicts with the manufacturer's 8 MB specification; check the
actual board and build output when qualifying it.

This build has Wi-Fi and CDC serial, but no `FPVGATE_USB_NET` networking flag.
Touch controller compatibility must be checked for the board revision; the
driver family is CST820/CST816D. Browser C5 support does not establish full
multi-pilot LCD feature parity.

```sh
pio run -e WaveshareESP32S3LCD2 -t upload
pio run -e WaveshareESP32S3LCD2 -t uploadfs
```

For GPIO16 press/hold, release and wake behavior see
[Power switch](../POWER_SWITCH.md). Battery calibration uses the runtime
divider setting; see [Battery monitoring](../BATTERY_MONITORING.md).
