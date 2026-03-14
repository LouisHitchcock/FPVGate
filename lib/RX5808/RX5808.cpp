#include "RX5808.h"
#include <Arduino.h>
#include "debug.h"
#include "config.h"

#ifdef USE_ADC_DMA
// Included only in this translation unit to avoid polluting the include chain.
#include "esp_adc/adc_continuous.h"
#endif

RX5808::RX5808(uint8_t _rssiInputPin, uint8_t _rx5808DataPin, uint8_t _rx5808SelPin, uint8_t _rx5808ClkPin) {
    rssiInputPin = _rssiInputPin;
    rx5808DataPin = _rx5808DataPin;
    rx5808SelPin = _rx5808SelPin;
    rx5808ClkPin = _rx5808ClkPin;
    lastSetFreqTimeMs = millis();
}

void RX5808::init() {
    pinMode(rssiInputPin, INPUT);
    pinMode(rx5808DataPin, OUTPUT);
    pinMode(rx5808SelPin, OUTPUT);
    pinMode(rx5808ClkPin, OUTPUT);
    digitalWrite(rx5808SelPin, HIGH);
    digitalWrite(rx5808ClkPin, LOW);
    digitalWrite(rx5808DataPin, LOW);

    // set antenna option
    #ifdef USE_EXT_ANTENNA
        pinMode(WIFI_ENABLE, OUTPUT); // pinMode(3, OUTPUT);
        digitalWrite(WIFI_ENABLE, LOW); // digitalWrite(3, LOW); // Activate RF switch control

        delay(100);

        pinMode(WIFI_ANT_CONFIG, OUTPUT); // pinMode(14, OUTPUT);
        digitalWrite(WIFI_ANT_CONFIG, HIGH); // digitalWrite(14, HIGH); // Use external antenna
    #endif

    resetRxModule();
    // Don't power down on init - leave module powered up and ready
    // Set currentFrequency to 0 to force initial frequency programming
    currentFrequency = 0;
    recentSetFreqFlag = false;
    // Delay to ensure module is ready before first frequency change
    delay(50);

#ifdef USE_ADC_DMA
    initAdcDma();
#endif
}

void RX5808::handleFrequencyChange(uint32_t currentTimeMs, uint16_t potentiallyNewFreq) {
    if ((currentFrequency != potentiallyNewFreq) && ((currentTimeMs - lastSetFreqTimeMs) > RX5808_MIN_BUSTIME)) {
        lastSetFreqTimeMs = currentTimeMs;
        setFrequency(potentiallyNewFreq);
    }

    if (recentSetFreqFlag && (currentTimeMs - lastSetFreqTimeMs) > RX5808_MIN_TUNETIME) {
        lastSetFreqTimeMs = currentTimeMs;
        DEBUG("RX5808 Tune done\n");
        verifyFrequency();
        recentSetFreqFlag = false;  // don't need to check again until next freq change
    }
}

