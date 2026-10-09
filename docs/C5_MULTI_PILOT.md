# ESP32-C5 multi-pilot receiver: user guide

FPVGate can use an ESP32-C5 as its receiver instead of an RX5808. One C5
watches up to **eight pilots at once**, reading each pilot's signal about
**1000 times a second**, continuously: the same rate RotorHazard reads one
pilot per receiver. FPVGate (the ESP32-S3) runs the lap timing, the web app,
the announcer and race history as usual.

You can use it for a single quad on one channel, or for multi-pilot races
with up to eight pilots.

## What you need

- An FPVGate on a Seeed XIAO ESP32-S3.
- An ESP32-C5 board flashed with the FPVGate C5 receiver firmware,
  [FPVGate C5MK](https://github.com/LouisHitchcock/FPVGateC5MK) (version 2 or
  later for the full 1 kHz-per-pilot mode). Its README covers building and
  flashing it, and its docs explain how the receiver works.
- Four wires between them:

| XIAO S3 | ESP32-C5 | Purpose |
|---|---|---|
| D3 / GPIO4 | GPIO4 | Link: S3 → C5 |
| D4 / GPIO5 | GPIO5 | Link: C5 → S3 |
| 5V | 5V (VUSB) | Power |
| GND | GND | Ground |

The link uses the pins the RX5808 used. **Power the C5 from the 5V pin, not
from the S3's 3V3 pin.** The C5's radio draws a burst of current as it
starts, which the S3's 3.3 V supply can't provide alongside the S3's own
Wi-Fi: wired 3V3 to 3V3, the C5 never finishes booting and FPVGate shows it
offline. 5V goes only to the C5's 5V (VUSB) power pin; the link pins are
3.3 V logic, so never connect 5 V to any other C5 pin.

## Setting it up

1. Open **Settings → Configuration**, set **Receiver Module** to
   **ESP32-C5 Multi-Pilot**, and save.
2. Open the **Calibration** tab. The C5 panel shows a status line; it should
   say **C5 online · scanning N pilots continuously** within a few seconds.
3. Pick a **Band** and press **Fill pilots from band** to put its channels in
   pilots 1–8, or choose a channel on each pilot's card.
4. Leave **Gain** at 30 to start with. Lower it if a close quad pushes the
   readings to the top of the chart; raise it for long distances.

### Supported channels

The C5 tunes **5180–5917 MHz**. That covers Raceband (R1–R8), Fatshark/F, A,
B, Lowband (L) and the DJI, HDZero and Walksnail channel sets. Boscam **E7
(5925 MHz) and E8 (5945 MHz)** are above the limit and can't be used.
Raceband is the best choice for multi-pilot races: its 37 MHz spacing keeps
pilots well apart.

## The Calibration tab

### Status line and link figures

The status line says whether the C5 is online, how it's scanning, the gain,
and what kind of race the current setup gives (see *Racing* below).

The row of figures under it is measured live:

| Figure | Meaning | Healthy |
|---|---|---|
| Mode | **Scan**: the C5 reads every pilot itself. **Slots**: older C5 firmware, one pilot at a time | Scan |
| Per pilot | Readings per second for each pilot | about 1 kHz with 8 pilots |
| Total | All pilots together | about 8 k/s |
| Seq gaps | Readings lost between the C5 and FPVGate | 0 (a red **+N** means new ones in the last 10 s) |
| Queue drops | Readings FPVGate couldn't process in time | 0 |
| Bad records | Damaged messages from the C5 | 0 |
| S3 poll | Longest pause in FPVGate reading the C5 over the last 10 s | a few ms |

Hover over a figure for a short explanation.

### Pilot cards

Each of the eight cards is one pilot slot:

- **Channel**: the pilot's frequency (Off to leave the slot empty).
- **Pilot name** and **Spoken as**: the name used in the race table and
  history, and an optional spelling for the announcer (for example a callsign
  written the way it should sound).
- **Colour**: used for the chart line, the race table column and the gate
  LEDs when this pilot laps.
- **Race**: whether this pilot's laps count in races. A slot without Race
  still scans and shows on the chart, but never adds laps.
- **Live value** and bar, with the **Enter** and **Exit** markers.
- **Enter / Exit**: the thresholds for this pilot (see below).

Changes save automatically ("Saved ✓" appears in the toolbar).

### Setting Enter and Exit

A pass through the gate is when the pilot's signal rises above **Enter**, and
it ends when it falls below **Exit**. The lap is timed at the strongest point
in between.

- Click a card to select it, then drag its **Enter** and **Exit** lines on the
  chart, or use the − / + buttons.
- Enter must be clearly above the pilot's level away from the gate, and below
  the peak of a pass. Exit sits a little lower than Enter so a noisy pass
  isn't counted twice.
