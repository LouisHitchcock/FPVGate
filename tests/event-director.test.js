const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../data/event.js'), 'utf8');
const initial = () => ({ version: 3, name: 'Club', nextId: 10, gateRevision: 3,
  pilots: [{ id: 1, name: 'Ann', freq: 5658 }, { id: 2, name: 'Bea', freq: 5695 }],
  groups: [{ id: 3, name: 'A', formatId: 5, pilotIds: [1] }, { id: 4, name: 'B', formatId: 5, pilotIds: [2] }],
  formats: [{ id: 5, name: 'One lap', maxLaps: 1, minLapS: 2, timeLimitS: 30, countdown: 1, win: 'first_to' }],
  active: { groupId: 3, seats: [1], step: 0 }, schedule: { blocks: [{ kind: 'rotate', groupIds: [3, 4], times: 2 }], pos: 0, auto: true }, races: [] });

async function page(gateManaged = true) {
  const handlers = {};
  const host = { innerHTML: '', addEventListener: (type, fn) => { handlers[type] = fn; } };
  const response = (body, status = 200) => ({ ok: status === 200, status,
    text: async () => JSON.stringify(body), json: async () => body });
  let server = initial();
  const context = { console, c5EventManaged: gateManaged, raceRunning: false,
    c5ReceiverSelected: () => true, alert: jest.fn(), confirm: () => true,
    C5UI: { getProfilesForSave: () => [], applyHeat: jest.fn(() => []) },
    setTimeout: jest.fn(() => 1), clearTimeout: jest.fn(),
    document: { getElementById: (id) => id === 'eventPanel' ? host : null, querySelector: () => null },
    renderUnifiedRaceView: jest.fn(),
    updateMaxLaps: jest.fn(), updateMaxHeatTime: jest.fn(), updateMinLap: jest.fn(),
    fetch: jest.fn(async (url, options) => {
      expect(url).toBe('/api/event');
      if (!options) return response(server);
      const body = JSON.parse(options.body);
      if (body.gateRevision !== server.gateRevision) return response({ error: 'Event changed on the gate; reload before editing' }, 409);
      server = { ...body, gateRevision: server.gateRevision + 1 };
      return response({ status: 'OK', revision: server.gateRevision });
    }),
  };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.event = RaceEvent;', context);
  context.event.setEnabled(true);
  await context.event.reload();
  return { ...context, handlers, response, getServer: () => server, setServer: (doc) => { server = doc; } };
}

test('a gate-managed result only refreshes the Event; it never posts a second result', async () => {
  const p = await page();
  p.setServer({ ...initial(), gateRevision: 4, races: [{ id: 10, timestamp: 42, groupId: 3, formatId: 5, results: [] }], active: { groupId: 4, seats: [2], step: 1 } });
  await p.event.recordRace({ timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000, 5000] }] });
  expect(p.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  expect(p.getServer().races).toHaveLength(1);
});

test('heat edits flush before a start and carry the server revision', async () => {
  const p = await page();
  p.event.nextHeat();
  await p.event.flush();
  const posts = p.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body)).toMatchObject({ gateRevision: 3, active: { groupId: 4, step: 1 } });
  expect(p.getServer().gateRevision).toBe(4);
});

test('older firmware retains browser Event result recording', async () => {
  const p = await page(false);
  p.event.recordRace({ timestamp: 42, pilots: [{ slot: 0, frequency: 5658, lapTimes: [1000, 5000] }] });
  await p.event.flush();
  expect(p.getServer().races).toHaveLength(1);
  expect(p.getServer().races[0]).toMatchObject({ timestamp: 42, groupId: 3, results: [{ pilotId: 1, laps: [1000, 5000] }] });
});

test('overlapping local edits serialize writes and use each acknowledged revision', async () => {
  const p = await page();
  let release;
  const originalFetch = p.fetch.getMockImplementation();
  p.fetch.mockImplementationOnce((...args) => new Promise((resolve) => { release = () => originalFetch(...args).then(resolve); }));
  p.event.nextHeat();
  const saving = p.event.flush();
  p.event.nextHeat();
  await release(); await saving;
  const posts = p.fetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts.map(([, options]) => JSON.parse(options.body).gateRevision)).toEqual([3, 4]);
  expect(p.getServer().active.step).toBe(2);
  expect(p.getServer().gateRevision).toBe(5);
});

test('a stale tab preserves its draft and requires explicit reload instead of overwriting gate results', async () => {
  const p = await page();
  const result = { id: 10, timestamp: 42, groupId: 3, formatId: 5, results: [] };
  p.setServer({ ...initial(), gateRevision: 4, races: [result] });
  p.event.nextHeat();
  await expect(p.event.flush()).rejects.toThrow('Event changed');
  const requests = p.fetch.mock.calls.length;
  expect(await p.event.reload()).toBe(false);
  expect(p.fetch).toHaveBeenCalledTimes(requests);
  await expect(p.event.flush()).rejects.toThrow('Reload');
  await p.event.reload({ force: true });
  p.event.nextHeat(); await p.event.flush();
  expect(p.getServer().races).toEqual([result]);
  expect(p.getServer().gateRevision).toBe(5);
});
