#ifdef FPVGATE_USB_NET
// IDF 4.4's DHCP implementation is a singleton. Compile a private copy for
// USB so WiFi AP start/stop cannot replace its interface or lease state.
#define dhcps_start usb_dhcps_start
#define dhcps_stop usb_dhcps_stop
#define dhcps_option_info usb_dhcps_option_info
#define dhcps_set_option_info usb_dhcps_set_option_info
#define dhcp_search_ip_on_mac usb_dhcp_search_ip_on_mac
#define dhcps_dns_setserver usb_dhcps_dns_setserver
#define dhcps_dns_getserver usb_dhcps_dns_getserver
#define dhcps_set_new_lease_cb usb_dhcps_set_new_lease_cb
#define dhcps_coarse_tmr usb_dhcps_coarse_tmr
#define dhcps_pbuf_alloc usb_dhcps_pbuf_alloc
#define node_remove_from_list usb_dhcps_node_remove_from_list
#include "idf/dhcpserver.inc"
#include "lwip/timeouts.h"

static void lease_assigned(u8_t client_ip[4]) {
    // Unlike WiFi AP, USB has no station table to update.
    (void)client_ip;
}

static void lease_timer(void *arg) {
    usb_dhcps_coarse_tmr();
    sys_timeout(DHCPS_COARSE_TIMER_SECS * 1000, lease_timer, arg);
}

// Called on lwIP's TCP/IP task, once for the lifetime of the USB netif.
esp_err_t usbnet_dhcp_start(struct netif *interface) {
    dhcps_offer_t offers = 0; // USB provides local access, not an Internet gateway.
    usb_dhcps_set_new_lease_cb(lease_assigned);
    usb_dhcps_set_option_info(ROUTER_SOLICITATION_ADDRESS, &offers, sizeof(offers));
    if (usb_dhcps_start(interface, *netif_ip4_addr(interface)) != ERR_OK) {
        usb_dhcps_stop(interface);
        return ESP_FAIL;
    }
    udp_bind_netif(interface->dhcps_pcb, interface);
    sys_timeout(DHCPS_COARSE_TIMER_SECS * 1000, lease_timer, NULL);
    return ESP_OK;
}
#endif
