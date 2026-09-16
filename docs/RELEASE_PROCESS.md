# FPVGate Release Process Guide

This document describes the complete process for creating and publishing FPVGate releases.

## Release Structure

Each release must follow this exact structure to work with the web flasher at https://fpvgate.xyz:

```
release/vX.Y.Z/
├── boards/                          # For web flasher (fpvgate.xyz)
│   ├── <BOARD>-<SIZE>-bootloader.bin
│   ├── <BOARD>-<SIZE>-partitions.bin
│   ├── <BOARD>-<SIZE>-firmware.bin
│   └── <BOARD>-<SIZE>-littlefs.bin        ... for every board below
├── <BOARD>-bootloader.bin            # For GitHub release downloads
├── <BOARD>-partitions.bin
├── <BOARD>-firmware.bin
├── <BOARD>-littlefs.bin
├── <BOARD>-FLASH_INSTRUCTIONS.txt     ... for every board below
├── Supported_Boards.txt
└── RELEASE_NOTES.md
```

### Boards a release ships

| Environment | Flash | Board |
|---|---|---|
| `ESP32S3` | 8MB | ESP32-S3 DevKitC-1 |
| `FPVGateAIO` | 8MB | FPVGate AIO V3 (XIAO ESP32S3) |
| `FPVGateSolo` | 8MB | FPVGate Solo (XIAO ESP32S3) |
| `SeeedXIAOESP32S3` | 8MB | Seeed Studio XIAO ESP32S3 |
| `XIAOS3Plus` | 16MB | XIAO ESP32S3 Plus |

This list lives in three places that must agree, or a board silently ships
nothing: the `BOARDS` table in `tools/package_release.py`, the `matrix` in
`.github/workflows/manual-release-build.yml`, and this table.

## Why Two Sets of Binaries?

### 1. `boards/` Directory
- **Purpose**: Used by the web flasher at https://fpvgate.xyz
- **Naming**: Must carry the flash size, `-8MB-` or `-16MB-`, matching the table above
- **URL Pattern**: `https://fpvgate.xyz/firmware/vX.Y.Z/boards/ESP32S3-8MB-bootloader.bin`
- **Must be committed to repository**: The website pulls files from the GitHub repository, NOT release assets

### 2. Root Level Files
- **Purpose**: Individual downloads for users flashing manually
- **Naming**: Simpler names for easier identification
- **Distribution**: GitHub release assets and optional zip files

## Automated Release Process

### Step 1: Update Version Number

Edit `lib/VERSION/version.h`. Both lines matter — the stage suffix is what makes
a build report `1.8.0-dev` rather than `1.8.0`, and leaving it set ships a
release that calls itself a development build:
```cpp
#define FPVGATE_VERSION "X.Y.Z"
#define FPVGATE_VERSION_STAGE ""   // "" for a release; "dev"/"alpha"/"beta"/"rc-1" otherwise
```

### Step 2: Update CHANGELOG.md

Add new section at the top:
```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added/Fixed/Changed
- Description of changes
```

### Step 3: Create Release Notes

Create `release/vX.Y.Z/RELEASE_NOTES.md` following the template from previous releases.

### Step 4: Tag and Push

```bash
git add -A
git commit -m "Release vX.Y.Z: <brief description>"
git tag -a vX.Y.Z -m "FPVGate vX.Y.Z - <brief description>"
git push origin main
git push origin vX.Y.Z
```

The GitHub Actions workflow will automatically:
1. Build firmware for all boards
2. Create properly named binaries
3. Create GitHub release with assets
4. Commit binaries to `release/vX.Y.Z/boards/` directory

### Step 5: Verify Web Flasher

After the workflow completes:
1. Visit https://fpvgate.xyz/flasher.html
2. Select the new version
3. Verify that all binaries download correctly

## Manual Release Process (Fallback)

If the automated process fails, follow these steps:

### 1. Build and package every board

One command builds all five boards, writes both naming conventions, generates
per-board flash instructions with the correct filesystem offset read from that
board's partition CSV, and writes `Supported_Boards.txt`:

```bash
python tools/package_release.py --version vX.Y.Z
```

Add `--skip-build` to repackage binaries already in `.pio/build`, or
`--only ESP32S3 FPVGateAIO` to limit it to specific boards.

**On Windows, run this from PowerShell, not Git Bash.** PlatformIO refuses to
install its esptool package under MSys and the filesystem build fails with
"MSys/Mingw is not supported".

The rest of this section describes what that script does, for when it needs
changing or the release has to be assembled by hand.

### 2. Copy Binaries to Release Directory

For each board, four artefacts are copied twice, under two naming conventions:

```
.pio/build/<ENV>/{bootloader,partitions,firmware,littlefs}.bin
  -> release/vX.Y.Z/<ENV>-<part>.bin              (GitHub release assets)
  -> release/vX.Y.Z/boards/<ENV>-<SIZE>-<part>.bin (web flasher)
```

