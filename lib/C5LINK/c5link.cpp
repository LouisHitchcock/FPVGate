#include "c5link.h"
#include "debug.h"

static uint8_t xorChecksum(const char *s) {
    uint8_t c = 0;
    while (*s) c ^= (uint8_t)*s++;
    return c;
}

// Poly 0x07, init 0, as the C5 frames scan records.
static uint8_t crc8(const uint8_t *p, size_t n) {
    uint8_t c = 0;
    for (size_t i = 0; i < n; ++i) {
        c ^= p[i];
        for (uint8_t b = 0; b < 8; ++b) c = (uint8_t)(c & 0x80 ? (c << 1) ^ 0x07 : c << 1);
    }
    return c;
}

void C5Link::begin(Config *config, HardwareSerial *port, int8_t rxPin, int8_t txPin) {
    config_ = config;
    if (!port || rxPin < 0 || txPin < 0) return;
    // Start the UART even with no pilot set, so the C5's status shows up and
    // pilots added later are picked up by poll().
    port_ = port;
    gain_ = config_->getC5Gain();
    gainDirty_ = true;
    port_->setRxBufferSize(RX_BUFFER_BYTES);   // must precede begin()
    port_->begin(BAUD, SERIAL_8N1, rxPin, txPin);
    sendPayload("Q");
    activePilot_ = C5_MAX_PILOTS - 1;   // the first slot tuned is the first enabled one
    tuneNext();
    lastSlotMs_ = millis();
    DEBUG("C5 link started at %lu baud (UART RX=%d TX=%d)\n", BAUD, rxPin, txPin);
}

uint8_t C5Link::enabledCount() const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < C5_MAX_PILOTS; ++i) n += config_ && config_->getC5Frequency(i) ? 1 : 0;
    return n;
}

void C5Link::tuneNext() {
    // Round robin over the slots that have a frequency; empty slots are
    // skipped so a gap can't stall the cycle.
    for (uint8_t step = 1; step <= C5_MAX_PILOTS; ++step) {
        uint8_t slot = (uint8_t)((activePilot_ + step) % C5_MAX_PILOTS);
        if (config_->getC5Frequency(slot)) {
            sendTune(slot);
            return;
        }
    }
    tuningReady_ = false;   // nothing to tune
    requestedFrequency_ = 0;
}

void C5Link::sendPayload(const char *payload) {
    if (!port_) return;
    port_->print(payload);
    port_->print('*');
    char checksum[3];
    snprintf(checksum, sizeof(checksum), "%02X", xorChecksum(payload));
    port_->print(checksum);
    port_->print('\n');
}

void C5Link::sendTune(uint8_t pilot) {
    if (!port_ || pilot >= C5_MAX_PILOTS) return;
    uint16_t frequency = config_->getC5Frequency(pilot);
    if (!frequency) return;
    char command[24];
    snprintf(command, sizeof(command), "F,%u", frequency);
    sendPayload(command);
    tuneSentUs_ = micros();
    tuningReceivedUs_ = 0;
    readyReceivedUs_ = 0;
    firstSampleRecorded_ = false;
    if (gainDirty_) {
        snprintf(command, sizeof(command), "G,%u", gain_);
        sendPayload(command);
        gainDirty_ = false;
    }
    activePilot_ = pilot;
    requestedFrequency_ = frequency;
    tuningReady_ = false;
    sampleSeqValid_ = false;
}

bool C5Link::slotsChanged() const {
    for (uint8_t i = 0; i < C5_MAX_PILOTS; ++i)
        if (sentSlots_[i] != config_->getC5Frequency(i)) return true;
    return false;
}

void C5Link::sendSlots(uint32_t nowMs) {
    char command[8 * 6 + 4] = "P";
    size_t n = 1;
    for (uint8_t i = 0; i < C5_MAX_PILOTS; ++i) {
        sentSlots_[i] = config_->getC5Frequency(i);
        n += snprintf(command + n, sizeof(command) - n, ",%u", sentSlots_[i]);
    }
    sendPayload(command);
    slotsSent_ = true;
    awaitingScanAck_ = true;
    lastSlotsMs_ = nowMs;
    // The C5 may have rebooted (its clock restarts) or the slots moved.
    clockValid_ = false;
    cycleSeqValid_ = false;
    tuningReady_ = false;
}

