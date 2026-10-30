# ELRS race control

Start and stop a race from a switch on an ExpressLRS radio, with no browser
open and no extra hardware. The gate listens to the radio's own backpack over
ESP-NOW, the same way the ExpressLRS race timer backpack and RotorHazard's
VRxC_ELRS plugin do. Off by default.

Not yet tested on hardware. The parser, debounce and race rules have native
tests; the radio link has not been checked against a real backpack.

## What you need

- A transmitter module with an ExpressLRS backpack, built in or external, with
  DVR Rec available in the Lua script's Backpack menu.
- The C5 receiver. Switch control only runs gate-managed C5 races, because an
  RX5808 or Novacore race is saved by the browser, not the gate.
- FPVGate in hotspot mode, with no WiFi network set. The backpack talks on Wi-Fi
  channel 1, so turning this on moves the hotspot from channel 6 to channel 1.
  USB networking and Ethernet are unaffected.

## Setup

1. On the radio, open the ExpressLRS Lua script, go to **Backpack**, and set
   **DVR Rec** to a spare switch. Never use the arm switch. The DVR start and
   stop delays are ignored by the gate.
2. In FPVGate, open **Settings > ELRS Backpack**, tick **Enable ELRS backpack**,
   enter the radio's binding phrase and keep **Start and stop races from the
   radio** ticked. Save. The gate restarts, never during a race.
3. Reconnect, open the tab again and flip the switch. The status shows the
   switch position and the result of the last command.

The binding phrase is never stored or sent back. The gate keeps only the six
byte ID derived from it, the same way ExpressLRS does.

## How the switch behaves

- **Switch on starts the race, switch off stops it.** Tick **Swap the Start and
  Stop positions** to reverse that, or invert the switch on the radio.
- The radio only sends when the switch moves, so the gate acts once per move.
  A position has to hold for 300 ms before it counts, so a brushed or bouncing
  switch gives one command at most.
- Start only works when no race is running or saving. A start refused by the
  race (an unsaved race, a heat waiting for result review in Event Director, no
  racing pilots) is shown in the status. The gate beeps when a race starts, so
  no beep means it was refused.
- Stop only works during a race, or to retry a failed save, as the Stop button
  does.
- Losing the radio link never stops a race.
- After a radio restart with the switch still on, nothing happens: the gate has
  already acted on that position. Flip it off and on to start the next race.
- **Power the radio on with the switch in the Stop position.** A radio that
  boots with it on sends a Start, and the gate cannot tell that apart from a
  flip.

RotorHazard keeps its own race control; the switch starts and stops only the
gate's local race, and RotorHazard receives passes either way.

## Status

`GET /api/elrs` returns the settings, whether the link is active, the number of
switch messages, the last switch position, the last command and its result,
and how many frames came from other devices and were ignored. `POST /api/elrs`
takes `enabled`, `raceControl`, `invert` (each `0` or `1`), `phrase`, and
`forget=1`. Both are unauthenticated, like the rest of the local API.

## Implementation

`lib/ELRSBACKPACK`. The ESP-NOW callback only checks that a frame came from the
binding ID and is `MSP_ELRS_BACKPACK_SET_RECORDING_STATE` (MSPv2 function
`0x0305`, valid CRC), then records the state. The main loop debounces it and
queues the command on `C5RaceControl`, like the web and LCD buttons. Settings
live in the `elrsbp` NVS namespace, separate from the main config, so config
export, import and factory reset do not include them.

The host-testable logic is in `elrs_backpack_core.h`, tested by
`tests/native/elrs_backpack_core_test.cpp`.
