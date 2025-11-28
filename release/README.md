# Prebuilt Firmware Files

These are precompiled binaries for ESP32-S3 boards. No build environment needed!

## Files Included

- `bootloader-esp32s3.bin` - ESP32-S3 bootloader (flash at 0x0000)
- `partitions-esp32s3.bin` - Partition table (flash at 0x8000)
- `firmware-esp32s3.bin` - Main application firmware (flash at 0x10000)
- `littlefs-esp32s3.bin` - Web interface filesystem (flash at 0x670000)

## Quick Flash Instructions

### Using esptool.py (All Platforms)

```bash
esptool.py --chip esp32s3 --port COM12 --baud 460800 write_flash -z \
  0x0000 bootloader-esp32s3.bin \
  0x8000 partitions-esp32s3.bin \
  0x10000 firmware-esp32s3.bin \
  0x670000 littlefs-esp32s3.bin
```

Replace `COM12` with your port (Windows: COM#, Linux: /dev/ttyUSB#, Mac: /dev/cu.usbserial-*)

### Using ESP Flash Tool (Windows)

1. Download [ESP Flash Tool](https://www.espressif.com/en/support/download/other-tools)
2. Select **ESP32-S3** chip
3. Add files with addresses shown above
4. Click **Start**

## Full Instructions

See the [Quick Start Guide](../QUICKSTART.md) for complete setup instructions.

## Version Info

- **Build Date**: Generated from latest source
- **Target**: ESP32-S3-DevKitC-1
- **Framework**: Arduino (ESP-IDF)
- **Platform**: Espressif32 v6.9.0
