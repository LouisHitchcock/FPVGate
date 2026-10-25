# Repository layout

| Path | Purpose |
| --- | --- |
| `src/`, `lib/` | Device firmware and its libraries |
| `data/` | Web interface and runtime assets uploaded to LittleFS |
| `targets/` | PlatformIO board environment definitions |
| `targets/partitions/` | Active 4 MB, 8 MB and 16 MB partition tables |
| `variants/` | Board pin definitions |
| `scripts/` | PlatformIO build hooks |
| `tools/` | Release packaging, voice generation and device test utilities |
| `tests/` | Frontend tests and their Node dependencies |
| `docs/` | User, hardware and developer documentation |
| `images/` | Documentation banner, social preview, screenshots and source logos |
| `integrations/` | Standalone services maintained separately from the device |
| `release/` | Published firmware, filesystem images and release notes |
| `.github/` | Workflows and repository automation |

`platformio.ini` stays at the root as the build entry point. The root
`requirements.txt` contains Python tooling dependencies. `boards.json` is retained
at its existing path as a board catalogue: it has no in-repository callers, but
changing its URL would need a separate audit of possible external consumers.

The old Electron wrapper has been removed. The current interface runs in a
browser over Wi-Fi, USB networking or Ethernet and has no `electronAPI` callers.
Its source remains available in Git history, along with its historical changelog
entries. The independent Discord webhook worker is preserved under
[`integrations/discord-bot/`](../integrations/discord-bot/README.md) because its
external deployment status is unknown.

Screenshots keep their dated/versioned subdirectories under `images/screenshots/`;
logo exports live under `images/logo/`. Runtime logos in `data/` belong to the
device filesystem and stay there.

The old `targets/custom_8mb.csv` was an unused, outdated 1 MB filesystem layout.
The active root partition tables were moved without changing their contents,
and every board environment now uses an explicit `targets/partitions/` path.
