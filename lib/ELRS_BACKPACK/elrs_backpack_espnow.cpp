#include "elrs_backpack_espnow.h"
#include "config.h"
#include "debug.h"
#include "elrs_bind_uid.h"
#include "msp.h"

#if defined(ENABLE_ELRS_BACKPACK_ESPNOW)

#include <cstdio>
#include <cstring>
#include <esp_idf_version.h>
#include <esp_now.h>
#include <esp_wifi.h>

#include <WiFi.h>

static bool s_espnow_ready = false;
static elrs_msp::Decoder s_msp_decoder;

/** After ESP-NOW start, send a few link-test OSD bursts (radio/interface may not be ready on first ms). */
static uint8_t s_link_ping_rounds_left = 0;
static uint32_t s_link_ping_next_ms = 0;

/** From esp_now send callback: SUCCESS = link-layer ack from peer (ExpressLRS Timer uses unicast only). */
static uint32_t s_espnow_deliver_ok = 0;
static uint32_t s_espnow_deliver_fail = 0;
static uint32_t s_espnow_last_fail_log_ms = 0;

static void handle_msp_packet(const elrs_msp::Packet& p) {
    DEBUG("[ELRS MSP] type=%c fn=0x%04X len=%u\n", static_cast<char>(p.type), p.function,
          static_cast<unsigned>(p.payload_len));
    (void)p;
}

static void on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    (void)info;
    if (!data || len <= 0) {
        return;
    }
    elrs_msp::Packet pkt{};
    for (int i = 0; i < len; i++) {
        if (s_msp_decoder.pushByte(data[i], &pkt)) {
            handle_msp_packet(pkt);
        }
    }
}

static void on_espnow_sent_count(const uint8_t* mac_addr, esp_now_send_status_t status) {
    if (status == ESP_NOW_SEND_SUCCESS) {
        s_espnow_deliver_ok++;
        return;
    }
    s_espnow_deliver_fail++;
    /* Throttle: rapid FAIL lines + SPI/LCD on same bus can contribute to SPI mutex timeouts. */
    const uint32_t now = millis();
    if (now - s_espnow_last_fail_log_ms < 5000u) {
        return;
    }
    s_espnow_last_fail_log_ms = now;
    if (mac_addr) {
        DEBUG("ELRS: esp_now delivery FAIL -> %02X:%02X:%02X:%02X:%02X:%02X (no ACK; throttled 5s)\n", mac_addr[0],
              mac_addr[1], mac_addr[2], mac_addr[3], mac_addr[4], mac_addr[5]);
    } else {
        DEBUG("ELRS: esp_now delivery FAIL (no dest in tx_info)\n");
    }
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 5, 0)
static void on_espnow_sent(const esp_now_send_info_t* tx_info, esp_now_send_status_t status) {
    const uint8_t* mac = (tx_info && tx_info->des_addr) ? tx_info->des_addr : nullptr;
    on_espnow_sent_count(mac, status);
}
#else
static void on_espnow_sent(const uint8_t* mac_addr, esp_now_send_status_t status) {
    on_espnow_sent_count(mac_addr, status);
}
#endif

/** Same as ExpressLRS Backpack Timer_main / Vrx_main SetSoftMACAddress() — LR is required for reliable ESP-NOW to VRx. */
static void apply_elrs_backpack_wifi_protocol(wifi_interface_t ifx) {
    const uint8_t mask =
        WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR;
    esp_err_t e = esp_wifi_set_protocol(ifx, mask);
    if (e != ESP_OK) {
        DEBUG("ELRS: esp_wifi_set_protocol(if=%d) err=%d\n", static_cast<int>(ifx), static_cast<int>(e));
    }
}

/** Apply LR-capable PHY on every interface we might use (AP_STA builds have both). */
static void apply_elrs_backpack_wifi_protocol_for_mode() {
    apply_elrs_backpack_wifi_protocol(WIFI_IF_AP);
    const wifi_mode_t wm = WiFi.getMode();
    if (wm == WIFI_MODE_APSTA || wm == WIFI_MODE_STA) {
        apply_elrs_backpack_wifi_protocol(WIFI_IF_STA);
    }
}

