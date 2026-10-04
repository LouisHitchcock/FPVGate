# ESP32-C5 multi-pilot receiver

The `receiverRadio=2` mode uses the S3 as the FPVGate controller and an ESP32-C5 as a separate RF co-processor. The C5 is one receiver, so FPVGate time-slices it across up to eight configured pilot frequencies.

## UART

The default S3 UART mapping is GPIO44 (RX), GPIO43 (TX), with common ground. The pins can be overridden with `C5_UART_RX_PIN` and `C5_UART_TX_PIN` in a board target. The link is 921600 baud, 8N1, no flow control.

Each message is `<payload>*<HH>\n`, where `HH` is the uppercase two-digit XOR of every payload byte:

* C5 → S3: `R,<sequence>,<rssi>` (RSSI 0–255)
* C5 → S3: `S,<MHz>,<gain>,<state>,<firmware>` (status/heartbeat)
* S3 → C5: `F,<MHz>` (tune), `G,<gain>` (gain 0–89), and `Q` (status request)

The S3 owns pilot configuration and rotates slots every 20 ms. The RF-node firmware must stop sending `R` while tuning and resume after reporting `OK`, as in the double-ESP-resso protocol.

## Configuration

Select **ESP32-C5 Multi-Pilot** under Settings → Receiver Radio. Each profile has a frequency, enter threshold, exit threshold, and live RSSI value. Frequencies outside 5180–5885 MHz are rejected because they are outside the validated C5 range.

The C5 mode emits `c5Rssi` and `c5Lap` server-sent events. Existing RX5808 and Novacore modes are unchanged. The C5 RF firmware remains a separate co-processor image; this branch implements the FPVGate S3-side integration.
