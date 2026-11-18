# LilyGO T-Energy S3 verification checklist

This is a checklist for a custom target, not a certificate that the wiring
has been physically qualified on the alpha branch.

## Before power

- Identify the exact T-Energy-S3 board/module revision and its schematic.
- Resolve SD GPIO35–37 reservation conflicts on a PSRAM-equipped module.
- Check regulated supplies, common ground, signal voltage and battery polarity.
- Compare each wire with [the alpha pin table](wiring/LilyGO-T-Energy-S3.md).
- Keep battery ADC GPIO3 separate from RSSI GPIO4.
- Use buzzer GPIO5 and RGB GPIO48, not DevKitC's GPIO6/5.
- Do not install the obsolete GPIO9 Wi-Fi/RotorHazard switch.

## Build and install

```sh
pio run -e LilyGOTEnergyS3
pio run -e LilyGOTEnergyS3 -t buildfs
pio run -e LilyGOTEnergyS3 -t upload
pio run -e LilyGOTEnergyS3 -t uploadfs
```

This retained target uses an 8 MB partition layout and CDC serial, without
USB networking. It is not an Alpha 5 shipping package.

## Runtime checks

1. Join the access point or configured Wi-Fi network and confirm `/version`.
2. Run the self-test, inspect Pass/Fail/Skip and verify SD storage.
3. Compare battery voltage on GPIO3 to a meter. Firmware offset is +0.2 V,
   and the divider is a runtime setting; see [battery calibration](BATTERY_MONITORING.md).
4. Tune the receiver, observe real RSSI and calibrate several passes.
5. Check the actual active buzzer and RGB outputs.
6. Start/stop a short race, reopen its history and test voice files.
7. Record the board revision, build commit and results; do not infer whole-board
   compatibility from a compile or the matching RX pin subset.

For remaining custom-target concerns see [LilyGO compatibility](LILYGO_TENERGY_S3_WIRING.md).
