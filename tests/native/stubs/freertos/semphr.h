#pragma once
using SemaphoreHandle_t = void*;
#define portMAX_DELAY 0xffffffffu
inline SemaphoreHandle_t xSemaphoreCreateMutex() { return (void*)1; }
inline void xSemaphoreTake(SemaphoreHandle_t, unsigned) {}
inline void xSemaphoreGive(SemaphoreHandle_t) {}
