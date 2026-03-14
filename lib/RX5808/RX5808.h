#ifndef RX5808_H
#define RX5808_H

#include <stdint.h>

// Optional DMA-based ADC reading for RSSI.
// Enable by adding -DUSE_ADC_DMA=1 to build_flags in your target's .ini file.
// Requires ESP32-S3 or ESP32-C3 — the ESP-IDF adc_continuous API used here is
// not compatible with the original ESP32 (DevKit / non-S3/C3 targets).
// NOTE: esp_adc/adc_continuous.h is intentionally NOT included here to avoid
// polluting the include chain.  It is included only in RX5808.cpp.
#ifdef USE_ADC_DMA
#if !defined(ESP32S3) && !defined(ESP32S3_SUPERMINI) && !defined(LILYGO_TENERGY_S3) && \
    !defined(SEEED_XIAO_ESP32S3) && !defined(WAVESHARE_ESP32S3_LCD2) && !defined(ESP32C3)
#error "USE_ADC_DMA is only supported on ESP32-S3 and ESP32-C3 board targets"
#endif
#endif

#define RX5808_MIN_TUNETIME 35    // after set freq need to wait this long before read RSSI
#define RX5808_MIN_BUSTIME 30     // after set freq need to wait this long before setting again
#define POWER_DOWN_FREQ_MHZ 1111  // signal to power down the module
#define RSSI_READS 5              // number of analog RSSI reads per tick

class RX5808 {
   public:
    RX5808(uint8_t _rssiInputPin, uint8_t _rx5808DataPin, uint8_t _rx5808SelPin, uint8_t _rx5808ClkPin);
    void init();
    void setFrequency(uint16_t frequency);
    uint8_t readRssi();
    void handleFrequencyChange(uint32_t currentTimeMs, uint16_t potentiallyNewFreq);

   private:
    uint8_t rx5808DataPin = 0;  // DATA (CH1) output line to RX5808 module
    uint8_t rx5808ClkPin = 0;   // CLK (CH3) output line to RX5808 module
    uint8_t rx5808SelPin = 0;   // SEL (CH2) output line to RX5808 module
    uint8_t rssiInputPin = 0;   // RSSI input from RX5808

    uint16_t currentFrequency = 0;

    bool rxPoweredDown = false;
    bool recentSetFreqFlag = false;
    uint32_t lastSetFreqTimeMs = 0;

    void rx5808SerialSendBit1();
    void rx5808SerialSendBit0();
    void rx5808SerialEnableLow();
    void rx5808SerialEnableHigh();

    void setRxModulePower(uint32_t options);
    void resetRxModule();
    void setupRxModule();
    void powerDownRxModule();
    bool verifyFrequency();

    static uint16_t freqMhzToRegVal(uint16_t freqInMhz);

#ifdef USE_ADC_DMA
    // ADC continuous (DMA) state — only present when USE_ADC_DMA is defined.
    // Samples are accumulated in a DMA ring buffer at 20 kHz; readRssi() drains
    // and averages whatever is available on each call (non-blocking).
    // Opaque types are used here so that esp_adc/adc_continuous.h is only
    // included in RX5808.cpp and does not leak into the wider include chain.
    void*            adcHandle = nullptr;  // adc_continuous_handle_t
    uint8_t          adcChannel = 0;       // adc_channel_t — values 0-9 fit in uint8_t
    volatile uint8_t lastDmaRssi = 0;     // written by DMA ISR callback, read by readRssi()
    bool             adcDmaInitialized = false;
    void initAdcDma();
#endif
};

#endif