void C5Link::poll(uint32_t nowMs) {
    if (!port_) return;
    if (config_->getC5Gain() != gain_) {
        gain_ = config_->getC5Gain();
        gainDirty_ = true;
        if (scanMode_) {
            char command[12];
            snprintf(command, sizeof(command), "G,%u", gain_);
            sendPayload(command);
            gainDirty_ = false;
        } else {
            activePilot_ = C5_MAX_PILOTS - 1;
            tuneNext();
            lastSlotMs_ = nowMs;
        }
    }
    const uint32_t pollUs = micros();
    if (lastPollUs_ && pollUs - lastPollUs_ > pollGapMaxUs_) pollGapMaxUs_ = pollUs - lastPollUs_;
    lastPollUs_ = pollUs;
    uint32_t bytes = 0;
    // Bulk reads: a driver call per byte cost ~20 us, most of a core at the
    // scan-mode data rate.
    uint8_t chunk[256];
    size_t got = 0, at = 0;
    for (;;) {
        if (at == got) {
            const int avail = port_->available();
            if (avail <= 0) break;
            got = port_->read(chunk, (size_t)avail < sizeof(chunk) ? (size_t)avail : sizeof(chunk));
            at = 0;
            if (!got) break;
        }
        const uint8_t b = chunk[at++];
        ++bytes;
        if (recState_ == 1) {
            if (b < 7 || b > RECORD_MAX) {
                ++badRecords_;
                recState_ = 0;
                continue;
            }
            recLen_ = b;
            rec_[0] = b;
            recPos_ = 0;
            recState_ = 2;
            continue;
        }
        if (recState_ == 2) {
            if (recPos_ < recLen_) {
                rec_[1 + recPos_++] = b;
                continue;
            }
            recState_ = 0;
            if (crc8(rec_, recLen_ + 1u) == b) handleRecord(nowMs);
            else ++badRecords_;
            continue;
        }
        // Outside a record, 0xA5 starts one: it never appears in a line.
        if (b == RECORD_SYNC) {
            recState_ = 1;
            lineLen_ = 0;
            continue;
        }
        const char c = (char)b;
        if (c == '\n') {
            line_[lineLen_] = 0;
            parseLine(line_, nowMs);
            lineLen_ = 0;
        } else if (c != '\r' && lineLen_ < sizeof(line_) - 1) {
            line_[lineLen_++] = c;
        } else if (lineLen_ >= sizeof(line_) - 1) {
            lineLen_ = 0;
        }
    }
    if (bytes > pollBytesMax_) pollBytesMax_ = bytes;
    if (scanMode_) {
        // Send the slot list when it changes, and again while the C5 isn't
        // scanning it (it rebooted, or the P was lost).
        const bool want = enabledCount() > 0;
        if (!slotsSent_ || slotsChanged() ||
            (want && strcmp(state_, "SCAN") != 0 && (nowMs - lastSlotsMs_) >= SLOT_RESEND_MS)) {
            sendSlots(nowMs);
        }
    } else if ((nowMs - lastSlotMs_) >= SLOT_MS) {
        // A slot is intentionally long enough to collect several 1 kHz
        // samples, but short enough that all eight pilots remain responsive.
        lastSlotMs_ = nowMs;
        tuneNext();
    }
    if ((nowMs - lastStatusMs_) >= 1000) {
        lastStatusMs_ = nowMs;
        sendPayload("Q");
    }
}

void C5Link::parseLine(char *line, uint32_t nowMs) {
    char *star = strrchr(line, '*');
    if (!star || strlen(star + 1) != 2) return;
    *star = 0;
    char *end = nullptr;
    unsigned long supplied = strtoul(star + 1, &end, 16);
    if (!end || *end || supplied != xorChecksum(line)) return;
    lastLineMs_ = nowMs;
    heardAny_ = true;

    if (line[0] == 'R' && line[1] == ',') {
        unsigned seq = 0, value = 0;
        if (!scanMode_ && sscanf(line, "R,%u,%u", &seq, &value) == 2 && tuningReady_ && value <= 1023) {
            const uint8_t sequence = (uint8_t)seq;
            if (sampleSeqValid_ && sequence != (uint8_t)(lastSampleSeq_ + 1u)) {
                ++sampleSequenceGaps_;
            }
            lastSampleSeq_ = sequence;
            sampleSeqValid_ = true;
            rssi_[activePilot_] = (uint16_t)value;
            // UART parsing is still driven by the millisecond main-loop
            // timestamp for link liveness, but retain sub-millisecond timing
            // for lap detection. The line protocol remains unchanged.
            const uint8_t pilot = activePilot_;
            const uint8_t next = (uint8_t)((sampleHead_[pilot] + 1u) % SAMPLE_QUEUE_DEPTH);
            if (next == sampleTail_[pilot]) {
                ++sampleQueueDrops_;
                sampleTail_[pilot] = (uint8_t)((sampleTail_[pilot] + 1u) % SAMPLE_QUEUE_DEPTH);
            }
            sampleQueue_[pilot][sampleHead_[pilot]] = {(uint16_t)value, micros()};
            sampleHead_[pilot] = next;
            ++acceptedSamples_;
            if (!firstSampleRecorded_ && readyReceivedUs_ != 0) {
                const uint32_t firstSampleUs = micros();
                readyToFirstSampleUs_ = firstSampleUs - readyReceivedUs_;
                tuneToFirstSampleUs_ = firstSampleUs - tuneSentUs_;
                firstSampleRecorded_ = true;
            }
            online_ = true;
        }
    } else if (line[0] == 'S' && line[1] == ',') {
        unsigned freq = 0, gain = 0, firmware = 0;
        char status[12] = {};
        const int fields = sscanf(line, "S,%u,%u,%11[^,],%u", &freq, &gain, status, &firmware);
        if (fields >= 3) {
            reportedFrequency_ = (uint16_t)freq;
            reportedGain_ = (uint8_t)gain;
            strlcpy(state_, status, sizeof(state_));
            const bool canScan = fields == 4 && firmware >= 2;
            if (canScan && !scanMode_) {
                scanMode_ = true;   // poll() sends the slot list next
                slotsSent_ = false;
                tuningReady_ = false;
            } else if (!canScan && scanMode_) {
                scanMode_ = false;   // C5 replaced by older firmware
                activePilot_ = C5_MAX_PILOTS - 1;
                tuneNext();
                lastSlotMs_ = nowMs;
            }
            if (scanMode_) {
                const bool scanning = strcmp(status, "SCAN") == 0;
                if (scanning) awaitingScanAck_ = false;
                tuningReady_ = scanning && !awaitingScanAck_;
                online_ = true;
                return;
            }
            const uint32_t statusUs = micros();
            if (strcmp(status, "TUNING") == 0 && reportedFrequency_ == requestedFrequency_ && tuneSentUs_ != 0) {
                tuningReceivedUs_ = statusUs;
                tuneToTuningUs_ = statusUs - tuneSentUs_;
            }
            if (strcmp(status, "OK") == 0 && reportedFrequency_ == requestedFrequency_) {
                tuningReady_ = true;
                if (tuningReceivedUs_ != 0) tuningToReadyUs_ = statusUs - tuningReceivedUs_;
                readyReceivedUs_ = statusUs;
            }
            online_ = true;
        }
    }
}

