# ESP32-C5 multi-pilot receiver: user guide

FPVGate can use an ESP32-C5 as its receiver instead of an RX5808. One C5
watches up to **eight pilot slots**, time-slicing one RF receiver and typically
reading each pilot about **1000 times a second**. This is a scan-rate figure,
not an absolute timing-accuracy specification. FPVGate (the ESP32-S3) runs lap
timing, the web app and race history; announcements run in the browser.

You can use it for a single quad on one channel, or for multi-pilot races
with up to eight pilots.

## What you need

- An FPVGate S3 timer on one of the six Alpha 5 targets: XIAO S3, S3-ETH,
  DevKitC-1 (8MB), FPVGate AIO, Solo or C5MK AIO.
- An ESP32-C5 board flashed with
  [FPVGate C5MK](https://github.com/LouisHitchcock/FPVGateC5MK) 1.2.1 or later for the documented multi-pilot workflow. The Alpha 5
  timing investigation used 1.2.4-rc.1; record the actual receiver version.
  The C5MK AIO has a separate integrated XIAO C5 receiver; use XIAO C5 firmware.
- Four wires for a separate receiver, joining TX to RX and sharing ground:

| S3 timer | Host TX -> C5 RX | Host RX <- C5 TX |
|---|---|---|
| XIAO S3 / FPVGate AIO / Solo / C5MK AIO | GPIO4 (D3) | GPIO5 (D4) |
| ESP32-S3 DevKitC-1 (8MB) / S3-ETH | GPIO43 | GPIO44 |

| C5 receiver | C5 RX <- S3 TX | C5 TX -> S3 RX |
|---|---|---|
| Seeed XIAO ESP32-C5 | GPIO23 (D4) | GPIO24 (D5) |
| Waveshare C5-Zero | GPIO4 | GPIO5 |

For example, XIAO S3 D3 connects to XIAO C5 D4, and S3 D4 connects to C5 D5.
The D-labels on the two boards do not mean the same GPIO numbers.

**Power a supported C5 development board from 5V/VUSB, not the S3's 3V3 regulator.** Join grounds;
signal pins are 3.3V logic only. Never connect 5V to a signal pin.
With separate USB supplies, share ground and leave the 5V link disconnected.
Disconnect power before changing wiring.

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

On C5MK AIO the receiver selection is fixed to C5. With C5 selected,
the device uses **Multi** mode exclusively. Personal,
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

### Gate-managed completion in refreshed Alpha 5

In C5 mode, max-lap and heat-time stopping and history saving run on the S3,
even with every browser closed. Reconnect to view the saved race; do not post
another history record. Failed saves keep the race in memory and block Start
and Clear until Stop retries successfully. More than 63 real laps is rejected;
Gate 1 uses the remaining crossing slot. A DNS racer never reaches max laps,
so configure a heat limit or use manual Stop.

Unreleased source now handles Event result recording/next-heat loading on the
gate; published Alpha 5 still needs a page for those steps. Browser speech
continues to require a page. See [Event progression](GATE_EVENT_PROGRESSION.md).
Other receiver modes keep their previous browser stopping/saving behavior.
These integrated builds still need physical closed-browser/storage testing.

### Timing rules (every pilot)

- **Gate 1**: the time from the start to the pilot's first pass.
- After that, each lap runs from one pass to the next.
- Passes quicker than the **minimum lap time** (Settings) are ignored.
- Each pass uses its sample-derived peak timestamp. A pass closes after
  300 ms below Exit. Timestamp resolution is not measured RF accuracy.

### Multi-pilot races

- The **lap table** has one column per pilot, in the pilot's colour, with a
  **G1** row for Gate 1. The fastest lap of each pilot is highlighted.
- The **announcer** says the pilot's name and the time ("Louis, 12.34"), or
  "Louis, Gate 1 …". It uses **Spoken as** if set, then the name, then
  "Pilot 5". The Beep and None announcer settings still apply; the 2-lap and
  3-lap modes now announce that pilot's rolling 2-/3-lap total once enough real
  laps exist, excluding Gate 1.
- **Internal gate-crossing LED flashes** are still work in progress for C5.
  The external LED API remains available for compatible modules.
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
| "No reply from the C5" | Use the board-specific TX/RX table above: XIAO C5 uses D4/GPIO23 and D5/GPIO24; C5-Zero uses GPIO4/5. Check common ground and C5 power. |
| Mode shows **Slots** | The C5 has older firmware: lower per-pilot rates than scan mode. Update the C5. |
| Per pilot far below 1 kHz | Fewer pilots read faster; with eight it should be close to 1 kHz. Check the link figures for errors. |
| Seq gaps rising | Occasional single gaps are harmless. Steady increases point to wiring or interference on the link. |
| A pilot never laps | Its Race box, its Enter threshold (must be below the pass peak), and the minimum lap time. |
| Double laps | Exit too close to Enter, or minimum lap time too short. |
| A channel reacts when another pilot passes | Pilots on closely spaced channels. Use Raceband and keep the gain as low as works. |
| "frequency outside 5180–5917 MHz" | That channel can't be tuned by the C5 (for example E7/E8). |
