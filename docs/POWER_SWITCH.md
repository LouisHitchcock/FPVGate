# Power button and sleep

For the alpha LCD target, the power control is a **momentary active-low button
on GPIO16**, not the old GPIO7 slide-switch recipe.

## Waveshare ESP32-S3-LCD-2

`lib/CONFIG/config.h` sets `PIN_POWER_SWITCH=16`.
`targets/WaveshareESP32S3LCD2.ini` enables `ENABLE_POWER_SWITCH` and the LCD UI.
The board has a pull-up to 3.3 V; the button's other contact connects to ground.

```text
3.3 V -- board pull-up --+-- GPIO16
                        |
                   momentary button
                        |
                       GND
```

1. While running, hold the button LOW for about two seconds.
2. The main loop handles shutdown and pending configuration before sleeping.
3. Release the button. The sleep routine waits for release, turns off the
   backlight and Wi-Fi, then enters deep sleep with EXT0 wake on LOW.
4. Press again to wake. The wake is a reboot; release before another hold.
   Firmware ignores a new shutdown hold until the wake button is released.

The pin is configured as INPUT because the external pull-up already exists.
Do not add a toggle switch that stays LOW: the shutdown routine waits for
HIGH before entering sleep. GPIO7 is not the alpha power-button definition.

## Building

From the repository root:

```sh
pio run -e WaveshareESP32S3LCD2 -t upload
pio run -e WaveshareESP32S3LCD2 -t uploadfs
```

Use the matching LCD target and wiring. It is a retained custom build, not
one of the six packaged Alpha 5 boards.
[Wiring and target differences](wiring/Waveshare-ESP32-S3-LCD-2.md).

## Legacy implementation on other boards

`lib/POWER/power.cpp` retains a separate slide-switch branch for DevKitC,
LilyGO and Super Mini builds if explicitly enabled and integrated. It uses
INPUT_PULLUP, LOW for Off, 200 ms debounce, 100 ms checks, a 3 s wake cooldown
and **light sleep**, despite the `enterDeepSleep` method name.
It is not a universal enabled feature on the shipping boards. The current
main integration uses LCD-specific pins, so adding a flag alone does not
make another target a supported power-switch build.

## Power and data limits

Sleep leaves the board's charging/regulation circuitry powered; it is not a
battery disconnect. No whole-device current measurement for the current
configuration is established here. Older 100–300 microamp / months-of-runtime
claims should not be used to size a battery.

Stop the race and confirm its save before sleeping. This control is not an
SD journal or a guarantee that an in-flight save survives power loss.
USB power can still supply the board; waking from deep sleep restarts USB
and network services.

If the button does not work, confirm the actual target, GPIO16 voltage and
pull-up, button continuity and release behavior. See
[battery monitoring](BATTERY_MONITORING.md) for voltage sensing and alerts.
