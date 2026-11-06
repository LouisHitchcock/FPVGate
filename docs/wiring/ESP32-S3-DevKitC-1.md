# ESP32-S3 DevKitC-1 (8 MB) wiring

Alpha branch mapping from `lib/CONFIG/config.h`. Environment: `ESP32S3`.
GPIO numbers are not physical header positions.

## Pin configuration

| Signal | Pin / GPIO |
| --- | --- |
| RX5808 RSSI | 4 |
| RX5808 DATA / CH1 | 10 |
| RX5808 SELECT / CH2 | 11 |
| RX5808 CLOCK / CH3 | 12 |
| SD CS / SCK / MOSI / MISO | 39 / 36 / 35 / 37 |
| External status LED | 2 |
| WS2812 data; count | 5; 2 LEDs |
| Active buzzer | 6 |
| Battery divider midpoint | 1 |
| C5 host TX / RX | 43 / 44 |

## Board-specific notes

Use the 8 MB N8 build without octal PSRAM. GPIO35–37 are used by octal PSRAM on other modules, so that module cannot be substituted with this SD mapping. USB networking is enabled; connect the board's native USB port, not a separate USB-to-UART bridge. Battery monitoring is not compiled into this target by default (it needs `ENABLE_BATTERY_TEST` in a custom build).

## Power and setup

Use a regulated board supply, common ground and 3.3 V signal levels.
SD cards need 3.3 V at the card; check whether the breakout includes a regulator.
Match an RX5808 carrier's VCC to its regulator/input specification.
Optional buzzers must stay within the GPIO drive rating or use a transistor.
There is no GPIO Wi-Fi/RotorHazard mode switch in this firmware.

Build and upload both firmware and web assets from the repository root:

```sh
pio run -e ESP32S3 -t upload
pio run -e ESP32S3 -t uploadfs
```

Back up races before filesystem uploads. See the [hardware guide](../HARDWARE_GUIDE.md),
[battery guide](../BATTERY_MONITORING.md) and
[C5 receiver guide](../C5_MULTI_PILOT.md) for the rest of the procedure.
