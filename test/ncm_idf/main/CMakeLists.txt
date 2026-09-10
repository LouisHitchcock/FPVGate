idf_component_register(SRCS "tusb_ncm_main.c" "tusb_cdc_handler.c" "resetful_server.c" 
                       INCLUDE_DIRS ""
                       PRIV_REQUIRES vfs spiffs esp_netif esp_http_server json usbnet
                       )
set(WEB_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../front/web-demo")
if(EXISTS ${WEB_SRC_DIR}/dist)
    spiffs_create_partition_image(www ${WEB_SRC_DIR}/dist FLASH_IN_PROJECT)
else()
    message(FATAL_ERROR "${WEB_SRC_DIR}/dist doesn't exit. Please run 'npm run build' in ${WEB_SRC_DIR}")
endif()
