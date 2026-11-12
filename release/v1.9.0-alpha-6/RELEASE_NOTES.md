# FPVGate 1.9.0-alpha-6

**Testing prerelease, not a production-qualified release.** This combines the current 1.9.0 RC source with the bench-tested Wi-Fi file-transfer fix. It is a new Alpha-6 package; previous Alpha-5 assets are unchanged.

## Wi-Fi web loading

File downloads now use a bounded two-segment TCP send window, with at most two file responses admitted at once. Waiting file responses defer both headers and body, then resume without blocking API or live RSSI streams. Cancellation releases admission, and empty deferred polls no longer consume send credit. The existing low-memory guard remains.

On the tested standard C5MK AIO, the compressed script's sequential median improved from about 8.2 s to 1.45 s. All 12 home-page CSS/JS dependencies downloaded in about 3.1 s. Six parallel downloads with live C5 RSSI, client cancellations and six subsequent retries passed without new link/UART errors. These are short bench results on one board/client, not a universal performance guarantee, browser-render test or soak pass. The separate operator's exact Alpha-5 outage is not conclusively diagnosed.

## Included RC work since Alpha-5

- Race-history filtering and access to older races; large-import handling, timestamp preservation and clearer import failures.
- Race announcements and lap-editor improvements, plus ELRS Backpack radio-switch race control and countdown support.
- Localization improvements, including the Chinese catalogue and locale-loading fixes.
- Diagnostic log retention/downloads, C5 receiver checks, and network/memory diagnostic improvements.
- Reduced internal-heap pressure using PSRAM for CPU-owned staging, configuration/JSON and event data; maintained network libraries and serialized SSE disconnect handling.
- C5MK AIO shared 95 ms median without the additional S3 EMA. Future-dated clock-mapped samples are clamped so all eight slots remain live.
- Ethernet DHCP/restart and SD-initialization improvements from the RC branch. Field reliability qualification remains incomplete.

## Boards

The package contains firmware, matching LittleFS, bootloader, partitions and OTA-selection initialization for:

- FPVGate C5MK AIO ? 8 MB
- FPVGate AIO ? 8 MB
- FPVGate Solo ? 8 MB
- Seeed XIAO ESP32S3 ? 8 MB
- ESP32-S3 DevKitC-1 ? 8 MB
- Waveshare ESP32-S3-ETH ? 16 MB

Only the standard XIAO C5MK AIO has the Wi-Fi-fix hardware checks described above. Other board images are build/packaging checked; do not infer equivalent hardware qualification.

## Installing

Update **both the S3 firmware and web filesystem** when coming from Alpha-5 or another older build. Use the files for the exact board. Existing supported 8 MB/16 MB layouts can use their normal paired application/filesystem update; migration from 1.7.x needs the full wired flash because the partition table changed. Full wired instructions include boot_app0.bin so a board previously running app1 starts the newly written app0.

These are **S3 host images**. This release does not flash the separate C5 receiver. Existing protocol 3 C5 links retain their wire format. Matching the native-USB median behavior additionally requires the separate C5MK 1.3.0 RC firmware, whose USB soak is not passed; it is not bundled or promoted by this release.

Back up settings first. The standard C5MK AIO tested here retained its settings and C5 firmware. Never apply S3 images or offsets to the C5.

## Validation limits

Hardware evidence is limited to one C5MK AIO, one Windows Wi-Fi client, and short download/RSSI tests. Long-duration network soak, real-video pass accuracy, other hardware variants and Ethernet/SD recovery qualification remain open. A release label does not turn the earlier incomplete RF/USB-soak evidence into a pass.

Checksums and source/build provenance are included with the packaged images.
