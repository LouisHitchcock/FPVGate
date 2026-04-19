#pragma once

#include <cstddef>
#include <cstdint>

/**
 * MSP V2 "X" framing (CRC8 DVB-S2) aligned with ExpressLRS / vrxc_elrs msp.py.
 * Used for ELRS backpack traffic over ESP-NOW.
 */

namespace elrs_msp {

constexpr size_t kMspHeaderLength = 8;
constexpr size_t kMspMaxPayload = 240;

enum class PacketType : uint8_t {
    Command = static_cast<uint8_t>('<'),
    Response = static_cast<uint8_t>('>'),
};

// Function IDs (16-bit LE in wire format) — see vrxc_elrs msp.py MSPTypes
enum MspFunction : uint16_t {
    MspElrsFunc = 0x4578,

    MspSetRxConfig = 45,
    MspVtxConfig = 88,
    MspSetVtxConfig = 89,
    MspEepromWrite = 250,

    MspElrsRfMode = 0x0006,
    MspElrsTxPwr = 0x0007,
    MspElrsTlmRate = 0x0008,
    MspElrsBind = 0x0009,
    MspElrsModelId = 0x000A,
    MspElrsRequVtxPkt = 0x000B,
    MspElrsSetTxBackpackWifiMode = 0x000C,
    MspElrsSetVrxBackpackWifiMode = 0x000D,
    MspElrsSetRxWifiMode = 0x000E,
    MspElrsSetRxLoanMode = 0x000F,
    MspElrsGetBackpackVersion = 0x0010,
    MspElrsBackpackCrsfTlm = 0x0011,
    MspElrsSetSendUid = 0x00B5,
    MspElrsSetOsd = 0x00B6,

    MspElrsBackpackGetChannelIndex = 0x0300,
    MspElrsBackpackSetChannelIndex = 0x0301,
    MspElrsBackpackGetFrequency = 0x0302,
    MspElrsBackpackSetFrequency = 0x0303,
    MspElrsBackpackGetRecordingState = 0x0304,
    MspElrsBackpackSetRecordingState = 0x0305,
    MspElrsBackpackGetVrxMode = 0x0306,
    MspElrsBackpackSetVrxMode = 0x0307,
    MspElrsBackpackGetRssi = 0x0308,
    MspElrsBackpackGetBatteryVoltage = 0x0309,
    MspElrsBackpackGetFirmware = 0x030A,
    MspElrsBackpackSetBuzzer = 0x030B,
    MspElrsBackpackSetOsdElement = 0x030C,
    MspElrsBackpackSetHeadTracking = 0x030D,
    MspElrsBackpackSetRtc = 0x030E,

    MspElrsBackpackSetMode = 0x0380,
    MspElrsBackpackGetVersion = 0x0381,
    MspElrsBackpackGetStatus = 0x0382,
    MspElrsBackpackSetPtr = 0x0383,
};

struct Packet {
    PacketType type = PacketType::Command;
    uint8_t flags = 0;
    uint16_t function = 0;
    uint16_t payload_len = 0;
    uint8_t payload[kMspMaxPayload]{};
};

uint8_t crc8DvbS2(uint8_t crc, uint8_t data);

/** Returns number of bytes written to out, or 0 if out_cap too small. */
size_t buildPacketV2(PacketType type, uint8_t flags, uint16_t function, const uint8_t* payload, uint16_t payload_len,
                     uint8_t* out, size_t out_cap);

enum class DecodeState {
    Idle,
    HeaderStart,
    HeaderX,
    HeaderV2,
    PayloadV2,
    ChecksumV2,
};

class Decoder {
   public:
    void reset();

    /**
     * Feed one byte. If a complete MSP V2 packet is parsed, fills *out and returns true.
     */
    bool pushByte(uint8_t b, Packet* out);

   private:
    static uint16_t readU16LE(const uint8_t* p) {
        return static_cast<uint16_t>(p[0] | (p[1] << 8));
    }

    DecodeState state_ = DecodeState::Idle;
    PacketType type_ = PacketType::Command;
    uint8_t flags_ = 0;
    uint16_t function_ = 0;
    uint16_t length_ = 0;
    uint8_t crc_ = 0;
    uint8_t buf_[kMspHeaderLength + kMspMaxPayload]{};
    size_t buf_len_ = 0;
};

}  // namespace elrs_msp
