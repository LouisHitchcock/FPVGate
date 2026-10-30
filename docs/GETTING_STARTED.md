# Getting started with FPVGate alpha

These instructions are for `V1.9.0-alpha`, currently reporting
`1.9.0-alpha-5`. Alpha firmware is for evaluation; physical eight-pilot
qualification and storage-failure testing are still incomplete.
For day-to-day operation see the [user guide](USER_GUIDE.md).

## Choose hardware

A ready-made FPVGate needs power and an appropriate SD voice pack. A DIY build
needs an ESP32-S3 timer and either an RX5808 for one pilot or an ESP32-C5
receiver for up to eight pilots. C5MK AIO uses its integrated C5 and fixes the
receiver selection to C5.

The six Alpha 5 packages are `ESP32S3` (8 MB DevKitC-1),
`SeeedXIAOESP32S3`, `FPVGateAIO`, `FPVGateSolo`, `FPVGateC5MKAIO` and
`WaveshareS3ETH`. Pick firmware by the exact board identity, not just
"ESP32-S3". [Hardware and wiring](HARDWARE_GUIDE.md) lists retained custom
targets separately.

Disconnect power before assembly. Check the selected board's GPIO mapping,
receiver supply, common ground and 3.3 V logic. A C5 uses UART TX-to-RX;
an RX5808 uses three tuning lines plus RSSI. Follow the module-specific
[SPI modification guide](https://sheaivey.github.io/rx5808-pro-diversity/docs/rx5808-spi-mod.html)
when needed. Do not connect an unscaled flight battery to an ADC.

## Prepare the SD card

1. Format a suitable card as FAT32.
2. Copy generated/downloaded `voice_*` folders to its root. A typical path is
   `voice_default_en/arm_your_quad.mp3`.
3. Insert the card with the gate powered off.
4. Keep existing race files backed up when replacing firmware.

Old `sounds_*` folders are compatibility paths, not the new install layout.
See [SD setup](SD_CARD_MIGRATION_GUIDE.md) and
[voice packs](MULTI_VOICE_SETUP.md).

## Flashing firmware

### Method 1: Web flasher

Open the [FPVGate flasher](https://fpvgate.xyz/flasher.html) in a browser with
Web Serial support, normally desktop Chrome or Edge. Select the alpha/pre-release
version explicitly and the exact board. Connect its USB data port, choose the
COM/serial device and follow the flasher prompts. The flasher's listed versions
depend on website publication; this branch alone does not publish a build.

A separate C5 must also run the correct
[C5MK firmware](https://github.com/LouisHitchcock/FPVGateC5MK) for its own board.
Use the C5 flasher or the gate's supported C5 update flow; an S3 image cannot
be used on a C5.

### Method 2: Downloaded files

Download the matching board's bootloader, partition table, firmware,
LittleFS image and shared `boot_app0.bin` from the same release.
Follow its `<BOARD>-FLASH_INSTRUCTIONS.txt`. For the `ESP32S3` 8 MB package,
this one-line command works in PowerShell and POSIX shells:

```sh
esptool.py --chip esp32s3 --port COM3 --baud 460800 write_flash -z 0x0 ESP32S3-bootloader.bin 0x8000 ESP32S3-partitions.bin 0xe000 boot_app0.bin 0x10000 ESP32S3-firmware.bin 0x410000 ESP32S3-littlefs.bin
```

Replace `COM3` with the actual port. The command uses the esptool v4 command
spelling; use the equivalent commands for your installed esptool version.

`boot_app0.bin` selects app0 after a wired flash; omitting it can leave a
previously OTA-updated device booting its old app1. The S3-ETH filesystem is
at `0x610000`, not `0x410000`. A Super Mini custom build uses `0x290000`.
Never mix these layouts.

### Method 3: Build from source

```sh
git clone --branch V1.9.0-alpha https://github.com/LouisHitchcock/FPVGate.git
cd FPVGate
python -m pip install platformio
pio run -e SeeedXIAOESP32S3
pio run -e SeeedXIAOESP32S3 -t buildfs
pio run -e SeeedXIAOESP32S3 -t upload
pio run -e SeeedXIAOESP32S3 -t uploadfs
```

Use your board's environment from [Development](DEVELOPMENT.md#build-targets).
On Windows run builds in PowerShell. Uploading a filesystem replaces that
partition: export saved races and traces first. Config lives in EEPROM; it
is not a `config.json` inside the web image.

### Upgrades and recovery

From 1.7.x, use a full wired flash for the changed partition layout.
For later compatible layouts, use Settings' OTA flow with a matching board
image and update both app and filesystem when the release requires it.
OTA cannot change the partition table. Back up before any full erase.

After flashing, power-cycle if normal USB operation does not return.
If the firmware will not boot, hold BOOT while connecting/resetting as
appropriate to the board, then retry flashing. A reset button alone does not
always clear a persistent bootloader state.

## Initial configuration

1. Power the gate, join `FPVGate_XXXX` using `fpvgate1`, and open
   `http://192.168.4.1`. `http://fpvgate.local` also works where mDNS is supported.
   Stay on the network if the phone warns that it has no Internet.
2. On a shipping USB-network build, Windows/Linux can instead open
   `http://192.168.7.1` over native USB-C. A COM port is for flashing/debugging,
   not for connecting the current web app. macOS users should use Wi-Fi.
3. S3-ETH users can connect Ethernet and find the DHCP address in the router
   or the System page. See [Ethernet setup](WAVESHARE_S3_ETH.md).
4. Open Settings/Configuration. For RX5808 set the band/channel to the actual
   transmitter frequency. For a C5 select **ESP32-C5 Multi-Pilot** unless the
   C5MK AIO has already fixed that setting.
5. Set pilot identity, minimum lap time, desired lap/heat limits and announcer.
   In C5 mode configure pilot slots in Calibration and tick Race for entrants.
6. Enable browser audio with a tap/click and test it. Voice packs play through
   the browser device; stock alpha builds do not provide an I2S speaker.
7. Wait for settings to save. Run Diagnostics' self-test and inspect failures;
   unsupported capabilities can legitimately report Skip.

## Calibration and first race

For RX5808, record a quiet baseline and several real passes in Calibration;
calculate thresholds, review them and save. Enter should be above background
but below a real peak, with Exit lower. Minimum lap time must be shorter than
your fastest real lap and long enough to reject duplicate detections.

For C5, start with gain 30 and follow
[per-pilot calibration](C5_MULTI_PILOT.md#setting-enter-and-exit). Do not retune,
change gain or edit thresholds during a race. Wait for the saved confirmation.

Start a short test race. The first pass is **Gate 1**; real laps run between
subsequent passes. Check each pilot and save/reopen the result. In C5 mode the
gate stops/saves at its limits even without a browser. Unreleased alpha source
adds [gate-side Event progression](GATE_EVENT_PROGRESSION.md); published Alpha 5
still needs a page for Event results/next heat. Speech always needs a page.
Conventional receiver
completion and automatic history saving retain their browser dependency.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Flasher cannot see board | Data cable, correct USB connector, another app holding the port, BOOT recovery |
| Old version after flashing | Matching files and `boot_app0.bin` at `0xe000` |
| Web page missing after app update | Matching LittleFS image and the installed partition layout |
| Only a COM port over USB | Custom target without USB networking, USB-to-UART connector, or bootloader mode |
| C5 offline | Its board firmware, crossed TX/RX, common ground and independent power budget |
| No voice | Audio permission, selected voice directory, browser/phone volume |
| C5 save failure | Keep power on, fix storage and retry Stop; do not Clear or reboot an unsaved race |

Next: [User guide](USER_GUIDE.md), [multi-pilot guide](C5_MULTI_PILOT.md),
[RotorHazard](ROTORHAZARD_INTEGRATION.md) and [feature reference](FEATURES.md).

