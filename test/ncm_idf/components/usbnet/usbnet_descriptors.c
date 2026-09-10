/**
 * Custom USB descriptors: composite CDC (debug console) + RNDIS (networking).
 *
 * Why these live here rather than coming from esp_tinyusb:
 *
 * esp_tinyusb's Kconfig offers ECM/NCM/RNDIS, but its default descriptor
 * generator only ever emits the *NCM* network interface - every net-related
 * block in its usb_descriptors.c is guarded by `#if CFG_TUD_NCM`, and
 * tusb_get_mac_string_id() only exists under that guard. Selecting
 * CONFIG_TINYUSB_NET_MODE_ECM_RNDIS therefore link-fails. Supplying our own
 * descriptors through tinyusb_config_t (device_descriptor /
 * fs_configuration_descriptor / string_descriptor) is the supported way round
 * that, and avoids patching a managed component that any dependency update
 * would silently overwrite.
 *
 * RNDIS rather than NCM because Windows' inbox UsbNcm driver binds to our NCM
 * device but then refuses to start it (CM_PROB_FAILED_START / Code 10), which
 * reproduces with Espressif's own reference firmware. RNDIS is Windows' native
 * USB networking path and is far more widely exercised there.
 *
 * ESP32-S3 USB is full-speed only, so only the FS configuration is provided.
 */

#include "usbnet.h"

#include "esp_mac.h"
#include "tusb.h"

#include <stdio.h>
#include <string.h>

#define USBNET_VID 0x303A  // Espressif
#define USBNET_PID 0x4003  // distinct from the earlier NCM build so Windows
                           // does not serve a cached descriptor set

// RNDIS only. CDC is deliberately absent: CDC + networking needs four IN
// endpoints, two of them bulk (which dcd_dwc2 allocates double FIFO for), and
// the S3's shared FIFO pool is the prime suspect for the network interface
// failing to start. See dcd_dwc2.c:599 - dcd_edpt_open() asserts on
// dfifo_alloc(), so an endpoint that cannot get FIFO space never opens.
enum {
    ITF_NUM_RNDIS = 0,
    ITF_NUM_RNDIS_DATA,
    ITF_NUM_TOTAL,
};

enum {
    EPNUM_RNDIS_NOTIF = 0x81,
    EPNUM_RNDIS_OUT = 0x02,
    EPNUM_RNDIS_IN = 0x82,
};

enum {
    STRID_LANGID = 0,
    STRID_MANUFACTURER,
    STRID_PRODUCT,
    STRID_SERIAL,
    STRID_RNDIS_INTERFACE,
    STRID_MAC,
    STRID_COUNT,
};

//--------------------------------------------------------------------+
// Device descriptor
//--------------------------------------------------------------------+

// TUSB_CLASS_MISC / COMMON / IAD is required for a composite device that uses
// Interface Association Descriptors, which both CDC and RNDIS do.
static const tusb_desc_device_t s_device_desc = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0200,
    .bDeviceClass = TUSB_CLASS_MISC,
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = USBNET_VID,
    .idProduct = USBNET_PID,
    .bcdDevice = 0x0100,
    .iManufacturer = STRID_MANUFACTURER,
    .iProduct = STRID_PRODUCT,
    .iSerialNumber = STRID_SERIAL,
    .bNumConfigurations = 0x01,
};

//--------------------------------------------------------------------+
// Configuration descriptor
//--------------------------------------------------------------------+

#define CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_RNDIS_DESC_LEN)

static const uint8_t s_fs_config_desc[] = {
    // config number, interface count, string index, total length, attribute, power in mA
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0x00, 100),

    // RNDIS: networking. Same argument shape as CDC.
    TUD_RNDIS_DESCRIPTOR(ITF_NUM_RNDIS, STRID_RNDIS_INTERFACE, EPNUM_RNDIS_NOTIF, 8,
                         EPNUM_RNDIS_OUT, EPNUM_RNDIS_IN, 64),
};

//--------------------------------------------------------------------+
// String descriptors
//--------------------------------------------------------------------+

// The MAC string is built at runtime from the factory MAC. RNDIS/ECM require
// it as 12 uppercase hex digits with no separators.
static char s_mac_str[13] = "020284A96001";
static char s_serial_str[17] = "FPVGATE";

static const char *s_string_desc[STRID_COUNT] = {
    [STRID_LANGID] = (const char[]){0x09, 0x04},  // English (0x0409)
    [STRID_MANUFACTURER] = "FPVGate",
    [STRID_PRODUCT] = "FPVGate Timer",
    [STRID_SERIAL] = s_serial_str,
    [STRID_RNDIS_INTERFACE] = "FPVGate USB Network",
    [STRID_MAC] = s_mac_str,
};

//--------------------------------------------------------------------+
// Storage TinyUSB expects the application to provide
//--------------------------------------------------------------------+

// Declared extern by TinyUSB's net_device.h and referenced by
// ecm_rndis_device.c / rndis_reports.c. esp_tinyusb only defines it on its NCM
// path, so with RNDIS the application has to. Populated by usbnet_init().
uint8_t tud_network_mac_address[6] = {0x02, 0x02, 0x84, 0x00, 0x00, 0x00};

//--------------------------------------------------------------------+
// Public accessors
//--------------------------------------------------------------------+

// Referenced by the vendored net glue in place of esp_tinyusb's private
// tusb_get_mac_string_id().
uint8_t usbnet_mac_string_id(void) { return STRID_MAC; }

void usbnet_get_mac(uint8_t mac_out[6]) {
    // Locally administered (bit 1 set), not multicast (bit 0 clear), with the
    // low three octets from the factory MAC so two boards on one host differ.
    static const uint8_t base[6] = {0x02, 0x02, 0x84, 0x00, 0x00, 0x00};
    memcpy(mac_out, base, 6);

    uint8_t factory[6];
    if (esp_read_mac(factory, ESP_MAC_WIFI_STA) == ESP_OK) {
        memcpy(mac_out + 3, factory + 3, 3);
    }
}

const tusb_desc_device_t *usbnet_device_descriptor(void) { return &s_device_desc; }

const uint8_t *usbnet_fs_config_descriptor(void) { return s_fs_config_desc; }

const char **usbnet_string_descriptors(int *count) {
    // Fill in the MAC and serial strings before the host can ask for them.
    uint8_t mac[6];
    usbnet_get_mac(mac);
    snprintf(s_mac_str, sizeof(s_mac_str), "%02X%02X%02X%02X%02X%02X", mac[0], mac[1], mac[2],
             mac[3], mac[4], mac[5]);
    snprintf(s_serial_str, sizeof(s_serial_str), "FPVGATE%02X%02X%02X", mac[3], mac[4], mac[5]);

    *count = STRID_COUNT;
    return s_string_desc;
}
