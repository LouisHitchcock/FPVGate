#ifndef ELRS_BACKPACK_ESPNOW_H
#define ELRS_BACKPACK_ESPNOW_H

#include <stdint.h>

class Config;

/**
 * Primary 2.4 GHz channel for ESP-NOW with ExpressLRS VRx / Timer backpacks.
 * MUST match `WiFi.begin(..., channel)` in Backpack `SetSoftMACAddress()` (Timer_main / Vrx_main / Tx_main use 1).
 * softAP on another channel (e.g. 6) leaves FPVGate transmitting ESP-NOW while goggles listen on 1 → no ACK.
 */
constexpr uint8_t kElrsBackpackEspnowWifiChannel = 1;

/** Tear down ESP-NOW if it was started (safe if already off). */
void elrsBackpackEspnowStopIfRunning();

/**
 * Tx_main SetSoftMACAddress sequence: WIFI_STA → begin(dummy, ch 1) → disconnect() → esp_wifi_set_mac(STA);
 * then WIFI_AP_STA → esp_wifi_set_mac(AP). begin() is required or set_mac can return ESP_ERR_WIFI_NOT_INIT
 * (12289) on Arduino/IDF 5.
 */
void elrsBackpackEspnowPrepareWifiMacForElrs(Config* conf);

/**
 * Re-apply bind-phrase STA/AP MACs and LR protocol after WiFi.softAP() / WiFi.begin().
 * Some stacks reset custom MACs when the AP or STA config is applied; VRx only accepts
 * frames whose 802.11 source MAC matches the bind UID.
 */
void elrsBackpackEspnowReassertCustomMacsForElrs(Config* conf);

/**
 * If ELRS backpack ESP-NOW is enabled in config and the build supports it,
 * initialize ESP-NOW after Wi-Fi is started. Otherwise ensures ESP-NOW is off.
 */
void elrsBackpackEspnowStartIfEnabled(Config* conf);

/** Call from main WiFi loop (e.g. Webserver::handleWebUpdate): retries link-test OSD while armed. */
void elrsBackpackEspnowPoll(Config* conf, uint32_t nowMs);

/**
 * On each completed lap, send MSP_ELRS_SET_OSD text + display to the bind-phrase UID (unicast ESP-NOW,
 * same as ExpressLRS Backpack Timer send path — no broadcast).
 * No-op if backpack ESP-NOW is off, not started, or unsupported in this build.
 */
void elrsBackpackEspnowOnLap(Config* conf, uint32_t lapTimeMs, uint16_t lapNumberCompleted);

/** Playback lap line (prefix "PB"); respects OSD row/column config. */
void elrsBackpackEspnowOnPlaybackLap(Config* conf, uint32_t lapTimeMs);

/** If enabled in config, clear goggle OSD (MSP 0x02 + display) after race stop. */
void elrsBackpackEspnowOnRaceStop(Config* conf);

#endif
