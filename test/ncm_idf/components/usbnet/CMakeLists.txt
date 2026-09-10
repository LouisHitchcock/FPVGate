idf_component_register(SRCS "usbnet_descriptors.c" "usbnet_glue.c"
                       INCLUDE_DIRS "include"
                       REQUIRES espressif__esp_tinyusb esp_netif
                       PRIV_REQUIRES esp_hw_support)
