#ifdef FPVGATE_ETH_W5500
#include "ethnet.h"
#include "config.h"
#include "debug.h"

#include <Arduino.h>
#include <string.h>
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_eth.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_rom_sys.h"
#include "lwip/ip4_addr.h"

// The project's copy of ESP-IDF's W5500 MAC driver (w5500_mac.c).
extern "C" esp_eth_mac_t *ethnet_w5500_mac_new(const eth_w5500_config_t *w5500_config,
                                               const eth_mac_config_t *mac_config);

// The W5500 is on its own SPI controller; the SD card uses HSPI (SPI3).
#define ETHNET_SPI_HOST SPI2_HOST
#define ETHNET_SPI_MHZ 20

static esp_eth_handle_t eth;
static esp_netif_t *netif;
static volatile bool linkUp;
static volatile bool hasIp;
static volatile bool isStatic;
static volatile unsigned long linkUpMs;
static esp_ip4_addr_t address;
static int bootPhycfgr = -1;

// A new link may be a different network: drop the old address and ask for
// one again, even after falling back to the fixed one.
static void onEthEvent(void *, esp_event_base_t, int32_t id, void *) {
    switch (id) {
        case ETHERNET_EVENT_CONNECTED:
            linkUp = true;
            linkUpMs = millis();
            if (isStatic && netif) {
                isStatic = false;
                esp_netif_dhcpc_start(netif);
            }
            DEBUG("[ETH] Link up\n");
            break;
        case ETHERNET_EVENT_DISCONNECTED:
            linkUp = false;
            hasIp = false;
            DEBUG("[ETH] Link down\n");
            break;
        default:
            break;
    }
}

static void onGotIp(void *, esp_event_base_t, int32_t, void *data) {
    const ip_event_got_ip_t *event = static_cast<const ip_event_got_ip_t *>(data);
    address = event->ip_info.ip;
    hasIp = true;
    DEBUG("[ETH] Address " IPSTR "%s\n", IP2STR(&address), isStatic ? " (fixed)" : " (DHCP)");
}

esp_err_t ethnet_begin(void) {
    if (eth) return ESP_OK;
    esp_netif_init();
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return err;
    // The W5500 driver's interrupt uses the GPIO ISR service.
    err = gpio_install_isr_service(0);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return err;

    // Hardware reset first, then let the MAC driver configure the chip. Given
    // the reset pin, ESP-IDF 4.4's W5500 PHY driver pulses it after the MAC
    // driver has set up the chip, which puts the 16 KB socket buffers back to
    // their 2 KB default: one full frame, so the second of any back-to-back
    // pair was dropped and uploads (OTA) crawled at ~10 KB/s.
    gpio_reset_pin((gpio_num_t)PIN_ETH_RST);
    gpio_set_direction((gpio_num_t)PIN_ETH_RST, GPIO_MODE_OUTPUT);
    gpio_set_level((gpio_num_t)PIN_ETH_RST, 0);
    esp_rom_delay_us(600);                   // RSTn low >= 500 us
    gpio_set_level((gpio_num_t)PIN_ETH_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(2));            // >= 1 ms for the PLL to lock

    spi_bus_config_t bus = {};
    bus.mosi_io_num = PIN_ETH_MOSI;
    bus.miso_io_num = PIN_ETH_MISO;
    bus.sclk_io_num = PIN_ETH_SCLK;
    bus.quadwp_io_num = -1;
    bus.quadhd_io_num = -1;
    err = spi_bus_initialize(ETHNET_SPI_HOST, &bus, SPI_DMA_CH_AUTO);
    if (err != ESP_OK) return err;

    spi_device_interface_config_t dev = {};
    dev.command_bits = 16;   // W5500 frame: 16-bit address phase + 8-bit control
    dev.address_bits = 8;
    dev.mode = 0;
    dev.clock_speed_hz = ETHNET_SPI_MHZ * 1000 * 1000;
    dev.spics_io_num = PIN_ETH_CS;
    dev.queue_size = 20;
    spi_device_handle_t spi = nullptr;
    err = spi_bus_add_device(ETHNET_SPI_HOST, &dev, &spi);
    if (err != ESP_OK) return err;

    eth_w5500_config_t w5500 = ETH_W5500_DEFAULT_CONFIG(spi);
    w5500.int_gpio_num = PIN_ETH_INT;
    eth_mac_config_t macConfig = ETH_MAC_DEFAULT_CONFIG();
    eth_phy_config_t phyConfig = ETH_PHY_DEFAULT_CONFIG();
    phyConfig.reset_gpio_num = -1;   // reset above, before the MAC setup
    esp_eth_mac_t *mac = ethnet_w5500_mac_new(&w5500, &macConfig);
    esp_eth_phy_t *phy = esp_eth_phy_new_w5500(&phyConfig);
    if (!mac || !phy) return ESP_FAIL;
    esp_eth_config_t ethConfig = ETH_DEFAULT_CONFIG(mac, phy);
    err = esp_eth_driver_install(&ethConfig, &eth);
    if (err != ESP_OK) return err;

    // The W5500 has no MAC address of its own; use the chip's Ethernet one.
    uint8_t macAddr[6];
    esp_read_mac(macAddr, ESP_MAC_ETH);
    esp_eth_ioctl(eth, ETH_CMD_S_MAC_ADDR, macAddr);

    esp_netif_config_t netifConfig = ESP_NETIF_DEFAULT_ETH();
    netif = esp_netif_new(&netifConfig);
    if (!netif) return ESP_ERR_NO_MEM;
    esp_netif_set_hostname(netif, "fpvgate");
    err = esp_netif_attach(netif, esp_eth_new_netif_glue(eth));
    if (err != ESP_OK) return err;

    esp_event_handler_register(ETH_EVENT, ESP_EVENT_ANY_ID, onEthEvent, nullptr);
    esp_event_handler_register(IP_EVENT, IP_EVENT_ETH_GOT_IP, onGotIp, nullptr);
    err = esp_eth_start(eth);
    bootPhycfgr = ethnet_w5500_phycfgr();   // diagnostics: the PHY's mode as started
    return err;
}

