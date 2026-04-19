#include "qmi8658.h"
#include "../CONFIG/config.h"
#include "debug.h"

#if defined(WAVESHARE_ESP32S3_LCD2)

namespace {

// acc_odr_t / gyro_odr_t low nibble: see Waveshare QMI8658.h enums (norm_120 = 6th enum value = 0x6).
constexpr uint8_t kAccOdr120Hz = 0x6;
constexpr uint8_t kGyroOdr120Hz = 0x6;

enum AccRange : uint8_t { kAcc4G = 0x1 };   // 01 = 4G in upper bits of CTRL2
enum GyroRange : uint8_t { kGyro64Dps = 0x2 }; // 010 = 64 DPS

}  // namespace

bool Qmi8658::probeAddress(uint8_t addr) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() != 0) {
        return false;
    }
    Wire.beginTransmission(addr);
    Wire.write(QMI8658_WHO_AM_I);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom((int)addr, 1) != 1) {
        return false;
    }
    uint8_t who = Wire.read();
    if (who == QMI8658_WHO_AM_I_EXPECTED) {
        _addr = addr;
        return true;
    }
    return false;
}

bool Qmi8658::begin() {
    _ok = false;
    _addr = 0;

#if defined(PIN_QMI8658_INT1) && PIN_QMI8658_INT1 >= 0
    pinMode(PIN_QMI8658_INT1, INPUT_PULLUP);
#endif

    if (probeAddress(QMI8658_I2C_ADDR_L) || probeAddress(QMI8658_I2C_ADDR_H)) {
        // Address found
    } else {
        return false;
    }

    uint8_t rev = 0;
    readReg(QMI8658_REVISION_ID, rev);
    DEBUG("QMI8658: I2C 0x%02X rev=0x%02X (touch shares bus)\n", (unsigned)_addr, (unsigned)rev);

    applyRunningConfig();

    _ok = true;
    return true;
}

void Qmi8658::applyRunningConfig() {
    // Mirror Waveshare setState(sensor_running): enable sensors, 2 MHz path, block read increment.
    uint8_t ctrl1 = 0;
    readReg(QMI8658_CTRL1, ctrl1);
    ctrl1 &= (uint8_t)~0x01;
    ctrl1 |= 0x40;
    writeReg(QMI8658_CTRL1, ctrl1);

    writeReg(QMI8658_CTRL7, 0x43);
    writeReg(QMI8658_CTRL6, 0x00);

    // Accelerometer: 4G, 120 Hz
    uint8_t ctrl2 = 0;
    readReg(QMI8658_CTRL2, ctrl2);
    ctrl2 &= (uint8_t)~(QMI8658_ASCALE_MASK | QMI8658_AODR_MASK);
    ctrl2 |= (uint8_t)(kAcc4G << QMI8658_ASCALE_OFFSET);
    ctrl2 |= kAccOdr120Hz;
    writeReg(QMI8658_CTRL2, ctrl2);

    // Gyro: 64 dps, 120 Hz
    uint8_t ctrl3 = 0;
    readReg(QMI8658_CTRL3, ctrl3);
    ctrl3 &= (uint8_t)~(QMI8658_GSCALE_MASK | QMI8658_GODR_MASK);
    ctrl3 |= (uint8_t)(kGyro64Dps << QMI8658_GSCALE_OFFSET);
    ctrl3 |= kGyroOdr120Hz;
    writeReg(QMI8658_CTRL3, ctrl3);

    _accelScale = 4.0f / 32768.0f;
    _gyroScale = 64.0f / 32768.0f;
}

void Qmi8658::powerDown() {
    if (!_ok || _addr == 0) {
        return;
    }
    // Waveshare setState(sensor_power_down)
    writeReg(QMI8658_CTRL7, 0x00);
    uint8_t ctrl1 = 0;
    if (readReg(QMI8658_CTRL1, ctrl1)) {
        ctrl1 |= 0x01;
        writeReg(QMI8658_CTRL1, ctrl1);
    }
}

bool Qmi8658::readWhoAmI(uint8_t& id) {
    if (_addr == 0) {
        return false;
    }
    return readReg(QMI8658_WHO_AM_I, id);
}

bool Qmi8658::readAccelGyro(float& ax, float& ay, float& az, float& gx, float& gy, float& gz) {
    if (!_ok) {
        return false;
    }
    uint8_t buf[12];
    if (!readRegs(QMI8658_AX_L, buf, 12)) {
        return false;
    }
    int16_t rax = (int16_t)((buf[1] << 8) | buf[0]);
    int16_t ray = (int16_t)((buf[3] << 8) | buf[2]);
    int16_t raz = (int16_t)((buf[5] << 8) | buf[4]);
    int16_t rgx = (int16_t)((buf[7] << 8) | buf[6]);
    int16_t rgy = (int16_t)((buf[9] << 8) | buf[8]);
    int16_t rgz = (int16_t)((buf[11] << 8) | buf[10]);

    ax = rax * _accelScale;
    ay = ray * _accelScale;
    az = raz * _accelScale;
    gx = rgx * _gyroScale;
    gy = rgy * _gyroScale;
    gz = rgz * _gyroScale;
    return true;
}

bool Qmi8658::writeReg(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    Wire.write(val);
    return Wire.endTransmission() == 0;
}

bool Qmi8658::readReg(uint8_t reg, uint8_t& val) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    if (Wire.requestFrom((int)_addr, 1) != 1) {
        return false;
    }
    val = Wire.read();
    return true;
}

bool Qmi8658::readRegs(uint8_t reg, uint8_t* buf, size_t len) {
    Wire.beginTransmission(_addr);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) {
        return false;
    }
    size_t n = Wire.requestFrom((int)_addr, (int)len);
    if (n != len) {
        return false;
    }
    for (size_t i = 0; i < len; i++) {
        buf[i] = Wire.read();
    }
    return true;
}

#else  // !WAVESHARE_ESP32S3_LCD2

bool Qmi8658::begin() {
    return false;
}
void Qmi8658::powerDown() {}
bool Qmi8658::readWhoAmI(uint8_t&) {
    return false;
}
bool Qmi8658::readAccelGyro(float&, float&, float&, float&, float&, float&) {
    return false;
}

#endif
