# Reliability check runbook

Instructions for running an unattended reliability check against a FPVGate
before a release. Follow these exactly. Everything you need to decide is decided
by the script; your job is to start it, let it finish, and report what it says.

## What this proves, and what it does not

It proves the gate stayed reachable and served correct responses under sustained
load for the duration of the run, on every transport it could reach.

It does **not** prove the absence of the known intermittent RNDIS transmit
stall. That fault has been measured at roughly **1 failure in 1350 requests**, so
a short clean run means very little. A four hour run is the minimum worth
reporting; longer is better.

## Before you start

1. The gate must be powered and already flashed with the firmware under test.
   **Do not flash anything.** If the firmware is wrong, stop and say so.
2. Work out the addresses:
   - **WiFi**: shown in the gate's web UI, or in the self test under `WiFi`.
     Usually `192.168.0.x`.
   - **USB**: the gate is always `192.168.7.1`. That is the only address you
     need. `--bind` is optional and rarely useful: it names *your own* address
     on the USB adapter, not the gate's, and the routing table already sends
     traffic for that subnet out of the right interface. Omit it unless a run
     shows requests leaving via the wrong interface.

     If you do pass it, the address is whatever your machine holds on the USB
     adapter, normally `192.168.7.2`. On Windows:
     `Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.7.*' }`
     Should that address vanish mid-run, which happens whenever the device
     re-enumerates, the binding is dropped automatically and the run carries on.
     The summary says so at the end, because it means the adapter reset.
3. Close any serial monitor attached to the board. It is not needed and it can
   interfere.

## Running it

Four hours, both transports. This is the standard run:

```
python tools/reliability_check.py \
    --usb 192.168.7.1 --bind 192.168.7.2 \
    --wifi 192.168.0.225 \
    --duration 14400 \
    --log reliability.log --report reliability.json
```

Adjust `--wifi` to the real address. Drop `--usb` and `--bind` if no USB cable is
connected; drop `--wifi` if the gate is not on WiFi. At least one is required.

Run it in the background and leave it alone. It prints a progress line every ten
minutes so you can confirm it is still alive.

To sanity-check your addresses first, without committing to four hours:

```
python tools/reliability_check.py --usb 192.168.7.1 --bind 192.168.7.2 \
    --wifi 192.168.0.225 --skip-soak
```

That runs preflight and diagnostics only and finishes in under a minute.

## What to do while it runs

Nothing. Specifically, do **not**:

- flash, reboot or power cycle the gate
- unplug the USB cable
- open a serial monitor
- start a race or change settings through the web UI
- run any other load test at the same time

If the gate becomes unreachable, **leave it alone**. Whether it recovers on its
own is precisely what the run is measuring. Intervening destroys the result.

## Reading the outcome

The last lines printed are the verdict. Exit status matches:

| Exit | Meaning |
|---|---|
| `0` | **PASS** — every criterion met |
| `1` | **FAIL** — criteria not met, reasons listed under the verdict |
| `2` | **Could not run** — nothing reachable, or the run was interrupted |

Exit `2` is not a failure of the firmware. It means the check never got far
enough to judge, usually a wrong address or an unplugged cable.

## What to report back

Report all of:

1. The verdict line, `PASS` or `FAIL`, and the exit status.
2. If FAIL, every reason listed underneath it, verbatim.
3. The per-transport summary line for each transport, which gives request count,
   failure count and percentage, bytes transferred, median latency and heap floor.
4. Any `DOWN` or `RECOVERED` lines, with their durations.
5. How long the run actually lasted, and whether it completed or was cut short.

Attach `reliability.json` if you can. Do not summarise or interpret beyond the
above, and do not re-run to "get a better result" — an intermittent fault that
appears once is the finding.

## Criteria the script applies

PASS requires all of:

- at least one transport reachable at preflight
- every device self-test check passes, on every reachable transport
- every probed endpoint returns 200 with a body matching its `Content-Length`
- no transport is down when the run ends
- every outage recovers unaided within `--max-outage` seconds (default 60)
- request failure rate at or below `--max-failure-rate` percent (default 0.5)
- heap minimum at or above `--min-heap` bytes (default 40000)
- **the device never restarts during the run**
- free heap not trending down faster than `--max-heap-leak` bytes/hour (default 10240)

### How a restart is detected

There is no uptime or reset reason exposed over HTTP. A restart is inferred from
min-heap-ever, which only falls while the device is running and resets on boot —
so an **increase** means it restarted.

This matters more than it sounds. Without it a silent watchdog reset looks like a
short outage followed by recovery, which every other criterion would pass. If you
see `REBOOT` in the log, that is the finding, whatever else the run says.

### Heap trend

Free heap is fitted against time across the whole run and reported in KB/hour. A
slow leak that never reaches the floor threshold inside the run would otherwise
pass; a sustained downward slope fails instead. A reading within a few KB/hour of
zero is normal jitter, not a leak.

The `Content-Length` check matters more than it looks. The transmit stall
presents as a body that stops partway with **HTTP 200 already sent**, so a
status-only check would report success on exactly the fault being hunted.

## Known-good reference figures

From a healthy AIO on 1.8.0-dev, for comparison:

| Measure | USB | WiFi |
|---|---|---|
| `/status` median | ~30 ms | ~110 ms |
| 60-request burst, **this script** | 78–81 s | 22–23 s |
| 60-request burst, `soak_test.py` | 34–38 s | 13 s |
| Heap floor under load | 85–125 KB | same device |

The two burst figures differ because the two scripts send different mixes. This
one is weighted far more heavily towards `/script.js`, which is 358 KB, so its
bursts move roughly three times the data. **Do not compare a burst time from one
script against the reference for the other.**

USB bulk transfer running roughly 3x slower than WiFi is **expected** and not a
failure. Worth reporting even on a PASS: a USB burst well over 90 s, a heap floor
below about 45 KB, or a heap trend more negative than a few KB/hour.
