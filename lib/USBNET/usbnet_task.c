#ifdef FPVGATE_USB_NET
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

BaseType_t __real_xTaskCreatePinnedToCore(TaskFunction_t code, const char *name,
    uint32_t stack, void *arg, UBaseType_t priority, TaskHandle_t *task,
    BaseType_t core);

// Arduino installs the USB interrupt then creates "usbd" from the same
// core-0 main task, but leaves usbd unpinned. The legacy dcd_esp32sx ISR
// continues accessing transfer state after posting a completion. Pinning
// its consumer to the interrupt core prevents concurrent cross-core re-arm.
// Keep every other task's requested affinity unchanged.
BaseType_t __wrap_xTaskCreatePinnedToCore(TaskFunction_t code, const char *name,
    uint32_t stack, void *arg, UBaseType_t priority, TaskHandle_t *task,
    BaseType_t core) {
    if (core == tskNO_AFFINITY && name && strcmp(name, "usbd") == 0) {
        core = xPortGetCoreID();
    }
    return __real_xTaskCreatePinnedToCore(code, name, stack, arg, priority, task, core);
}
#endif