int ethnet_boot_phycfgr(void) { return bootPhycfgr; }

void ethnet_update(unsigned long nowMs) {
    if (!netif || !linkUp || hasIp || isStatic) return;
    if (nowMs - linkUpMs < ETHNET_DHCP_TIMEOUT_MS) return;
    // No DHCP server answered: a cable straight to a computer.
    esp_netif_dhcpc_stop(netif);
    esp_netif_ip_info_t ip = {};
    IP4_ADDR(&ip.ip, 192, 168, 8, 1);
    IP4_ADDR(&ip.gw, 0, 0, 0, 0);
    IP4_ADDR(&ip.netmask, 255, 255, 255, 0);
    isStatic = true;
    if (esp_netif_set_ip_info(netif, &ip) == ESP_OK) {
        address = ip.ip;
        hasIp = true;
        DEBUG("[ETH] No DHCP after %lu s: fixed address 192.168.8.1\n", (unsigned long)(ETHNET_DHCP_TIMEOUT_MS / 1000));
    }
}

bool ethnet_link_up(void) { return linkUp; }
bool ethnet_has_ip(void) { return hasIp && linkUp; }
bool ethnet_is_static(void) { return isStatic; }

int ethnet_speed_mbps(void) {
    eth_speed_t speed = ETH_SPEED_10M;
    if (!eth || !linkUp || esp_eth_ioctl(eth, ETH_CMD_G_SPEED, &speed) != ESP_OK) return 0;
    return speed == ETH_SPEED_100M ? 100 : 10;
}

bool ethnet_full_duplex(void) {
    eth_duplex_t duplex = ETH_DUPLEX_HALF;
    return eth && linkUp && esp_eth_ioctl(eth, ETH_CMD_G_DUPLEX_MODE, &duplex) == ESP_OK && duplex == ETH_DUPLEX_FULL;
}

void ethnet_ip_string(char *out, size_t len) {
    if (!len) return;
    if (!ethnet_has_ip()) {
        out[0] = '\0';
        return;
    }
    snprintf(out, len, IPSTR, IP2STR(&address));
}
#endif
