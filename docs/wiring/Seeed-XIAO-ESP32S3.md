# Seeed Studio XIAO ESP32S3 (8MB) - Wiring Diagram

Compact XIAO form factor with FPVGate pin mappings and SD card support.

## Pin Configuration
```
XIAO ESP32S3    RX5808              SD Card (SPI)        Optional
D2 (GPIO3)  ─── RSSI             D1 (GPIO2) ─── CS     
D4 (GPIO5)  ─── CH1 (DATA)       D8 (GPIO7) ─── SCK    
D5 (GPIO6)  ─── CH2 (SELECT)     D9 (GPIO8) ─── MOSI   
D3 (GPIO4)  ─── CH3 (CLOCK)      D10 (GPIO9) ── MISO   
D0 (GPIO1)  ───────────────── Mode Switch               
D6 (GPIO43) ───────────────── Buzzer (+)               
D7 (GPIO44) ───────────────── NeoPixel DIN             
GND         ─── GND              GND       ─── GND     
5V (VUSB)   ─── +5V              3V3/5V    ─── VCC     
```

- SD mapping above matches the current firmware (SeeedXIAOESP32S3 env).
- NeoPixel is on D7 (GPIO44); add a 330 Ω series resistor and a 470–1000 µF capacitor across VUSB–GND.

## Notes
- Logic levels are 3.3V. Most WS2812B run fine at 5V VCC with 3.3V DIN; use a level shifter if you see flicker.
- VUSB (VBUS) can power the LED(s); share GND with the XIAO.
- RSSI on GPIO3 (D2) is commonly used; if you encounter boot issues, move to another ADC pin and update config.
- SD modules: If yours is 5V-ready (with regulator/level shifting), power from 5V; otherwise power from 3V3.

## References
- XIAO ESP32S3 pinout (GPIO ↔ D0–D10 mapping)
- FPVGate target: `SeeedXIAOESP32S3` (PlatformIO)
