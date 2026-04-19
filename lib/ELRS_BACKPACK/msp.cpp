#include "msp.h"

namespace elrs_msp {

uint8_t crc8DvbS2(uint8_t crc, uint8_t data) {
    crc ^= data;
    for (int i = 0; i < 8; i++) {
        if (crc & 0x80) {
            crc = static_cast<uint8_t>((crc << 1) ^ 0xD5);
        } else {
            crc = static_cast<uint8_t>(crc << 1);
        }
    }
    return crc;
}

static uint8_t checksumBody(const uint8_t* body, size_t len) {
    uint8_t crc = 0;
    for (size_t i = 0; i < len; i++) {
        crc = crc8DvbS2(crc, body[i]);
    }
    return crc;
}

size_t buildPacketV2(PacketType type, uint8_t flags, uint16_t function, const uint8_t* payload, uint16_t payload_len,
                     uint8_t* out, size_t out_cap) {
    if (payload_len > kMspMaxPayload) {
        return 0;
    }
    const size_t need = 3 + 1 + 2 + 2 + payload_len + 1;  // $ X < flags fn_lo fn_hi len_lo len_hi payload crc
    if (need > out_cap) {
        return 0;
    }

    uint8_t body[1 + 2 + 2 + kMspMaxPayload];
    body[0] = flags;
    body[1] = static_cast<uint8_t>(function & 0xFF);
    body[2] = static_cast<uint8_t>(function >> 8);
    body[3] = static_cast<uint8_t>(payload_len & 0xFF);
    body[4] = static_cast<uint8_t>(payload_len >> 8);
    if (payload_len > 0 && payload) {
        for (uint16_t i = 0; i < payload_len; i++) {
            body[5 + i] = payload[i];
        }
    }
    const size_t body_len = 5 + payload_len;
    const uint8_t crc = checksumBody(body, body_len);

    size_t o = 0;
    out[o++] = '$';
    out[o++] = 'X';
    out[o++] = static_cast<uint8_t>(type);
    for (size_t i = 0; i < body_len; i++) {
        out[o++] = body[i];
    }
    out[o++] = crc;
    return o;
}

void Decoder::reset() {
    state_ = DecodeState::Idle;
    buf_len_ = 0;
}

bool Decoder::pushByte(uint8_t b, Packet* out) {
    switch (state_) {
        case DecodeState::Idle:
            if (b == '$') {
                buf_len_ = 0;
                buf_[buf_len_++] = b;
                state_ = DecodeState::HeaderStart;
            }
            break;

        case DecodeState::HeaderStart:
            if (b == 'X') {
                buf_[buf_len_++] = b;
                state_ = DecodeState::HeaderX;
            } else {
                reset();
                if (b == '$') {
                    buf_[buf_len_++] = b;
                    state_ = DecodeState::HeaderStart;
                }
            }
            break;

        case DecodeState::HeaderX:
            if (b == static_cast<uint8_t>(PacketType::Command) || b == static_cast<uint8_t>(PacketType::Response)) {
                buf_[buf_len_++] = b;
                type_ = static_cast<PacketType>(b);
                crc_ = 0;
                state_ = DecodeState::HeaderV2;
            } else {
                reset();
            }
            break;

        case DecodeState::HeaderV2:
            buf_[buf_len_++] = b;
            crc_ = crc8DvbS2(crc_, b);
            if (buf_len_ == kMspHeaderLength) {
                flags_ = buf_[3];
                function_ = readU16LE(&buf_[4]);
                length_ = readU16LE(&buf_[6]);
                if (length_ > kMspMaxPayload) {
                    reset();
                    break;
                }
                if (length_ == 0) {
                    state_ = DecodeState::ChecksumV2;
                } else {
                    state_ = DecodeState::PayloadV2;
                }
            }
            break;

        case DecodeState::PayloadV2:
            buf_[buf_len_++] = b;
            crc_ = crc8DvbS2(crc_, b);
            if (buf_len_ - kMspHeaderLength == length_) {
                state_ = DecodeState::ChecksumV2;
            }
            break;

        case DecodeState::ChecksumV2:
            if (b == crc_) {
                out->type = type_;
                out->flags = flags_;
                out->function = function_;
                out->payload_len = length_;
                if (length_ > 0) {
                    for (uint16_t i = 0; i < length_; i++) {
                        out->payload[i] = buf_[kMspHeaderLength + i];
                    }
                }
                reset();
                return true;
            }
            reset();
            break;
    }
    return false;
}

}  // namespace elrs_msp
