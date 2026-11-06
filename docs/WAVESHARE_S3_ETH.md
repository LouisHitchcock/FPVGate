# Waveshare ESP32-S3-ETH

The [Waveshare ESP32-S3-ETH](https://www.waveshare.com/wiki/ESP32-S3-ETH) runs
FPVGate with wired Ethernet as well as Wi-Fi and USB. It has an ESP32-S3R8
(8MB PSRAM), 16MB flash, a W5500 10/100 Ethernet port, a microSD slot and an
RGB LED, and can be powered over Ethernet with Waveshare's PoE module.

Firmware: `WaveshareS3ETH`, one of the six Alpha 5 shipping targets.
It uses `targets/partitions/custom_16mb.csv`: 3 MB app slots and a 2 MB
LittleFS partition at `0x610000`. Include `boot_app0.bin` at `0xe000` in a
full wired flash; use the generated release instructions. In the web
flasher it is **Waveshare ESP32-S3-ETH (16MB, Ethernet)**.

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

Power a supported C5 development board from its 5V/VUSB input (VBUS pin 40
on the S3-ETH when USB-powered), and share ground. Match an RX5808 carrier's
input supply to its regulator specification. All signal pins are 3.3V logic.

Avoid GPIO0, GPIO3, GPIO45 and GPIO46 (they decide how the chip boots) and
GPIO33 to GPIO37 (used by the PSRAM).

## Ethernet

Plug in a cable and the gate asks the network for an address (DHCP). Find it
in your router's client list, or on the device's System page.

If no DHCP server answers within 45 seconds, for example with a cable straight
to a laptop, the gate uses the fixed address **192.168.8.1**. Give the laptop's
Ethernet adapter a fixed address on the same network, such as 192.168.8.2 with
netmask 255.255.255.0, then open `http://192.168.8.1`. Unplugging and
replugging the cable makes the gate ask for an address again, so moving it to
another network works without a restart.

Wi-Fi (192.168.4.1 in access-point mode) keeps working alongside Ethernet.
USB networking (192.168.7.1) only runs while no Ethernet cable is connected: a
computer plugged into the USB-C port still sees the gate's USB adapter and
serial port, but gets no address on it while the cable is in. The header's
connection indicator shows the Ethernet address. For RotorHazard, enter the
gate's Ethernet address in the FPVGate plugin's settings.

## Onboard resources and limitations

The onboard SD mapping is CS4/SCK7/MOSI6/MISO5; RGB data is GPIO21 with one LED.
W5500 uses MOSI11/MISO12/SCLK13/CS14/INT10/RST9. Battery GPIO2 needs an external
divider and a custom `ENABLE_BATTERY_TEST` build for monitoring; stock shipping
flags do not enable it. There is no I2S speaker in this target.

## Status

Historical hardware evidence, not a new test in this docs pass: tested from 1.9.0-Multi-Alpha-3 with an ESP32-C5 receiver over Ethernet: OTA
updates, C5 firmware updates through the gate, and an overnight run alongside
RotorHazard. Use Alpha-3 or later: earlier builds receive at about 10 KB/s over
Ethernet, too slow for OTA updates.
