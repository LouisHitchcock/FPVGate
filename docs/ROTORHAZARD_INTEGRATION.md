# RotorHazard Integration

Guide for using FPVGate as timing hardware in a [RotorHazard](https://github.com/RotorHazard/RotorHazard) race timer server.

**Navigation:** [Home](../README.md) | [User Guide](USER_GUIDE.md) | [Hardware Guide](HARDWARE_GUIDE.md) | [Features](FEATURES.md)

---

## Overview

The [FPVGate RotorHazard plugin](https://github.com/LouisHitchcock/fpvgate-rh-plugin) adds an FPVGate to RotorHazard as receiver nodes, alongside or instead of RotorHazard's own:

- **One node** for an RX5808 gate, **eight** for an ESP32-C5 multi-pilot gate
- **RotorHazard sets** each node's frequency and EnterAt/ExitAt levels; the gate's own settings are copied into RotorHazard the first time it connects
- **Live RSSI** for every node in RotorHazard's Sensor Tuning and Marshal page, nominally 20 times a second, with peak-held readings between updates
- **Passes** use the gate's RSSI peak timestamps rather than network arrival times; clock synchronization and RF detection still affect accuracy
- **Race mirroring** (optional): the gate's own race starts, stops and clears with RotorHazard's, for its local race/display (available outputs depend on the build)

The plugin connects to the gate. There is nothing to turn on in the FPVGate web UI: the RotorHazard API is always available.

If RotorHazard already has its own nodes, the gate's nodes are added after them (an 8-node timer plus an 8-pilot C5 gate gives 16 nodes). Recent companion-plugin versions can also use additional gates for splits
when the RotorHazard API supports it; see the plugin's own split setup below.

---

## Requirements

- FPVGate **1.9.0 alpha hardware-interface builds**, including this Alpha 5 source
- Compatible FPVGate RotorHazard plugin v2; Alpha 5 timing comparisons use
  **2.3.2-rc.1**. Keep the tested gate/plugin pair together.
- RotorHazard **4.4** or later (tested on 4.4.0 and 4.5.0-beta.1)
- FPVGate and RotorHazard able to reach each other over the network: Wi-Fi (gate in Station mode), USB networking or Ethernet

---

## Setup

### Step 1: Install the plugin

1. Download the plugin from [github.com/LouisHitchcock/fpvgate-rh-plugin](https://github.com/LouisHitchcock/fpvgate-rh-plugin).
2. Find `custom_plugins/fpvgate` in the plugin source and put that `fpvgate` folder in the `plugins` folder of RotorHazard's data directory (normally `~/rh-data/plugins`), so you have `plugins/fpvgate/__init__.py`.
3. Restart RotorHazard.

### Step 2: Put FPVGate on the network

FPVGate must be reachable from the RotorHazard server. For Wi-Fi, in the FPVGate web UI:

1. Go to **Settings > WiFi & Connection**
2. Set **Connection Mode** to **Station** (join existing network)
3. Enter your Wi-Fi SSID and password
4. Click **Apply** (the device reboots)
5. Note the gate's new IP address

### Step 3: Point RotorHazard at the gate

1. In RotorHazard, go to **Settings > FPVGate**
2. Enter the gate's IP address or hostname in **FPVGate Address**
3. **Restart RotorHazard.** The plugin creates the gate's nodes at startup, so they appear only after a restart with the address saved.

### Step 4: Check the connection

- The **FPVGate** panel shows **Connected**, with the board, firmware, node count, RSSI scale and clock accuracy.
- **Settings > Sensor Tuning** shows one node per gate slot, with live RSSI.
- The RotorHazard log shows `FPVGate: 8 nodes at <address> (reached at startup)` (or 1 node for an RX5808 gate).

---

## Options

All in **Settings > FPVGate** in RotorHazard.

| Option | What it does |
|---|---|
| **FPVGate Address** | IP address or hostname of the gate. Restart RotorHazard after changing it. |
| **Nodes** | Node count to use when the gate can't be reached at startup. Set automatically from the gate. |
| **Run races on the gate too** | Starts, stops and clears the gate's own race with RotorHazard's, for its local display and enabled outputs. |
| **Full-resolution RSSI** | C5 gates only: shows RSSI as 0-1023 instead of 0-255 for finer graphs. EnterAt/ExitAt switch to the same scale and snap to steps of 4. Restart RotorHazard after changing it. |

---

## How It Works

The plugin talks to the gate over HTTP:

| Endpoint | Purpose |
|---|---|
| `GET /api/rh/info` | Firmware, board, frequency range, and every node's frequency and EnterAt/ExitAt levels |
| `GET /api/rh/clock` | The gate's clock in microseconds since boot. Polled every 5 s; this also keeps the link alive |
| `POST /api/rh/node` | `{"node":0,"frequency":5732,"enter":125,"exit":95}`: tune one node. Replies with the node as stored |
| `GET /api/rh/events` | Server-sent events (needs `Accept: text/event-stream`): `rhPass` for each pass, `rhRssi` 20 times a second |
| `POST /api/rh/testPass?node=n` | A pass on node `n` (0-based) now, sent to RotorHazard exactly as a real one, to check a setup (a split gate, say) without flying. Doesn't touch the gate's own race. Only while the plugin is linked (409 otherwise) |

While the plugin has polled the clock in the last 15 seconds, the gate is linked: it reports every pass to RotorHazard, including outside the gate's own races, and RotorHazard applies its own race rules.

A pass starts when a node's RSSI rises above EnterAt and ends once it has stayed below ExitAt for 300 ms. A dip below ExitAt that recovers above EnterAt within that time (multipath as a quad flies through) stays part of the same pass, so one fly-through is reported once, timed at its highest peak.

### Clock synchronisation

The plugin samples `/api/rh/clock` and keeps the offset from the fastest recent round trip. Passes carry the gate's timestamp, which the plugin converts to RotorHazard's clock with that offset. The panel estimates synchronization uncertainty from the round trip.
This is not a strict bound on RF timing: asymmetric delays and the peak estimator
are separate sources of error.

### RSSI and levels

Stored threshold levels are 0-255. A C5 gate measures RSSI as 0-1023 and compares it against `level x 4`; it sends both scales, and the plugin uses the full one when **Full-resolution RSSI** is on.

---

## Split gates and version scope

The [companion plugin's current README](https://github.com/LouisHitchcock/fpvgate-rh-plugin#split-times)
describes additional split gates. It requires the appropriate RHAPI support
(split timers 1.10; separate sensor tuning 1.11). Older RH installations may
support lap nodes without those additions. Configure each gate's own
thresholds and use the plugin documentation for the exact installed version;
this is not the S3 Master/Slave chain mode.

## Troubleshooting

**"No receiver nodes found", or no FPVGate nodes in Sensor Tuning**
- Check the RotorHazard log. `no address set, so no nodes` means the address wasn't saved when RotorHazard started: save it and restart RotorHazard.
- Make sure there is only one copy of the plugin (look in both `rh-data/plugins` and RotorHazard's `src/server/plugins`).

**Panel says Not connected**
- Open `http://<gate>/api/rh/info` in a browser from the RotorHazard machine. It should list the gate's nodes.
- If RotorHazard runs in a VM or container, check that it can reach the gate's network.

**Nodes show but RSSI stays at 0**
- From the RotorHazard machine, run
  `curl -N -H "Accept: text/event-stream" http://<gate>/api/rh/events`
  (`curl.exe` on Windows). `rhRssi` lines should scroll 20 times a second. A browser address bar gets a 404 here, which is expected.

**Laps not appearing**
- Laps are only recorded while RotorHazard is racing.
- Check that the pilot's heat slot matches the gate node they are tuned to.

**Gates on firmware before 1.9.0**
- They used a version 1 mode where the gate posted laps to RotorHazard. Plugin 2 still accepts those laps, but update the gate to 1.9.0 or later for every pilot, live RSSI and tuning from RotorHazard.

---

## Links

- **FPVGate RotorHazard plugin:** [github.com/LouisHitchcock/fpvgate-rh-plugin](https://github.com/LouisHitchcock/fpvgate-rh-plugin)
- **RotorHazard:** [github.com/RotorHazard/RotorHazard](https://github.com/RotorHazard/RotorHazard)
- **FPVGate:** [github.com/LouisHitchcock/FPVGate](https://github.com/LouisHitchcock/FPVGate)
