# Contributors

FPVGate is built by pilots, for pilots. Thank you to everyone who has contributed!

## Core Development

**Louis Hitchcock** (@LouisHitchcock)  
Project creator and lead developer

## Contributors

### Richard Amiss (@ramiss)
**Contributions:**
- Fixed frequency changing bugs preventing proper VTx frequency updates
- Added comprehensive digital FPV band support (DJI, HDZero, WalkSnail)
- Improved lap timer detection algorithm to minimize false positives
- Enhanced Kalman filter for RSSI signal processing
- Digital band frequency tables for modern FPV systems

**GitHub:** https://github.com/ramiss/FPVGate  
**Integrated:** December 2024

### Licardo (@L1cardo)
**Contributions:**
- Internationalization (i18n) system implementation
- Multi-language support (English, French, Spanish, German, Simplified Chinese)
- Language selector UI integration
- Translation framework with dynamic locale loading
- Enhanced accessibility for international users

**GitHub:** https://github.com/L1cardo  
**Integrated:** January 2026

### racefpv (@racefpv)
**Contributions:**
- LCD touchscreen UI system originally developed for StarForgeOS
- LVGL-based display framework for Waveshare ESP32-S3-LCD-2
- Fullscreen countdown overlay and race stop overlay
- Cross-core architecture pattern (LVGL on core 0, timing on core 1)
- Touch-friendly settings controls with bidirectional web sync
- Responsive percentage-based layout system for racing tab
- Fixed header with scrollable content for improved navigation
- Adaptive SPI mutex timeouts to prevent SD card lockups
- Debug message throttling for cleaner serial output
- Auto-creation of SD card directory structure on startup
- Start/stop race behavior parity between LCD and web race flows
- SD/LCD coexistence reliability fixes and race-history load improvements
- DMA RSSI pipeline and board pin/power fixes across Waveshare and related targets
- Deep sleep, power-switch behavior, and gyro screen-flip integration work
- Passive buzzer tone-system groundwork and related race-audio path updates

**GitHub:** https://github.com/racefpv  
**Integrated:** February-April 2026 (ongoing merged contributions)

---

## How to Contribute

We welcome contributions from the FPV community! Here's how you can help:

1. **Report Bugs** - Open an issue on GitHub with detailed reproduction steps
2. **Suggest Features** - Share your ideas for new features or improvements  
3. **Submit Code** - Fork the repo, make changes, and submit a pull request
4. **Test Hardware** - Help test FPVGate on different ESP32 boards and configurations
5. **Write Documentation** - Improve guides, add examples, or clarify existing docs

### Pull Request Guidelines

- Follow existing code style and conventions
- Test your changes thoroughly
- Include clear commit messages describing what and why
- Update documentation if adding new features
- Add yourself to this CONTRIBUTORS file!

---

## Special Thanks

- **phobos-** for the original PhobosLT project that inspired FPVGate
- **RotorHazard** project for timing logic inspiration
- **racefpv** for the StarForgeOS LCD UI that was ported to FPVGate
- The FPV community for testing and feedback

---

## Attribution

If you use FPVGate in your project or build, please credit:
```
FPVGate by Louis Hitchcock
https://github.com/LouisHitchcock/FPVGate
```

Licensed under CC BY-NC-SA 4.0 - see LICENSE file for details
