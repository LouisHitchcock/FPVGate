// Read-only release validation; only filesystem extraction uses a fresh temp dir.
// node tools/verify_alpha5_release.mjs [--website C:/path/to/website]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const release = 'release/v1.9.0-alpha-5';
const boards = ['SeeedXIAOESP32S3', 'WaveshareS3ETH', 'ESP32S3', 'FPVGateAIO', 'FPVGateSolo', 'FPVGateC5MKAIO'];
const websiteAt = process.argv.indexOf('--website');
const website = websiteAt < 0 ? null : process.argv[websiteAt + 1];
if (websiteAt >= 0) assert(website, '--website needs a directory');
const core = process.env.PLATFORMIO_CORE_DIR || path.join(os.homedir(), '.platformio');
const mkfs = path.join(core, 'packages/tool-mklittlefs', process.platform === 'win32' ? 'mklittlefs.exe' : 'mklittlefs');
const sha = data => createHash('sha256').update(data).digest('hex');
const info = JSON.parse(fs.readFileSync(path.join(release, 'BUILD_INFO.json'), 'utf8'));
assert.equal(info.version, '1.9.0-alpha-5');
assert.deepEqual([...info.boards].sort(), [...boards].sort());
assert.match(info.sourceCommit, /^[0-9a-f]{40}$/);
assert.equal(execFileSync('git', ['diff', info.sourceCommit, '--', 'data', 'lib', 'src', 'targets', 'platformio.ini', 'scripts'], { encoding: 'utf8' }), '', 'Production source must match BUILD_INFO');

const sums = new Map(fs.readFileSync(path.join(release, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/).map(line => {
    const [hash, name] = line.split(/\s+/);
    assert.equal(sha(fs.readFileSync(path.join(release, name))), hash, `Checksum ${name}`);
    return [name, hash];
}));
assert.equal(sums.size, 25);
assert.equal(fs.statSync(path.join(release, 'boot_app0.bin')).size, 8192);

for (const board of boards) {
    const flashMb = board === 'WaveshareS3ETH' ? 16 : 8;
    const dir = path.join(release, board);
    const firmware = fs.readFileSync(path.join(dir, 'firmware.bin'));
    assert.equal(firmware[0], 0xe9);
    assert.equal(firmware.readUInt16LE(12), 9, `${board} must be ESP32-S3`);
    assert.equal(firmware[3] >> 4, flashMb === 16 ? 4 : 3);
    for (const text of ['1.9.0\0', 'alpha-5\0', `${board}\0`, 'gateManaged']) assert(firmware.includes(Buffer.from(text)), `${board}: ${text}`);
    for (const text of ['/api/c5/pintest', '/api/c5/trace']) assert(!firmware.includes(Buffer.from(text)), `${board}: unexpected debug endpoint`);
    const table = fs.readFileSync(path.join(dir, 'partitions.bin'));
    const entries = [];
    for (let i = 0; i + 32 <= table.length && table.readUInt16LE(i) === 0x50aa; i += 32)
        entries.push({ type: table[i + 2], sub: table[i + 3], offset: table.readUInt32LE(i + 4), size: table.readUInt32LE(i + 8) });
    const apps = entries.filter(p => p.type === 0 && p.sub >= 0x10 && p.sub < 0x20);
    assert.equal(apps.length, 2);
    assert.equal(apps[0].offset, 0x10000);
    assert(apps.every(p => firmware.length <= p.size));
    const ota = entries.find(p => p.type === 1 && p.sub === 0);
    assert.equal(ota.offset, 0xe000);
    const storage = entries.find(p => p.type === 1 && p.sub === 0x82);
    assert.equal(storage.offset, flashMb === 16 ? 0x610000 : 0x410000);
    assert.equal(fs.statSync(path.join(dir, 'littlefs.bin')).size, storage.size);
    for (const part of ['bootloader', 'partitions', 'firmware', 'littlefs']) {
        const binary = fs.readFileSync(path.join(dir, part + '.bin'));
        const name = `${board}-${part}.bin`;
        assert.equal(sha(binary), sums.get(name));
        assert(binary.equals(fs.readFileSync(path.join(release, name))));
        assert(binary.equals(fs.readFileSync(path.join(release, 'boards', `${board}-${flashMb}MB-${part}.bin`))));
        if (website) assert(binary.equals(fs.readFileSync(path.join(website, 'preRelease/v1.9.0-alpha-5', board, part + '.bin'))));
    }
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpvgate-alpha5-'));
    try {
        // The older Windows mklittlefs prefixes the extraction path with ./;
        // use its working directory rather than a drive-letter output path.
        execFileSync(mkfs, ['-b', '4096', '-p', '256', '-s', String(storage.size), '-u', '.', path.resolve(dir, 'littlefs.bin')], { cwd: temp, stdio: 'pipe' });
        for (const asset of ['script.js', 'event.js']) {
            const actual = gunzipSync(fs.readFileSync(path.join(temp, asset + '.gz')));
            assert(actual.equals(fs.readFileSync(path.join('data', asset))), `${board}: filesystem contains stale ${asset}`);
        }
    } finally {
        assert(path.resolve(temp).startsWith(path.join(os.tmpdir(), 'fpvgate-alpha5-')));
        fs.rmSync(temp, { recursive: true, force: true });
    }
    console.log(`PASS ${board}: chip/version/identity, image fit, partitions, all copies and extracted frontend assets`);
}
console.log('PASS all six boards and 25 flash-image checksums; production source matches BUILD_INFO');
