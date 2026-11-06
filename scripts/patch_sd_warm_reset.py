"""Backport the upstream SD SPI double-CMD0 handshake into a build-local copy.

Arduino 2.0.17 stops after the first non-idle response. A powered card left by
a CPU restart can reject that first command. Current upstream performs two
resets with 20 ms settling delays. Leave the installed framework untouched.
https://github.com/espressif/arduino-esp32/blob/c1b72ee2654e7ef298e23a681dd01fb245f0748d/libraries/SD/src/sd_diskio.cpp
"""
from pathlib import Path

OLD = '''    // Fix mount issue - sdWait fail ignored before command GO_IDLE_STATE
    digitalWrite(card->ssPin, LOW);
    if(!sdWait(pdrv, 500)){
        log_w("sdWait fail ignored, card initialize continues");
    }
    if (sdCommand(pdrv, GO_IDLE_STATE, 0, NULL) != 1){
        sdDeselectCard(pdrv);
        log_w("GO_IDLE_STATE failed");
        goto unknown_card;
    }
    sdDeselectCard(pdrv);
'''

NEW = '''    // FPVGate: upstream double-CMD0 SPI handshake for warm card recovery.
    digitalWrite(card->ssPin, LOW);
    if (!sdWait(pdrv, 500)) {
        log_w("sdWait fail ignored, card initialize continues");
    }
    (void)sdCommand(pdrv, GO_IDLE_STATE, 0, NULL);
    sdDeselectCard(pdrv);
    delay(20);
    digitalWrite(card->ssPin, LOW);
    if (!sdWait(pdrv, 500)) {
        log_w("sdWait fail ignored, card initialize continues");
    }
    if (sdCommand(pdrv, GO_IDLE_STATE, 0, NULL) != 1) {
        sdDeselectCard(pdrv);
        log_w("GO_IDLE_STATE failed");
        goto unknown_card;
    }
    sdDeselectCard(pdrv);
    delay(20);
'''


def patch_source(text):
    text = text.replace('\r\n', '\n')
    if NEW in text:
        return text
    if text.count(OLD) != 1:
        raise RuntimeError('SD reset handshake changed; review the warm-reset backport')
    return text.replace(OLD, NEW, 1)


def replace_sd_source(build_env, node):
    source = node.srcnode() if hasattr(node, 'srcnode') else node
    original = Path(source.get_abspath())
    if original.name != 'sd_diskio.cpp' or original.parent.name != 'src' or original.parent.parent.name != 'SD':
        return node
    text = patch_source(original.read_text(encoding='utf-8'))
    # The copied source lives outside the library source directory.
    header = (original.parent / 'sd_diskio.h').as_posix()
    text = text.replace('#include "sd_diskio.h"', '#include "' + header + '"', 1)
    generated = Path(build_env.subst('$BUILD_DIR')) / 'sd-recovery' / 'sd_diskio.cpp'
    generated.parent.mkdir(parents=True, exist_ok=True)
    if not generated.exists() or generated.read_text(encoding='utf-8') != text:
        generated.write_text(text, encoding='utf-8')
    return build_env.File(str(generated.resolve()))


try:
    Import('env')  # noqa: F821 - supplied by SCons
except NameError:
    env = None

if env is not None:
    env.AddBuildMiddleware(replace_sd_source, '*sd_diskio.cpp')
