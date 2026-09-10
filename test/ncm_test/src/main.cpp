/**
 * CDC-NCM spike.
 *
 * Proves the USB-C link end to end without touching the main firmware:
 *   1. the board enumerates as a USB Ethernet adapter (no driver install),
 *   2. its DHCP server leases the host an address,
 *   3. a real TCP server on the lwIP stack answers over that link.
 *
 * Success looks like: plug in USB-C, then open http://192.168.5.1/ on the host.
 * WiFi is never started, so anything that answers came over the cable.
 *
 * Console note: with ARDUINO_USB_MODE=0 the hardware USB-Serial-JTAG is not
 * available - it and USB-OTG are separate peripherals sharing the same pins,
 * and only one may own them. Do not start HWCDC here; it fights TinyUSB for
 * the bus. All logging goes over the TinyUSB CDC interface of the composite
 * NCM + CDC device, which is the same cable.
 */

#include <Arduino.h>
#include <USB.h>

#include "usb_net.h"

#include "esp_system.h"
#include "lwip/sockets.h"

static const char RESPONSE_BODY[] =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>FPVGate USB</title>"
    "<style>body{font-family:system-ui,sans-serif;text-align:center;padding:3rem}"
    "h1{color:#2ecc71}</style></head><body>"
    "<h1>USB network link is up</h1>"
    "<p>Served from the ESP32-S3 over USB-C. WiFi is off.</p>"
    "</body></html>";

static void httpTask(void *arg) {
    (void)arg;

    int listenFd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenFd < 0) {
        Serial.println("[http] socket() failed");
        vTaskDelete(NULL);
        return;
    }

    int yes = 1;
    setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));

    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(80);

    if (bind(listenFd, (struct sockaddr *)&addr, sizeof(addr)) < 0 || listen(listenFd, 2) < 0) {
        Serial.println("[http] bind/listen failed");
        close(listenFd);
        vTaskDelete(NULL);
        return;
    }

    Serial.println("[http] listening on :80");

    for (;;) {
        int fd = accept(listenFd, NULL, NULL);
        if (fd < 0) continue;

        // Drain the request; we answer identically regardless of path.
        char buf[256];
        recv(fd, buf, sizeof(buf), 0);

        char header[160];
        int headerLen = snprintf(header, sizeof(header),
                                 "HTTP/1.1 200 OK\r\n"
                                 "Content-Type: text/html\r\n"
                                 "Content-Length: %u\r\n"
                                 "Connection: close\r\n\r\n",
                                 (unsigned)(sizeof(RESPONSE_BODY) - 1));

        send(fd, header, headerLen, 0);
        send(fd, RESPONSE_BODY, sizeof(RESPONSE_BODY) - 1, 0);
        close(fd);

        Serial.println("[http] served a request");
    }
}

static bool s_registered = false;
static uint32_t s_prevStep = USB_NET_STEP_NONE;
static bool s_prevCrashed = false;

void setup() {
    // The core already called Serial.begin() in app_main() (CDC_ON_BOOT with
    // ARDUINO_USB_MODE=0), so the CDC interface is registered by now.

    // If the previous boot died partway through phase 1, skip it this time so
    // USB still comes up and the console can report where it died. Without
    // that a phase 1 fault is invisible: the panic goes to UART0, and no USB
    // console exists yet to read it from.
    uint32_t prev = usb_net_progress;
    bool prevValid = (prev & ~USB_NET_STEP_MASK) == USB_NET_STEP_MAGIC;
    s_prevStep = prevValid ? (prev & USB_NET_STEP_MASK) : USB_NET_STEP_NONE;
    s_prevCrashed = prevValid && s_prevStep != USB_NET_STEP_DONE;

    // Phase 1 already ran, from a global constructor in usb_net.c. It cannot
    // run here: ARDUINO_USB_ON_BOOT is derived from ARDUINO_USB_CDC_ON_BOOT,
    // so the core called USB.begin() in app_main() before setup() and the
    // configuration descriptor is already frozen. Likewise USB.serialNumber()
    // and friends have no effect at this point.
    s_registered = usb_net_registered();

    // Harmless if the core already started it; tinyusb_init() is idempotent.
    USB.begin();

    // The CDC console only attaches once the host has enumerated us, so hold
    // briefly to keep the banner.
    delay(3000);

    // ESP_LOG* defaults to UART0, which is not connected. Route it to CDC so
    // the log lines inside usb_net.c are actually visible.
    Serial.setDebugOutput(true);

    Serial.println();
    Serial.println("=== FPVGate CDC-NCM spike ===");
    Serial.printf("reset reason: %d%s\n", (int)esp_reset_reason(),
                  esp_reset_reason() == ESP_RST_PANIC ? " (PANIC on previous boot)" : "");

    if (s_prevCrashed) {
        Serial.printf("*** previous boot died in phase 1 at step %u (%s) ***\n",
                      (unsigned)s_prevStep, usb_net_step_name(s_prevStep));
        Serial.println("Phase 1 skipped this boot; NCM is NOT registered.");
        return;
    }

    Serial.printf("NCM interface registered: %s\n", s_registered ? "yes" : "NO");
    if (!s_registered) {
        Serial.println("Descriptor registration failed - see endpoint log above.");
        return;
    }

    // Trigger the network phase manually so a fault there cannot take down
    // enumeration before a console is attached to watch it.
    Serial.println();
    Serial.println("Ready. Press 'n' to start the network phase (netif + DHCP).");
}

void loop() {
    static bool lastLink = false;
    static bool netStarted = false;
    static uint32_t lastBeat = 0;

    if (Serial.available()) {
        int c = Serial.read();
        if ((c == 'n' || c == 'N') && !netStarted && s_registered) {
            netStarted = true;
            Serial.println("calling usb_net_start()");
            bool started = usb_net_start();
            Serial.printf("netif/DHCP start posted: %s\n", started ? "yes" : "NO");
            xTaskCreate(httpTask, "http", 4096, NULL, 5, NULL);
            Serial.println("Open http://192.168.5.1/ on the host.");
        }
    }

    bool link = usb_net_link_up();
    if (link != lastLink) {
        Serial.printf("[ncm] link %s\n", link ? "UP" : "DOWN");
        lastLink = link;
    }

    uint32_t now = millis();
    if (now - lastBeat >= 2000) {
        lastBeat = now;
        Serial.printf("[alive] %lus reg=%d net=%s link=%s\n", (unsigned long)(now / 1000),
                      (int)s_registered, netStarted ? "started" : "idle", link ? "up" : "down");
    }

    delay(50);
}
