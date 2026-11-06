# Ethernet restart investigation — 6 November 2026

## Premature DHCP fallback fixed

The rc.5 Ethernet gate appeared to hang after a software restart: HTTP, ping
and ARP stopped answering at its usual DHCP address. The SD log recovered
after a power cycle showed that boot 6 logged link-up at 3959 ms, then chose
the fixed fallback address at 3971 ms while claiming to have waited 45 seconds.
Heap logs continued until 1265253 ms. That boot was still running on a
different IP; the earlier outage without this evidence remains unproven.

The main loop samples its clock before calling `ethnet_update()`. An Ethernet
event can record a newer link timestamp before the update uses that sample.
Unsigned subtraction then produces an enormous age, immediately stopping
DHCP and selecting `192.168.8.1`. The faulty check exists in soaked rc.4
commit `18b1f15` and the initial Ethernet commit `542c633`; it predates rc.5.
This evidence does not implicate the new logger. Ethernet startup already
pulses the W5500 hardware reset pin.

Fix `499d6e4` uses signed elapsed time and records the link timestamp before
publishing link-up. The native regression covers a newer event timestamp,
timeout boundaries and clock wrap; the old calculation fails the same test.

## Validation and remaining blocker

- 34 Python tests and 166 Jest tests passed; WaveshareS3ETH firmware built.
- App-only OTA recovered in 5.64 seconds. Configuration, race history, Event
  and receiver firmware 1.2.5 were verified preserved; filesystem untouched.
- Patched firmware SHA256:
  `7fb8de2726bc57414f06ccc6e065e21d1e237a4e9796b5cf251ac5083e2a3f87`.
- A planned 20-restart check passed the first six with DHCP and exact saved
  data comparisons. One needed two SD mount retries and took 24.8 seconds;
  the others took about 6.7 seconds.
- Restart seven obtained DHCP at 4234 ms and kept serving HTTP, but failed
  all five SD mount attempts. Event retrieval returned 404 without the card,
  so the full restart check **failed after six passes**.
- One further software restart restored SD access and logging. Configuration,
  history and Event exactly matched the pre-loop baseline. No further power
  cycle was required.

The intermittent SD mount failure remains unresolved. This is not a completed
soak or release qualification. The physical no-DHCP/direct-cable fallback
still needs validation; its timer is covered by the native regression.
Existing post-flash power-cycle advice does not remove the need for reliable
ordinary software restarts.

Raw bench evidence is retained locally under
`.dev/rc-evidence/eth-dhcp-fix-20261106/`; configuration backups and device
logs are not published with this report.
