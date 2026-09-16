#!/usr/bin/env python3
"""Build every shipping board and assemble a release directory.

Packaging a release by hand means about forty file copies across two naming
conventions, and a single typo produces a 404 in the web flasher that is only
noticed by a user trying to flash. This does the whole thing from the board
table below, so the names cannot drift.

Two copies of each binary are written, because they serve different consumers:

* `release/vX.Y.Z/boards/<BOARD>-<SIZE>-<part>.bin` is what the web flasher at
  fpvgate.xyz fetches, and the `-8MB-` / `-16MB-` infix is load-bearing. These
  must be committed to the repository - the site pulls from GitHub, not from
  release assets.
* `release/vX.Y.Z/<BOARD>-<part>.bin` is for people flashing by hand, and is
  what gets attached to the GitHub release.

    python tools/package_release.py --version v1.8.0
    python tools/package_release.py --version v1.8.0 --skip-build

On Windows, run this from PowerShell rather than Git Bash. PlatformIO refuses
to install its esptool package under MSys and the filesystem build fails.
"""

import argparse
import os
import shutil
import subprocess
import sys

# Every board a release ships. Keep in step with the matrix in
# .github/workflows/manual-release-build.yml.
BOARDS = [
    ("ESP32S3", "8MB", "ESP32-S3 DevKitC-1 (8MB Flash)"),
    ("FPVGateAIO", "8MB", "FPVGate AIO V3 (XIAO ESP32S3, 8MB)"),
    ("FPVGateSolo", "8MB", "FPVGate Solo (XIAO ESP32S3, 8MB)"),
    ("SeeedXIAOESP32S3", "8MB", "Seeed Studio XIAO ESP32S3 (8MB)"),
    ("XIAOS3Plus", "16MB", "XIAO ESP32S3 Plus (16MB Flash)"),
]

PARTS = ["bootloader", "partitions", "firmware", "littlefs"]

# Offsets the web flasher and the manual instructions both use. bootloader sits
# at 0x0 on the S3, unlike the classic ESP32's 0x1000.
OFFSETS = {"bootloader": "0x0", "partitions": "0x8000", "firmware": "0x10000"}

FLASH_INSTRUCTIONS = """FPVGate {version} - {description}

Flash all four files in one command. The filesystem offset differs per board,
so use the value below rather than one from another board's instructions.

esptool.py --chip esp32s3 --port <PORT> --baud 460800 write_flash -z \\
  0x0      {board}-bootloader.bin \\
  0x8000   {board}-partitions.bin \\
  0x10000  {board}-firmware.bin \\
  {fs_offset}  {board}-littlefs.bin

Notes
-----
* Upgrading from 1.7.x MUST be a full wired flash like the one above. An
  over-the-air update replaces the application only and leaves the old
  partition table in place, which a 1.8.0 filesystem image will not fit.
* The easier route is the web flasher at https://fpvgate.xyz, which does all
  of this from a browser.
* After flashing, the gate is reachable over USB-C at http://192.168.7.1 as
  well as over WiFi. USB networking works on Windows and Linux; macOS is not
  supported, because Apple removed RNDIS.
"""


def run(command):
    print(f"  $ {' '.join(command)}", flush=True)
    result = subprocess.run(command)
    if result.returncode != 0:
        raise SystemExit(f"FAILED: {' '.join(command)}")


def filesystem_offset(environment):
    """Read the spiffs offset from the board's partition CSV.

    Hardcoding it per board is how flash instructions end up wrong after a
    partition change, which is exactly what happened to the 8MB layout in this
    release.
    """
    import configparser

    parser = configparser.ConfigParser()
    parser.read("platformio.ini")
    for extra in parser.get("platformio", "extra_configs", fallback="").split():
        parser.read(extra)
    section = f"env:{environment}"
    csv = parser.get(section, "board_build.partitions", fallback=None)
    if not csv:
        return None
    for candidate in (csv, os.path.join("targets", csv)):
        if os.path.isfile(candidate):
            with open(candidate) as handle:
                for line in handle:
                    if line.strip().startswith("#") or "," not in line:
                        continue
                    fields = [f.strip() for f in line.split(",")]
                    if fields[0] in ("spiffs", "littlefs"):
                        return fields[3]
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", required=True, help="release tag, e.g. v1.8.0")
    parser.add_argument("--skip-build", action="store_true",
                        help="package binaries already in .pio/build")
    parser.add_argument("--only", nargs="*", help="limit to these environments")
    args = parser.parse_args()

    boards = [b for b in BOARDS if not args.only or b[0] in args.only]
    if not boards:
        raise SystemExit("no matching boards")

    root = os.path.join("release", args.version)
    board_dir = os.path.join(root, "boards")
    os.makedirs(board_dir, exist_ok=True)

    missing = []
    for environment, size, description in boards:
        print(f"\n=== {environment} ({size}) ===")
        if not args.skip_build:
            run(["pio", "run", "-e", environment])
            run(["pio", "run", "-e", environment, "-t", "buildfs"])

        build = os.path.join(".pio", "build", environment)
        for part in PARTS:
            source = os.path.join(build, f"{part}.bin")
            if not os.path.isfile(source):
                missing.append(f"{environment}/{part}.bin")
                print(f"  MISSING {source}")
                continue
            shutil.copy2(source, os.path.join(root, f"{environment}-{part}.bin"))
            shutil.copy2(source, os.path.join(board_dir, f"{environment}-{size}-{part}.bin"))
            print(f"  {part:11} {os.path.getsize(source) / 1024:7.0f} KB")

        offset = filesystem_offset(environment) or "0x410000"
        with open(os.path.join(root, f"{environment}-FLASH_INSTRUCTIONS.txt"), "w") as handle:
            handle.write(FLASH_INSTRUCTIONS.format(version=args.version,
                                                   description=description,
                                                   board=environment,
                                                   fs_offset=offset))

    with open(os.path.join(root, "Supported_Boards.txt"), "w") as handle:
        handle.write(f"FPVGate {args.version} - Supported Boards\n\n")
        for environment, size, description in boards:
            handle.write(f"  - {description}\n")
        handle.write("\nUSB networking (http://192.168.7.1 over USB-C) is available on all of\n"
                     "these. Windows and Linux only; macOS does not support RNDIS.\n")

    print(f"\npackaged into {root}")
    print(f"  {len(boards)} boards, {len(boards) * len(PARTS)} binaries, two copies each")
    if missing:
        print("\nMISSING artefacts:")
        for item in missing:
            print(f"  {item}")
        return 1
    print("\nNext: commit boards/*.bin (they are what the web flasher fetches),")
    print("      tag, push, then verify at https://fpvgate.xyz/flasher.html")
    return 0


if __name__ == "__main__":
    sys.exit(main())
