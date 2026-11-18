# ESP32-S3 Super Mini (4 MB) wiring

Alpha branch mapping from `lib/CONFIG/config.h`. Environment: `ESP32S3SuperMini`.
GPIO numbers are not physical header positions.

## Pin configuration

| Signal | Pin / GPIO |
| --- | --- |
| RX5808 RSSI | 3 |
| RX5808 DATA / CH1 | 6 |
| RX5808 SELECT / CH2 | 7 |
| RX5808 CLOCK / CH3 | 4 |
| SD CS / SCK / MOSI / MISO | 8 / 2 / 10 / 9 |
| Status LED definition | 2 (conflicts with SD SCK) |
| WS2812 data; count | 1; 2 LEDs |
| Active buzzer | 5 |
| Battery divider midpoint | 0 |

## Board-specific notes

Retained source target, outside the six-board Alpha 5 packages. It uses the 4 MB partition table (filesystem `0x290000`), CDC serial and Wi-Fi; it does not enable USB networking. GPIO2 is defined for both the status LED and SD SCK: this is an unresolved source conflict, not permission to attach both peripherals. GPIO0/3 are strapping pins. Board revisions vary, so check the module before using this mapping. Battery monitoring is not compiled by default. Prefer a shipping target for new builds.

## Power and setup

Use a regulated board supply, common ground and 3.3 V signal levels.
SD cards need 3.3 V at the card; check whether the breakout includes a regulator.
Match an RX5808 carrier's VCC to its regulator/input specification.
Optional buzzers must stay within the GPIO drive rating or use a transistor.
There is no GPIO Wi-Fi/RotorHazard mode switch in this firmware.

Build and upload both firmware and web assets from the repository root:

```sh
pio run -e ESP32S3SuperMini -t upload
pio run -e ESP32S3SuperMini -t uploadfs
```

Back up races before filesystem uploads. See the [hardware guide](../HARDWARE_GUIDE.md),
[battery guide](../BATTERY_MONITORING.md) and
[C5 receiver guide](../C5_MULTI_PILOT.md) for the rest of the procedure.
