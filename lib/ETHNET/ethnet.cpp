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
#include "lwip/ip4_addr.h"

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
    phyConfig.reset_gpio_num = PIN_ETH_RST;
    esp_eth_mac_t *mac = esp_eth_mac_new_w5500(&w5500, &macConfig);
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
    return esp_eth_start(eth);
}

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

void ethnet_ip_string(char *out, size_t len) {
    if (!len) return;
    if (!ethnet_has_ip()) {
        out[0] = '\0';
        return;
    }
    snprintf(out, len, IPSTR, IP2STR(&address));
}
#endif