/** ExpressLRS Backpack Timer_main sendMSPViaEspnow(): unicast to peer MAC only (no broadcast). */
static void espnow_send_to_uid_unicast(const uint8_t uid[6], const uint8_t* frame, size_t len) {
    if (!elrs_backpack_uid_valid(uid)) {
        return;
    }
    esp_err_t e = esp_now_send(uid, frame, len);
    if (e != ESP_OK) {
        DEBUG("ELRS: esp_now_send err=%d\n", (int)e);
    }
}

/**
 * MSP_ELRS_SET_OSD sub 0x03 — same layout as vrxc_elrs send_osd_text. Returns payload length (4 + text).
 * HDZero goggle OSD font uses 0x61–0x7A (a–z) for symbol glyphs (arrows, etc.), not letters — map to A–Z.
 */
static size_t build_osd_text_subpayload(uint8_t row, uint8_t col, const char* text, uint8_t* payload,
                                        size_t cap) {
    if (cap < 4 + 50) {
        return 0;
    }
    payload[0] = 0x03;
    payload[1] = row;
    payload[2] = col;
    payload[3] = 0;
    size_t n = 0;
    for (; text[n] && n < 50; ++n) {
        unsigned char uc = static_cast<unsigned char>(text[n]);
        if (uc >= 'a' && uc <= 'z') {
            uc = static_cast<unsigned char>(uc - static_cast<unsigned char>('a' - 'A'));
        }
        payload[4 + n] = uc;
    }
    return 4 + n;
}

static void send_msp_set_osd_payload(const uint8_t uid[6], const uint8_t* osd_payload, uint16_t osd_len) {
    uint8_t out[256];
    size_t olen = elrs_msp::buildPacketV2(elrs_msp::PacketType::Command, 0,
                                          static_cast<uint16_t>(elrs_msp::MspElrsSetOsd), osd_payload, osd_len, out,
                                          sizeof(out));
    if (olen == 0) {
        DEBUG("ELRS: MSP SET_OSD build failed (len=%u)\n", static_cast<unsigned>(osd_len));
        return;
    }
    espnow_send_to_uid_unicast(uid, out, olen);
}

static constexpr unsigned kHdzeroOsdCols = 50;

/**
 * Queue MSP_ELRS_SET_OSD text for row; optional immediate display flush (vrxc_elrs sends 0x04 once after all text).
 * @param col_override if 0–49, use that column; if -1, use config (AUTO centers in a 50-col grid — on HDZero that
 *                    lands on the crosshair/stick symbol band and eats the middle of the string).
 */
static void elrs_send_text_row_with_uid(const uint8_t uid[6], Config* conf, uint8_t row, const char* text,
                                        bool with_display, int16_t col_override = -1) {
    if (!conf || !text) {
        return;
    }
    uint8_t col = 0;
    if (col_override >= 0 && col_override <= 49) {
        col = static_cast<uint8_t>(col_override);
    } else {
        const uint8_t cfgCol = conf->getElrsOsdLapCol();
        const size_t text_len = strnlen(text, 56);
        if (cfgCol == ELRS_OSD_LAP_COL_AUTO) {
            if (text_len < kHdzeroOsdCols) {
                col = static_cast<uint8_t>((kHdzeroOsdCols - text_len) / 2U);
            }
        } else {
            col = cfgCol;
        }
    }

    uint8_t pl[4 + 50]{};
    size_t plen = build_osd_text_subpayload(row, col, text, pl, sizeof(pl));
    if (plen == 0) {
        return;
    }
    send_msp_set_osd_payload(uid, pl, static_cast<uint16_t>(plen));
    if (with_display) {
        const uint8_t display_sub[1] = {0x04};
        send_msp_set_osd_payload(uid, display_sub, 1);
    }
}

