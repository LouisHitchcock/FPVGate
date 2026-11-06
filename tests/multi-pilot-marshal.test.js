const fs = require('fs');
const path = require('path');
const { decodeRaceTrace, nearestTraceSample } = require('../data/race-trace');

function trace(times) {
  const buffer = new ArrayBuffer(12 + times.length * 12);
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  bytes.set([70, 71, 82, 72, 2, 20, 0]);
  view.setUint32(7, times.length, true);
  times.forEach((t, i) => {
    view.setUint32(12 + i * 12, t, true);
    bytes.set(Array.from({length: 8}, (_, s) => s * 25 + i), 16 + i * 12);
  });
  return buffer;
}

test('eight independent traces retain timestamps across a dropped frame', () => {
  const result = decodeRaceTrace(trace([20, 40, 100]));
  expect(result.times).toEqual([20, 40, 100]);
  expect(result.channels[0]).toEqual([0, 1, 2]);
  expect(result.channels[7]).toEqual([175, 176, 177]);
  expect(nearestTraceSample(result.times, 90)).toBe(2);
  expect(nearestTraceSample(result.times, -1)).toBe(0);
  expect(nearestTraceSample(result.times, 9999)).toBe(2);
});

test('partial and out-of-order traces are rejected rather than misaligned', () => {
  expect(() => decodeRaceTrace(trace([20, 40]).slice(0, -1))).toThrow('Incomplete');
  expect(() => decodeRaceTrace(trace([40, 20]))).toThrow('timestamps');
  expect(() => decodeRaceTrace(new ArrayBuffer(0))).toThrow('Unsupported');
});

const source = fs.readFileSync(path.join(__dirname, '../data/script.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
}

function editor(state) {
  document.body.innerHTML = '<input id="marshalEnter"><input id="marshalExit"><span id="marshalEnterSpan"></span><span id="marshalExitSpan"></span>';
  const functions = ['marshalStorePilot', 'marshalSwitchPilot', 'segmentsToAbsPasses', 'absPassesToSegments', 'marshalTimeAt', 'marshalRaceDurationMs'];
  return new Function('document', 'marshalState', `
    const setMarshalGraphVisible = () => {}, renderMarshalLapsList = () => {}, drawMarshalChart = () => {}, renderLapEditList = () => {};
    const readLapEditInputs = () => marshalState.editLaps.map(ms => ({ ms, valid: ms > 0, input: { classList: { toggle() {} } } }));
    ${functions.map(extract).join('\n')}
    return { marshalSwitchPilot, marshalStorePilot };
  `)(document, state);
}

test('switching sparse slots retains each pilot edits and selects physical slot 8', () => {
  const pilots = [{slot: 2, lapTimes: [1000, 3000], enter: 80, exit: 60}, {slot: 7, lapTimes: [1200, 4000], enter: 90, exit: 70}];
  const state = { pilots: JSON.parse(JSON.stringify(pilots)), pilotIndex: 0, channels: Array.from({length: 8}, (_, s) => [s, s + 10]), times: [20, 40], intervalMs: 20 };
  const api = editor(state);
  api.marshalSwitchPilot(0, true);
  state.absPasses = [1000, 4500];
  api.marshalSwitchPilot(1);
  expect(state.samples).toEqual([7, 17]);
  expect(state.enter).toBe(90);
  expect(state.pilots[0].lapTimes).toEqual([1000, 3500]);
  state.absPasses = [1200, 6000];
  api.marshalSwitchPilot(0);
  expect(state.absPasses).toEqual([1000, 4500]);
  expect(state.pilots[1].lapTimes).toEqual([1200, 4800]);
  expect(pilots[0].lapTimes).toEqual([1000, 3000]);
});

test('legacy remote pilots use typed entry and never inherit the local trace', () => {
  const state = { pilots: [{ isLocal: true, lapTimes: [1000, 2000] }, {isLocal: false, lapTimes: []}], pilotIndex: 0, legacySamples: [10, 20], intervalMs: 20 };
  const api = editor(state);
  api.marshalSwitchPilot(0, true);
  expect(state.hasHistory).toBe(true);
  api.marshalSwitchPilot(1);
  expect(state.hasHistory).toBe(false);
  state.editLaps = [1234, 4567];
  api.marshalSwitchPilot(0);
  expect(state.pilots[1].lapTimes).toEqual([1234, 4567]);
});

test('saving graph edits posts all eight pilots and leaves other results intact', async () => {
  document.body.innerHTML = ['raceName', 'raceTag', 'raceDistance', 'raceEditNotes'].map(id => `<input id="${id}" value="">`).join('');
  const state = {
    raceTimestamp: 42, race: { timestamp: 42 }, pilotIndex: 7, hasHistory: true,
    absPasses: [1000, 5000], enter: 80, exit: 60,
    pilots: Array.from({length: 8}, (_, slot) => ({slot, lapTimes: [1000, 2000 + slot]}))
  };
  const fetch = jest.fn().mockResolvedValue({ json: async () => ({status:'OK'}) });
  const functions = ['saveRaceChanges', 'marshalStorePilot', 'absPassesToSegments', 'assertSaved'];
  const save = new Function('document', 'marshalState', 'fetch', 'URLSearchParams', `
    const alert = () => {}, i18n = {t: k => k}, closeMarshalModal = () => {},
      loadRaceHistory = () => Promise.resolve(), refreshRaceHistoryViews = () => {};
    ${functions.map(extract).join('\n')}
    return saveRaceChanges;
  `)(document, state, fetch, URLSearchParams);
  await save();
  const request = fetch.mock.calls.find(([url]) => url === '/races/updateLaps');
  expect(request).toBeDefined();
  const saved = JSON.parse(request[1].body);
  expect(saved.timestamp).toBe(42);
  expect(saved.pilots).toHaveLength(8);
  expect(saved.pilots[7].lapTimes).toEqual([1000, 4000]);
  expect(saved.pilots[0].lapTimes).toEqual([1000, 2000]);
  expect(saved).not.toHaveProperty('lapTimes');
});
