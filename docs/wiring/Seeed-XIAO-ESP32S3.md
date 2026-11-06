# Seeed Studio XIAO ESP32S3 wiring

Alpha branch mapping from `lib/CONFIG/config.h`. Environment: `SeeedXIAOESP32S3`.
GPIO numbers are not physical header positions.

## Pin configuration

| Signal | Pin / GPIO |
| --- | --- |
| RX5808 RSSI | D2 / GPIO3 |
| RX5808 DATA / CH1 | D4 / GPIO5 |
| RX5808 SELECT / CH2 | D5 / GPIO6 |
| RX5808 CLOCK / CH3 | D3 / GPIO4 |
| SD CS | D1 / GPIO2 |
| SD SCK | D8 / GPIO7 |
| SD MOSI | D9 / GPIO8 |
| SD MISO | D10 / GPIO9 |
| Battery divider midpoint | D0 / GPIO1 |
| Active buzzer | D6 / GPIO43 |
| WS2812 data; count | D7 / GPIO44; 2 LEDs |
| Onboard user LED | GPIO21 |
| C5 host TX / RX | D3 / GPIO4; D4 / GPIO5 |

## Board-specific notes

Use the 8 MB XIAO S3 build; the Plus has its own `XIAOS3Plus` target and 16 MB layout. The bare XIAO has no battery divider on D0: fit an external divider before connecting a battery sense lead. C5 UART uses the RX5808 CLOCK/DATA pins, so disconnect those RX5808 control wires when fitting a C5. XIAO C5 D4/D5 refer to GPIO23/24, not the same numbers as the S3. USB networking is enabled on `SeeedXIAOESP32S3`. AIO and Solo have their own board identities and LED counts; use their matching firmware.

## Power and setup

Use a regulated board supply, common ground and 3.3 V signal levels.
SD cards need 3.3 V at the card; check whether the breakout includes a regulator.
Match an RX5808 carrier's VCC to its regulator/input specification.
Optional buzzers must stay within the GPIO drive rating or use a transistor.
There is no GPIO Wi-Fi/RotorHazard mode switch in this firmware.

Build and upload both firmware and web assets from the repository root:

```sh
pio run -e SeeedXIAOESP32S3 -t upload
pio run -e SeeedXIAOESP32S3 -t uploadfs
```

Back up races before filesystem uploads. See the [hardware guide](../HARDWARE_GUIDE.md),
[battery guide](../BATTERY_MONITORING.md) and
[C5 receiver guide](../C5_MULTI_PILOT.md) for the rest of the procedure.
