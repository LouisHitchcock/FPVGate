# Waveshare ESP32-S3-ETH

> **UNTESTED.** This build compiles but has never been run on the board. It may
> not boot, Ethernet may not work, and the pin choices below may change. Keep a
> USB cable handy to reflash, and please report what you find.

The [Waveshare ESP32-S3-ETH](https://www.waveshare.com/wiki/ESP32-S3-ETH) runs
FPVGate with wired Ethernet as well as Wi-Fi and USB. It has an ESP32-S3R8
(8MB PSRAM), 16MB flash, a W5500 10/100 Ethernet port, a microSD slot and an
RGB LED, and can be powered over Ethernet with Waveshare's PoE module.

Firmware: the `WaveshareS3ETH` build. In the web flasher it is listed under
expert boards as **Waveshare ESP32-S3-ETH (16MB, Ethernet)**.

## Wiring

Everything you connect is on the left-hand header (pin numbers as printed on
Waveshare's pinout). The microSD card, Ethernet and RGB LED are on the board.

| Function | GPIO | Header pin |
|---|---|---|
| RX5808 RSSI | GPIO1 | 25 |
| RX5808 CH1 (data) | GPIO15 | 29 |
| RX5808 CH2 (LE / select) | GPIO16 | 32 |
| RX5808 CH3 (clock) | GPIO17 | 34 |
| Buzzer | GPIO18 | 31 |
| Battery sense (optional, external divider) | GPIO2 | 26 |
| ESP32-C5 receiver: S3 TX to C5 RX | GPIO43 | 21 |
| ESP32-C5 receiver: S3 RX from C5 TX | GPIO44 | 22 |
| Ground | GND | 23, 28 or 33 |

Power the RX5808 or the ESP32-C5 from 5V (VBUS, pin 40, when powered over USB)
and connect its ground to the board's.

Avoid GPIO0, GPIO3, GPIO45 and GPIO46 (they decide how the chip boots) and
GPIO33 to GPIO37 (used by the PSRAM).

## Ethernet

Plug in a cable and the gate asks the network for an address (DHCP). Find it
in your router's client list, or on the device's System page.

If no DHCP server answers within 15 seconds, for example with a cable straight
to a laptop, the gate uses the fixed address **192.168.8.1**. Give the laptop's
Ethernet adapter a fixed address on the same network, such as 192.168.8.2 with
netmask 255.255.255.0, then open `http://192.168.8.1`.

Wi-Fi (192.168.4.1 in access-point mode) and USB networking (192.168.7.1) keep
working alongside Ethernet. For RotorHazard, enter the gate's Ethernet address
in the FPVGate plugin's settings.

## Status

Built from the same source as the other boards. Not yet tested on the hardware.
