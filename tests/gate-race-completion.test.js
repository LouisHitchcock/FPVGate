const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../data/script.js'), 'utf8');

function extract(name, text = source) {
  const head = text.indexOf(`function ${name}(`);
  if (head < 0) throw new Error(name);
  let params = 0, end;
  for (let i = text.indexOf('(', head); i < text.length; i++) {
    if (text[i] === '(') params++;
    if (text[i] === ')' && --params === 0) { end = i; break; }
  }
  let depth = 0;
  for (let i = text.indexOf('{', end); i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0)
      return text.slice(text.slice(head - 6, head) === 'async ' ? head - 6 : head, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function page(states, { observed = 0, notes = '', raceEvent = true } = {}) {
  let idx = 0;
  const saved = { timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000, 10000] }] };
  const context = {
    console, URLSearchParams,
    c5GateManaged: true, c5RaceResyncing: false, c5RaceRequest: null,
    c5Race: { active: true, racers: [{ slot: 0, spoken: 'Ann' }], laps: {}, finished: {} },
    c5ObservedTimestamp: observed, c5CompletedTimestamp: 0, c5CompletionPromise: null,
    c5RaceLabel: {}, c5StopReason: '', currentRaceSessionTimestamp: null, raceRunning: false,
    openRaceNotesOnRaceEnd: false, raceNotesInput: { value: notes },
    startRaceButton: {}, stopRaceButton: {},
    timer: {}, currentLapStartMs: 0, stopDistancePolling: jest.fn(),
    i18n: { t: (key) => key }, queueSpeak: jest.fn(),
    c5ReceiverSelected: () => true,
    c5RaceReset: () => {}, renderUnifiedRaceView: () => {}, updateAnalysisSectionVisibility: () => {},
    startRaceTimer: jest.fn(), stopRaceTimer: jest.fn(), updateRaceButtons: jest.fn(),
    loadRaceHistory: jest.fn(async () => [saved]), openRaceNotesModal: jest.fn(),
    RaceEvent: raceEvent ? { recordRace: jest.fn() } : undefined,
    setTimeout: (fn) => fn(),
    fetch: jest.fn(async (url) => {
      if (url === '/races/update') return { ok: true, json: async () => ({ status: 'OK' }) };
      if (url !== '/api/c5/race') throw new Error(`Unexpected write: ${url}`);
      const state = states[Math.min(idx++, states.length - 1)];
      return { json: async () => state };
    }),
  };
  vm.createContext(context);
  const functions = ['c5RaceResync', 'waitForC5RaceSave', 'completeC5RaceInBrowser', 'saveCurrentRace', 'handleC5RaceLap'];
  vm.runInContext(functions.map((name) => extract(name)).join('\n'), context);
  return context;
}

const snapshot = (extra = {}) => ({ gateManaged: true, running: false, busy: false,
  timestamp: 42, savedTimestamp: 42, racers: 1,
  pilots: [{ slot: 0, laps: [1000, 10000] }], ...extra });

test('reopening a finished race restores saved ID and laps without a save POST', async () => {
  const p = page([snapshot()]);
  await p.c5RaceResync();
  expect(p.currentRaceSessionTimestamp).toBe(42);
  expect(p.c5Race.laps[0]).toEqual([1, 10]);
  expect(p.raceRunning).toBe(false);
  expect(await p.saveCurrentRace()).toBe(42);
  expect(p.fetch.mock.calls.every(([url]) => url === '/api/c5/race')).toBe(true);
});

test('a queued stop waits for gate persistence rather than writing its own record', async () => {
  const p = page([snapshot({ busy: true, savedTimestamp: 0 }), snapshot()]);
  expect(await p.saveCurrentRace()).toBe(42);
  expect(p.fetch).toHaveBeenCalledTimes(2);
  expect(p.currentRaceSessionTimestamp).toBe(42);
});

test('running snapshots restore race controls and remember the observed race', async () => {
  const p = page([snapshot({ running: true, savedTimestamp: 0 })]);
  await p.c5RaceResync();
  expect(p.raceRunning).toBe(true);
  expect(p.c5ObservedTimestamp).toBe(42);
  expect(p.startRaceTimer).toHaveBeenCalledTimes(1);
  await p.c5RaceResync();
  expect(p.startRaceTimer).toHaveBeenCalledTimes(1);
});

test('a failed gate save exposes retry and never falls back to a browser save', async () => {
  const p = page([snapshot({ savedTimestamp: 0, saveFailed: true })]);
  await expect(p.saveCurrentRace()).rejects.toThrow('press Stop to retry');
  expect(p.stopRaceButton.disabled).toBe(false);
  expect(p.startRaceButton.disabled).toBe(true);
  expect(p.fetch.mock.calls.every(([url]) => url === '/api/c5/race')).toBe(true);
});

