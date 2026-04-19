# Waveshare ESP32-S3-LCD-2 (16MB Flash / 8MB PSRAM) - Wiring Diagram

Board with built-in 2" LCD (ST7789), TF card slot, QMI8658 IMU, camera connector and LiPo charger.

## Pin Configuration
```
ESP32-S3-LCD-2     RX5808              Built-in TF Card (SPI)    Optional
GPIO4  (Header) -- RSSI             GPIO41 (onboard) -- CS
GPIO17 (Header) -- CH1 (DATA)       GPIO39 (onboard) -- SCK
GPIO21 (Header) -- CH2 (SELECT)     GPIO38 (onboard) -- MOSI
GPIO18 (Header) -- CH3 (CLOCK)      GPIO40 (onboard) -- MISO
GPIO9  (Header) --------------- Mode Switch
GPIO6  (Header) --------------- Buzzer (+)
GPIO15 (Header) --------------- NeoPixel DIN (optional)
GPIO2  (Header) --------------- Status LED (optional)
GND             -- GND              (onboard GND)
5V (VUSB)       -- +5V              (onboard VCC)
```

## Built-in Features (no wiring needed)
- **TF Card Slot**: Directly on the board (GPIO38/39/40/41). Insert a FAT32-formatted SD card.
- **Battery Monitor**: GPIO5 via onboard 200K/100K voltage divider (3:1 ratio). Connect a 3.7V LiPo to the MX1.25 battery header.
- **2" LCD**: ST7789T3 on SPI (GPIO38 MOSI, GPIO39 SCLK, GPIO42 DC) with CST820 capacitive touch. Used by the optional LCD UI (build target `WaveshareESP32S3LCD2` with `ENABLE_LCD_UI=1`).

## Notes
- The RX5808 pins use GPIOs that are shared with the camera connector (J1). Do NOT use the camera and RX5808 at the same time.
- GPIO4 (RSSI) is on the camera HREF line. GPIO17 is CAM_PWDN. GPIO18 and GPIO21 are header pins shared with camera I2C/data.
- The SD card SPI bus is shared with the LCD. The firmware uses separate CS lines so both can coexist.
- GPIO33-37 are reserved for the onboard 8MB PSRAM (OPI) and cannot be used.
- GPIO19/GPIO20 are USB D+/D- and should not be used for other purposes.

## References
- Waveshare wiki: https://www.waveshare.com/wiki/ESP32-S3-LCD-2
- FPVGate target: `WaveshareESP32S3LCD2` (PlatformIO)