- **Auto-calibrate** does this for every pilot: press **Start** with the gate
  clear, wait 5 seconds, fly each pilot through the gate a few times, then
  press **Calculate thresholds**. Check the result against the chart.

Each card also shows the last 10 seconds' peak and floor, and lap counts and
times while a race runs.

## Racing

With C5 selected, the device uses **Multi** mode exclusively. Personal,
Master and Slave roles are unavailable; C5 devices cannot be daisy-chained.
This applies even when only one pilot races. To race in RotorHazard, use the
[RotorHazard plugin](ROTORHAZARD_INTEGRATION.md), which gives each pilot a node.

New C5 races record all eight RSSI channels when SD storage is available.
In **Race History → Edit**, select a pilot before changing crossings.
**Show all channel traces** overlays other slots for reference; edits always
apply to the selected pilot. Switch pilots freely, then **Save Changes** saves
every pilot's edits. Missing traces use typed times. Old recordings are not
retroactively expanded.

Stop the race before changing channels, gain or thresholds. Calibration keeps
existing thresholds when it sees no clear pass. Wait for **Saved** before racing.

The number of pilots with **Race** ticked decides the kind of race:

| Pilots with Race on | Race |
|---|---|
| 0 | No laps are counted. The status line turns amber. |
| 1 | One pilot in the Multi race view. |
| 2 to 8 | A **multi-pilot race**. |

Start, stop and clear races from the Race tab as usual. The pilots in a race
are fixed when it starts. Stop the race before changing pilot participation,
receiver tuning, or calibration.

### Timing rules (every pilot)

- **Gate 1**: the time from the start to the pilot's first pass.
- After that, each lap runs from one pass to the next.
- Passes quicker than the **minimum lap time** (Settings) are ignored.
- Each pass is timed at its strongest point, to the nearest millisecond or so.

### Multi-pilot races

- The **lap table** has one column per pilot, in the pilot's colour, with a
  **G1** row for Gate 1. The fastest lap of each pilot is highlighted.
- The **announcer** says the pilot's name and the time ("Louis, 12.34"), or
  "Louis, Gate 1 …". It uses **Spoken as** if set, then the name, then
  "Pilot 5". The Beep and None announcer settings still apply; the 2-lap and
  3-lap modes announce every lap in multi-pilot races.
- **Gate LEDs** flash in the colour of the pilot who just lapped.
- **Max laps**: each pilot hears "*name* finished" when they complete the
  maximum, and the race stops when every pilot has finished. Heat time and
  Stop end the race at any time.
- **Race analysis** charts show every pilot.
- **Race history**: stopping the race saves every pilot's laps. History marks
  it as a multi-pilot race and shows each pilot.
- If you open or reload the page during a race, it picks up the race so far
  from FPVGate.

## RSSI debug window

**Settings → Diagnostics → Debug Mode** shows the debug overlay on the race
screen; its **⧉** button opens the **RSSI debug window**, which can stay open
on a second screen.

With the C5 the window shows:

- A line per pilot in the pilot's colour, updated 25 times a second. Each
  point is the highest reading since the previous one, so short gate passes
  always show at their true height.
- A chip per pilot with its name, live value, a light that is on while the
  pilot is in the gate, and **RACE** if it races.
- Click a chip to select that pilot: its Enter and Exit lines are drawn and its
  live, min and max values fill the header.
- **Racers only** hides pilots without Race on.

Name, colour and threshold changes made on the Calibration tab appear in the
window within a few seconds. The small overlay on the race screen itself only
works with the RX5808 and stays blank with the C5; use the window.

## Troubleshooting

| What you see | What to check |
|---|---|
| "No live data from FPVGate yet" | Receiver Module is ESP32-C5 and the configuration was saved. |
| "No reply from the C5" | Wiring (D3 → GPIO4, D4 ← GPIO5, GND) and C5 power: the C5 must be powered from 5V, not the S3's 3V3 pin. |
| Mode shows **Slots** | The C5 has older firmware: about 116 readings per pilot per second instead of 1000. Update the C5. |
| Per pilot far below 1 kHz | Fewer pilots read faster; with eight it should be close to 1 kHz. Check the link figures for errors. |
| Seq gaps rising | Occasional single gaps are harmless. Steady increases point to wiring or interference on the link. |
| A pilot never laps | Its Race box, its Enter threshold (must be below the pass peak), and the minimum lap time. |
| Double laps | Exit too close to Enter, or minimum lap time too short. |
| A channel reacts when another pilot passes | Pilots on closely spaced channels. Use Raceband and keep the gain as low as works. |
| "frequency outside 5180–5917 MHz" | That channel can't be tuned by the C5 (for example E7/E8). |
