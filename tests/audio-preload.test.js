const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Blob } = require('buffer');
const source = fs.readFileSync(path.join(__dirname, '../data/audio-announcer.js'), 'utf8');

function setup() {
  const played = [], revoked = [];
  let url = 0;
  const fetch = jest.fn(async () => ({ ok: true, blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }) }));
  class Audio {
    constructor() { this.readyState = 4; }
    play() { played.push(this.src); Promise.resolve().then(() => this.onended?.()); return Promise.resolve(); }
  }
  const context = {
    window: { location: { origin: 'http://gate', host: 'gate' } },
    localStorage: { getItem: () => 'default', setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    fetch, Audio, AbortController, setTimeout, clearTimeout,
    URL: { createObjectURL: () => `blob:audio-${++url}`, revokeObjectURL: value => revoked.push(value) },
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { announcer: new context.window.AudioAnnouncer(), fetch, played, revoked };
}

test('existence check and repeated playback share one complete download', async () => {
  const { announcer, fetch, played } = setup();
  expect(await announcer.hasPrerecordedAudio('voice_default_en/gate_1.mp3')).toBe(true);
  await announcer.playPrerecorded('voice_default_en/gate_1.mp3');
  await announcer.playPrerecorded('voice_default_en/gate_1.mp3');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(played).toEqual(['blob:audio-1', 'blob:audio-1']);
});

test('concurrent callers wait for the same fully consumed response body', async () => {
  const { announcer, fetch } = setup();
  let finish;
  fetch.mockResolvedValue({ ok: true, blob: () => new Promise(resolve => { finish = resolve; }) });
  const first = announcer.loadAudioSource('gate.mp3'), second = announcer.loadAudioSource('gate.mp3');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(announcer.audioSources.size).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(new Blob(['audio']));
  expect(await first).toBe(await second);
  expect(announcer.audioLoads.size).toBe(0);
});

test('all recorded voices warm confirmations, which need no later network request', async () => {
  const { announcer, fetch } = setup();
  for (const voice of ['default', 'rachel', 'adam', 'antoni', 'matilda', 'de', 'es', 'fr']) {
    announcer.setVoice(voice);
    await announcer.preloadRaceAudio();
    const count = fetch.mock.calls.length;
    const dir = announcer.getPrimaryVoiceDirectory();
    for (const file of ['gate_1.mp3', 'race_complete.mp3', 'race_stopped.mp3']) await announcer.playPrerecorded(`${dir}/${file}`);
    expect(fetch.mock.calls.length).toBe(count);
  }
});

test('Web Speech mode does not preload recorded audio', async () => {
  const { announcer, fetch } = setup();
  announcer.setVoice('webspeech');
  await announcer.preloadRaceAudio();
  expect(fetch).not.toHaveBeenCalled();
});

test('voice changes discard pending old-voice results', async () => {
  const { announcer, fetch } = setup();
  let finish;
  fetch.mockResolvedValue({ ok: true, blob: () => new Promise(resolve => { finish = resolve; }) });
  const pending = announcer.loadAudioSource('voice_default_en/gate_1.mp3');
  await new Promise(resolve => setTimeout(resolve, 0)); announcer.setVoice('rachel');
  finish(new Blob(['audio']));
  expect(await pending).toBeNull();
  expect(announcer.audioSources.size).toBe(0);
});

test('bounded cache evicts ordinary clips and retains race confirmations', async () => {
  const { announcer, revoked } = setup();
  announcer.maxAudioSourceBytes = 10;
  await announcer.loadAudioSource('voice_default_en/gate_1.mp3');
  await announcer.loadAudioSource('voice_default_en/num_1.mp3');
  await announcer.loadAudioSource('voice_default_en/num_2.mp3');
  expect(announcer.audioSourceBytes).toBe(10);
  expect(announcer.audioSources.has('voice_default_en/gate_1.mp3')).toBe(true);
  expect(announcer.audioSources.has('voice_default_en/num_1.mp3')).toBe(false);
  expect(revoked).toEqual(['blob:audio-2']);
  announcer.setVoice('rachel');
  expect(announcer.audioSourceBytes).toBe(0);
  expect(revoked).toHaveLength(3);
});

test('failed responses release the body and remain retryable', async () => {
  const { announcer, fetch } = setup();
  const cancel = jest.fn(async () => {});
  fetch.mockResolvedValueOnce({ ok: false, body: { cancel } });
  expect(await announcer.hasPrerecordedAudio('gate.mp3')).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(await announcer.hasPrerecordedAudio('gate.mp3')).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
