#ifndef SERIAL_GUARD_H
#define SERIAL_GUARD_H

#include <Arduino.h>

void serialOutputLock();
void serialOutputUnlock();
void markUsbProtocolActivity();
bool shouldSuppressDebugSerial();

#endif