test('two stop notifications share completion and record Events once', async () => {
  const p = page([snapshot()], { observed: 42, notes: 'Windy' });
  p.c5RaceLabel = { name: 'Heat 1', tag: 'Club race' };
  await Promise.all([p.completeC5RaceInBrowser(), p.completeC5RaceInBrowser()]);
  await p.completeC5RaceInBrowser();
  expect(p.RaceEvent.recordRace).toHaveBeenCalledTimes(1);
  const updates = p.fetch.mock.calls.filter(([url]) => url === '/races/update');
  expect(updates).toHaveLength(1);
  expect(updates[0][1].body.get('notes')).toBe('Windy');
  expect(updates[0][1].body.get('name')).toBe('Heat 1');
});

test('a race finished before this page opened is not assigned to its loaded heat', async () => {
  const p = page([snapshot()]);
  await p.completeC5RaceInBrowser();
  expect(p.RaceEvent.recordRace).not.toHaveBeenCalled();
  expect(p.fetch.mock.calls.some(([url]) => url === '/races/update')).toBe(false);
});

test('a temporary history fetch failure can be retried without losing Events recording', async () => {
  const p = page([snapshot()], { observed: 42 });
  p.loadRaceHistory.mockResolvedValueOnce(null);
  await expect(p.completeC5RaceInBrowser()).rejects.toThrow('history could not be loaded');
  expect(p.c5CompletedTimestamp).toBe(0);
  await p.completeC5RaceInBrowser();
  expect(p.RaceEvent.recordRace).toHaveBeenCalledTimes(1);
});

test('gate-managed C5 lap events never schedule browser max-laps stopping', () => {
  const p = page([snapshot()]);
  Object.assign(p, { maxLaps: 1, announceC5RaceLap: jest.fn(), updateRaceLeader: jest.fn(),
    queueSpeak: jest.fn(), stopRace: jest.fn(), setTimeout: jest.fn() });
  p.handleC5RaceLap({ racer: true, pilot: 0, lap: 0, lapTimeMs: 1000 });
  p.handleC5RaceLap({ racer: true, pilot: 0, lap: 1, lapTimeMs: 10000 });
  expect(p.setTimeout).not.toHaveBeenCalled();
  expect(p.stopRace).not.toHaveBeenCalled();
});

test('Events ignores a repeated saved timestamp before advancing the heat', () => {
  const eventSource = fs.readFileSync(path.join(__dirname, '../data/event.js'), 'utf8');
  const record = new Function('enabled', 'activeGroup', 'doc', `${extract('recordRace', eventSource)}; return recordRace;`)(
    true, () => ({}), { races: [{ timestamp: 42 }] });
  expect(() => record({ timestamp: 42, pilots: [{ slot: 0 }] })).not.toThrow();
});

test('switching from C5 to another receiver preserves browser stopping and saving', async () => {
  const p = page([snapshot()]);
  Object.assign(p, { c5ReceiverSelected: () => false, raceSyncMode: 0, heatTimeoutId: null,
    audioAnnouncer: null, timerInterval: 0, clearInterval: () => {},
    document: { getElementById: () => null }, addLapButton: {},
    hasRaceLaps: () => true, saveCurrentRace: jest.fn(async () => 123),
    updateDistanceDisplay: () => {}, fetch: jest.fn(async () => ({ json: async () => ({ status: 'OK' }) })),
  });
  vm.runInContext(extract('stopRace'), p);
  await p.stopRace();
  expect(p.saveCurrentRace).toHaveBeenCalledTimes(1);
  expect(p.currentRaceSessionTimestamp).toBeNull();
});

test('switching away from C5 retains the browser heat-time limit', async () => {
  const p = page([snapshot()]);
  const classList = { add: jest.fn(), remove: jest.fn() };
  Object.assign(p, { c5ReceiverSelected: () => false, raceSyncMode: 0, raceCountdownMode: 1,
    document: { getElementById: () => null }, updateLapCounter: () => {},
    startRaceButton: { classList }, addLapButton: {},
    c5MultiMode: () => false, c5RacePilotsNow: () => [], beepAudioContext: null,
    audioEnabled: false, audioAnnouncer: null, beep: () => {}, navigator: {},
    startTimer: async () => {}, startDistancePolling: () => {},
    heatTimeoutId: null, maxHeatTime30s: 1,
    fetch: jest.fn(async () => ({})),
    setTimeout: jest.fn((fn, delay) => { if (delay === 10500) fn(); return 1; }),
  });
  vm.runInContext(extract('startRace'), p);
  await p.startRace();
  expect(p.setTimeout).toHaveBeenCalledWith(expect.any(Function), 30000);
});

test('a delayed C5 snapshot cannot overwrite another receiver after switching', async () => {
  const p = page([snapshot()]);
  let respond;
  p.fetch.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
  const pending = p.c5RaceResync();
  p.c5ReceiverSelected = () => false;
  p.raceRunning = true;
  respond({ json: async () => snapshot() });
  await pending;
  expect(p.raceRunning).toBe(true);
  expect(p.currentRaceSessionTimestamp).toBeNull();
});