bool RX5808::verifyFrequency() {
    // Start of Read Reg code :
    // Verify read HEX value in RX5808 module Frequency Register 0x01
    uint16_t vtxRegisterHex = 0;
    //  Modified copy of packet code in setRxModuleToFreq(), to read Register 0x01
    //  20 bytes of register data are read, but the
    //  MSB 4 bits are zeros
    //  Data Packet is: register address (4-bits) = 0x1, read/write bit = 1 for read, data D0-D15 stored in vtxHexVerify, data15-19=0x0

    rx5808SerialEnableHigh();
    rx5808SerialEnableLow();

    rx5808SerialSendBit1();  // Register 0x1
    rx5808SerialSendBit0();
    rx5808SerialSendBit0();
    rx5808SerialSendBit0();

    rx5808SerialSendBit0();  // Read register r/w

    // receive data D0-D15, and ignore D16-D19
    pinMode(rx5808DataPin, INPUT_PULLUP);
    for (uint8_t i = 0; i < 20; i++) {
        delayMicroseconds(10);
        // only use D0-D15, ignore D16-D19
        if (i < 16) {
            if (digitalRead(rx5808DataPin)) {
                bitWrite(vtxRegisterHex, i, 1);
            } else {
                bitWrite(vtxRegisterHex, i, 0);
            }
        }
        if (i >= 16) {
            digitalRead(rx5808DataPin);
        }
        digitalWrite(rx5808ClkPin, HIGH);
        delayMicroseconds(10);
        digitalWrite(rx5808ClkPin, LOW);
        delayMicroseconds(10);
    }

    pinMode(rx5808DataPin, OUTPUT);  // return status of Data pin after INPUT_PULLUP above
    rx5808SerialEnableHigh();        // Finished clocking data in
    delay(2);

    digitalWrite(rx5808ClkPin, LOW);
    digitalWrite(rx5808DataPin, LOW);

    if (vtxRegisterHex != freqMhzToRegVal(currentFrequency)) {
        DEBUG("RX5808 frequency not matching, register = %u, currentFreq = %u\n", vtxRegisterHex, currentFrequency);
        return false;
    }
    DEBUG("RX5808 frequency verified properly\n");
    return true;
}

// Set frequency on RX5808 module to given value
void RX5808::setFrequency(uint16_t vtxFreq) {
    DEBUG("Setting frequency to %u\n", vtxFreq);

    currentFrequency = vtxFreq;

    if (vtxFreq == POWER_DOWN_FREQ_MHZ)  // frequency value to power down rx module
    {
        powerDownRxModule();
        rxPoweredDown = true;
        return;
    }
    if (rxPoweredDown) {
        resetRxModule();
        rxPoweredDown = false;
    }

    // Get the hex value to send to the rx module
    uint16_t vtxHex = freqMhzToRegVal(vtxFreq);

    // Channel data from the lookup table, 20 bytes of register data are sent, but the
    // MSB 4 bits are zeros register address = 0x1, write, data0-15=vtxHex data15-19=0x0
    rx5808SerialEnableHigh();
    rx5808SerialEnableLow();

    rx5808SerialSendBit1();  // Register 0x1
    rx5808SerialSendBit0();
    rx5808SerialSendBit0();
    rx5808SerialSendBit0();

    rx5808SerialSendBit1();  // Write to register

    // D0-D15, note: loop runs backwards as more efficent on AVR
    uint8_t i;
    for (i = 16; i > 0; i--) {
        if (vtxHex & 0x1) {  // Is bit high or low?
            rx5808SerialSendBit1();
        } else {
            rx5808SerialSendBit0();
        }
        vtxHex >>= 1;  // Shift bits along to check the next one
    }

    for (i = 4; i > 0; i--)  // Remaining D16-D19
        rx5808SerialSendBit0();

    rx5808SerialEnableHigh();  // Finished clocking data in
    delay(2);

    digitalWrite(rx5808ClkPin, LOW);
    digitalWrite(rx5808DataPin, LOW);

    recentSetFreqFlag = true;  // indicate need to wait RX5808_MIN_TUNETIME before reading RSSI
}

// Read the RSSI value.
//
// When USE_ADC_DMA is defined the ADC runs continuously via DMA at 20 kHz.
// A registered ISR callback (adcConvDoneHandler) fires on each completed DMA
// frame, averages the samples, and writes the result into lastDmaRssi.
// readRssi() simply returns that cached value — no IDF calls, no WDT touching.
// The CPU-based analogRead() path below is compiled in unchanged for all
// targets that do NOT define USE_ADC_DMA.
uint8_t RX5808::readRssi() {
    if (recentSetFreqFlag) return 0;  // RSSI is unstable after a frequency change

#ifdef USE_ADC_DMA
    if (adcDmaInitialized) {
        return lastDmaRssi;  // Updated continuously by adcConvDoneHandler ISR
    }
#endif

    // CPU-based (default) path — single analogRead, clamp, and rescale.
    // for (uint8_t i = 0; i < RSSI_READS; i++) {
    //   rssi += map(analogRead(rssiInputPin), 0, analogRead(vbatPin), 0, 4095);
    // }
    // rssi = rssi / RSSI_READS; // average of RSSI_READS readings

    // reads 5V value as 0-4095, RX5808 is 3.3V powered so RSSI pin will never output the full range
    volatile uint16_t rssi = analogRead(rssiInputPin);
    // clamp upper range to fit scaling
    if (rssi > 2047) rssi = 2047;
    // rescale to fit into a byte and remove some jitter TODO: experiment with exp or log
    return rssi >> 3;
}

