#include <stdint.h>
#include <esp_log.h>
#include <tinyusb.h>
#include <tusb_cdc_acm.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <sdkconfig.h>
#include "tusb_ncm_demo.h"

static const char *TAG = "CDC_Handler";

typedef struct {
    uint32_t frame_count;
    uint32_t total_bytes;
    uint32_t queue_fail_count;
    uint32_t queue_fail_bytes;
} cdc_stats_t;

typedef struct {
    cdc_stats_t stats;
    uint8_t rx_buf[CONFIG_TINYUSB_CDC_RX_BUFSIZE + 1];
    QueueHandle_t app_queue;
} cdc_context_t;

static cdc_context_t s_cdc_ctx = {0};

typedef struct {
    uint8_t buf[CONFIG_TINYUSB_CDC_RX_BUFSIZE + 1];
    size_t buf_len;
    uint8_t itf;
} app_message_t;

static void tinyusb_cdc_rx_callback(int itf, cdcacm_event_t *event)
{
    size_t rx_size = 0;
    esp_err_t ret = tinyusb_cdcacm_read(itf, s_cdc_ctx.rx_buf, CONFIG_TINYUSB_CDC_RX_BUFSIZE, &rx_size);
    if (ret == ESP_OK) {
        app_message_t tx_msg;
        tx_msg.buf_len = rx_size;
        tx_msg.itf = itf;
        memcpy(tx_msg.buf, s_cdc_ctx.rx_buf, rx_size);
        BaseType_t xStatus = xQueueSend(s_cdc_ctx.app_queue, &tx_msg, 0);
        if (xStatus == pdTRUE) {
            s_cdc_ctx.stats.frame_count++;
            s_cdc_ctx.stats.total_bytes += tx_msg.buf_len;
            ESP_LOGV(TAG, "Frame count: %lu, Byte count: %lu",
                     s_cdc_ctx.stats.frame_count, s_cdc_ctx.stats.total_bytes);
        } else {
            s_cdc_ctx.stats.queue_fail_count++;
            s_cdc_ctx.stats.queue_fail_bytes += tx_msg.buf_len;
            ESP_LOGV(TAG, "Failed to send to queue, fail count: %lu, fail bytes: %lu",
                     s_cdc_ctx.stats.queue_fail_count, s_cdc_ctx.stats.queue_fail_bytes);
        }
    } else {
        ESP_LOGE(TAG, "Read Error");
    }
}

static void tinyusb_cdc_line_state_changed_callback(int itf, cdcacm_event_t *event)
{
    int dtr = event->line_state_changed_data.dtr;
    int rts = event->line_state_changed_data.rts;
    ESP_LOGI(TAG, "Line state changed on channel %d: DTR:%d, RTS:%d", itf, dtr, rts);
}

static void dump_cdc_stats(void)
{
    ESP_LOGI(TAG, "Frame count: %lu, Byte count: %lu, Fail count: %lu, Fail bytes: %lu",
             (unsigned long)s_cdc_ctx.stats.frame_count,
             (unsigned long)s_cdc_ctx.stats.total_bytes,
             (unsigned long)s_cdc_ctx.stats.queue_fail_count,
             (unsigned long)s_cdc_ctx.stats.queue_fail_bytes);
}

static void init_usb_serial(void)
{
    s_cdc_ctx.app_queue = xQueueCreate(5, sizeof(app_message_t));
    ESP_ERROR_CHECK(s_cdc_ctx.app_queue != NULL ? ESP_OK : ESP_FAIL);

    ESP_LOGI(TAG, "USB ACM initialization");

    tinyusb_config_cdcacm_t acm_cfg = {
        .usb_dev = TINYUSB_USBDEV_0,
        .cdc_port = TINYUSB_CDC_ACM_0,
        .callback_rx = &tinyusb_cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = &tinyusb_cdc_line_state_changed_callback,
        .callback_line_coding_changed = NULL
    };

    ESP_ERROR_CHECK(tusb_cdc_acm_init(&acm_cfg));
    ESP_ERROR_CHECK(tinyusb_cdcacm_register_callback(
                        TINYUSB_CDC_ACM_0,
                        CDC_EVENT_LINE_STATE_CHANGED,
                        &tinyusb_cdc_line_state_changed_callback));

    ESP_LOGI(TAG, "USB ACM initialization DONE");
}

static void tusb_cdc_handler_task(void *pvParameters)
{
    app_message_t msg;
    TickType_t last_wake_time = xTaskGetTickCount();
    const TickType_t dump_interval = pdMS_TO_TICKS(10000); // 10 seconds

    while (1) {
        if (xQueueReceive(s_cdc_ctx.app_queue, &msg, portMAX_DELAY)) {
            if (msg.buf_len) {
                ESP_LOGI(TAG, "Data from channel %d:", msg.itf);
                ESP_LOG_BUFFER_HEXDUMP(TAG, msg.buf, msg.buf_len, ESP_LOG_INFO);

                tinyusb_cdcacm_write_queue(msg.itf, msg.buf, msg.buf_len);
                esp_err_t err = tinyusb_cdcacm_write_flush(msg.itf, 0);
                if (err != ESP_OK) {
                    ESP_LOGE(TAG, "CDC ACM write flush error: %s", esp_err_to_name(err));
                }
            }
        }

        // Dump statistics at the specified interval
        if (xTaskGetTickCount() - last_wake_time >= dump_interval) {
            dump_cdc_stats();
            last_wake_time = xTaskGetTickCount();
        }
    }
}

static void start_cdc_handler_task()
{
    s_cdc_ctx.app_queue = xQueueCreate(10, sizeof(app_message_t));
    xTaskCreate(tusb_cdc_handler_task, "cdc_handler_task", 4096, NULL, 5, NULL);
}

int tusb_cdc_handler_init(void)
{
    // Initialize USB serial
    init_usb_serial();
    start_cdc_handler_task();
    return ESP_OK;
}