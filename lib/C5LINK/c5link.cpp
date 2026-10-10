#include "c5link.h"
#include <LittleFS.h>
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

bool C5Link::poll(uint32_t nowMs) {
    if (!port_) return false;
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
    bool more = false;
    for (;;) {
        if (at == got) {
            if (bytes >= POLL_MAX_BYTES) {
                more = port_->available() > 0;
                break;
            }
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
    if (updateRequested_ || updateState_ != UpdateState::Idle) {
        // The transfer and the C5's restart aren't link faults: hold the
        // error counts where they were when the update started.
        if (updating() && !updateRequested_) {
            badRecords_ = updateBadRecords_;
            sampleSequenceGaps_ = updateSeqGaps_;
        }
        serviceUpdate(nowMs);
        // While the image goes over, nothing else is sent: the C5 would
        // reject a retune anyway, and chunks must not interleave with lines.
        // Once it restarts, the slot list goes out as usual, which is what
        // tells the new image the S3 can reach it.
        if (updateState_ == UpdateState::Starting || updateState_ == UpdateState::Sending ||
            updateState_ == UpdateState::Finishing)
            return more;
    }
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
    return more;
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
    } else if (line[0] == 'u' && line[1] == ',') {
        updateReply(line + 2, nowMs);
    } else if (line[0] == 'S' && line[1] == ',') {
        unsigned freq = 0, gain = 0, firmware = 0;
        char status[12] = {};
        char version[16] = {};
        char board[12] = {};
        // Firmware 3 adds ,<version>,<board>.
        const int fields =
            sscanf(line, "S,%u,%u,%11[^,],%u,%15[^,],%11[^,]", &freq, &gain, status, &firmware, version, board);
        if (fields >= 3) {
            reportedFrequency_ = (uint16_t)freq;
            reportedGain_ = (uint8_t)gain;
            strlcpy(state_, status, sizeof(state_));
            firmware_ = fields >= 4 ? (uint8_t)firmware : 1;
            strlcpy(version_, fields >= 6 ? version : "", sizeof(version_));
            strlcpy(board_, fields >= 6 ? board : "", sizeof(board_));
            const bool canScan = fields >= 4 && firmware >= 2;
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

bool C5Link::requestUpdate(const char *path, uint32_t size, const uint8_t sha256[32], const char *version) {
    if (!port_ || updating()) return false;
    strlcpy(updatePath_, path, sizeof(updatePath_));
    strlcpy(updateVersion_, version, sizeof(updateVersion_));
    memcpy(updateSha_, sha256, sizeof(updateSha_));
    updateSize_ = size;
    updateAcked_ = 0;
    updateError_[0] = 0;
    updateState_ = UpdateState::Idle;
    __sync_synchronize();   // the fields above before the flag the C5 task reads
    updateRequested_ = true;
    return true;
}

void C5Link::failUpdate(const char *reason) {
    if (updateFile_) updateFile_.close();
    strlcpy(updateError_, reason, sizeof(updateError_));
    updateState_ = UpdateState::Failed;
    // The C5 is back on its old image (or still on it): resend the slots.
    slotsSent_ = false;
    DEBUG("[C5] update failed: %s\n", reason);
}

// One chunk, at the offset the C5 last acknowledged:
// sync, len, 'W', offset (4), data (n), crc8 over len to the end of data.
void C5Link::sendChunk(uint32_t nowMs) {
    uint8_t frame[8 + UPDATE_CHUNK];
    if (!updateFile_.seek(updateAcked_)) return failUpdate("file seek");
    const size_t want = min<uint32_t>(UPDATE_CHUNK, updateSize_ - updateAcked_);
    const size_t n = updateFile_.read(frame + 7, want);
    if (n != want) return failUpdate("file read");
    frame[0] = CHUNK_SYNC;
    frame[1] = (uint8_t)(5 + n);
    frame[2] = 'W';
    const uint32_t offset = updateAcked_;
    memcpy(frame + 3, &offset, 4);   // little-endian on both chips
    frame[7 + n] = crc8(frame + 1, 6 + n);
    port_->write(frame, 8 + n);
    updateSentMs_ = nowMs;
}

void C5Link::updateReply(const char *reply, uint32_t nowMs) {
    if (!strcmp(reply, "ready")) {
        if (updateState_ != UpdateState::Starting) return;
        updateState_ = UpdateState::Sending;
        updateTries_ = 0;
        sendChunk(nowMs);
    } else if (!strncmp(reply, "ack,", 4)) {
        if (updateState_ != UpdateState::Sending) return;
        // The C5 says where it is; a repeat or an out-of-order ack just
        // moves the next chunk to that offset.
        const uint32_t at = strtoul(reply + 4, nullptr, 10);
        if (at > updateSize_) return failUpdate("bad ack");
        if (at > updateAcked_) updateTries_ = 0;
        updateAcked_ = at;
        if (at == updateSize_) {
            if (updateFile_) updateFile_.close();
            sendPayload("E");
            updateState_ = UpdateState::Finishing;
            updateSentMs_ = nowMs;
        } else {
            sendChunk(nowMs);
        }
    } else if (!strcmp(reply, "done")) {
        if (updateState_ != UpdateState::Finishing) return;
        updateState_ = UpdateState::Restarting;
        updateSentMs_ = nowMs;
        version_[0] = 0;   // until the new image reports
        slotsSent_ = false;      // resent, and acknowledged only by an image that hears it
        tuningReady_ = false;
    } else if (!strncmp(reply, "err,", 4)) {
        if (updateState_ == UpdateState::Starting || updateState_ == UpdateState::Sending ||
            updateState_ == UpdateState::Finishing)
            failUpdate(reply + 4);
    }
}

void C5Link::serviceUpdate(uint32_t nowMs) {
    if (updateRequested_) {
        updateRequested_ = false;
        updateBadRecords_ = badRecords_;
        updateSeqGaps_ = sampleSequenceGaps_;
        updateFile_ = LittleFS.open(updatePath_, "r");
        if (!updateFile_ || updateFile_.size() != updateSize_) return failUpdate("no image");
        char command[8 + 10 + 64 + 1];
        int n = snprintf(command, sizeof(command), "U,%lu,", (unsigned long)updateSize_);
        for (uint8_t i = 0; i < 32; ++i) n += snprintf(command + n, sizeof(command) - n, "%02x", updateSha_[i]);
        sendPayload(command);
        updateState_ = UpdateState::Starting;
        updateSentMs_ = nowMs;
        DEBUG("[C5] update: %lu bytes to %s\n", (unsigned long)updateSize_, updateVersion_);
        return;
    }
    switch (updateState_) {
        case UpdateState::Starting:
            if (nowMs - updateSentMs_ >= UPDATE_BEGIN_TIMEOUT_MS) failUpdate("no reply");
            break;
        case UpdateState::Sending:
            // A chunk lost either way (or its ack) is sent again.
            if (nowMs - updateSentMs_ >= UPDATE_ACK_TIMEOUT_MS) {
                if (++updateTries_ > UPDATE_RETRIES) failUpdate("no ack");
                else sendChunk(nowMs);
            }
            break;
        case UpdateState::Finishing:
            if (nowMs - updateSentMs_ >= UPDATE_FINISH_TIMEOUT_MS) failUpdate("no finish");
            break;
        case UpdateState::Restarting: {
            // Reporting the new version isn't enough: an image that can send
            // but not hear the S3 does that, then rolls back. Scanning the
            // slot list sent since its restart shows it hears the S3, which
            // is also what confirms the image on the C5.
            const bool newVersion = version_[0] && !strcmp(version_, updateVersion_);
            const bool hearsUs = enabledCount() == 0 || (scanMode_ && tuningReady_);
            if (newVersion && hearsUs) {
                updateState_ = UpdateState::Done;
                DEBUG("[C5] update done: %s\n", version_);
            } else if (version_[0] && !newVersion && nowMs - updateSentMs_ >= UPDATE_STALE_STATUS_MS) {
                // Another version once the old image has gone: the C5 is
                // back on its previous firmware.
                failUpdate("rolled back");
            } else if (nowMs - updateSentMs_ >= UPDATE_RESTART_TIMEOUT_MS) {
                failUpdate(version_[0] && !newVersion ? "rolled back" : "not back");
            }
            break;
        }
        default:
            break;
    }
}