#ifdef USE_ADC_DMA
// ISR callback: fires on each completed DMA conversion frame.
// Averages all valid samples in the frame and stores the result in lastDmaRssi.
// Must be in IRAM and must not call any non-IRAM-safe IDF functions.
static bool IRAM_ATTR adcConvDoneHandler(adc_continuous_handle_t /*handle*/,
                                          const adc_continuous_evt_data_t *edata,
                                          void *user_data) {
    volatile uint8_t *pLastRssi = (volatile uint8_t *)user_data;
    uint32_t sum = 0, count = 0;
    for (uint32_t i = 0; i + SOC_ADC_DIGI_RESULT_BYTES <= edata->size; i += SOC_ADC_DIGI_RESULT_BYTES) {
        const adc_digi_output_data_t *p =
            (const adc_digi_output_data_t *)&edata->conv_frame_buffer[i];
        uint32_t data = p->type2.data;
        if (data > 2047) data = 2047;
        sum += data;
        count++;
    }
    if (count > 0) *pLastRssi = (uint8_t)((sum / count) >> 3);
    return false;  // no high-priority task woken
}

// Initialise the ADC continuous (DMA) driver for the RSSI input pin.
// Called once from init().  On any failure the driver is left uninitialised and
// readRssi() will silently fall through to return lastDmaRssi (0).
void RX5808::initAdcDma() {
    // Resolve the GPIO pin to an ADC unit + channel at runtime.
    adc_unit_t unit;
    adc_channel_t channel;
    if (adc_continuous_io_to_channel(rssiInputPin, &unit, &channel) != ESP_OK) {
        DEBUG("ADC DMA: pin %d cannot be mapped to an ADC channel\n", rssiInputPin);
        return;
    }
    adcChannel = (uint8_t)channel;

    // conv_frame_size: bytes per DMA frame (16 samples × 4 bytes = 64 bytes).
    // A full frame is produced every 16/20000 s ≈ 0.8 ms at 20 kHz, so a
    // non-blocking read will typically find data after the first millisecond.
    adc_continuous_handle_cfg_t handle_cfg = {
        .max_store_buf_size = 1024,  // ring buffer: 256 samples
        .conv_frame_size    = 128,   // one frame: 32 samples → ~625 callbacks/sec at 20 kHz
    };
    adc_continuous_handle_t handle = nullptr;
    if (adc_continuous_new_handle(&handle_cfg, &handle) != ESP_OK) {
        DEBUG("ADC DMA: failed to allocate handle\n");
        return;
    }

    adc_digi_pattern_config_t pattern = {
        .atten     = ADC_ATTEN_DB_12,  // full 0–2500 mV input range
        .channel   = adcChannel,
        .unit      = (uint8_t)unit,
        .bit_width = ADC_BITWIDTH_12,
    };
    adc_continuous_config_t cont_cfg = {
        .pattern_num    = 1,
        .adc_pattern    = &pattern,
        .sample_freq_hz = 20 * 1000,              // 20 kHz continuous sampling
        .conv_mode      = ADC_CONV_SINGLE_UNIT_1, // ADC1 only (avoids WiFi conflict)
        .format         = ADC_DIGI_OUTPUT_FORMAT_TYPE2,
    };
    if (adc_continuous_config(handle, &cont_cfg) != ESP_OK) {
        DEBUG("ADC DMA: failed to configure\n");
        adc_continuous_deinit(handle);
        return;
    }

    if (adc_continuous_start(handle) != ESP_OK) {
        DEBUG("ADC DMA: failed to start\n");
        adc_continuous_deinit(handle);
        return;
    }

    // Register ISR callback — fires on each completed DMA frame so readRssi()
    // never needs to call any IDF function (avoids esp_task_wdt_reset spam).
    adc_continuous_evt_cbs_t cbs = {};
    cbs.on_conv_done = adcConvDoneHandler;
    if (adc_continuous_register_event_callbacks(handle, &cbs, (void*)&lastDmaRssi) != ESP_OK) {
        DEBUG("ADC DMA: failed to register callback\n");
        adc_continuous_stop(handle);
        adc_continuous_deinit(handle);
        return;
    }

    adcHandle = (void*)handle;
    DEBUG("ADC DMA: RSSI pin %d → ADC unit %d ch %d, 20 kHz continuous (callback mode)\n",
          rssiInputPin, (int)unit, (int)adcChannel);
    adcDmaInitialized = true;
}
#endif

