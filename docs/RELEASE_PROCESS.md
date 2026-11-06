# FPVGate alpha release process

This guide reflects `tools/package_release.py` and the checked-in
`manual-release-build.yml`. A documentation/source commit does not change
already published binaries.

## Version and source

The working alpha branch is `V1.9.0-alpha`. Set `lib/VERSION/version.h`:
`FPVGATE_VERSION` is the base version and `FPVGATE_VERSION_STAGE` the suffix.
The normal current label is `1.9.0-alpha-5`. Keep a nonempty alpha stage for
pre-releases; only a final release uses an empty stage.
`FPVGateC5MKAIO_EMAProbe` overrides the stage and is never a shipping target.

Record the exact production source commit, board set and hashes when building.
A release tag should identify the source used for its images. Do not silently
move an existing public tag as a routine publishing step.

## Shipping boards

| Environment | Flash | Filesystem offset |
| --- | --- | --- |
| `ESP32S3` | 8 MB | `0x410000` |
| `FPVGateAIO` | 8 MB | `0x410000` |
| `FPVGateC5MKAIO` | 8 MB | `0x410000` |
| `FPVGateSolo` | 8 MB | `0x410000` |
| `SeeedXIAOESP32S3` | 8 MB | `0x410000` |
| `WaveshareS3ETH` | 16 MB | `0x610000` |

Keep this table, `BOARDS` in the packaging script, and the manual workflow's
matrix in agreement. Retained custom targets are outside this six-board scope.

## What the workflow actually does

The checked-in workflow runs only on **workflow_dispatch**. Pushing a tag
does not trigger it. It builds the six environments and uploads per-board
Actions artifacts plus a combined ZIP (90-day retention). It does not create
a GitHub Release, commit binaries, move tags or publish the website.

Unreleased source makes filesystem builds mandatory and uses the canonical
packaging script, including the built bootloader, partition-derived filesystem
offset and `boot_app0.bin`. Missing images/offsets fail the job; invalid version
tags are rejected. PlatformIO Core is pinned to the locally tested 6.1.18.
The matrix caches packages, not stale `.pio` build outputs. Each board artifact
contains all three layouts, a boot selector and board-specific instructions.
`SHA256SUMS` covers the delivered files; verify it before flashing/publication.
The aggregate ZIP retains per-board artifact directories (and their own board
lists); it is not an automatically published release directory. Treat artifacts
as unqualified build outputs until the hardware checklist passes. The changed
workflow still needs an actual Actions run after it is pushed.

## Build and package

From the repository root, after tests and source review:

```sh
python tools/package_release.py --version vX.Y.Z-alpha-N
```

Use the intended version instead of the placeholder. The script builds both
app and filesystem for each shipping environment and fails if artifacts are
missing. It reads filesystem offsets from the configured partition CSV.
Run it from PowerShell on Windows.

`--only ESP32S3 FPVGateAIO` deliberately limits the board set.
`--skip-build` packages existing `.pio/build` outputs: only use it when those
outputs are known to match the recorded source. The script creates
`SHA256SUMS`, but not source-provenance `BUILD_INFO.json`.

## Package layout

Each board's bootloader, partitions, firmware and LittleFS image is copied
into three layouts under `release/<tag>/`:

| Path | Consumer |
| --- | --- |
| `<BOARD>-<part>.bin` | Individual/manual downloads |
| `boards/<BOARD>-<SIZE>-<part>.bin` | Legacy size-qualified flasher layout |
| `<BOARD>/<part>.bin` | Board-ID web flasher and device updater layout |

For example, `WaveshareS3ETH/littlefs.bin` and
`boards/WaveshareS3ETH-16MB-littlefs.bin` identify the same board image.
Names and case must match the device's `FPVGATE_BOARD_ID`.

The script also writes `<BOARD>-FLASH_INSTRUCTIONS.txt`,
`Supported_Boards.txt` and a shared `boot_app0.bin` copied from the Arduino
framework. Keep release notes, source metadata and hashes alongside them.
An Alpha 5 package additionally has release-specific metadata/checksums
checked by `tools/verify_alpha5_release.mjs`.

## Wired flashing and upgrades

A full S3 flash writes five images:

| Offset | Image |
| --- | --- |
| `0x0` | bootloader |
| `0x8000` | partition table |
| `0xe000` | `boot_app0.bin` |
| `0x10000` | application |
| Board-specific offset above | LittleFS |

Use the generated board command rather than substituting offsets by flash
capacity alone. `boot_app0.bin` selects the freshly written app0 after a
previous OTA session. From 1.7.x, perform a full wired flash for the changed
partition table. OTA cannot alter that table and may reject oversized images.

## Verify before publication

1. Run `npm test --prefix tests -- --runInBand` and the relevant native checks.
2. Build app and filesystem for all six shipping boards.
3. Confirm each image's board, stage, flash size and filesystem layout.
4. Verify every packaged copy matches, and generate/review checksums.
5. Run device/component/page-load tests on available boards and record gaps.
   Include C5 closed-browser completion, save retry and matching web assets.
6. Back up real device data before any write tests or flash.
7. Prepare release notes that state the actual validation and known limits.

For the existing Alpha 5 artifact set:

```sh
node tools/verify_alpha5_release.mjs
```

Optional `--website <path>` compares a local website checkout too. The verifier
requires `BUILD_INFO.json`, exact hashes, mklittlefs and production-source
agreement with the recorded commit. Source refactors, including moved target
paths, invalidate that exact-source assertion even if binary behavior is
unchanged. Do not change the recorded source revision to force a pass:
rebuild/requalify a new package or preserve the old package's provenance.

## Publishing

Commit only reviewed release metadata and verified images to the intended
release branch; generated `.bin` files may require explicit `git add -f`.
Keep all three layouts and the shared boot selector together.

Create/tag the intended source revision, push the intended branch/tag, then
create an explicit GitHub pre-release and attach the root downloads and
instructions. Confirm the website's release metadata points to the branch,
tag and paths that actually contain those files. Alpha source lives on
`V1.9.0-alpha`; a URL hardcoded to `main` is not automatically an alpha URL.

The updater constructs `<site>/preRelease/<tag>/<BOARD>/firmware.bin` and
`littlefs.bin` for pre-releases, or `/firmware/…` for stable releases.
Website routing/publication is maintained separately; verify actual download
responses, lengths and hashes before testing a flash. GitHub release uploads
alone do not populate repository-backed website paths.

After publication, check every board's downloadable images, flash a matching
bench board, verify `/version` and `/api/system/info`, then test the app,
storage, receiver and OTA compatibility. Report untested boards explicitly.

## Refreshing existing pre-releases

A same-version refresh must be deliberate and traceable: preserve prior
provenance, identify the new source and hashes, replace every required app/
filesystem copy consistently, and disclose the refresh in its notes.
Do not assume rebuilt app binaries are byte-identical because only web source
changed, or treat silent overwrites of stable releases as the default process.

Historical notes under `release/` describe those releases. They are not
current build instructions; use this guide and the current target files.
