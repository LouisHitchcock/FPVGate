# LilyGO T-Energy S3 pinout changes

This page records the migration context, corrected for the alpha source.
Use [the current wiring table](wiring/LilyGO-T-Energy-S3.md) for connections,
and [hardware compatibility notes](LILYGO_TENERGY_S3_WIRING.md) before wiring.

Earlier documentation claimed every DevKitC wire could be reused. The current
`lib/CONFIG/config.h` definitions differ:

| Signal | DevKitC `ESP32S3` | `LilyGOTEnergyS3` |
| --- | --- | --- |
| RX RSSI | GPIO4 | GPIO4 |
| RX DATA / SELECT / CLOCK | 10 / 11 / 12 | 10 / 11 / 12 |
| SD CS / SCK / MOSI / MISO | 39 / 36 / 35 / 37 | 39 / 36 / 35 / 37 |
| External status LED | GPIO2 | GPIO2 |
| RGB data | GPIO5 | GPIO48 |
| Buzzer | GPIO6 | GPIO5 |
| Battery sense | GPIO1, external divider | GPIO3, onboard measurement |

Battery is not GPIO4. The old GPIO9 mode-switch instruction is obsolete.
Do not apply the old GPIO5/6/7 RX tuning or GPIO10/11/12/13 SD mapping to
the current firmware.

Matching a table in source does not resolve board-level PSRAM pin reservations.
LilyGO's physical V1.0 board has 16 MB flash/8 MB PSRAM, while the retained
FPVGate build uses an 8 MB layout without PSRAM enabled. Review the actual
revision, especially SD pins 35–37, before migrating hardware.
