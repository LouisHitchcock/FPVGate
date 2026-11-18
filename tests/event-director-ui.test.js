const fs = require('fs');
const path = require('path');
const vm = require('vm');
const uiSource = fs.readFileSync(path.join(__dirname, '../data/event-director-ui.js'), 'utf8');
const eventSource = fs.readFileSync(path.join(__dirname, '../data/event.js'), 'utf8');
const initial = () => ({ version: 3, name: 'Club', nextId: 10, gateRevision: 3,
  pilots: [{ id: 1, name: 'Ann', freq: 5658, enter: 120, exit: 100 }, { id: 2, name: 'Bea', freq: 5732, enter: 120, exit: 100 }],
  groups: [{ id: 3, name: 'Group A', formatId: 5, pilotIds: [1] }, { id: 4, name: 'Group B', formatId: 5, pilotIds: [2] }],
  formats: [{ id: 5, name: 'One lap', maxLaps: 1, minLapS: 2, timeLimitS: 30, countdown: 1, win: 'first_to' }],
  active: { groupId: 3, seats: [1], step: 0 }, schedule: { blocks: [{ kind: 'rotate', groupIds: [3, 4], times: 2 }], pos: 0, auto: true }, races: [] });

async function page(server = initial(), preference) {
  document.body.innerHTML = '<div id="eventDirectorPreferences"></div><div id="eventPanel"></div><div id="eventRaceBanner"></div><button id="nextHeatButton"></button>';
  localStorage.clear();
  if (preference) localStorage.setItem('fpvgate.eventDirector.ui.v1', preference);
  const response = (body, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(body), json: async () => body });
  let history = { races: [] };
  const context = { document, localStorage, console: { error: jest.fn() }, c5EventManaged: true, raceRunning: false,
    setTimeout, clearTimeout, alert: jest.fn(), confirm: jest.fn(() => true), c5ReceiverSelected: () => true,
    C5UI: { getProfilesForSave: () => [], applyHeat: jest.fn(() => []) },
    bandDefinitions: [{ value: 'R', label: 'Raceband', system: 'analog', index: 0 }], freqLookup: [[5658,5695,5732,5769,5806,5843,5880,5917]],
    renderUnifiedRaceView: jest.fn(), updateMaxLaps: jest.fn(), updateMaxHeatTime: jest.fn(), updateMinLap: jest.fn(),
    fetch: jest.fn(async (url, options) => {
      if (url.startsWith('/races/downloadOne')) return response(history);
      if (!options) return response(server);
      const body = JSON.parse(options.body);
      if (body.gateRevision !== server.gateRevision) return response({ error: 'Event changed on the gate' }, 409);
      server = { ...body, gateRevision: server.gateRevision + 1 };
      return response({ revision: server.gateRevision });
    }),
  };
  vm.createContext(context);
  vm.runInContext(`${uiSource}\n${eventSource}\nglobalThis.event = RaceEvent;`, context);
  context.event.setEnabled(true); await context.event.reload();
  return { ...context, getServer: () => server, setServer: value => { server = value; }, setHistory: value => { history = value; } };
}
function click(selector) { const el = document.querySelector(selector); expect(el).not.toBeNull(); el.click(); }
function change(selector, value) {
  const el = document.querySelector(selector); expect(el).not.toBeNull();
  if (el.type === 'checkbox') el.checked = value; else el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true })); jest.advanceTimersByTime(0);
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('presets and individual display toggles never write shared race workflow', async () => {
  const p = await page();
  change('[data-ev-pref="preset"]', 'club');
  expect(document.querySelector('.ev-layout-dashboard')).not.toBeNull();
  change('[data-ev-pref="schedule"]', false);
  expect(document.querySelector('.ev-director-schedule')).toBeNull();
  expect(document.querySelector('[data-ev-pref="preset"]').value).toBe('custom');
  expect(p.fetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
  expect(p.getServer().schedule.auto).toBe(true);
  expect(p.getServer().schedule.requireReview).toBeUndefined();
});

test('a schedule click previews without retuning the gate; Prepare loads explicitly', async () => {
  const p = await page();
  click('[data-ui-act="select-race"][data-ui-step="1"]');
  expect(p.C5UI.applyHeat).not.toHaveBeenCalled();
  expect(document.querySelector('.ev-director-current h3').textContent).toBe('Round 1 · Group B');
  click('[data-ui-act="prepare"]'); await p.event.flush();
  expect(p.C5UI.applyHeat).toHaveBeenCalledTimes(1);
  expect(p.getServer().active).toMatchObject({ groupId: 4, step: 1 });
});

test('the original full-page layout restores the editor without changing event workflow', async () => {
  const p = await page();
  change('[data-ev-pref="layout"]', 'full-page');
  expect(document.querySelector('.ev-full-page .ev-side [data-coll="pilots"]')).not.toBeNull();
  expect(document.querySelector('.ev-full-page [data-coll="groups"]')).not.toBeNull();
  expect(document.querySelector('.ev-formats')).not.toBeNull();
  expect(document.querySelector('.ev-director-tabs')).toBeNull();
  expect(document.querySelector('.c5p-headctl').style.display).toBe('');
  expect(p.fetch.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem('fpvgate.eventDirector.ui.v1')).layout).toBe('full-page');
  click('.ev-full-page [data-step="1"]'); await p.event.flush();
  expect(p.getServer().active).toMatchObject({ groupId: 4, step: 1 });
  change('[data-ev-pref="layout"]', 'auto');
  expect(document.querySelector('.ev-director-tabs')).not.toBeNull();
  expect(document.querySelector('.ev-full-page')).toBeNull();
  expect(p.getServer().pilots).toHaveLength(2);
});

