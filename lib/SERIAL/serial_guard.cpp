#include "serial_guard.h"

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace {
SemaphoreHandle_t g_serialMutex = nullptr;
volatile uint32_t g_lastUsbProtocolActivityMs = 0;
constexpr uint32_t USB_PROTOCOL_QUIET_WINDOW_MS = 300000;

SemaphoreHandle_t getSerialMutex() {
    if (g_serialMutex == nullptr) {
        g_serialMutex = xSemaphoreCreateMutex();
    }
    return g_serialMutex;
}
}  // namespace

void serialOutputLock() {
    SemaphoreHandle_t mutex = getSerialMutex();
    if (mutex != nullptr) {
        xSemaphoreTake(mutex, portMAX_DELAY);
    }
}

void serialOutputUnlock() {
    SemaphoreHandle_t mutex = getSerialMutex();
    if (mutex != nullptr) {
        xSemaphoreGive(mutex);
    }
}

void markUsbProtocolActivity() {
    g_lastUsbProtocolActivityMs = millis();
}

bool shouldSuppressDebugSerial() {
    uint32_t lastActivity = g_lastUsbProtocolActivityMs;
    return lastActivity != 0 && (millis() - lastActivity) < USB_PROTOCOL_QUIET_WINDOW_MS;
}
