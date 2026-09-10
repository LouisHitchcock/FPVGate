#ifndef __TUSB_NCM_DEMO_H__
#define __TUSB_NCM_DEMO_H__
#include <sys/types.h>
#include <esp_err.h>
esp_err_t resetful_server_start(const char *base_path);
int tusb_cdc_handler_init(void);
#endif
