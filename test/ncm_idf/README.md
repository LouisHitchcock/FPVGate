| Supported Targets | ESP32-S2 | ESP32-S3 |
| ----------------- | -------- | -------- |

# TinyUSB Network Control Model Device Example

Network Control Model (NCM) is a sub-class of Communication Device Class (CDC) USB Device for Ethernet-over-USB applications.

In this example, we implemented the ESP development board to transmit data to the Linux or Windows host via USB, so that the host could access the webserver on the board. Note that the host cannot access the internet through this connection.

As a USB stack, a TinyUSB component is used.

## How to use example

### Hardware Required

Any ESP board that have USB-OTG supported.

#### Pin Assignment

_Note:_ In case your board doesn't have micro-USB connector connected to USB-OTG peripheral, you may have to DIY a cable and connect **D+** and **D-** to the pins listed below.

### Configure the project

Open the project configuration menu (`idf.py menuconfig`).

### Build, Flash, and Run

Build the project and flash it to the board, then run monitor tool to view serial output:

```
idf.py -p PORT build flash monitor
```

(Replace PORT with the name of the serial port to use.)

(To exit the serial monitor, type ``Ctrl-]``.)

See the Getting Started Guide for full steps to configure and use ESP-IDF to build projects.

### Accessing the Webserver

After the device is connected and the network is set up, you can access the webserver by navigating to the device's IP address (hardcoded to 192.168.4.1) in a web browser. The default page (`index.html`) will display a message indicating that "This is the ESPNetKit webserver through USB Ethernet". Note that this connection does not provide internet access.

## Example Output

After the flashing you should see the output at idf monitor:

```
I (289) main_task: Started on CPU0
I (309) main_task: Calling app_main()
I (309) wired_tusb_ncm: starting app for RNDIS and webusb
I (309) wired_tusb_ncm: *********IP is: 192.168.4.1
I (309) esp_netif_lwip: DHCP server started on interface wired with IP: 192.168.4.1
W (319) tusb_desc: No Device descriptor provided, using default.
W (329) tusb_desc: No FullSpeed configuration descriptor provided, using default.
W (329) tusb_desc: No String descriptors provided, using default.
I (339) tusb_desc:
┌─────────────────────────────────┐
│  USB Device Descriptor Summary  │
├───────────────────┬─────────────┤
│bDeviceClass       │ 0           │
├───────────────────┼─────────────┤
│bDeviceSubClass    │ 0           │
├───────────────────┼─────────────┤
│bDeviceProtocol    │ 0           │
├───────────────────┼─────────────┤
│bMaxPacketSize0    │ 64          │
├───────────────────┼─────────────┤
│idVendor           │ 0x303a      │
├───────────────────┼─────────────┤
│idProduct          │ 0x4000      │
├───────────────────┼─────────────┤
│bcdDevice          │ 0x100       │
├───────────────────┼─────────────┤
│iManufacturer      │ 0x1         │
├───────────────────┼─────────────┤
│iProduct           │ 0x2         │
├───────────────────┼─────────────┤
│iSerialNumber      │ 0x3         │
├───────────────────┼─────────────┤
│bNumConfigurations │ 0x1         │
└───────────────────┴─────────────┘
I (509) TinyUSB: TinyUSB Driver installed
I (509) main_task: Returned from app_main()
I (1129) esp_netif_lwip: DHCP server assigned IP to a client, IP is: 192.168.4.2
```

## TODO

- Hold the netpacket buffer from LWIP to prevent excess consumption on the buffer of tinyUSB.
- Add webusb

## License

This project is based on ESP-IDF v5.4. All licenses should follow the rules of that project.

## SDK Environment

Ensure you are using ESP-IDF v5.4 as the SDK environment. You can set up the ESP-IDF environment by following the instructions in the [ESP-IDF Programming Guide](https://docs.espressif.com/projects/esp-idf/en/v5.4/esp32/get-started/index.html).