The `-8MB-` / `-16MB-` infix in `boards/` is load-bearing and case-sensitive;
the flasher builds its URLs from it.

### 3. Create Flash Instructions

One `<ENV>-FLASH_INSTRUCTIONS.txt` per board. The filesystem offset differs
between the 8MB and 16MB layouts (`0x410000` vs `0x610000`), so it is read from
that board's partition CSV rather than copied from another board's file.

### 4. Commit Binaries to Repository

```bash
# IMPORTANT: Binaries in boards/ must be committed to work with web flasher
git add -f release/vX.Y.Z/boards/*.bin
git add release/vX.Y.Z/RELEASE_NOTES.md
git add release/vX.Y.Z/*FLASH_INSTRUCTIONS.txt
git commit -m "Add vX.Y.Z release binaries for web flasher"
git push origin main
```

### 5. Upload to GitHub Release

```bash
gh release upload vX.Y.Z \
  release/vX.Y.Z/*.bin \
  release/vX.Y.Z/*FLASH_INSTRUCTIONS.txt \
  release/vX.Y.Z/Supported_Boards.txt \
  release/vX.Y.Z/RELEASE_NOTES.md
```

Note this uploads the root-level binaries only. The `boards/` copies are served
from the repository, not from release assets, so they are committed rather than
uploaded.

## Hotfix Process (Silent Update)

For bug fixes that don't warrant a new version number:

### 1. Fix the Bug

Make code changes and test thoroughly.

### 2. Rebuild Affected Binaries

Only rebuild what changed (usually just littlefs.bin for web interface fixes):

```bash
python tools/package_release.py --version vX.Y.Z
```

### 3. Update Release Binaries

The packaging script overwrites both copies for every board, so there is nothing
to do by hand. If only the web UI changed, the firmware binaries will be
byte-identical anyway and `git add` picks up just the filesystem images.

### 4. Commit and Upload

```bash
git add -f release/vX.Y.Z/boards/*.bin
git add -f release/vX.Y.Z/*.bin
git commit -m "Hotfix: <brief description> for vX.Y.Z"
git push origin main

# Replace GitHub release assets
gh release upload vX.Y.Z release/vX.Y.Z/*-littlefs.bin --clobber
```

## Web Flasher Integration

The web flasher at https://fpvgate.xyz expects:

### URL Pattern
```
https://raw.githubusercontent.com/LouisHitchcock/FPVGate/main/release/vX.Y.Z/boards/BOARD-FLASH_SIZE-TYPE.bin
```

Or through the website proxy:
```
https://fpvgate.xyz/firmware/vX.Y.Z/boards/BOARD-FLASH_SIZE-TYPE.bin
```

### File Names Must Match

`<Environment>-<Size>-<part>.bin`, case-sensitive, for each of the five
environments in the table at the top and each of `bootloader`, `partitions`,
`firmware`, `littlefs`. For example:

- `ESP32S3-8MB-firmware.bin`
- `FPVGateAIO-8MB-littlefs.bin`
- `XIAOS3Plus-16MB-partitions.bin`

### Testing Checklist

Before tagging:
- [ ] `lib/VERSION/version.h` has the right version **and an empty stage**
- [ ] `cd tests && npx jest` passes
- [ ] Every shipping environment builds, from PowerShell on Windows
- [ ] `tools/concurrent_load.py` passes on each board that has hardware
- [ ] The device self test (`/api/selftest`) passes on each board

After releasing:
- [ ] Visit https://fpvgate.xyz/flasher.html
- [ ] Select new version from dropdown
- [ ] For each of the five boards, verify all 4 files are found
- [ ] Test flashing on actual hardware
- [ ] Confirm the flashed device reports the expected version at `/version`
- [ ] Verify GitHub release has all individual binaries as assets
- [ ] Check that release notes are correct

## Troubleshooting

### Web Flasher Can't Find Binaries
- **Problem**: 404 errors when trying to flash
- **Solution**: Ensure binaries are committed to `release/vX.Y.Z/boards/` in the repository
- **Verify**: Check https://github.com/LouisHitchcock/FPVGate/tree/main/release/vX.Y.Z/boards

### Wrong File Names
- **Problem**: Binaries have wrong naming convention
- **Solution**: Rename files to match exact pattern above (case-sensitive)
- **Key**: Must include the flash size, `-8MB-` or `-16MB-`, in boards/ directory files

### Release Assets Not Uploading
- **Problem**: GitHub Actions fails to create release
- **Solution**: Check workflow logs, ensure tag is pushed, verify GITHUB_TOKEN permissions

## Version Numbering

Follow Semantic Versioning (SemVer):
- **Major (X.0.0)**: Breaking changes, major new features
- **Minor (x.Y.0)**: New features, backwards compatible
- **Patch (x.y.Z)**: Bug fixes, no new features

Examples:
- v1.5.3 → v1.5.4 (bug fix)
- v1.5.4 → v1.6.0 (new feature)
- v1.6.0 → v2.0.0 (major rewrite/breaking changes)
