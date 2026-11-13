/**
 * Lap announcements in the 2- and 3-lap modes.
 *
 * v1.1.0 removed the variables these modes read (last2lapStr/last3lapStr), so
 * from the first lap after Gate 1 addLap threw: nothing was announced and the
 * max-laps stop after the announcer never ran. Reported on Discord against
 * 1.7.3 and 1.8.4. These run the real addLap and announceC5RaceLap from
 * script.js against stubbed page state.
 */
const fs = require("fs");
const path = require("path");

const english = require("../data/locales/en.json");
function translated(k, p = {}) {
  if (["settings.tts.gate1", "settings.tts.laps_2", "settings.tts.laps_3"].includes(k)) {
    return Object.entries(p).reduce((v, [key, value]) => v.replaceAll(`{${key}}`, value), k.split(".").reduce((v, key) => v[key], english));
  }
  return Object.keys(p).length ? `${k}:${p.n}` : k;
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "data", "script.js"), "utf8");

function extractBody(name) {
  const head = `function ${name}(`;
  const at = SRC.indexOf(head);
  if (at < 0) throw new Error(`function ${name} not found in script.js`);
  let depth = 0;
  for (let j = SRC.indexOf("{", at); j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// A race: addLap with the page state it reads and writes, and what it says.
function race({ mode, maxLaps = 0, pilot = "Ann", sync = 0, format = "full", phonetic = "", extras = {} }) {
  const spoken = [];
  const stops = [];
  const pending = [];
  const stubs = {
    announcerSelect: { selectedIndex: 0, options: [{ value: mode }] },
    pilotNameInput: { value: pilot },
    document: { getElementById: (id) => id === "pphonetic" ? { value: phonetic } : null },
    queueSpeak: (t) => spoken.push(t.replace(/<\/?p>/g, "")),
    beep: () => spoken.push("BEEP"),
    announcerExtras: () => extras,
    i18n: { t: translated },
    resetCurrentLapTimer: () => {},
    renderUnifiedRaceView: () => {},
    updateLapCounter: () => {},
    updateAnalysisSectionVisibility: () => {},
    updateRaceLeader: () => {},
    stopRace: () => { stops.push("stop"); stubs.stopRaceButton.disabled = true; },
    stopRaceButton: { disabled: false },
    setTimeout: (fn, delay) => { expect(delay).toBe(500); pending.push(fn); },
    maxLaps,
    raceSyncMode: sync,
    lapFormat: format,
  };
  const body = `
    let lapNo = -1, lapTimes = [];
    let lastCompletedLapTime = 0, currentLapStartTime = 0, lapTimerStartMs = 0, currentLapDistance = 0;
    ${extractBody("lastLapsTotal")}
    ${extractBody("addLap")}
    return { addLap, laps: () => lapTimes };`;
  const api = new Function(...Object.keys(stubs), body)(...Object.values(stubs));
  return { ...api, spoken, stops, flush: () => pending.splice(0).forEach((fn) => fn()) };
}

test("2-lap mode announces each 2-lap total after Gate 1, without throwing", () => {
  const r = race({ mode: "2lap" });
  for (const t of ["1.50", "10.00", "11.00", "12.50"]) expect(() => r.addLap(t)).not.toThrow();
  expect(r.spoken).toEqual(["Gate 1 1.50", "Ann 2 laps 21.00", "Ann 2 laps 23.50"]);
});

test("3-lap mode announces each 3-lap total, Gate 1 excluded", () => {
  const r = race({ mode: "3lap" });
  for (const t of ["2.00", "10.00", "11.00", "12.00", "9.50"]) r.addLap(t);
  expect(r.spoken).toEqual(["Gate 1 2.00", "Ann 3 laps 33.00", "Ann 3 laps 32.50"]);
});

test("the race still stops at max laps in the 2- and 3-lap modes", () => {
  for (const mode of ["2lap", "3lap"]) {
    const r = race({ mode, maxLaps: 3 });
    for (const t of ["1.00", "10.00", "11.00"]) { r.addLap(t); r.flush(); }
    expect(r.stops).toEqual([]);
    r.addLap("12.00");
    expect(r.stops).toEqual([]);
    r.flush();
    expect(r.stops).toEqual(["stop"]);
    expect(r.spoken).toContain("settings.tts.race_complete");
  }
});

test.each(["none", "", "beep", "1lap", "2lap", "3lap"])("%p stops at one real lap, excluding Gate 1", (mode) => {
  const r = race({ mode, maxLaps: 1 });
  r.addLap("2.00");
  r.flush();
  expect(r.stops).toEqual([]);
  r.addLap("10.00");
  r.flush();
  expect(r.stops).toEqual(["stop"]);
  expect(r.spoken.at(-1)).toBe("settings.tts.race_complete");
});

test.each(["none", "", "beep", "1lap", "2lap", "3lap"])("%p with unlimited laps never auto-stops", (mode) => {
  const r = race({ mode });
  ["1.00", "10.00", "11.00", "12.00", "13.00"].forEach((t) => { r.addLap(t); r.flush(); });
  expect(r.stops).toEqual([]);
  if (mode === "none" || mode === "") expect(r.spoken).toEqual([]);
});

test.each([
  [0, "laptime", "race.lap_counter:1, 10.00"],
  [0, "timeonly", "10.00"],
  [1, "timeonly", "Anna, 10.00"],
  [2, "laptime", "Anna, 10.00"],
  [3, "timeonly", "Anna, 10.00"],
])("every-lap formatting in sync mode %p with %p", (sync, format, expected) => {
  const r = race({ mode: "1lap", sync, format, phonetic: "Anna" });
  r.addLap("1.00");
  r.addLap("10.00");
  expect(r.spoken[1]).toBe(expected);
});

test.each([1, 2])("consecutive announcements include the pilot in sync mode %p", (sync) => {
  const r = race({ mode: "2lap", sync, phonetic: "Anna" });
  ["1.00", "10.00", "11.00"].forEach((t) => r.addLap(t));
  expect(r.spoken).toEqual(["Anna Gate 1 1.00", "Anna 2 laps 21.00"]);
});

test("every-lap and beep modes are unchanged", () => {
  const r = race({ mode: "1lap" });
  ["1.00", "10.00"].forEach((t) => r.addLap(t));
  expect(r.spoken).toEqual(["Gate 1 1.00", "Ann, 10.00"]);
  const b = race({ mode: "beep" });
  ["1.00", "10.00"].forEach((t) => b.addLap(t));
  expect(b.spoken).toEqual(["BEEP", "BEEP"]);
});

function c5RaceSandbox(mode, maxLaps = 0, gateManaged = false, extras = {}) {
  const spoken = [];
  const stops = [];
  const pending = [];
  const racers = [{ slot: 3, spoken: "Bea" }, { slot: 5, spoken: "Cal" }];
  const state = { active: true, racers, laps: {}, finished: {} };
  const stubs = {
    announcerSelect: { selectedIndex: 0, options: [{ value: mode }] },
    c5Race: state,
    c5GateManaged: gateManaged,
    queueSpeak: (t) => spoken.push(t.replace(/<\/?p>/g, "")),
    beep: () => spoken.push("BEEP"),
    announcerExtras: () => extras,
    i18n: { t: translated },
    renderUnifiedRaceView: () => {},
    updateAnalysisSectionVisibility: () => {},
    updateRaceLeader: () => {},
    c5RaceResync: () => { throw new Error("Unexpected resync"); },
    maxLaps,
    stopRaceButton: { disabled: false },
    stopRace: () => { stops.push("stop"); stubs.stopRaceButton.disabled = true; },
    setTimeout: (fn, delay) => { expect(delay).toBe(500); pending.push(fn); },
  };
  const api = new Function(...Object.keys(stubs),
    `${["lastLapsTotal", "announceC5RaceLap", "handleC5RaceLap"].map(extractBody).join("\n")}
     return { announceC5RaceLap, handleC5RaceLap };`)(...Object.values(stubs));
  return { ...api, state, spoken, stops,
    pass: (slot, idx, seconds) => api.handleC5RaceLap({ racer: true, pilot: slot, lap: idx, lapTimeMs: seconds * 1000 }),
    flush: () => pending.splice(0).forEach((fn) => fn()),
  };
}

test.each([
  ["2lap", ["Bea 2 laps 21.00", "Cal 2 laps 41.00", "Bea 2 laps 23.00"]],
  ["3lap", ["Bea 3 laps 33.00"]],
])("C5 %p rolling totals stay separate for interleaved pilots", (mode, totals) => {
  const r = c5RaceSandbox(mode);
  r.pass(3, 0, 1.2);
  r.pass(5, 0, 2.5);
  r.pass(3, 1, 10);
  r.pass(5, 1, 20);
  r.pass(3, 2, 11);
  r.pass(5, 2, 21);
  r.pass(3, 3, 12);
  expect(r.spoken).toEqual(["Bea Gate 1 1.20", "Cal Gate 1 2.50", ...totals]);
  r.flush();
  expect(r.stops).toEqual([]);
});

test.each(["none", "", "beep", "1lap", "2lap", "3lap"])("C5 %p stops only after every pilot reaches max laps", (mode) => {
  const r = c5RaceSandbox(mode, 3);
  for (let idx = 0; idx < 3; idx++) {
    r.pass(3, idx, 10);
    r.pass(5, idx, 20);
    r.flush();
    expect(r.stops).toEqual([]);
    expect(r.state.finished).toEqual({});
  }
  r.pass(3, 3, 10);
  r.flush();
  expect(r.stops).toEqual([]);
  expect(r.state.finished).toEqual({ 3: true });
  r.pass(5, 3, 20);
  expect(r.stops).toEqual([]);
  r.flush();
  expect(r.stops).toEqual(["stop"]);
  expect(r.spoken.at(-1)).toBe("settings.tts.race_complete");
});

test.each([
  ["1lap", ["Bea Gate 1 1.20", "Bea, 10.00"]],
  ["beep", ["BEEP", "BEEP"]],
  ["none", []],
  ["", []],
])("C5 %p announcements", (mode, expected) => {
  const r = c5RaceSandbox(mode);
  r.pass(3, 0, 1.2);
  r.pass(3, 1, 10);
  expect(r.spoken).toEqual(expected);
});

test.each(["none", "", "beep", "1lap", "2lap", "3lap"])("gate-managed C5 %p announces without scheduling a browser stop", (mode) => {
  const r = c5RaceSandbox(mode, 3, true);
  for (let idx = 0; idx <= 3; idx++) {
    r.pass(3, idx, idx ? 10 : 1);
    r.pass(5, idx, idx ? 20 : 2);
  }
  r.flush();
  expect(r.state.finished).toEqual({ 3: true, 5: true });
  expect(r.stops).toEqual([]);
  if (mode === '2lap') expect(r.spoken).toContain('Bea 2 laps 20.00');
  if (mode === '3lap') expect(r.spoken).toContain('Cal 3 laps 60.00');
});

test("C5 replayed announcements only use laps up to the event index", () => {
  const r = c5RaceSandbox("2lap");
  r.state.laps[3] = [1, 10, 11, 12, 13];
  r.announceC5RaceLap(r.state.racers[0], 2, 11);
  expect(r.spoken).toEqual(["Bea 2 laps 21.00"]);
});

// spova, Discord 24 October: a beep on every lap with the consecutive modes,
// and the lap time spoken with the 2- or 3-lap total.
test("beep every lap adds a beep to each lap without changing what is spoken", () => {
  const r = race({ mode: "3lap", extras: { beepEveryLap: true } });
  ["1.00", "10.00", "11.00", "12.00"].forEach((t) => r.addLap(t));
  expect(r.spoken).toEqual(["BEEP", "Gate 1 1.00", "BEEP", "BEEP", "BEEP", "Ann 3 laps 33.00"]);
});

test("beep every lap does not double the beep in beep mode", () => {
  const r = race({ mode: "beep", extras: { beepEveryLap: true } });
  ["1.00", "10.00"].forEach((t) => r.addLap(t));
  expect(r.spoken).toEqual(["BEEP", "BEEP"]);
});

test("say lap time too speaks the lap time before the total, and on its own until there is one", () => {
  const r = race({ mode: "2lap", extras: { withLapTime: true } });
  ["1.00", "10.00", "11.00"].forEach((t) => r.addLap(t));
  expect(r.spoken).toEqual(["Gate 1 1.00", "Ann 10.00", "Ann 11.00, 2 laps 21.00"]);
});

test("both extras together", () => {
  const r = race({ mode: "3lap", extras: { beepEveryLap: true, withLapTime: true } });
  ["1.00", "10.00", "11.00", "12.00"].forEach((t) => r.addLap(t));
  expect(r.spoken.slice(-2)).toEqual(["BEEP", "Ann 12.00, 3 laps 33.00"]);
});

test("extras off leave every mode exactly as before", () => {
  const r = race({ mode: "2lap", extras: { beepEveryLap: false, withLapTime: false } });
  ["1.00", "10.00", "11.00"].forEach((t) => r.addLap(t));
  expect(r.spoken).toEqual(["Gate 1 1.00", "Ann 2 laps 21.00"]);
});

test("C5 pilots get the same extras", () => {
  const r = c5RaceSandbox("3lap", 0, false, { beepEveryLap: true, withLapTime: true });
  r.state.laps[3] = [1, 10, 11, 12];
  r.announceC5RaceLap(r.state.racers[0], 3, 12);
  expect(r.spoken).toEqual(["BEEP", "Bea 12.00, 3 laps 33.00"]);
  r.spoken.length = 0;
  r.announceC5RaceLap(r.state.racers[0], 1, 10);
  expect(r.spoken).toEqual(["BEEP", "Bea 10.00"]);
});

test.each(["1lap", "2lap", "3lap"])("%s Gate 1 beep keeps later lap calls", (mode) => {
  for (const beepEveryLap of [false, true]) {
    const r = race({ mode, extras: { gate1Beep: true, beepEveryLap } });
    r.addLap("1.00");
    expect(r.spoken).toEqual(["BEEP"]);
    ["10.00", "11.00", "12.00"].forEach(t => r.addLap(t));
    expect(r.spoken.some(t => t.includes("33.00") || t.includes("23.00") || t.includes("12.00"))).toBe(true);
    expect(r.laps()).toEqual([1, 10, 11, 12]);
    const c = c5RaceSandbox(mode, 0, true, { gate1Beep: true, beepEveryLap });
    c.pass(3, 0, 1);
    c.pass(5, 0, 2);
    expect(c.spoken).toEqual(["BEEP", "BEEP"]);
    [10, 11, 12].forEach((t, i) => c.pass(3, i + 1, t));
    expect(c.spoken.some(t => t.includes("33.00") || t.includes("23.00") || t.includes("12.00"))).toBe(true);
  }
});
test.each(["none", "", "beep"])("Gate 1 override preserves %s mode", (mode) => {
  const r = race({ mode, extras: { gate1Beep: true } });
  r.addLap("1.00");
  const c = c5RaceSandbox(mode, 0, true, { gate1Beep: true });
  c.pass(3, 0, 1);
  expect(r.spoken).toEqual(mode === "beep" ? ["BEEP"] : []);
  expect(c.spoken).toEqual(r.spoken);
});
