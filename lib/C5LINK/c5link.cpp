#include "c5link.h"
#include "debug.h"

static uint8_t xorChecksum(const char *s) {
    uint8_t c = 0;
    while (*s) c ^= (uint8_t)*s++;
    return c;
}

void C5Link::begin(Config *config, HardwareSerial *port, int8_t rxPin, int8_t txPin) {
    config_ = config;
    if (!port || rxPin < 0 || txPin < 0) return;
    // Start the UART even with no pilot set, so the C5's status shows up and
    // pilots added later are picked up by poll().
    port_ = port;
    gain_ = config_->getC5Gain();
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
    snprintf(command, sizeof(command), "G,%u", gain_);
    sendPayload(command);
    activePilot_ = pilot;
    requestedFrequency_ = frequency;
    tuningReady_ = false;
}

void C5Link::poll(uint32_t nowMs) {
    if (!port_) return;
    if (config_->getC5Gain() != gain_) {
        gain_ = config_->getC5Gain();
        activePilot_ = C5_MAX_PILOTS - 1;
        tuneNext();
        lastSlotMs_ = nowMs;
    }
    while (port_->available()) {
        char c = (char)port_->read();
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
    // A slot is intentionally long enough to collect several 1 kHz samples,
    // but short enough that all eight pilots remain responsive.
    if ((nowMs - lastSlotMs_) >= SLOT_MS) {
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
        if (sscanf(line, "R,%u,%u", &seq, &value) == 2 && tuningReady_ && value <= 255) {
            rssi_[activePilot_] = (uint8_t)value;
            lastSampleMs_[activePilot_] = nowMs;
            samplePending_[activePilot_] = true;
            online_ = true;
        }
    } else if (line[0] == 'S' && line[1] == ',') {
        unsigned freq = 0, gain = 0;
        char status[12] = {};
        if (sscanf(line, "S,%u,%u,%11[^,]", &freq, &gain, status) >= 3) {
            reportedFrequency_ = (uint16_t)freq;
            reportedGain_ = (uint8_t)gain;
            strlcpy(state_, status, sizeof(state_));
            if (strcmp(status, "OK") == 0 && reportedFrequency_ == requestedFrequency_) {
                tuningReady_ = true;
            }
            online_ = true;
        }
    }
}

bool C5Link::takeSample(uint8_t pilot, uint8_t &value, uint32_t &timestampMs) {
    if (pilot >= C5_MAX_PILOTS || !samplePending_[pilot]) return false;
    samplePending_[pilot] = false;
    value = rssi_[pilot];
    timestampMs = lastSampleMs_[pilot];
    return true;
}