static void elrs_send_text_row_then_display(Config* conf, uint8_t row, const char* text) {
    uint8_t uid[6]{};
    elrs_backpack_compute_uid6(conf->getElrsBackpackBindPhrase(), conf->getPilotCallsign(), uid);
    if (!elrs_backpack_uid_valid(uid)) {
        return;
    }
    elrs_send_text_row_with_uid(uid, conf, row, text, true);
}

static void elrs_send_text_then_display(Config* conf, const char* text) {
    elrs_send_text_row_then_display(conf, conf->getElrsOsdLapRow(), text);
}

/**
 * Link test: avoid row 0 (flight band) and avoid AUTO horizontal center (HDZero stick/crosshair glyphs there).
 * Left margin col keeps full strings visible; buffer text then one 0x04 (vrxc_elrs style).
 */
static void elrs_send_link_ping(Config* conf) {
    uint8_t uid[6]{};
    elrs_backpack_compute_uid6(conf->getElrsBackpackBindPhrase(), conf->getPilotCallsign(), uid);
    if (!elrs_backpack_uid_valid(uid)) {
        return;
    }
    constexpr int16_t kSafeLeftCol = 3;
    const uint8_t r = conf->getElrsOsdLapRow();
    if (r + 1 <= 18) {
        elrs_send_text_row_with_uid(uid, conf, r, "FPVGate", false, kSafeLeftCol);
        elrs_send_text_row_with_uid(uid, conf, static_cast<uint8_t>(r + 1), "Timer link OK", false, kSafeLeftCol);
    } else if (r >= 1) {
        elrs_send_text_row_with_uid(uid, conf, static_cast<uint8_t>(r - 1), "FPVGate", false, kSafeLeftCol);
        elrs_send_text_row_with_uid(uid, conf, r, "Timer link OK", false, kSafeLeftCol);
    } else {
        elrs_send_text_row_with_uid(uid, conf, r, "FPVGate | link OK", false, kSafeLeftCol);
    }
    const uint8_t display_sub[1] = {0x04};
    send_msp_set_osd_payload(uid, display_sub, 1);
}

void elrsBackpackEspnowOnLap(Config* conf, uint32_t lapTimeMs, uint16_t lapNumberCompleted) {
    if (!conf || !conf->getElrsBackpackEspnow() || !s_espnow_ready) {
        return;
    }

    const uint32_t sec = lapTimeMs / 1000U;
    const uint32_t tenth = (lapTimeMs % 1000U) / 100U;
    const uint32_t m = sec / 60U;
    const uint32_t s = sec % 60U;

    char text[56];
    snprintf(text, sizeof(text), "LAP %u %lu:%02lu.%lu", static_cast<unsigned>(lapNumberCompleted),
             static_cast<unsigned long>(m), static_cast<unsigned long>(s), static_cast<unsigned long>(tenth));
    elrs_send_text_then_display(conf, text);
}

void elrsBackpackEspnowOnPlaybackLap(Config* conf, uint32_t lapTimeMs) {
    if (!conf || !conf->getElrsBackpackEspnow() || !conf->getElrsOsdPlaybackLaps() || !s_espnow_ready) {
        return;
    }
    const uint32_t sec = lapTimeMs / 1000U;
    const uint32_t tenth = (lapTimeMs % 1000U) / 100U;
    const uint32_t m = sec / 60U;
    const uint32_t s = sec % 60U;
    char text[56];
    snprintf(text, sizeof(text), "PB %lu:%02lu.%lu", static_cast<unsigned long>(m),
             static_cast<unsigned long>(s), static_cast<unsigned long>(tenth));
    elrs_send_text_then_display(conf, text);
}

