# LilyGO T-Energy S3 wiring

Alpha branch mapping from `lib/CONFIG/config.h`. Environment: `LilyGOTEnergyS3`.
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
| WS2812 data; count | 48; 2 LEDs |
| Active buzzer | 5 |
| Built-in battery ADC | 3 |

## Board-specific notes

This source target is not an Alpha 5 shipping package. It uses an 8 MB layout, Wi-Fi and CDC serial; USB networking is not enabled. The manufacturer's V1.0 board has 16 MB flash and 8 MB octal PSRAM, unlike the configured layout. Review the actual module's GPIO35–37 reservations before adding SD: the retained mapping must not be assumed safe on a PSRAM-equipped board. Battery is GPIO3, not GPIO4. Buzzer and RGB pins differ from DevKitC (6/5 on DevKitC versus 5/48 here). See [the detailed guide](../LILYGO_TENERGY_S3_WIRING.md) before assembling.

## Power and setup

Use a regulated board supply, common ground and 3.3 V signal levels.
SD cards need 3.3 V at the card; check whether the breakout includes a regulator.
Match an RX5808 carrier's VCC to its regulator/input specification.
Optional buzzers must stay within the GPIO drive rating or use a transistor.
There is no GPIO Wi-Fi/RotorHazard mode switch in this firmware.

Build and upload both firmware and web assets from the repository root:

```sh
pio run -e LilyGOTEnergyS3 -t upload
pio run -e LilyGOTEnergyS3 -t uploadfs
```

Back up races before filesystem uploads. See the [hardware guide](../HARDWARE_GUIDE.md),
[battery guide](../BATTERY_MONITORING.md) and
[C5 receiver guide](../C5_MULTI_PILOT.md) for the rest of the procedure.
