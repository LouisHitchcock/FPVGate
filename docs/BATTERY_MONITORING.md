# Battery Monitoring

FPVGate can read the voltage of the pack powering the gate and show it in the web
UI. Getting a correct reading takes two things that have to agree with each other:
a resistor divider on the board, and a matching **Voltage Divider Ratio** in the
settings. Build the divider and skip the setting and the hardware is safe but the
voltage shown is wrong.

- [Quick start](#quick-start)
- [How the reading is produced](#how-the-reading-is-produced)
- [Choosing a divider](#choosing-a-divider)
- [The settings](#the-settings)
- [Per-board defaults](#per-board-defaults)
- [Calibration](#calibration)
- [Low battery alerts](#low-battery-alerts)
- [Troubleshooting](#troubleshooting)

For the physical wiring and resistor placement, see
[Hardware Guide - Battery Monitoring Circuit](HARDWARE_GUIDE.md#battery-monitoring-circuit).

---

## Quick start

1. Work out the divider you need for your pack from the
   [table below](#choosing-a-divider) and fit the resistors.
2. Open **Configuration -> System Setup -> Battery Monitoring** and enable it.
3. Set **Battery Type** and **Cell Count** to match your pack.
4. Set **Voltage Divider Ratio** to the ratio of the divider you fitted.
5. Compare the displayed voltage against a multimeter and
   [calibrate](#calibration) if it is off.

---

## How the reading is produced

The ESP32-S3 ADC cannot measure more than about 3.3 V. A LiPo pack is higher than
that, so a resistor divider scales the pack voltage down to something the pin can
read, and the firmware multiplies back up.

```
Battery+ ──┬── R1 ──┬── ADC pin
           │        │
          GND       R2
                    │
                   GND
```

The pin sees `Vbat x R2 / (R1 + R2)`, so:

```
divider ratio = (R1 + R2) / R2
Vbat          = Vpin x divider ratio
```

`lib/BATTERY/battery.cpp` reads the pin, keeps a rolling average of the last 5
samples, maps it across the 12-bit ADC range and applies the ratio:

```
scaled = map(averaged, 0, 4095, 0, 33 x ratio) + offset
```

The result is in **tenths of a volt**, and `offset` is a per-board calibration
constant, also in tenths. The ADC is configured for 11 dB / 12 dB attenuation to
get the full input range.

> **Note on precision.** `33 x ratio` is truncated to an integer, so a ratio of
> 3.3 becomes 108 rather than 108.9 — about 0.8% low. It is well inside the
> accuracy of the ADC itself, but it is why very precise ratios do not help.

---

## Choosing a divider

**The ADC pin must never see more than 3.3 V.** Exceeding it risks damaging the
pin. Size the divider for your pack's **fully charged** voltage, not its nominal
voltage, and leave headroom.

The table below targets roughly 3.0 V at full charge, using common E12 resistor
values with `R2 = 10 kΩ`:

| Pack | Max voltage | R1 | R2 | Ratio | Pin sees at full charge |
|---|---|---|---|---|---|
| 1S | 4.2 V | 10 kΩ | 10 kΩ | 2.0 | 2.10 V |
| 2S | 8.4 V | 22 kΩ | 10 kΩ | 3.2 | 2.63 V |
| 3S | 12.6 V | 33 kΩ | 10 kΩ | 4.3 | 2.93 V |
| 4S | 16.8 V | 47 kΩ | 10 kΩ | 5.7 | 2.95 V |
| 6S | 25.2 V | 100 kΩ | 10 kΩ | 11.0 | 2.29 V |

LiPoHV packs charge to 4.35 V per cell rather than 4.2 V, so recompute with
`cells x 4.35` if you use them. The 3S and 4S rows above have the least headroom
and are the ones to re-check.

> **The ratio is the reciprocal of the divider fraction.** The Hardware Guide
> works in the fraction, `R2 / (R1 + R2)` — for 33 kΩ/10 kΩ that is 0.23. The
> **Voltage Divider Ratio** setting wants the other way up: 1 / 0.23 = **4.3**.
> Entering 0.23 will read far too low.

---

## The settings

**Configuration -> System Setup -> Battery Monitoring**

| Setting | Range | What it does |
|---|---|---|
| **Battery Monitoring** | on/off | Shows or hides the battery readout |
| **Battery Type** | LiPo 3.0-4.2 V, LiPoHV 3.0-4.35 V, Li-Ion 2.5-4.2 V | Sets the per-cell range used to work out remaining charge |
| **Cell Count** | 1-6S | Divides pack voltage to get per-cell voltage |
| **Voltage Divider Ratio** | 1.0-20.0 | Must match the divider you fitted. This is the single most common cause of a wrong reading |
| **Low Battery Alarm (per cell)** | 2.5-4.35 V | Per-cell voltage at which the browser warns |

Cell count and battery type do not change the measured voltage. They convert it
into a per-cell figure, which is what the alarm compares against — so a 6S pack
at 22.2 V is 3.70 V per cell and healthy, while a 1S pack at 3.70 V is the same
per-cell figure and equally healthy.

---

## Per-board defaults

Defined in `lib/CONFIG/config.h`. `VBAT_SCALE` is the compiled-in default ratio
and `VBAT_ADD` the calibration offset in tenths of a volt.

| Board | ADC pin | Default ratio | Offset |
|---|---|---|---|
| FPVGate AIO | GPIO1 (D0) | 2.0 | +0.2 V |
| FPVGate Solo | GPIO1 (D0) | 2.0 | +0.2 V |
| XIAO ESP32S3 Plus | GPIO1 (D0) | 2.0 | +0.2 V |
| Seeed XIAO ESP32S3 | GPIO0 | 2.0 | +0.2 V |
| ESP32-S3 DevKitC-1 | GPIO1 | 2.0 | +0.2 V |
| ESP32-S3 SuperMini | GPIO0 | 2.0 | +0.2 V |
| LilyGO T-Energy S3 | GPIO3 | 2.0 | +0.2 V |
| Waveshare ESP32-S3-LCD-2 | GPIO5 | 3.3 | 0 V |

> **The default ratio of 2.0 suits a 1S pack only.** At 2.0 the pin reaches
> 3.3 V when the pack is at 6.6 V, so a fully charged 2S pack at 8.4 V would put
> **4.2 V on the pin** and risk damaging it. If you run 2S or above you must fit
> a larger divider and raise the ratio to match.

Boards with a divider already fitted, such as the LilyGO T-Energy S3, are covered
in their own wiring documents — see
[LilyGO T-Energy S3 wiring](LILYGO_TENERGY_S3_WIRING.md#battery-voltage-monitoring).

---

## Calibration

Tolerance in the resistors, and in the ESP32's internal reference, means the
reading is usually a little off even with the right ratio.

1. Measure the pack with a multimeter.
2. Compare against the voltage in the web UI.
3. Adjust **Voltage Divider Ratio** until they agree.

Because the reading is proportional to the ratio, scale it:

```
new ratio = current ratio x (multimeter voltage / displayed voltage)
```

For example, a ratio of 4.3 showing 11.8 V against a true 12.4 V needs
`4.3 x (12.4 / 11.8)` = **4.52**.

Calibrate near the middle of the pack's range rather than at full charge, so the
error is spread across the range you actually fly in.

---

## Low battery alerts

**The alert is raised by the browser, not by the gate.** `data/script.js` compares
the per-cell voltage against the **Low Battery Alarm (per cell)** setting and
shows a warning, with 0.1 V of hysteresis so it does not flicker at the
threshold.

This has a consequence worth understanding: **if no browser is connected to the
gate, nothing warns you.** The pack can run flat with no buzzer and no LED.

The firmware contains an on-gate alarm — `BatteryMonitor::checkBatteryState()`
beeps the buzzer and blinks the LED — but it only runs when its threshold is
above zero, and the threshold is currently always zero. The config default is
`conf.alarm = 0` and the web UI sends `alarm: 0`, marked *"Legacy alarm field (no
longer used)"*. So that path never fires today.

> If you need an alert that works without a browser open, this is the gap to
> close. It is a firmware change, not a settings change.

---

## Troubleshooting

**Voltage reads zero**
Check the pin. The ADC pin differs per board — see the
[table above](#per-board-defaults). Confirm the divider's midpoint actually
reaches it and that grounds are common.

**Voltage reads about half, or about double**
Almost always the divider ratio. Reading low by roughly the divider factor means
the ratio is still at its default; reading high means it is set too large. If you
took 0.23 from the Hardware Guide, you want its reciprocal, 4.3.

**Voltage is close but consistently out**
Normal resistor tolerance. [Calibrate](#calibration) it.

**Reading jumps around**
The firmware already averages 5 samples. Noise beyond that is usually a long or
unshielded sense wire, or a ground that is shared with the VTX supply. Adding a
100 nF capacitor from the ADC pin to ground helps.

**Reading is stuck at full scale**
The pin is saturated, meaning it is seeing 3.3 V or more. Disconnect the pack and
recheck the divider before powering it again — this is the case that damages
pins.

**Self test shows a raw ADC value but no voltage**
The self test reports the raw count, for example `Raw ADC: 3803 on GPIO1`, before
any ratio is applied. A plausible raw count with an implausible voltage points at
the ratio rather than the wiring.

---

## Related

- [Hardware Guide - Battery Monitoring Circuit](HARDWARE_GUIDE.md#battery-monitoring-circuit)
- [User Guide - Battery Monitoring](USER_GUIDE.md#battery-monitoring)
- [Power Switch](POWER_SWITCH.md)
- [LilyGO T-Energy S3 wiring](LILYGO_TENERGY_S3_WIRING.md#battery-voltage-monitoring)
