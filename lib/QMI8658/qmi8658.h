#pragma once

#include <Arduino.h>
#include <Wire.h>

// QMI8658 on Waveshare ESP32-S3-LCD-2: same I2C as touch (see config.h LCD_I2C_*).
// Register map aligned with Waveshare demo (QMI8658/QMI8658.h in their ESP-IDF examples).

#define QMI8658_I2C_ADDR_L 0x6B
#define QMI8658_I2C_ADDR_H 0x6A

#define QMI8658_WHO_AM_I 0x00
#define QMI8658_REVISION_ID 0x01
#define QMI8658_CTRL1 0x02
#define QMI8658_CTRL2 0x03
#define QMI8658_CTRL3 0x04
#define QMI8658_CTRL5 0x06
#define QMI8658_CTRL6 0x07
#define QMI8658_CTRL7 0x08

#define QMI8658_AX_L 0x35

#define QMI8658_AODR_MASK 0x0F
#define QMI8658_GODR_MASK 0x0F
#define QMI8658_ASCALE_MASK 0x70
#define QMI8658_GSCALE_MASK 0x70
#define QMI8658_ASCALE_OFFSET 4
#define QMI8658_GSCALE_OFFSET 4

// Expected WHO_AM_I for QMI8658 family (QST).
#define QMI8658_WHO_AM_I_EXPECTED 0x05

class Qmi8658 {
   public:
    bool begin();
    void powerDown();

    bool isReady() const { return _ok; }

    /// Raw WHO_AM_I (register 0x00); optional diagnostics.
    bool readWhoAmI(uint8_t& id);

    /// Accel in g, gyro in deg/s (only valid after successful begin()).
    bool readAccelGyro(float& ax, float& ay, float& az, float& gx, float& gy, float& gz);

   private:
    bool probeAddress(uint8_t addr);
    bool writeReg(uint8_t reg, uint8_t val);
    bool readReg(uint8_t reg, uint8_t& val);
    bool readRegs(uint8_t reg, uint8_t* buf, size_t len);

    void applyRunningConfig();

    uint8_t _addr = 0;
    bool _ok = false;
    float _accelScale = 0.0f;
    float _gyroScale = 0.0f;
};