void RX5808::rx5808SerialSendBit1() {
    digitalWrite(rx5808DataPin, HIGH);
    delayMicroseconds(300);
    digitalWrite(rx5808ClkPin, HIGH);
    delayMicroseconds(300);
    digitalWrite(rx5808ClkPin, LOW);
    delayMicroseconds(300);
}

void RX5808::rx5808SerialSendBit0() {
    digitalWrite(rx5808DataPin, LOW);
    delayMicroseconds(300);
    digitalWrite(rx5808ClkPin, HIGH);
    delayMicroseconds(300);
    digitalWrite(rx5808ClkPin, LOW);
    delayMicroseconds(300);
}

void RX5808::rx5808SerialEnableLow() {
    digitalWrite(rx5808SelPin, LOW);
    delayMicroseconds(200);
}

void RX5808::rx5808SerialEnableHigh() {
    digitalWrite(rx5808SelPin, HIGH);
    delayMicroseconds(200);
}

// Reset rx5808 module to wake up from power down
void RX5808::resetRxModule() {
    rx5808SerialEnableHigh();
    rx5808SerialEnableLow();

    rx5808SerialSendBit1();  // Register 0xF
    rx5808SerialSendBit1();
    rx5808SerialSendBit1();
    rx5808SerialSendBit1();

    rx5808SerialSendBit1();  // Write to register

    for (uint8_t i = 20; i > 0; i--)
        rx5808SerialSendBit0();

    rx5808SerialEnableHigh();  // Finished clocking data in

    setupRxModule();
}

// Set power options on the rx5808 module
void RX5808::setRxModulePower(uint32_t options) {
    rx5808SerialEnableHigh();
    rx5808SerialEnableLow();

    rx5808SerialSendBit0();  // Register 0xA
    rx5808SerialSendBit1();
    rx5808SerialSendBit0();
    rx5808SerialSendBit1();

    rx5808SerialSendBit1();  // Write to register

    for (uint8_t i = 20; i > 0; i--) {
        if (options & 0x1) {  // Is bit high or low?
            rx5808SerialSendBit1();
        } else {
            rx5808SerialSendBit0();
        }
        options >>= 1;  // Shift bits along to check the next one
    }

    rx5808SerialEnableHigh();  // Finished clocking data in

    digitalWrite(rx5808DataPin, LOW);
}

// Power down rx5808 module
void RX5808::powerDownRxModule() {
    setRxModulePower(0b11111111111111111111);
}

// Set up rx5808 module (disabling unused features to save some power)
void RX5808::setupRxModule() {
    setRxModulePower(0b11010000110111110011);
}

// Calculate rx5808 register hex value for given frequency in MHz
uint16_t RX5808::freqMhzToRegVal(uint16_t freqInMhz) {
    uint16_t tf, N, A;
    tf = (freqInMhz - 479) / 2;
    N = tf / 32;
    A = tf % 32;
    return (N << (uint16_t)7) + A;
}