void elrsBackpackEspnowOnRaceStop(Config* conf) {
    if (!conf || !conf->getElrsBackpackEspnow() || !conf->getElrsOsdClearOnStop() || !s_espnow_ready) {
        return;
    }
    uint8_t uid[6]{};
    elrs_backpack_compute_uid6(conf->getElrsBackpackBindPhrase(), conf->getPilotCallsign(), uid);
    const uint8_t clear_sub[1] = {0x02};
    send_msp_set_osd_payload(uid, clear_sub, 1);
    const uint8_t display_sub[1] = {0x04};
    send_msp_set_osd_payload(uid, display_sub, 1);
}

static void add_or_update_peer(const uint8_t mac[6], wifi_interface_t ifidx) {
    esp_now_del_peer(mac);
    esp_now_peer_info_t peer{};
    memcpy(peer.peer_addr, mac, 6);
    uint8_t ch = 0;
    wifi_second_chan_t second = WIFI_SECOND_CHAN_NONE;
    if (esp_wifi_get_channel(&ch, &second) != ESP_OK || ch == 0) {
        ch = kElrsBackpackEspnowWifiChannel;
    }
    peer.channel = ch;
    peer.encrypt = false;
    peer.ifidx = ifidx;
    esp_err_t err = esp_now_add_peer(&peer);
    if (err != ESP_OK && err != ESP_ERR_ESPNOW_EXIST) {
        DEBUG("ELRS: esp_now_add_peer %02x:... err=%d\n", mac[0], (int)err);
    }
}

void elrsBackpackEspnowPrepareWifiMacForElrs(Config* conf) {
    if (!conf || !conf->getElrsBackpackEspnow()) {
        return;
    }
    uint8_t uid[6]{};
    elrs_backpack_compute_uid6(conf->getElrsBackpackBindPhrase(), conf->getPilotCallsign(), uid);
    if (!elrs_backpack_uid_valid(uid)) {
        return;
    }

    /* Same sequence as ExpressLRS Backpack Tx_main.cpp / Timer_main SetSoftMACAddress() */
    uid[0] = static_cast<uint8_t>(uid[0] & ~0x01u); /* unicast MAC */

    const uint8_t lr_proto =
        static_cast<uint8_t>(WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR);

    WiFi.mode(WIFI_STA);
    WiFi.setTxPower(WIFI_POWER_19_5dBm);
    esp_err_t pr = esp_wifi_set_protocol(WIFI_IF_STA, lr_proto);
    if (pr != ESP_OK) {
        DEBUG("ELRS: esp_wifi_set_protocol(STA) err=%d\n", (int)pr);
    }
    WiFi.begin("network-name", "pass-to-network", 1);
    /* Must be disconnect() with default wifioff=false — disconnect(true) calls STA.end() and in STA-only
     * mode can drop the stack to WIFI_OFF / esp_wifi_deinit(), then esp_wifi_set_mac → 12289 NOT_INIT. */
    WiFi.disconnect();

    esp_err_t es = esp_wifi_set_mac(WIFI_IF_STA, uid);
    if (es != ESP_OK) {
        DEBUG("ELRS: esp_wifi_set_mac(STA, UID) err=%d (12289=NOT_INIT, 12293=MAC/state)\n", (int)es);
    }

    uint8_t ap_mac[6];
    memcpy(ap_mac, uid, 6);
    ap_mac[0] = static_cast<uint8_t>(ap_mac[0] ^ 0x02u);

    /* AP MAC before softAP() (webserver starts AP after this). Do not disconnect(true)/softAPdisconnect(true)
     * here — that can fully deinit Wi-Fi and break esp_wifi_set_mac(AP). */
    WiFi.mode(WIFI_AP_STA);
    esp_err_t ea = esp_wifi_set_mac(WIFI_IF_AP, ap_mac);
    if (ea == ESP_OK) {
        esp_err_t pra = esp_wifi_set_protocol(WIFI_IF_AP, lr_proto);
        if (pra != ESP_OK) {
            DEBUG("ELRS: esp_wifi_set_protocol(AP) err=%d\n", (int)pra);
        }
    } else {
        DEBUG("ELRS: esp_wifi_set_mac(AP, derived) err=%d\n", (int)ea);
    }

    if (es == ESP_OK && ea == ESP_OK) {
        DEBUG("ELRS: STA=bind UID, softAP=distinct (Tx_main SetSoftMACAddress + AP_STA)\n");
    }
}

