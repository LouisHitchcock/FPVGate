# Voice packs and browser audio

Alpha announcements use pre-recorded MP3s plus the browser's Web Speech API.
They play through the phone/computer running the page. Stock alpha targets
do not enable the unfinished I2S speaker feature.

## Supported voice selections

From `data/audio-announcer.js` and config normalization:

| Selection ID | Canonical SD directory | Compatibility candidate |
| --- | --- | --- |
| `default` (Sarah) | `voice_default_en` | `sounds_default` |
| `rachel` | `voice_rachel_en` | `sounds_rachel` |
| `adam` | `voice_adam_en` | `sounds_adam` |
| `antoni` | `voice_antoni_en` | `sounds_antoni` |
| `matilda` | `voice_matilda_en` | `sounds_matilda` |
| `de` | `voice_german_de` | `voice_de` |
| `es` | `voice_spanish_es` | `voice_es` |
| `fr` | `voice_french_fr` | `voice_fr` |
| `webspeech` | None | Installed browser/OS speech voices |

The old `piper` ID normalizes to `default`. No Piper model or runtime is
bundled. UI language is independent of voice selection.

## Install and select

Copy the chosen directories to the FAT32 card root, for example
`voice_default_en/arm_your_quad.mp3`. Follow
[SD setup](SD_CARD_MIGRATION_GUIDE.md). Use only generated/downloaded packs
with the phrase names expected by the current announcer.

Open Settings, choose the voice and announcement format, wait for save feedback,
then tap/click Enable Audio and test it. Browser playback rate and volume are
separate from the hardware buzzer. Test again after a phone locks, a browser
restarts or its audio route changes.

## Fallback and offline behavior

The announcer tries the configured directory candidates and uses Web Speech
when a phrase/name is unavailable. Some C5 pilot-name/time announcements use
Web Speech directly. Pre-recorded files can be served locally without Internet;
Web Speech availability/offline operation depends on the OS and installed voice.
Do not promise every arbitrary pilot name works offline on every phone.

Audio permission and speech are browser-dependent: keep a page open. The gate
can finish/save a C5 race without a page, but cannot make a closed browser speak.
Enable speech on one controlling device to avoid several clients talking at once.

## Generating/customizing packs

See [Voice generation](VOICE_GENERATION_README.md). The generator has five
English presets and localized phrase options. A new directory alone does not
add a new selectable voice: browser mapping, UI and firmware normalization must
agree. Replacing a supported pack's MP3s retains its existing selection ID.
Keep file names consistent and preserve a backup.

## Troubleshooting

Use the browser network panel to find a missing MP3; request that exact path
from the gate. Confirm the card is mounted and the chosen folder is at root.
Switch voice/reload if a browser has cached an old phrase. Check system mute,
media volume and user-gesture permission before regenerating files.
No fixed pack size, exact file count or first-play latency is guaranteed.
