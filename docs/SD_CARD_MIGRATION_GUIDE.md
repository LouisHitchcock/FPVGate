# SD card setup and migration

Current alpha uses LittleFS for the device web interface and SD for voice packs,
race files, RSSI sidecars and other storage-layer data. EEPROM holds device
configuration. This guide replaces the old one-off "sounds not migrated" report.

## Prepare a card

1. Back up an existing card, then prepare a FAT32 volume.
2. Generate or obtain the required voice packs.
3. Copy the contents of the generated `SD_Card/` staging folder to the card root.
4. With power off, insert the card; boot and check storage diagnostics.
5. Enable audio in the browser and test the selected voice before a race.

Example card root:

```text
voice_default_en/
voice_rachel_en/
voice_adam_en/
voice_antoni_en/
voice_matilda_en/
voice_french_fr/
voice_spanish_es/
voice_german_de/
```

Install only the voices you need. Do not nest those folders inside another
`SD_Card/` or `sounds/` directory. File counts and total sizes depend on the
generator/version; there is no fixed 125/214-file requirement.
[Multi-voice mapping](MULTI_VOICE_SETUP.md).

## Existing cards

Canonical `voice_*` paths are preferred. The browser retains compatibility
candidates such as `sounds_default` and `sounds_rachel`; French/German/Spanish
also accept their short `voice_fr`/`voice_de`/`voice_es` aliases.
Keep a backup while replacing an old pack.

Firmware retains a legacy `migrateSoundsToSD()` path for old LittleFS sound
assets. It cannot generate missing voices and is not the current installation
procedure. Current source attempts deferred SD initialization after about
two seconds and can retry; the old fixed "five seconds after boot" instructions
are not the scheduling contract.

## Storage layout

Active CSVs live in `targets/partitions/`:

| Layout | App slots, each | LittleFS offset / size |
| --- | --- | --- |
| 4 MB | `0x140000` | `0x290000 / 0x160000` |
| 8 MB | `0x200000` | `0x410000 / 0x3E0000` |
| 16 MB | `0x300000` | `0x610000 / 0x200000` |

The 8 MB filesystem is no longer the old 1 MB layout. The LCD target uses that
8 MB layout even though its chip is 16 MB. Gzipped assets are built from
`data/` by the PlatformIO hook. Audio generation writes `SD_Card/`, not
LittleFS; uploading a filesystem does not install those packs on the card.

## Backup and persistence

Export race JSON from the UI and back up the card's actual files too:
JSON does not include `.rssi` sidecars. Preserve event data and track images
as well as laps. A config backup alone does not cover race/event storage.

Use the built-in controls rather than editing indexes by hand. Do not remove
a mounted card during recording or persistence. In C5 mode a failed save
keeps the race in RAM and blocks Start/Clear; restore storage and retry Stop.
Rebooting loses an unsaved in-memory race.

## Troubleshooting

| Problem | Checks |
| --- | --- |
| Card not detected | FAT32, contacts, power, exact board pins and SD breakout supply |
| Voice 404 | Selected folder at card root, exact filename/case, card mounted |
| Page loads but no voice | Tap Enable Audio; phone/browser volume; inspect missing MP3 request |
| Missing trace after JSON import | Sidecars are separate; restore the original trace file too |
| Web UI missing | Correct LittleFS image and partition layout; SD voices cannot replace the web image |

There is no universal SD pin assignment. DevKitC uses CS/SCK/MOSI/MISO
39/36/35/37; XIAO uses 2/7/8/9; S3-ETH and LCD have onboard slots with different
pins. See [hardware](HARDWARE_GUIDE.md) and the matching wiring page.
A storage failure can leave individual features unavailable; do not assume
all data is automatically replicated between SD and flash.