void elrsBackpackEspnowReassertCustomMacsForElrs(Config* conf) {
    if (!conf || !conf->getElrsBackpackEspnow()) {
        return;
    }
    uint8_t uid[6]{};
    elrs_backpack_compute_uid6(conf->getElrsBackpackBindPhrase(), conf->getPilotCallsign(), uid);
    if (!elrs_backpack_uid_valid(uid)) {
        return;
    }
    uid[0] = static_cast<uint8_t>(uid[0] & ~0x01u);

    uint8_t cur_sta[6]{};
    if (esp_wifi_get_mac(WIFI_IF_STA, cur_sta) == ESP_OK && memcmp(cur_sta, uid, 6) != 0) {
        DEBUG("ELRS: STA MAC != bind UID after Wi-Fi bring-up — re-applying (VRx filters on source MAC)\n");
    }

    esp_err_t es = esp_wifi_set_mac(WIFI_IF_STA, uid);
    if (es != ESP_OK) {
        DEBUG("ELRS: reassert esp_wifi_set_mac(STA, UID) err=%d\n", (int)es);
    }

    wifi_mode_t wm = WIFI_MODE_NULL;
    if (esp_wifi_get_mode(&wm) == ESP_OK && (wm & WIFI_MODE_AP) != 0) {
        uint8_t ap_mac[6];
        memcpy(ap_mac, uid, 6);
        ap_mac[0] = static_cast<uint8_t>(ap_mac[0] ^ 0x02u);
        esp_err_t ea = esp_wifi_set_mac(WIFI_IF_AP, ap_mac);
        if (ea != ESP_OK) {
            DEBUG("ELRS: reassert esp_wifi_set_mac(AP) err=%d\n", (int)ea);
        }
    }

    apply_elrs_backpack_wifi_protocol_for_mode();
}

void elrsBackpackEspnowStopIfRunning() {
    s_link_ping_rounds_left = 0;
    if (!s_espnow_ready) {
        return;
    }
    s_msp_decoder.reset();
    esp_now_unregister_recv_cb();
    esp_now_unregister_send_cb();
    esp_now_deinit();
    s_espnow_ready = false;
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    DEBUG("ELRS backpack ESP-NOW stopped\n");
}