test('full-page preference survives reload and keeps pending review visible', async () => {
  const p = await page(withReview(), JSON.stringify({ layout: 'full-page' }));
  expect(document.querySelector('[data-ev-pref="layout"]').value).toBe('full-page');
  expect(document.querySelector('.ev-review')).not.toBeNull();
  click('.ev-full-page [data-step="1"]');
  expect(p.C5UI.applyHeat).not.toHaveBeenCalled();
  expect(p.event.pendingReview()).toBe(true);
});

test('shared workflow switches persist independently of browser preferences', async () => {
  const p = await page(); click('[data-ui-act="setup"]');
  click('[data-ui-act="wizard-step"][data-ui-index="1"]');
  change('[data-f="requireReview"]', true); change('[data-f="autoChannels"]', false);
  await p.event.flush();
  expect(p.getServer().schedule).toMatchObject({ requireReview: true, autoChannels: false, auto: true });
  expect(JSON.parse(localStorage.getItem('fpvgate.eventDirector.ui.v1') || '{}').requireReview).toBeUndefined();
});

test('guided setup adds a roster and previews the generated schedule', async () => {
  const empty = { ...initial(), pilots: [], groups: [], active: null, schedule: { blocks: [], pos: 0, auto: true, requireReview: true }, races: [] };
  const p = await page(empty);
  document.querySelector('#evBulkPilots').value = 'Alex\nJamie\nSam'; click('[data-ui-act="bulk-pilots"]');
  click('[data-ui-act="wizard-step"][data-ui-index="2"]');
  change('[data-ui-rounds]', 2); click('[data-ui-act="build-schedule"]'); await p.event.flush();
  expect(p.getServer().pilots.map(p => p.name)).toEqual(['Alex', 'Jamie', 'Sam']);
  expect(p.getServer().groups).toHaveLength(1);
  expect(p.getServer().schedule.blocks[0].times).toBe(2);
  expect(p.getServer().schedule.requireReview).toBe(true);
  expect(new Set(p.getServer().pilots.map(p => p.freq)).size).toBe(3);
});

const withReview = () => {
  const d = initial();
  d.races = [{ id: 10, timestamp: 42, step: 0, groupId: 3, formatId: 5, results: [{ pilotId: 1, slot: 0, freq: 5658, laps: [1000, 5000] }] }];
  d.nextId = 11; Object.assign(d.schedule, { requireReview: true, reviewRaceId: 10, pos: 1 }); return d;
};
test('pending results stay visible when schedule, guidance and standings are hidden', async () => {
  const p = await page(withReview());
  change('[data-ev-pref="schedule"]', false); change('[data-ev-pref="prompts"]', false); change('[data-ev-pref="standings"]', false);
  expect(document.querySelector('.ev-review')).not.toBeNull();
  expect(document.querySelector('#nextHeatButton').disabled).toBe(true);
  p.event.nextHeat(); expect(p.C5UI.applyHeat).not.toHaveBeenCalled();
  expect(p.event.pendingReview()).toBe(true);
});

