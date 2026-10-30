# LilyGO T-Energy S3 wiring and compatibility

Use `LilyGOTEnergyS3` for the retained FPVGate source target. It is not one
of the six packaged Alpha 5 builds. The current pin table is maintained in
[the wiring reference](wiring/LilyGO-T-Energy-S3.md).

## Physical board versus FPVGate layout

The [manufacturer's T-Energy-S3 V1.0 repository](https://github.com/Xinyuan-LilyGO/T-Energy-S3)
specifies 16 MB flash, 8 MB octal PSRAM and battery ADC GPIO3.
FPVGate's target declares an 8 MB flash layout, does not enable PSRAM and uses
`targets/partitions/custom_8mb.csv`. These are software choices, not the
physical board specification.

The retained SD mapping uses GPIO35/36/37/39. Before assembling, verify those
signals on the actual module/revision: octal-PSRAM modules reserve pins in that
range. Disabling PSRAM in the build is not proof that reserved hardware pins
are available. This documentation pass does not qualify the target or change
its pin definitions.

## Corrected pin distinctions

Battery sensing is GPIO3, not GPIO4. RX5808 RSSI is GPIO4.
The RX tuning lines are 10/11/12; SD is CS39, SCK36, MOSI35, MISO37.
Buzzer is GPIO5 and RGB data GPIO48; DevKitC instead uses GPIO6 and GPIO5.
The boards are therefore not drop-in wiring equivalents.
There is no alpha GPIO9 Wi-Fi/RotorHazard mode switch.

The buzzer is active by default; the old passive-buzzer recipe did not match
this build. Use 3.3 V signals and check SD breakout power requirements.
Avoid guessed charger IC, charge-current or boost-output claims: consult the
schematic for the exact revision.

## Battery voltage monitoring

The board's battery measurement is on GPIO3. Firmware fallback scale is 2.0
with `VBAT_ADD=2` (+0.2 V); runtime divider configuration is the primary scale.
Set battery type/cells and calibrate against a meter using
[Battery monitoring](BATTERY_MONITORING.md). Do not wire an external receiver
RSSI lead to the built-in battery-sense net.

## Building and checking

```sh
pio run -e LilyGOTEnergyS3
pio run -e LilyGOTEnergyS3 -t buildfs
pio run -e LilyGOTEnergyS3 -t upload
pio run -e LilyGOTEnergyS3 -t uploadfs
```

Use Wi-Fi for the page. This target enables CDC serial but not USB networking.
Its filesystem offset is `0x410000`. Back up storage before uploadfs and follow
the full-flash instructions if changing partitions.

Run [the verification checklist](LILYGO_TENERGY_S3_VERIFICATION.md) after
resolving hardware compatibility. A successful compile is not an electrical
pinout verification.