void elrsBackpackEspnowStartIfEnabled(Config* conf) {
    if (!conf || !conf->getElrsBackpackEspnow()) {
        elrsBackpackEspnowStopIfRunning();
        return;
    }

    elrsBackpackEspnowStopIfRunning();

    esp_err_t err = esp_now_init();
    if (err != ESP_OK) {
        DEBUG("esp_now_init failed: %d\n", (int)err);
        return;
    }

    err = esp_now_register_recv_cb(on_recv);
    if (err != ESP_OK) {
        DEBUG("esp_now_register_recv_cb failed: %d\n", (int)err);
        esp_now_deinit();
        return;
    }

    err = esp_now_register_send_cb(on_espnow_sent);
    if (err != ESP_OK) {
        DEBUG("esp_now_register_send_cb failed: %d\n", (int)err);
        esp_now_unregister_recv_cb();
        esp_now_deinit();
        return;
    }

    s_espnow_deliver_ok = 0;
    s_espnow_deliver_fail = 0;

    esp_wifi_set_ps(WIFI_PS_NONE);

    apply_elrs_backpack_wifi_protocol_for_mode();

    /*
     * Timer backpack uses STA + UID MAC for ESP-NOW. With AP_STA, use STA (see prepareWifiMacForElrs).
     * Pure AP mode: only AP exists, UID was set on AP in prepare.
     */
    wifi_interface_t ifidx = WIFI_IF_AP;
    const wifi_mode_t wm = WiFi.getMode();
    if (wm == WIFI_MODE_APSTA || wm == WIFI_MODE_STA) {
        ifidx = WIFI_IF_STA;
    }
    if (WiFi.status() == WL_CONNECTED) {
        ifidx = WIFI_IF_STA;
    }

    uint8_t uid[6]{};
    elrs_backpack_compute_uid6(conf->getElrsBackpackBindPhrase(), conf->getPilotCallsign(), uid);
    if (elrs_backpack_uid_valid(uid)) {
        add_or_update_peer(uid, ifidx);
        DEBUG("ELRS: backpack UID %02X:%02X:%02X:%02X:%02X:%02X (bind phrase or callsign hash)\n", uid[0], uid[1],
              uid[2], uid[3], uid[4], uid[5]);
        uint8_t hw[6]{};
        if (esp_wifi_get_mac(WIFI_IF_STA, hw) == ESP_OK) {
            DEBUG("ELRS: STA hw MAC %02X:%02X:%02X:%02X:%02X:%02X (must match UID above for goggle)\n", hw[0], hw[1],
                  hw[2], hw[3], hw[4], hw[5]);
        }
    } else {
        DEBUG("ELRS: no bind phrase or callsign — set phrase to match goggles\n");
    }

    s_espnow_ready = true;
    {
        uint8_t ch = 0;
        wifi_second_chan_t second = WIFI_SECOND_CHAN_NONE;
        if (esp_wifi_get_channel(&ch, &second) == ESP_OK) {
            DEBUG("ELRS: Wi-Fi channel %u (must match VRx backpack; ELRS SetSoftMACAddress uses ch %u)\n",
                  static_cast<unsigned>(ch), static_cast<unsigned>(kElrsBackpackEspnowWifiChannel));
        }
    }
    DEBUG("ELRS backpack ESP-NOW started (esp_now if=%d)\n", static_cast<int>(ifidx));

    /* Deferred + repeated: first attempt after Wi-Fi/ESP-NOW often needs a few hundred ms; HDZero may show row 0 vs lap row differently. */
    s_link_ping_rounds_left = 14;
    s_link_ping_next_ms = millis() + 250;
    DEBUG("ELRS: link test: %u OSD bursts (~450ms); cb ok should climb if goggle ACKs unicast\n",
          static_cast<unsigned>(s_link_ping_rounds_left));
}

void elrsBackpackEspnowPoll(Config* conf, uint32_t nowMs) {
    if (!s_espnow_ready || !conf || !conf->getElrsBackpackEspnow() || s_link_ping_rounds_left == 0) {
        return;
    }
    if (static_cast<int32_t>(nowMs - s_link_ping_next_ms) < 0) {
        return;
    }
    const uint8_t round = static_cast<uint8_t>(s_link_ping_rounds_left);
    elrs_send_link_ping(conf);
    s_link_ping_rounds_left--;
    s_link_ping_next_ms = nowMs + 450;
    DEBUG("ELRS: link OSD burst #%u left=%u | esp_now_cb ok=%lu fail=%lu (fail>0 = no ACK from goggle)\n",
          static_cast<unsigned>(round), static_cast<unsigned>(s_link_ping_rounds_left),
          static_cast<unsigned long>(s_espnow_deliver_ok), static_cast<unsigned long>(s_espnow_deliver_fail));
}

#else

void elrsBackpackEspnowPrepareWifiMacForElrs(Config*) {}

void elrsBackpackEspnowReassertCustomMacsForElrs(Config*) {}

void elrsBackpackEspnowStopIfRunning() {}

void elrsBackpackEspnowStartIfEnabled(Config*) {}

void elrsBackpackEspnowOnLap(Config*, uint32_t, uint16_t) {}

void elrsBackpackEspnowOnPlaybackLap(Config*, uint32_t) {}

void elrsBackpackEspnowOnRaceStop(Config*) {}

void elrsBackpackEspnowPoll(Config*, uint32_t) {}

#endif