test('confirmation checks saved laps, acknowledges once and prepares the next group', async () => {
  const p = await page(withReview());
  p.setHistory({ races: [{ timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000,5000] }] }] });
  await Promise.all([p.event.confirmResults(), p.event.confirmResults()]); await p.event.flush();
  expect(p.getServer().schedule.reviewRaceId).toBeNull();
  expect(p.getServer().active).toMatchObject({ groupId: 4, step: 1 });
  expect(p.getServer().races).toHaveLength(1);
  expect(p.C5UI.applyHeat).toHaveBeenCalledTimes(1);
});

test('Marshal corrections are shown for review before confirmation is accepted', async () => {
  const p = await page(withReview());
  p.setHistory({ races: [{ timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000,4500] }] }] });
  await p.event.confirmResults();
  expect(p.getServer().races[0].results[0].laps).toEqual([1000,4500]);
  expect(p.getServer().schedule.reviewRaceId).toBe(10);
  expect(document.querySelector('.ev-review').textContent).toContain('4.50s');
  await p.event.confirmResults(); expect(p.getServer().schedule.reviewRaceId).toBeNull();
});

test('missing saved history and stale tabs cannot confirm or advance a heat', async () => {
  const p = await page(withReview());
  await p.event.confirmResults(); expect(p.event.pendingReview()).toBe(true);
  p.setHistory({ races: [{ timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000,5000] }] }] });
  p.setServer({ ...withReview(), gateRevision: 4 });
  await p.event.confirmResults();
  expect(p.event.pendingReview()).toBe(true);
  expect(p.getServer().active.groupId).toBe(3);
  expect(p.C5UI.applyHeat).not.toHaveBeenCalled();
});

test('manual progression presents the next group without silently preparing it', async () => {
  const d = withReview(); d.schedule.auto = false;
  const p = await page(d); p.setHistory({ races: [{ timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000,5000] }] }] });
  click('[data-ui-act="select-race"][data-ui-step="0"]');
  await p.event.confirmResults();
  expect(p.C5UI.applyHeat).not.toHaveBeenCalled();
  expect(document.querySelector('.ev-director-current h3').textContent).toBe('Round 1 · Group B');
  expect(document.querySelector('[data-ui-act="prepare"]')).not.toBeNull();
});

test('gate-side progression moves the dashboard away from the previously selected heat', async () => {
  const p = await page();
  click('[data-ui-act="select-race"][data-ui-step="0"]');
  const advanced = initial(); advanced.active = { groupId: 4, seats: [2], step: 1 }; advanced.schedule.pos = 1;
  p.setServer(advanced); await p.event.reload();
  expect(document.querySelector('.ev-director-current h3').textContent).toBe('Round 1 · Group B');
});

test('channel clashes stay visible with explanations disabled', async () => {
  const d = initial(); d.groups[0].pilotIds = [1,2]; d.pilots[1].freq = 5658;
  await page(d); change('[data-ev-pref="prompts"]', false);
  expect(document.querySelector('[role="alert"]').textContent).toContain('Ann and Bea share R1');
});

test('invalid stored preferences fall back to a usable guided layout', async () => {
  await page(initial(), '{broken');
  expect(document.querySelector('.ev-layout-auto')).not.toBeNull();
  expect(document.querySelector('[data-ev-pref="preset"]').value).toBe('guided');
});

test('a temporary storage lease conflict retries without declaring the tab stale', async () => {
  const p = await page(withReview());
  p.setHistory({ races: [{ timestamp: 42, pilots: [{ slot: 0, lapTimes: [1000,5000] }] }] });
  const actual = p.fetch.getMockImplementation(); let refused = false;
  p.fetch.mockImplementation(async (url, options) => {
    if (options?.method === 'POST' && !refused) {
      refused = true;
      return { ok: false, status: 409, json: async () => ({ error: 'event busy or race not saved; retry after Stop' }) };
    }
    return actual(url, options);
  });
  const confirming = p.event.confirmResults();
  await jest.runAllTimersAsync(); await confirming; await p.event.flush();
  expect(refused).toBe(true);
  expect(p.getServer().schedule.reviewRaceId).toBeNull();
  expect(p.getServer().active.groupId).toBe(4);
});