// rec_[0] = len, rec_[1..len] = payload; the CRC has been checked.
void C5Link::handleRecord(uint32_t nowMs) {
    const uint8_t *p = rec_ + 1;
    if (p[0] != 'M') return;
    lastLineMs_ = nowMs;
    heardAny_ = true;
    online_ = true;
    const uint8_t mask = p[6];
    uint8_t slots = 0;
    uint8_t wantMask = 0;
    for (uint8_t i = 0; i < C5_MAX_PILOTS; ++i) {
        slots += (mask >> i) & 1u;
        if (sentSlots_[i]) wantMask |= (uint8_t)(1u << i);
    }
    if (recLen_ != 7u + 4u * slots) {
        ++badRecords_;
        return;
    }
    // Records from before the current slot list took effect are dropped.
    if (!scanMode_ || awaitingScanAck_ || mask != wantMask) return;
    ++scanRecords_;
    const uint8_t seq = p[1];
    if (cycleSeqValid_ && seq != (uint8_t)(lastCycleSeq_ + 1u)) ++sampleSequenceGaps_;
    lastCycleSeq_ = seq;
    cycleSeqValid_ = true;

    uint32_t t0;
    memcpy(&t0, p + 2, sizeof(t0));
    const uint32_t candidate = micros() - t0;
    const int32_t late = (int32_t)(candidate - clockOffset_);
    if (!clockValid_ || late < 0) {
        clockOffset_ = candidate;
        clockValid_ = true;
        clockLateRun_ = 0;
    } else {
        if (++clockLeak_ >= 16) {
            clockLeak_ = 0;
            ++clockOffset_;
        }
        // 20 ms late for a run of records: the C5 clock jumped (reboot).
        clockLateRun_ = late > 20000 ? (uint8_t)(clockLateRun_ + 1u) : 0;
        if (clockLateRun_ >= 8) clockValid_ = false;
    }

    const uint8_t *s = p + 7;
    for (uint8_t i = 0; i < C5_MAX_PILOTS; ++i) {
        if (!(mask & (1u << i))) continue;
        const uint16_t raw = (uint16_t)(s[0] | (s[1] << 8));
        const uint16_t dt = (uint16_t)(s[2] | (s[3] << 8));
        s += 4;
        if (raw & 0x8000u) continue;   // the C5's dump failed
        const uint16_t value = raw & 0x3FFu;
        rssi_[i] = value;
        activePilot_ = i;
        const uint8_t next = (uint8_t)((sampleHead_[i] + 1u) % SAMPLE_QUEUE_DEPTH);
        if (next == sampleTail_[i]) {
            ++sampleQueueDrops_;
            sampleTail_[i] = (uint8_t)((sampleTail_[i] + 1u) % SAMPLE_QUEUE_DEPTH);
        }
        sampleQueue_[i][sampleHead_[i]] = {value, t0 + dt + clockOffset_};
        sampleHead_[i] = next;
        ++acceptedSamples_;
    }
}

bool C5Link::takeSample(uint8_t pilot, uint16_t &value, uint32_t &timestampUs) {
    if (pilot >= C5_MAX_PILOTS || sampleTail_[pilot] == sampleHead_[pilot]) return false;
    const Sample &sample = sampleQueue_[pilot][sampleTail_[pilot]];
    value = sample.value;
    timestampUs = sample.timestampUs;
    sampleTail_[pilot] = (uint8_t)((sampleTail_[pilot] + 1u) % SAMPLE_QUEUE_DEPTH);
    return true;
}
