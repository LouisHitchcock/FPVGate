// Compile the production board header and Config load/default/receiver methods
// on the PC. JSON and EEPROM are stand-ins; no serial ports or boards are used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'lib/CONFIG/config.cpp'), 'utf8');
const header = fs.readFileSync(path.join(root, 'lib/CONFIG/config.h'), 'utf8')
    .replace(/^#include <(?:ArduinoJson|AsyncJson)\.h>\r?\n/gm, '')
    .replace('private:', 'public:');
function method(signature) {
    const start = source.indexOf(signature);
    if (start < 0) throw new Error(`Missing production method ${signature}`);
    const end = source.indexOf('\n}', start);
    return source.slice(start, end + 2);
}
const helpers = source.slice(0, source.indexOf('void Config::init(void)'))
    .replace(/^#include .*$/gm, '');

test.each([
    ['FPVGATE_C5MK_AIO', 2, 'FPVGateC5MKAIO', 4, 5],
    ['SEEED_XIAO_ESP32S3', 0, 'SeeedXIAOESP32S3', 4, 5],
    ['FPVGATE_AIO', 0, 'FPVGateAIO', 4, 5],
    ['FPVGATE_SOLO', 0, 'FPVGateSolo', 4, 5],
    ['ESP32S3', 0, 'ESP32S3', 43, 44],
    ['WAVESHARE_S3_ETH', 0, 'WaveshareS3ETH', 43, 44]
])('%s preserves the correct receiver defaults, saved settings and setter behavior', (board, defaultRadio, boardId, tx, rx) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpvgate-config-'));
    const exe = path.join(dir, 'config-test.exe');
    const cpp = `
#include <cassert>
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <algorithm>
using std::min; using std::max;
#define ${board} 1
#define DEBUG(...) ((void)0)
class JsonObject {}; class AsyncResponseStream {};
${header}
static size_t strlcpy(char* dst, const char* src, size_t n) {
    size_t len = strlen(src); if (n) { size_t k = std::min(len, n - 1); memcpy(dst, src, k); dst[k] = 0; } return len;
}
struct Eeprom { laptimer_config_t image{}; void get(int, laptimer_config_t& out) { out = image; } } EEPROM;
${helpers}
${method('void Config::initC5PilotIdentity()')}
${method('void Config::setDefaults(void)')}
${method('void Config::load(void)')}
${method('uint8_t Config::getReceiverRadio()')}
${method('void Config::setReceiverRadio(uint8_t radio)')}
void Config::write() { EEPROM.image = conf; modified = false; }
bool Config::loadFromSD() { return false; }
int main() {
    assert(strcmp(FPVGATE_BOARD_ID, "${boardId}") == 0);
    static_assert(C5_UART_TX_PIN == ${tx} && C5_UART_RX_PIN == ${rx}, "C5 wiring must match the board's documentation");
#ifdef FPVGATE_C5MK_AIO
    static_assert(C5_UART_TX_PIN == 4 && C5_UART_RX_PIN == 5, "AIO C5 UART pins");
    static_assert(PIN_RGB_LED == 44 && NUM_LEDS == 3 && PIN_BUZZER == 43, "AIO outputs");
    static_assert(PIN_SD_CS == 2 && PIN_SD_SCK == 7 && PIN_SD_MOSI == 8 && PIN_SD_MISO == 9, "AIO SD pins");
    static_assert(HAS_SD_CARD_SUPPORT == 1 && FIXED_RECEIVER_RADIO == 2, "C5-only board");
    assert(strcmp(FPVGATE_BOARD_ID, "FPVGateC5MKAIO") == 0);
#endif
    Config c{}; c.setDefaults();
    assert(c.getReceiverRadio() == ${defaultRadio});
    const auto baseline = c.conf;
    memset(&EEPROM.image, 0xff, sizeof(EEPROM.image));
    c.load();
    assert(c.getReceiverRadio() == ${defaultRadio});
    for (unsigned input = 0; input < 256; ++input) {
        c.conf = baseline; c.modified = false;
        c.setReceiverRadio(input);
        const unsigned expected = ${defaultRadio} == 2 ? 2 : input <= 2 ? input : ${defaultRadio};
        assert(c.getReceiverRadio() == expected);
        assert(c.modified == (expected != ${defaultRadio}));
    }
    for (unsigned saved : {0u, 1u, 2u, 255u}) {
        EEPROM.image = baseline; EEPROM.image.receiverRadio = saved;
        EEPROM.image.frequency = 5695;
        strcpy(EEPROM.image.pilotName, "Preserve");
        c.load();
        assert(c.getReceiverRadio() == (${defaultRadio} == 2 ? 2 : saved <= 2 ? saved : 0));
        assert(c.conf.frequency == 5695 && strcmp(c.conf.pilotName, "Preserve") == 0);
    }
    puts("receiver defaults, 256 setter inputs, saved-config enforcement and pin map passed");
}
`;
    try {
        const build = spawnSync(process.env.CXX || 'g++', ['-std=c++17', '-x', 'c++', '-o', exe, '-'], { input: cpp, encoding: 'utf8', timeout: 20000 });
        expect({ status: build.status, stderr: build.stderr }).toEqual({ status: 0, stderr: '' });
        const result = spawnSync(exe, [], { encoding: 'utf8', timeout: 5000 });
        expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    } finally {
        // Only this test's newly-created temp directory is cleaned up.
        fs.rmSync(dir, { recursive: true, force: true });
    }
}, 30000);
