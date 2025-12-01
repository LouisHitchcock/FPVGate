/*
 * Standalone SD Card Test for ESP32-S3
 * Tests SD card reader on SPI pins
 */

#include <Arduino.h>
#include <SD.h>
#include <SPI.h>

// Pin definitions - MUST match your wiring
#define PIN_SD_CS   9
#define PIN_SD_SCK  7
#define PIN_SD_MOSI 6
#define PIN_SD_MISO 15

SPIClass spi(HSPI);

void setup() {
    Serial.begin(460800);
    delay(2000);
    
    Serial.println("\n\n=================================");
    Serial.println("ESP32-S3 SD Card Test");
    Serial.println("=================================\n");
    
    // Test 1: Pin Configuration
    Serial.println("Test 1: Pin Configuration");
    Serial.printf("  CS   = GPIO %d\n", PIN_SD_CS);
    Serial.printf("  SCK  = GPIO %d\n", PIN_SD_SCK);
    Serial.printf("  MOSI = GPIO %d\n", PIN_SD_MOSI);
    Serial.printf("  MISO = GPIO %d\n", PIN_SD_MISO);
    Serial.println();
    
    // Test 2: Initialize SPI
    Serial.println("Test 2: Initialize SPI Bus");
    spi.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
    Serial.println("  ✓ SPI bus initialized");
    Serial.println();
    
    // Test 3: Try different frequencies
    uint32_t frequencies[] = {400000, 1000000, 4000000, 8000000};
    const char* freqNames[] = {"400kHz", "1MHz", "4MHz", "8MHz"};
    
    for (int i = 0; i < 4; i++) {
        Serial.printf("Test 3.%d: Try SD.begin() at %s\n", i+1, freqNames[i]);
        
        if (SD.begin(PIN_SD_CS, spi, frequencies[i], "/sd", 5)) {
            Serial.println("  ✓ SUCCESS!");
            
            uint8_t cardType = SD.cardType();
            if (cardType == CARD_NONE) {
                Serial.println("  ✗ No SD card attached");
                SD.end();
                continue;
            }
            
            Serial.print("  Card Type: ");
            if (cardType == CARD_MMC) Serial.println("MMC");
            else if (cardType == CARD_SD) Serial.println("SD");
            else if (cardType == CARD_SDHC) Serial.println("SDHC");
            else Serial.println("UNKNOWN");
            
            uint64_t cardSize = SD.cardSize() / (1024 * 1024);
            Serial.printf("  Card Size: %lluMB\n", cardSize);
            
            uint64_t totalBytes = SD.totalBytes() / (1024 * 1024);
            uint64_t usedBytes = SD.usedBytes() / (1024 * 1024);
            Serial.printf("  Total Space: %lluMB\n", totalBytes);
            Serial.printf("  Used Space: %lluMB\n", usedBytes);
            
            // Test read/write
            Serial.println("\nTest 4: File Write/Read");
            File file = SD.open("/test.txt", FILE_WRITE);
            if (file) {
                file.println("Hello from ESP32-S3!");
                file.close();
                Serial.println("  ✓ Write successful");
                
                file = SD.open("/test.txt");
                if (file) {
                    Serial.print("  Content: ");
                    while (file.available()) {
                        Serial.write(file.read());
                    }
                    file.close();
                    Serial.println("  ✓ Read successful");
                    
                    SD.remove("/test.txt");
                    Serial.println("  ✓ Delete successful");
                } else {
                    Serial.println("  ✗ Read failed");
                }
            } else {
                Serial.println("  ✗ Write failed");
            }
            
            Serial.println("\n✓✓✓ SD CARD WORKING! ✓✓✓");
            SD.end();
            break;
        } else {
            Serial.printf("  ✗ Failed at %s\n", freqNames[i]);
            SD.end();
        }
        Serial.println();
    }
    
    Serial.println("\n=================================");
    Serial.println("Test Complete");
    Serial.println("=================================");
}

void loop() {
    delay(10000);
}
