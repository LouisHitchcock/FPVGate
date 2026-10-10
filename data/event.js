// Race director: an event's pilots, groups, race formats, heats and results,
// kept on the gate as one JSON document (GET/POST /api/event) and shown when
// Event mode is on (Settings > System).
//
// Groups are sets of pilots (Group A, B, C…). Heats are the races in order,
// each run by one group, built in the heat order editor ("Group A ×3",
// "Rotate A, B, C ×4"). Loading a heat puts its group's pilots into the
// ESP32-C5 slots in order, tuned to their channels (or the group's
// override), and makes the group's format the race settings. A race saved
// while a heat is loaded is recorded as that heat's result, and with auto on
// the next heat loads itself.
//
// Each pilot keeps a channel and Enter/Exit levels for the day.
// Lap arrays are milliseconds with [0] = Gate 1, as in race history.

const RaceEvent = (() => {
  const SLOTS = 8;
  const SAVE_DELAY_MS = 600;
  const MIN_MHZ = 5180, MAX_MHZ = 5917;
  const COLORS = ["#ff6b6b", "#f7b32b", "#06d6a0", "#4cc9f0", "#a78bfa", "#f78c6b", "#7bd389", "#f472b6"];
  const WIN = {
    most_laps: "Most laps, fastest time",
    first_to: "First to the lap limit",
    fastest_lap: "Fastest lap",
    fastest_consecutive: "Fastest 3 consecutive laps",
  };
  const CONSECUTIVE = 3;
  const SEEDS = { roster: "Roster order", random: "Random", elo: "Elo rating", best3: "Best 3 consecutive", best: "Fastest lap" };
  const ELO_START = 1500, ELO_K = 32;
  const IMD_MHZ = 15;   // a 2f1 - f2 product this close to a channel in use counts against a set

  let doc = null;
  let enabled = false;
  let started = false;
  let saveTimer = null;
  let saveState = "";
  let loadError = "";
  let damaged = false;   // the gate has an event file that isn't valid JSON
  let note = "";         // one-line message under the status strip

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const byId = (list, id) => list.find(x => x.id === id);
  const fmtMs = ms => ms == null ? "–" : (ms / 1000).toFixed(2) + "s";
  const inRange = f => f >= MIN_MHZ && f <= MAX_MHZ;
  const letter = i => String.fromCharCode(65 + (i % 26));

  function blank() {
    return {
      version: 3, name: "", nextId: 2, pilots: [], groups: [], races: [], active: null,
      seed: "roster", groupSize: 4, band: "R",
      formats: [{ id: 1, name: "3 laps", maxLaps: 3, timeLimitS: 0, minLapS: 3, countdown: 1, win: "first_to" }],
      schedule: { blocks: [], pos: 0, auto: true },
    };
  }

  // Version 1 kept heats as 8 slots with results inside; version 2 called
  // groups "heats". Both are brought up to version 3.
  function migrate(d) {
    if (!d || !Array.isArray(d.pilots)) return blank();
    if ((d.version || 1) >= 3) return Object.assign(blank(), d);
    let v2 = d;
    if ((d.version || 1) < 2) {
      v2 = { name: d.name || "", nextId: d.nextId || 2, formats: d.formats?.length ? d.formats : blank().formats,
             pilots: d.pilots.map(p => ({ ...p, freq: 0, enter: 0, exit: 0 })), heats: [], races: [] };
      for (const h of d.heats || []) {
        v2.heats.push({ id: h.id, name: h.name, formatId: h.formatId, pilotIds: (h.slots || []).filter(x => x != null), overrides: {} });
        for (const r of h.rounds || []) {
          v2.races.push({ id: v2.nextId++, heatId: h.id, timestamp: r.timestamp, formatId: r.formatId,
                          results: (r.results || []).map(x => ({ pilotId: x.pilotId, slot: x.slot, freq: 0, laps: x.laps })) });
        }
      }
    }
    const out = blank();
    Object.assign(out, {
      name: v2.name || "", nextId: v2.nextId || 2, pilots: v2.pilots || [], band: v2.band || "R", seed: v2.seed || "roster",
      groupSize: v2.heatSize || 4, formats: v2.formats?.length ? v2.formats : out.formats,
      groups: (v2.heats || []).map(h => ({ id: h.id, name: String(h.name || "").replace(/^Heat\b/, "Group"), formatId: h.formatId,
                                           pilotIds: h.pilotIds || [], overrides: h.overrides || {} })),
      races: (v2.races || []).map(r => ({ id: r.id, groupId: r.heatId, step: null, timestamp: r.timestamp, formatId: r.formatId, results: r.results })),
      schedule: { pos: v2.schedule?.pos || 0, auto: v2.schedule?.auto !== false,
                  blocks: (v2.schedule?.blocks || []).map(b => ({ id: b.id, kind: b.kind, groupIds: b.heatIds || [], times: b.times })) },
    });
    return out;
  }

  const newId = () => doc.nextId++;
  // Group A, B, C… unless the event already numbers its groups.
  const groupName = i => doc.groups.some(g => /^Group \d+$/.test(g.name)) ? `Group ${i + 1}` : `Group ${letter(i)}`;
  const shortName = g => {
    if (!g) return "?";
    const m = /^group\s+(.+)$/i.exec(g.name || "");
    return m ? m[1] : g.name || "?";
  };

  // ---- storage --------------------------------------------------------------------------

  async function load() {
    damaged = false;
    try {
      const r = await fetch("/api/event");
      if (r.status === 404) {
        doc = blank();
      } else if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      } else {
        const text = await r.text();
        try {
          doc = migrate(JSON.parse(text));
        } catch (e) {
          damaged = true;
          throw e;
        }
      }
      loadError = "";
    } catch (e) {
      console.error("[Event] load failed", e);
      loadError = damaged
        ? "The event saved on FPVGate is damaged and can't be read. Download it to keep a copy, then start a new event."
        : "Couldn't load the event from FPVGate. Changes won't be saved until it loads.";
      doc = null;
    }
    render();
  }

  function save() {
    if (!doc) return;
    setSaveState("pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const r = await fetch("/api/event", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setSaveState("saved");
      } catch (e) {
        console.error("[Event] save failed", e);
        setSaveState("error");
      }
    }, SAVE_DELAY_MS);
  }

  function setSaveState(s) {
    saveState = s;
    const el = $("#evSave");
    if (el) {
      el.textContent = { pending: "Unsaved changes…", saving: "Saving…", saved: "Saved ✓", error: "Save failed" }[s] || "";
      el.className = "c5p-save" + (s ? " c5p-save-" + s : "");
    }
  }

  // ---- results and ratings ------------------------------------------------------------------

  function bestLap(laps) {
    const valid = laps.slice(1);
    return valid.length ? Math.min(...valid) : null;
  }

  function bestConsecutive(laps, n) {
    const valid = laps.slice(1);
    if (valid.length < n) return null;
    let sum = valid.slice(0, n).reduce((s, t) => s + t, 0), best = sum;
    for (let i = n; i < valid.length; i++) {
      sum += valid[i] - valid[i - n];
      best = Math.min(best, sum);
    }
    return best;
  }

  function row(pilotId, laps, format) {
    const lapCount = Math.max(0, laps.length - 1);
    const target = format && format.maxLaps > 0 ? format.maxLaps : 0;
    return {
      pilotId, laps, lapCount,
      total: laps.reduce((s, t) => s + t, 0),
      toTarget: target && lapCount >= target ? laps.slice(0, target + 1).reduce((s, t) => s + t, 0) : null,
      best: bestLap(laps),
      best3: bestConsecutive(laps, CONSECUTIVE),
    };
  }

  // Missing values sort last.
  const asc = (a, b) => a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b;
  const byLaps = (a, b) => b.lapCount - a.lapCount || a.total - b.total;

  function compare(win) {
    switch (win) {
      case "first_to": return (a, b) => asc(a.toTarget, b.toTarget) || byLaps(a, b);
      case "fastest_lap": return (a, b) => asc(a.best, b.best) || byLaps(a, b);
      case "fastest_consecutive": return (a, b) => asc(a.best3, b.best3) || byLaps(a, b);
      default: return byLaps;
    }
  }

  function resultText(r, win) {
    switch (win) {
      case "first_to": return r.toTarget != null ? fmtMs(r.toTarget) : `${r.lapCount} laps`;
      case "fastest_lap": return fmtMs(r.best);
      case "fastest_consecutive": return fmtMs(r.best3);
      default: return `${r.lapCount} laps, ${fmtMs(r.total)}`;
    }
  }

  const formatById = id => byId(doc.formats, id) || doc.formats[0] || blank().formats[0];
  const formatOf = group => formatById(group.formatId);
  const pilotName = id => byId(doc.pilots, id)?.name || "?";

  function raceStandings(race) {
    const format = formatById(race.formatId);
    return race.results.map(x => row(x.pilotId, x.laps, format)).sort(compare(format.win));
  }

  const racesOf = group => doc.races.filter(r => r.groupId === group.id);
  // The latest race run as heat `step`.
  const raceOfStep = step => doc.races.filter(r => r.step === step).pop() || null;

  // A group's standings: each pilot's best race by the group's win condition.
  function groupStandings(group) {
    const format = formatOf(group), cmp = compare(format.win);
    const best = new Map();
    for (const race of racesOf(group)) {
      for (const r of race.results.map(x => row(x.pilotId, x.laps, format))) {
        const prev = best.get(r.pilotId);
        if (!prev || cmp(r, prev) < 0) best.set(r.pilotId, r);
      }
    }
    return [...best.values()].sort(cmp);
  }

  // Elo from every race in order: each pair of pilots in a race is a game,
  // won by the one placed higher, scaled so a race counts once per pilot.
  // lastChange: each pilot's rating change from their latest race.
  const lastChange = new Map();
  function eloRatings() {
    const rating = new Map(doc.pilots.map(p => [p.id, ELO_START]));
    lastChange.clear();
    const races = [...doc.races].sort((a, b) => a.timestamp - b.timestamp);
    for (const race of races) {
      const order = raceStandings(race).map(r => r.pilotId).filter(id => rating.has(id));
      if (order.length < 2) continue;
      const delta = new Map(order.map(id => [id, 0]));
      for (let i = 0; i < order.length; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const a = order[i], b = order[j];
          const expectA = 1 / (1 + 10 ** ((rating.get(b) - rating.get(a)) / 400));
          const change = ELO_K * (1 - expectA) / (order.length - 1);
          delta.set(a, delta.get(a) + change);
          delta.set(b, delta.get(b) - change);
        }
      }
      delta.forEach((d, id) => {
        rating.set(id, rating.get(id) + d);
        lastChange.set(id, d);
      });
    }
    return rating;
  }

  function pilotStats() {
    const stats = new Map(doc.pilots.map(p => [p.id, { pilotId: p.id, races: 0, lapCount: 0, best: null, best3: null, elo: ELO_START }]));
    for (const race of doc.races) {
      for (const x of race.results) {
        const t = stats.get(x.pilotId);
        if (!t) continue;
        const r = row(x.pilotId, x.laps, null);
        t.races++;
        t.lapCount += r.lapCount;
        if (r.best != null && (t.best == null || r.best < t.best)) t.best = r.best;
        if (r.best3 != null && (t.best3 == null || r.best3 < t.best3)) t.best3 = r.best3;
      }
    }
    eloRatings().forEach((elo, id) => { if (stats.has(id)) stats.get(id).elo = elo; });
    return stats;
  }

  // ---- channels ------------------------------------------------------------------------------

  // The analog bands, each with the channels the C5 can tune.
  function bands() {
    if (typeof bandDefinitions === "undefined" || typeof freqLookup === "undefined") return [];
    return bandDefinitions.filter(b => b.system === "analog")
      .map(b => ({ value: b.value, label: b.label, freqs: (freqLookup[b.index] || []).filter(inRange), all: freqLookup[b.index] || [] }))
      .filter(b => b.freqs.length);
  }

  // A channel's name, in the event's band where it has one: 5880 MHz is F8
  // in a Fatshark event and R7 in a Raceband one.
  function chName(freq) {
    if (!freq) return "–";
    const all = bands(), preferred = all.find(b => b.value === (doc && doc.band));
    for (const b of preferred ? [preferred, ...all] : all) {
      const i = b.all.indexOf(freq);
      if (i >= 0) return b.value + (i + 1);
    }
    return String(freq);
  }

  function channelOptions(selected) {
    let html = `<option value="0"${selected ? "" : " selected"}>–</option>`;
    let found = !selected;
    const all = bands();
    // The event's band first, so its name is the one selected for a shared frequency.
    for (const b of all.filter(x => x.value === doc.band).concat(all.filter(x => x.value !== doc.band))) {
      html += `<optgroup label="${esc(b.label)}">`;
      b.all.forEach((f, i) => {
        if (!inRange(f)) return;
        const sel = f === selected && !found;
        if (sel) found = true;
        html += `<option value="${f}"${sel ? " selected" : ""}>${b.value}${i + 1} · ${f}</option>`;
      });
      html += "</optgroup>";
    }
    if (!found) html += `<option value="${selected}" selected>${selected} MHz</option>`;
    return html;
  }

  // The best `count` channels of one band: fewest third-order
  // intermodulation products (2f1 - f2) landing near a channel in use, then
  // the widest smallest gap between neighbours. Null if the band is too small.
  const setCache = new Map();
  function bandSet(bandValue, count) {
    const key = bandValue + count;
    if (setCache.has(key)) return setCache.get(key);
    const band = bands().find(b => b.value === bandValue);
    const freqs = band ? band.freqs.slice().sort((a, b) => a - b) : [];
    let best = null;
    const score = set => {
      let imd = 0;
      for (const a of set) for (const b of set) {
        if (a === b) continue;
        const p = 2 * a - b;
        if (set.some(f => Math.abs(f - p) < IMD_MHZ)) imd++;
      }
      let gap = Infinity;
      for (let i = 1; i < set.length; i++) gap = Math.min(gap, set[i] - set[i - 1]);
      return { imd, gap };
    };
    const pick = (start, chosen) => {
      if (chosen.length === count) {
        const s = score(chosen);
        if (!best || s.imd < best.s.imd || (s.imd === best.s.imd && s.gap > best.s.gap)) best = { set: chosen.slice(), s };
        return;
      }
      for (let i = start; i <= freqs.length - (count - chosen.length); i++) {
        chosen.push(freqs[i]);
        pick(i + 1, chosen);
        chosen.pop();
      }
    };
    if (count > 0 && freqs.length >= count) pick(0, []);
    const set = best ? best.set : null;
    setCache.set(key, set);
    return set;
  }

  const seatFreq = (group, pid) => group.overrides?.[pid] || byId(doc.pilots, pid)?.freq || 0;

  // The group's channels that more than one of its pilots is on.
  function clashes(group) {
    const seen = new Map();
    group.pilotIds.forEach(pid => {
      const f = seatFreq(group, pid);
      if (f) seen.set(f, (seen.get(f) || 0) + 1);
    });
    return new Set([...seen].filter(([, n]) => n > 1).map(([f]) => f));
  }

  // Give every pilot a channel for the day from the event's band, spread for
  // their group's size, keeping channels they already have where they fit. A
  // pilot in two groups keeps their first group's channel; where it clashes
  // in a later group that group gets an override. Returns the groups too big
  // for the band.
  function assignChannels() {
    const assigned = new Map(), tooBig = [];
    for (const group of doc.groups) {
      const ids = group.pilotIds.slice(0, SLOTS);
      if (!ids.length) continue;
      const set = bandSet(doc.band, ids.length);
      if (!set) {
        tooBig.push(group);
        continue;
      }
      const used = new Set(), pick = new Map();
      for (const pid of ids) {
        const f = assigned.get(pid) ?? byId(doc.pilots, pid)?.freq;
        if (set.includes(f) && !used.has(f)) { pick.set(pid, f); used.add(f); }
      }
      for (const pid of ids) {
        if (pick.has(pid)) continue;
        const f = set.find(x => !used.has(x));
        pick.set(pid, f);
        used.add(f);
      }
      group.overrides = {};
      for (const pid of ids) {
        const f = pick.get(pid);
        if (!assigned.has(pid)) assigned.set(pid, f);
        else if (assigned.get(pid) !== f) group.overrides[pid] = f;
      }
    }
    assigned.forEach((f, pid) => { const p = byId(doc.pilots, pid); if (p) p.freq = f; });
    return tooBig;
  }

  const bandLabel = () => bands().find(b => b.value === doc.band)?.label || `band ${doc.band}`;

  function channelNote(tooBig) {
    if (!tooBig.length) return `Channels spread across ${bandLabel()} for every group.`;
    const usable = bands().find(b => b.value === doc.band)?.freqs.length || 0;
    return `${bandLabel()} has ${usable} channels the C5 can tune: ${tooBig.map(g => g.name).join(", ")} ${tooBig.length > 1 ? "have" : "has"} more pilots. Pick a bigger band or smaller groups.`;
  }

  // ---- groups --------------------------------------------------------------------------------

  // Put the pilots into groups of about `size`, seeded by doc.seed: tiers of
  // similar skill race together when seeding by a rating. Existing groups
  // are reused (their races stay with them); surplus groups with no races go.
  function buildGroups() {
    const size = Math.min(SLOTS, Math.max(1, doc.groupSize || 4));
    if (!doc.pilots.length) {
      note = "Add pilots first.";
      return;
    }
    if (doc.races.length && !confirm("Rebuild the groups? Pilots move between groups; results so far are kept.")) return;
    const stats = pilotStats();
    const order = doc.pilots.slice();
    if (doc.seed === "random") {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } else if (doc.seed === "elo") {
      order.sort((a, b) => stats.get(b.id).elo - stats.get(a.id).elo);
    } else if (doc.seed === "best3" || doc.seed === "best") {
      order.sort((a, b) => asc(stats.get(a.id)[doc.seed], stats.get(b.id)[doc.seed]));
    }
    const count = Math.ceil(order.length / size);
    const per = Math.ceil(order.length / count);   // even groups, not one short group at the end
    for (let i = 0; i < count; i++) {
      const pilotIds = order.slice(i * per, (i + 1) * per).map(p => p.id);
      if (doc.groups[i]) doc.groups[i].pilotIds = pilotIds;
      else doc.groups.push({ id: newId(), name: groupName(i), formatId: doc.formats[0].id, pilotIds, overrides: {} });
    }
    doc.groups = doc.groups.filter((g, i) => i < count || racesOf(g).length);
    doc.groups.slice(count).forEach(g => { g.pilotIds = []; });
    const tooBig = assignChannels();
    if (!doc.schedule.blocks.length) {
      doc.schedule.blocks.push({ id: newId(), kind: "rotate", groupIds: doc.groups.slice(0, count).map(g => g.id), times: 3 });
      doc.schedule.pos = 0;
    }
    note = `${count} group${count > 1 ? "s" : ""} of up to ${per} pilots, seeded by ${SEEDS[doc.seed].toLowerCase()}. ${channelNote(tooBig)}`;
  }

  // ---- heats -------------------------------------------------------------------------------------

  // The heats in order, as group ids: "each" runs every chosen group N times
  // in a row, "rotate" cycles through them N times.
  function sequence() {
    const seq = [];
    for (const b of doc.schedule.blocks) {
      const groups = b.groupIds.filter(id => byId(doc.groups, id));
      const times = Math.max(1, Math.min(50, b.times || 1));
      if (b.kind === "each") groups.forEach(id => { for (let t = 0; t < times; t++) seq.push(id); });
      else for (let t = 0; t < times; t++) groups.forEach(id => seq.push(id));
    }
    return seq;
  }

  function setRange(id, value, update) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = Math.min(Math.max(value, +el.min), +el.max);
    update(el, el.value);
  }

  function applyFormat(f) {
    setRange("maxLaps", f.maxLaps, updateMaxLaps);
    setRange("maxHeatTime", Math.round(f.timeLimitS / 30), updateMaxHeatTime);
    setRange("minLap", f.minLapS, updateMinLap);
    const cd = document.getElementById("raceCountdownMode");
    if (cd) {
      cd.value = String(f.countdown);
      onRaceCountdownModeChange(cd);
    }
  }

  const activeGroup = () => doc && doc.active ? byId(doc.groups, doc.active.groupId) : null;
  const activeStep = () => doc && doc.active ? doc.active.step : null;

  // Calibration tab edits made while a heat is loaded belong to its pilots:
  // levels to the pilot, a changed channel to the group as an override.
  function syncFromSlots() {
    const group = activeGroup();
    if (!group || typeof C5UI === "undefined") return;
    const profiles = C5UI.getProfilesForSave();
    let changed = false;
    doc.active.seats.forEach((pid, slot) => {
      const p = pid != null && byId(doc.pilots, pid), prof = profiles[slot];
      if (!p || !prof || !prof.frequency) return;
      if (p.enter !== prof.enterRssi || p.exit !== prof.exitRssi) {
        p.enter = prof.enterRssi;
        p.exit = prof.exitRssi;
        changed = true;
      }
      if (seatFreq(group, pid) !== prof.frequency) {
        group.overrides = group.overrides || {};
        if (prof.frequency === p.freq) delete group.overrides[pid];
        else group.overrides[pid] = prof.frequency;
        changed = true;
      }
    });
    if (changed) save();
  }

  // Load a group into the slots. step is the heat it runs as, or null for a
  // race outside the heat order.
  function loadGroup(groupId, step, quiet) {
    const group = byId(doc.groups, groupId);
    if (!group) return false;
    if (typeof C5UI === "undefined" || !c5ReceiverSelected()) {
      if (!quiet) alert("Heats run on an ESP32-C5 receiver. Select it under Settings → System → Receiver Radio.");
      return false;
    }
    if (raceRunning) {
      if (!quiet) alert("Stop the race before loading another heat.");
      return false;
    }
    if (!group.pilotIds.length) {
      if (!quiet) alert(`${group.name} has no pilots.`);
      return false;
    }
    syncFromSlots();
    const seats = Array(SLOTS).fill(null);
    group.pilotIds.slice(0, SLOTS).forEach((pid, i) => {
      const p = byId(doc.pilots, pid);
      if (p) seats[i] = { name: p.name, phonetic: p.phonetic, color: p.color || COLORS[i], freq: seatFreq(group, pid), enter: p.enter, exit: p.exit };
    });
    const noChannel = C5UI.applyHeat(seats);
    if (noChannel === null) {
      if (!quiet) alert("Stop the race before loading another heat.");
      return false;
    }
    applyFormat(formatOf(group));
    doc.active = { groupId, seats: group.pilotIds.slice(0, SLOTS).concat(Array(SLOTS).fill(null)).slice(0, SLOTS), step };
    if (step != null) doc.schedule.pos = step;
    note = noChannel.length
      ? `No channel for ${noChannel.map(i => pilotName(doc.active.seats[i])).join(", ")}: they won't be timed. Assign channels or pick one in ${group.name}.`
      : clashes(group).size ? `Two pilots in ${group.name} share a channel. Assign channels or change one in the group.` : "";
    save();
    render();
    if (typeof renderUnifiedRaceView === "function") renderUnifiedRaceView();
    return true;
  }

  function loadStep(step, quiet) {
    const seq = sequence();
    if (step >= seq.length) {
      note = "Every heat has been raced.";
      render();
      return false;
    }
    return loadGroup(seq[step], step, quiet);
  }

  // The heat after the loaded one, or the next unraced one.
  function nextStep() {
    const step = activeStep();
    return step != null ? step + 1 : doc.schedule.pos;
  }

  // Race tab "Next Heat": skip to the following heat even if this one wasn't raced.
  function nextHeat() {
    if (!doc || raceRunning) return;
    loadStep(nextStep());
  }

  // ---- race tab hooks ---------------------------------------------------------------------------

  function heatLabel() {
    const group = activeGroup(), step = activeStep();
    return step != null ? `Heat ${step + 1} · ${group.name}` : group.name;
  }

  // For saveCurrentRace: the race's name and tag while a heat is loaded and
  // every racer is seated in it.
  function raceLabel(racers) {
    const group = enabled && activeGroup();
    if (!group || !racers.length || !racers.every(r => doc.active.seats[r.slot] != null)) return {};
    return { name: heatLabel(), tag: doc.name || "Event" };
  }

  // After a race is saved: record it as the loaded heat's result, move to
  // the next heat and, with auto on, load it.
  function recordRace(raceData) {
    const group = enabled && activeGroup();
    const pilots = raceData.pilots || [];
    if (!group || !pilots.length || !pilots.every(p => doc.active.seats[p.slot] != null)) return;
    syncFromSlots();
    const step = activeStep();
    doc.races.push({
      id: newId(), groupId: group.id, step, timestamp: raceData.timestamp, formatId: formatOf(group).id,
      results: pilots.map(p => ({ pilotId: doc.active.seats[p.slot], slot: p.slot, freq: p.frequency, laps: p.lapTimes.slice() })),
    });
    if (step != null) {
      doc.schedule.pos = step + 1;
      const seq = sequence();
      if (doc.schedule.auto && doc.schedule.pos < seq.length) {
        save();
        render();
        // The C5 reports the race over a moment after the stop.
        let tries = 0;
        const next = () => { if (!loadStep(doc.schedule.pos, true) && ++tries < 5 && raceRunning === false) setTimeout(next, 1000); };
        setTimeout(next, 500);
        return;
      }
      if (doc.schedule.pos >= seq.length) note = "Every heat has been raced.";
    }
    save();
    render();
  }

  // ---- rendering ----------------------------------------------------------------------------------

  function show() {
    if (!enabled) return;
    if (doc) syncFromSlots();
    render();
  }

  function setEnabled(on) {
    enabled = !!on;
    if (enabled && !started) {
      started = true;
      load();
    }
    renderRaceTab();
  }

  function statusLine() {
    const group = activeGroup();
    const seq = sequence();
    if (!group) {
      const pos = doc.schedule.pos;
      if (seq.length && pos < seq.length) return { cls: "c5p-warn", text: `No heat loaded. Next: Heat ${pos + 1} (${byId(doc.groups, seq[pos])?.name}). Click it to load.` };
      if (seq.length) return { cls: "", text: "Every heat has been raced." };
      return { cls: "", text: doc.groups.length ? "Set the heat order, then click a heat to load it." : "Add pilots, then build groups." };
    }
    const step = activeStep();
    const where = step != null ? `Heat ${step + 1} of ${seq.length} · ${group.name}` : `${group.name} (outside the heat order)`;
    const nextId = seq[nextStep()];
    const next = nextId != null ? ` · next Heat ${nextStep() + 1} (${byId(doc.groups, nextId)?.name})` : "";
    return { cls: clashes(group).size ? "c5p-bad" : "c5p-ok", text: `${where} loaded${next} · ${formatOf(group).name}` };
  }

  function render() {
    renderRaceTab();
    const host = document.getElementById("eventPanel");
    if (!host) return;
    if (!doc) {
      host.innerHTML = `<div class="calib-card"><p>${esc(loadError || "Loading the event…")}</p>
        <div class="ev-actions"><button class="c5p-btn c5p-small" id="evRetry">Retry</button>
        ${damaged ? `<a class="c5p-btn c5p-small" href="/api/event" download="event-damaged.json">Download</a>
          <button class="c5p-btn c5p-small" id="evStartOver">Start a new event</button>` : ""}</div></div>`;
      $("#evRetry").onclick = load;
      const startOver = $("#evStartOver");
      if (startOver) startOver.onclick = () => {
        if (!confirm("Replace the damaged event with a new, empty one?")) return;
        doc = blank();
        damaged = false;
        loadError = "";
        save();
        render();
      };
      return;
    }
    const st = statusLine();
    const seedOpts = Object.entries(SEEDS).map(([k, v]) => `<option value="${k}"${k === doc.seed ? " selected" : ""}>${v}</option>`).join("");
    const sizeOpts = [2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}"${n === doc.groupSize ? " selected" : ""}>${n} per group</option>`).join("");
    const bandOpts = bands().map(b => `<option value="${esc(b.value)}"${b.value === doc.band ? " selected" : ""}>${esc(b.label)} · ${b.freqs.length} ch</option>`).join("");
    host.innerHTML = `
      <div class="calib-card c5p-panel ev-panel">
        <div class="calib-card-header c5p-head">
          <input type="text" class="ev-title" data-f="name" maxlength="40" placeholder="Event name" value="${esc(doc.name)}">
          <div class="c5p-headctl">
            <select class="c5p-mini" data-f="groupSize" title="Pilots per group">${sizeOpts}</select>
            <select class="c5p-mini" data-f="seed" title="How pilots are grouped">${seedOpts}</select>
            <button class="calib-wizard-btn" data-act="build" title="Put the pilots into groups and give them channels">Build groups</button>
            <select class="c5p-mini" data-f="band" title="Band the channels are taken from">${bandOpts}</select>
            <button class="c5p-btn c5p-small" data-act="channels" title="Spread every group's channels across the band">Assign channels</button>
          </div>
        </div>
        <div class="c5p-status ${st.cls}"><span class="c5p-dot"></span><span class="ev-status-text">${esc(st.text)}</span><span class="c5p-save" id="evSave"></span></div>
        ${note ? `<div class="c5p-fillnote">${esc(note)}</div>` : ""}
        <div class="c5p-main ev-main">
          <div class="c5p-left">
            ${renderHeats()}
            ${renderGroups()}
            ${renderLeaderboard()}
          </div>
          <div class="ev-side">
            ${renderPilots()}
          </div>
        </div>
        ${renderFormats()}
        <div class="ev-actions ev-foot">
          <button class="c5p-btn c5p-small" data-act="export-results-csv"${doc.races.length ? "" : " disabled"} title="Every heat's result, one row per pilot">Results CSV</button>
          <button class="c5p-btn c5p-small" data-act="export-results-report"${doc.races.length ? "" : " disabled"} title="A page to print or share: leaderboard, groups and every heat">Results report</button>
          <button class="c5p-btn c5p-small" data-act="export-event" title="The whole event as one file: pilots, groups, formats, heat order and results">Export event</button>
          <button class="c5p-btn c5p-small" data-act="import-event" title="Replace this event with one from a file">Import event</button>
          <button class="c5p-btn c5p-small ev-danger" data-act="new-event">New event</button>
        </div>
      </div>`;
    setSaveState(saveState);
    if (orderOpen) renderOrderModal();
  }

  // The Race tab: banner with the loaded heat, and the Next Heat button.
  function renderRaceTab() {
    const el = document.getElementById("eventRaceBanner");
    const nextBtn = document.getElementById("nextHeatButton");
    const group = enabled && activeGroup();
    if (nextBtn) {
      const seq = doc && enabled ? sequence() : [];
      const n = doc && enabled ? nextStep() : 0;
      nextBtn.style.display = seq.length ? "" : "none";
      nextBtn.disabled = raceRunning || n >= seq.length;
      nextBtn.title = n < seq.length ? `Load Heat ${n + 1} (${byId(doc.groups, seq[n])?.name})` : "Every heat has been raced";
    }
    if (!el) return;
    if (!group) {
      el.style.display = "none";
      return;
    }
    const st = statusLine();
    const names = doc.active.seats.filter(id => id != null).map(id => {
      const p = byId(doc.pilots, id);
      return `<span class="ev-pill"><span class="ev-dot" style="--c:${esc(p?.color || "#888")}"></span>${esc(p?.name || "?")} <b>${esc(chName(seatFreq(group, id)))}</b></span>`;
    }).join("");
    el.style.display = "";
    el.className = `c5p-status ev-race-banner ${st.cls}`;
    el.innerHTML = `<span class="c5p-dot"></span><span><b>${esc(doc.name || "Event")}</b> · ${esc(st.text)}</span><span class="ev-pills">${names}</span>`;
  }

  // The heats in order: click one to load it.
  function renderHeats() {
    const seq = sequence(), step = activeStep(), next = doc.schedule.pos;
    const rows = seq.map((gid, i) => {
      const g = byId(doc.groups, gid);
      const race = raceOfStep(i);
      let state, cls;
      if (i === step) { state = "Loaded"; cls = "ev-heat-on"; }
      else if (race) {
        const winner = raceStandings(race)[0];
        state = winner ? `✓ ${esc(pilotName(winner.pilotId))}` : "✓";
        cls = "ev-heat-done";
      } else if (i === next) { state = "Next"; cls = "ev-heat-next"; }
      else { state = ""; cls = ""; }
      const pilots = g.pilotIds.map(pid => {
        const p = byId(doc.pilots, pid);
        return `<span class="ev-hp"><span class="ev-dot" style="--c:${esc(p?.color || "#888")}"></span>${esc(p?.name || "?")} <b>${esc(chName(seatFreq(g, pid)))}</b></span>`;
      }).join("");
      return `<div class="ev-heat ${cls}" data-step="${i}" title="Click to load Heat ${i + 1}">
        <span class="ev-heat-n">${i + 1}</span>
        <span class="ev-heat-g">${esc(shortName(g))}</span>
        <span class="ev-heat-pilots">${pilots || `<span class="c5p-hint">No pilots</span>`}</span>
        <span class="ev-heat-state">${state}</span>
        ${race ? `<button class="ev-x" data-act="del-race" data-race="${race.id}" title="Remove this heat's result">✕</button>` : `<span></span>`}
      </div>`;
    }).join("");
    return `<div class="ev-section">
      <div class="c5p-list-head ev-sec-head"><span>Heats${seq.length ? ` · ${seq.filter((_, i) => raceOfStep(i)).length} of ${seq.length} raced` : ""}</span>
        <span class="ev-actions">
          <button class="c5p-btn c5p-small" data-act="edit-order"${doc.groups.length ? "" : " disabled"}>Heat order</button>
          ${seq.length ? `<button class="c5p-btn c5p-small" data-act="restart" title="Go back to Heat 1; results are kept">Restart</button>` : ""}
        </span></div>
      ${seq.length ? `<div class="c5p-hint">${esc(describeOrder())}</div><div class="ev-heats">${rows}</div>`
        : `<div class="ev-empty">${doc.groups.length ? "No heats yet. Open Heat order to set which groups race and how often." : "Build groups first, then set the heat order."}</div>`}
      ${seq.length ? `<label class="c5p-check"><input type="checkbox" data-f="auto"${doc.schedule.auto ? " checked" : ""}> Load the next heat after each race</label>` : ""}
    </div>`;
  }

  function renderGroups() {
    if (!doc.groups.length) {
      return `<div class="ev-section"><div class="c5p-list-head ev-sec-head"><span>Groups</span></div>
        <div class="ev-empty">No groups yet. Add pilots, choose the group size and seeding above, then Build groups.</div>
        <div class="ev-actions"><button class="c5p-btn c5p-small" data-act="add-group">Add group</button></div></div>`;
    }
    const activeId = doc.active ? doc.active.groupId : null;
    const formatOpts = sel => doc.formats.map(f => `<option value="${f.id}"${f.id === sel ? " selected" : ""}>${esc(f.name)}</option>`).join("");
    const cards = doc.groups.map(g => {
      const clash = clashes(g);
      const raced = racesOf(g).length;
      const rows = g.pilotIds.map(pid => {
        const p = byId(doc.pilots, pid) || { name: "(removed)", color: "#888" };
        const f = seatFreq(g, pid), over = g.overrides?.[pid];
        return `<div class="ev-seat${clash.has(f) || !f ? " ev-seat-bad" : ""}">
          <span class="ev-dot" style="--c:${esc(p.color)}"></span>
          <span class="ev-seat-name">${esc(p.name || "Pilot")}</span>
          <select class="ev-ch${over ? " ev-ch-over" : ""}" data-pid="${pid}" title="${over ? "Channel in this group only" : "Pilot's channel"}">${channelOptions(f)}</select>
          <button class="ev-x" data-act="unseat" data-pid="${pid}" title="Take out of this group">✕</button>
        </div>`;
      }).join("");
      const seated = new Set(g.pilotIds);
      const free = doc.pilots.filter(p => !seated.has(p.id));
      const add = g.pilotIds.length < SLOTS && free.length
        ? `<select class="ev-add" data-act-change="seat"><option value="">+ Pilot</option>${free.map(p => `<option value="${p.id}">${esc(p.name || "Pilot")}</option>`).join("")}</select>` : "";
      const standings = groupStandings(g);
      return `
        <div class="ev-group${g.id === activeId ? " ev-group-on" : ""}" data-coll="groups" data-id="${g.id}">
          <div class="ev-group-head">
            <input type="text" class="ev-group-name" data-f="name" maxlength="24" value="${esc(g.name)}">
            <span class="ev-group-meta">${raced ? `${raced} race${raced > 1 ? "s" : ""}` : ""}</span>
            <select class="c5p-mini ev-group-fmt" data-f="formatId" title="Race format">${formatOpts(g.formatId)}</select>
            <button class="ev-x" data-act="del" title="Remove group">✕</button>
          </div>
          <div class="ev-seats">${rows || `<div class="ev-empty">No pilots.</div>`}</div>
          <div class="ev-group-foot">${add}<button class="c5p-btn c5p-small" data-act="race-now" title="Load this group for a race outside the heat order">Race now</button></div>
          ${standings.length ? `<details class="ev-results"><summary>Standings · ${esc(WIN[formatOf(g).win])}</summary>${standingsTable(standings, formatOf(g).win)}</details>` : ""}
        </div>`;
    }).join("");
    return `<div class="ev-section">
      <div class="c5p-list-head ev-sec-head"><span>Groups · ${doc.groups.length}</span></div>
      <div class="ev-groups">${cards}</div>
      <div class="ev-actions"><button class="c5p-btn c5p-small" data-act="add-group">Add group</button></div>
    </div>`;
  }

  function standingsTable(rows, win) {
    return `<table class="ev-table">
      <tr><th>#</th><th>Pilot</th><th>Result</th><th>Laps</th><th>Best</th><th>Best ${CONSECUTIVE}</th></tr>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(pilotName(r.pilotId))}</td><td>${esc(resultText(r, win))}</td>
        <td>${r.lapCount}</td><td>${fmtMs(r.best)}</td><td>${fmtMs(r.best3)}</td></tr>`).join("")}
    </table>`;
  }

  let leaderSort = "best3";

  function eloCell(r) {
    const d = lastChange.get(r.pilotId);
    const change = d == null || Math.round(d) === 0 ? "" : `<span class="${d > 0 ? "ev-up" : "ev-down"}">${d > 0 ? "▲" : "▼"}${Math.abs(Math.round(d))}</span>`;
    return `${Math.round(r.elo)} ${change}`;
  }

  function renderLeaderboard() {
    if (!doc.races.length) return "";
    const stats = pilotStats();
    const sorts = {
      best3: (a, b) => asc(a.best3, b.best3) || asc(a.best, b.best),
      best: (a, b) => asc(a.best, b.best) || asc(a.best3, b.best3),
      elo: (a, b) => b.elo - a.elo,
    };
    const rows = [...stats.values()].filter(s => s.races).sort(sorts[leaderSort] || sorts.best3);
    const th = (key, label) => `<th><button class="ev-sort${leaderSort === key ? " ev-sort-on" : ""}" data-act="sort" data-key="${key}">${label}</button></th>`;
    return `<div class="ev-section"><div class="c5p-list-head ev-sec-head"><span>Leaderboard</span>
        <button class="ev-x ev-info-btn" data-act="elo-info" title="How Elo works">How Elo works</button></div>
      <div class="ev-info" id="evEloInfo" hidden>
        <b>Elo</b> rates pilots by who they beat, not how fast they are, so pilots from different groups and formats can be compared.
        Everyone starts at ${ELO_START}. After each race, every pair of pilots in it counts as a match won by whoever finished higher
        (by that group's win condition). Beating a higher-rated pilot gains more than beating a lower-rated one, and losing to a lower-rated
        pilot costs more. The points a pilot can win or lose in one race are capped at ${ELO_K}, shared across their opponents, so a big
        group doesn't swing ratings more than a small one. ▲/▼ is the change from their latest race. Elo is worked out again from every
        race in order whenever results change, so removing a race corrects everyone's rating.
      </div>
      <table class="ev-table">
        <tr><th>#</th><th>Pilot</th>${th("best3", `Best ${CONSECUTIVE}`)}${th("best", "Best lap")}${th("elo", "Elo")}<th>Races</th><th>Laps</th></tr>
        ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(pilotName(r.pilotId))}</td><td>${fmtMs(r.best3)}</td>
          <td>${fmtMs(r.best)}</td><td>${eloCell(r)}</td><td>${r.races}</td><td>${r.lapCount}</td></tr>`).join("")}
      </table></div>`;
  }

  function renderPilots() {
    const stats = doc.races.length ? pilotStats() : null;
    const rows = doc.pilots.map(p => `
      <div class="ev-prow" data-coll="pilots" data-id="${p.id}">
        <input type="color" class="ev-color" data-f="color" value="${esc(p.color)}" title="Colour">
        <input type="text" data-f="name" maxlength="20" value="${esc(p.name)}" placeholder="Name">
        <select data-f="freq" title="Channel for the day">${channelOptions(p.freq)}</select>
        <span class="ev-th" title="Enter / Exit, set on the Calibration tab while their heat is loaded">${p.enter ? `${p.enter}/${p.exit}` : "–"}</span>
        <button class="ev-x" data-act="del" title="Remove pilot">✕</button>
        <input type="text" class="ev-phon" data-f="phonetic" maxlength="20" value="${esc(p.phonetic)}" placeholder="Spoken as (optional)">
        ${stats ? `<span class="ev-elo" title="Elo rating (see How Elo works)">Elo ${eloCell(stats.get(p.id))}</span>` : ""}
      </div>`).join("");
    return `<div class="ev-section">
      <div class="c5p-list-head ev-sec-head"><span>Pilots · ${doc.pilots.length}</span><span>Channel</span></div>
      ${rows || `<div class="ev-empty">No pilots yet.</div>`}
      <div class="ev-actions">
        <button class="c5p-btn c5p-small" data-act="add-pilot">Add pilot</button>
        <button class="c5p-btn c5p-small" data-act="import-pilots" title="Add or update pilots from a CSV or JSON file">Import</button>
        <button class="c5p-btn c5p-small" data-act="export-pilots"${doc.pilots.length ? "" : " disabled"} title="Download the pilots as a CSV">Export</button>
      </div>
    </div>`;
  }

  function renderFormats() {
    const winOpts = sel => Object.entries(WIN).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v}</option>`).join("");
    const used = id => doc.groups.filter(g => g.formatId === id).map(shortName);
    const rows = doc.formats.map(f => `
      <div class="ev-frow" data-coll="formats" data-id="${f.id}">
        <input type="text" class="c5p-mini" data-f="name" maxlength="24" value="${esc(f.name)}" aria-label="Name">
        <select class="c5p-mini" data-f="win" aria-label="Win condition">${winOpts(f.win)}</select>
        <input type="number" class="c5p-mini" data-f="maxLaps" min="0" max="50" value="${f.maxLaps}" title="0 = no limit" aria-label="Laps">
        <input type="number" class="c5p-mini" data-f="timeLimitS" min="0" max="1800" step="30" value="${f.timeLimitS}" title="Steps of 30 s; 0 = no limit" aria-label="Time limit">
        <input type="number" class="c5p-mini" data-f="minLapS" min="1" max="20" step="0.5" value="${f.minLapS}" aria-label="Minimum lap">
        <select class="c5p-mini" data-f="countdown" aria-label="Start"><option value="1"${f.countdown == 1 ? " selected" : ""}>10 s countdown</option><option value="0"${f.countdown == 0 ? " selected" : ""}>Random 1–5 s</option></select>
        <span class="c5p-hint ev-frow-used">${used(f.id).length ? "Groups " + esc(used(f.id).join(", ")) : "Not used"}</span>
        <button class="ev-x" data-act="del" title="Remove format"${doc.formats.length < 2 ? " disabled" : ""}>✕</button>
      </div>`).join("");
    return `<div class="ev-section ev-formats">
      <div class="c5p-list-head ev-sec-head"><span>Race formats</span></div>
      <div class="ev-frow ev-frow-head"><span>Name</span><span>Win condition</span><span>Laps</span><span>Time limit (s)</span><span>Min lap (s)</span><span>Start</span><span>Used by</span><span></span></div>
      ${rows}
      <div class="ev-actions"><button class="c5p-btn c5p-small" data-act="add-format">Add format</button>
        <span class="c5p-hint">Laps 0 and time 0 mean no limit. A group's format is applied when its heat loads.</span></div>
    </div>`;
  }

  // ---- heat order editor (pop-out, drag and drop) ------------------------------------------------
  //
  // The order is a list of blocks. A group block runs one group N times in a
  // row ("each"); a rotate block cycles through its groups N times. Drag
  // groups from the palette into the order or onto a rotate block, drag
  // blocks to reorder them, and drag a block back to the palette to remove
  // it. Pointer events, so it works with a finger as well as a mouse.

  // "Rotate A, B ×3 · C ×2" for the Heats summary.
  function describeOrder() {
    return doc.schedule.blocks.map(b => {
      const names = b.groupIds.map(id => shortName(byId(doc.groups, id))).filter(n => n !== "?");
      if (!names.length) return null;
      return (b.kind === "rotate" && names.length > 1 ? "Rotate " : "Group ") + names.join(", ") + ` ×${b.times}`;
    }).filter(Boolean).join(" · ");
  }

  let orderOpen = false;
  let drag = null;   // { kind: "group" | "rotate" | "block", id, el, ghost, startX, startY, moved }

  function openOrder() {
    orderOpen = true;
    let modal = document.getElementById("evOrderModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "evOrderModal";
      modal.className = "settings-modal";
      modal.innerHTML = `<div class="settings-modal-container ev-sched-box" role="dialog" aria-modal="true" aria-labelledby="evOrderTitle"></div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", e => { if (e.target === modal) closeOrder(); });
      modal.addEventListener("pointerdown", onDragStart);
      modal.addEventListener("change", onOrderChange);
      modal.addEventListener("click", onOrderClick);
    }
    modal.classList.add("active");
    renderOrderModal();
  }

  function closeOrder() {
    orderOpen = false;
    const modal = document.getElementById("evOrderModal");
    if (modal) modal.classList.remove("active");
    render();
  }

  function renderOrderModal() {
    const box = document.querySelector("#evOrderModal .ev-sched-box");
    if (!box) return;
    const palette = doc.groups.map(g => `<div class="ev-tile" data-drag="group" data-id="${g.id}">
        <b>${esc(shortName(g))}</b><span>${esc(g.name)} · ${g.pilotIds.length} pilots</span></div>`).join("");
    const block = b => {
      const chips = b.groupIds.map(id => byId(doc.groups, id)).filter(Boolean).map(g =>
        `<span class="ev-chip">${esc(shortName(g))}<button class="ev-x" data-act="chip-x" data-group="${g.id}" title="Take out">✕</button></span>`).join("");
      const rotate = b.kind === "rotate";
      return `<div class="ev-pblock${rotate ? " ev-pblock-rot" : ""}" data-drag="block" data-id="${b.id}"${rotate ? ` data-drop="rotate"` : ""}>
        <span class="ev-grip" title="Drag to move">⠿</span>
        <span class="ev-pblock-kind">${rotate ? "Rotate" : "Group"}</span>
        <span class="ev-pblock-heats">${chips || `<span class="c5p-hint">Drop groups here</span>`}</span>
        <span class="c5p-step"><button class="c5p-btn c5p-small c5p-sq" data-act="times" data-d="-1">−</button>
          <input type="number" class="c5p-mini" data-f="times" min="1" max="50" value="${b.times}" aria-label="Times">
          <button class="c5p-btn c5p-small c5p-sq" data-act="times" data-d="1">+</button><span class="c5p-ctl-l">times</span></span>
        <button class="ev-x" data-act="block-x" title="Remove block">✕</button>
      </div>`;
    };
    const seq = sequence();
    const preview = seq.map((gid, i) => `<span class="ev-step${raceOfStep(i) ? " ev-step-done" : ""}" title="Heat ${i + 1}">${esc(shortName(byId(doc.groups, gid)))}</span>`).join("");
    box.innerHTML = `
      <div class="ev-sched-head"><h2 id="evOrderTitle">Heat order</h2>
        <button class="settings-close-button" data-act="close" title="Close">✕</button></div>
      <div class="ev-sched-body">
        <div class="ev-palette" data-drop="palette">
          <div class="c5p-list-head ev-sec-head"><span>Groups</span></div>
          ${palette}
          <div class="ev-tile ev-tile-rot" data-drag="rotate"><b>⟳</b><span>Rotate: cycle through groups</span></div>
          <div class="c5p-hint">Drag into the order, or tap to add at the end. Drag a block back here to remove it.</div>
        </div>
        <div class="ev-program" data-drop="program">
          <div class="c5p-list-head ev-sec-head"><span>Order</span><span>${seq.length} heat${seq.length === 1 ? "" : "s"}</span></div>
          <div class="ev-lane">${doc.schedule.blocks.map(block).join("") || `<div class="ev-empty ev-lane-empty">Drag a group or Rotate here to start.</div>`}</div>
          <div class="ev-actions">
            <button class="c5p-btn c5p-small" data-act="preset-rotate" title="Every group in turn, three times">Rotate all ×3</button>
            <button class="c5p-btn c5p-small" data-act="preset-each" title="Each group three times in a row">Each group ×3</button>
            <button class="c5p-btn c5p-small ev-danger" data-act="clear"${doc.schedule.blocks.length ? "" : " disabled"}>Clear</button>
          </div>
        </div>
      </div>
      <div class="ev-sched-foot">
        <div class="ev-steps">${preview || `<span class="c5p-hint">The heats appear here in order.</span>`}</div>
        <button class="calib-wizard-btn" data-act="close">Done</button>
      </div>`;
  }

  function orderChanged() {
    doc.schedule.pos = Math.min(doc.schedule.pos, sequence().length);
    save();
    renderOrderModal();
  }

  function onOrderChange(e) {
    const t = e.target, holder = t.closest("[data-drag=block]");
    if (!holder || t.dataset.f !== "times") return;
    const b = byId(doc.schedule.blocks, +holder.dataset.id);
    if (b) b.times = Math.max(1, Math.min(50, Number(t.value) || 1));
    orderChanged();
  }

  function onOrderClick(e) {
    if (drag && drag.moved) return;
    const btn = e.target.closest("[data-act]");
    if (!btn) {
      // A tap on a palette tile adds it at the end, for when dragging is awkward.
      const tile = e.target.closest(".ev-palette [data-drag]");
      if (!tile) return;
      doc.schedule.blocks.push(tile.dataset.drag === "rotate"
        ? { id: newId(), kind: "rotate", groupIds: [], times: 1 }
        : { id: newId(), kind: "each", groupIds: [+tile.dataset.id], times: 1 });
      orderChanged();
      return;
    }
    const holder = btn.closest("[data-drag=block]");
    const b = holder && byId(doc.schedule.blocks, +holder.dataset.id);
    switch (btn.dataset.act) {
      case "close":
        closeOrder();
        return;
      case "times":
        b.times = Math.max(1, Math.min(50, b.times + +btn.dataset.d));
        break;
      case "chip-x":
        b.groupIds = b.groupIds.filter(x => x !== +btn.dataset.group);
        if (!b.groupIds.length && b.kind !== "rotate") doc.schedule.blocks = doc.schedule.blocks.filter(x => x !== b);
        break;
      case "block-x":
        doc.schedule.blocks = doc.schedule.blocks.filter(x => x !== b);
        break;
      case "preset-rotate":
      case "preset-each":
        if (doc.schedule.blocks.length && !confirm("Replace the heat order?")) return;
        doc.schedule.blocks = btn.dataset.act === "preset-each"
          ? doc.groups.map(g => ({ id: newId(), kind: "each", groupIds: [g.id], times: 3 }))
          : [{ id: newId(), kind: "rotate", groupIds: doc.groups.map(g => g.id), times: 3 }];
        doc.schedule.pos = 0;
        break;
      case "clear":
        if (!confirm("Clear the heat order?")) return;
        doc.schedule.blocks = [];
        doc.schedule.pos = 0;
        break;
      default:
        return;
    }
    orderChanged();
  }

  function onDragStart(e) {
    const src = e.target.closest("[data-drag]");
    if (!src || e.button > 0 || e.target.closest("button, input, select")) return;
    drag = { kind: src.dataset.drag, id: src.dataset.id != null ? +src.dataset.id : null, el: src,
             startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
    src.setPointerCapture(e.pointerId);
    src.addEventListener("pointermove", onDragMove);
    src.addEventListener("pointerup", onDragEnd, { once: true });
    src.addEventListener("pointercancel", onDragEnd, { once: true });
  }

  // Where a drop at (x, y) would land: onto a rotate block (groups only), at
  // an index in the order, or back on the palette.
  function dropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const rot = el.closest("[data-drop=rotate]");
    if (rot && drag.kind === "group") return { type: "rotate", id: +rot.dataset.id, el: rot };
    if (el.closest("[data-drop=palette]")) return drag.kind === "block" ? { type: "palette" } : null;
    const lane = el.closest("[data-drop=program]");
    if (!lane) return null;
    const blocks = [...lane.querySelectorAll(".ev-lane > [data-drag=block]")].filter(b => b !== drag.el);
    let index = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const r = blocks[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { index = i; break; }
    }
    return { type: "program", index, before: blocks[index] || null, lane: lane.querySelector(".ev-lane") };
  }

  function clearDropMarks() {
    document.querySelectorAll(".ev-drop-into, .ev-drop-line, .ev-drop-out").forEach(el => {
      if (el.classList.contains("ev-drop-line")) el.remove();
      else el.classList.remove("ev-drop-into", "ev-drop-out");
    });
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
      drag.moved = true;
      drag.ghost = drag.el.cloneNode(true);
      drag.ghost.classList.add("ev-ghost");
      drag.ghost.style.width = drag.el.getBoundingClientRect().width + "px";
      document.body.appendChild(drag.ghost);
      if (drag.kind === "block") drag.el.classList.add("ev-dragging");
    }
    drag.ghost.style.left = e.clientX + 8 + "px";
    drag.ghost.style.top = e.clientY + 8 + "px";
    clearDropMarks();
    const target = dropTarget(e.clientX, e.clientY);
    if (!target) return;
    if (target.type === "rotate") target.el.classList.add("ev-drop-into");
    else if (target.type === "palette") document.querySelector(".ev-palette").classList.add("ev-drop-out");
    else {
      const line = document.createElement("div");
      line.className = "ev-drop-line";
      target.lane.insertBefore(line, target.before);
    }
  }

  function onDragEnd(e) {
    const d = drag;
    if (!d) return;
    d.el.removeEventListener("pointermove", onDragMove);
    clearDropMarks();
    if (d.ghost) d.ghost.remove();
    d.el.classList.remove("ev-dragging");
    const target = d.moved && e.type === "pointerup" ? dropTarget(e.clientX, e.clientY) : null;
    // Let the click that follows pointerup see that this was a drag.
    setTimeout(() => { drag = null; }, 0);
    if (!target) return;
    const blocks = doc.schedule.blocks;
    if (target.type === "rotate") {
      const b = byId(blocks, target.id);
      if (b && !b.groupIds.includes(d.id)) b.groupIds.push(d.id);
    } else if (target.type === "palette") {
      doc.schedule.blocks = blocks.filter(b => b.id !== d.id);
    } else if (d.kind === "block") {
      const moving = byId(blocks, d.id), rest = blocks.filter(b => b.id !== d.id);
      rest.splice(target.index, 0, moving);
      doc.schedule.blocks = rest;
    } else {
      blocks.splice(target.index, 0, d.kind === "rotate"
        ? { id: newId(), kind: "rotate", groupIds: [], times: 1 }
        : { id: newId(), kind: "each", groupIds: [d.id], times: 1 });
    }
    orderChanged();
  }

  // ---- import and export --------------------------------------------------------------------------
  //
  // Pilots as CSV (or JSON) for reusing a club roster, the whole event as a
  // JSON backup, and the day's results as CSV or a standalone HTML report.

  const PILOT_COLUMNS = ["Name", "Spoken as", "Colour", "Channel", "Frequency", "Enter", "Exit"];

  function fileStamp() {
    const slug = (doc.name || "event").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "event";
    const d = new Date(), pad = n => String(n).padStart(2, "0");
    return `${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // local date, not UTC
  }

  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Ask for one file and hand back its text.
  function pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return resolve(null);
        file.text().then(text => resolve({ name: file.name, text }), () => resolve(null));
      };
      input.click();
    });
  }

  const csvCell = v => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvLine = cells => cells.map(csvCell).join(",");

  // RFC 4180-style: quoted fields, doubled quotes, commas and newlines inside quotes.
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ""));
  }

  // "R1", "r1" or "5658" to MHz, or 0.
  function parseChannel(value) {
    const s = String(value || "").trim();
    if (/^\d{4}$/.test(s)) return inRange(+s) ? +s : 0;
    const m = /^([A-Za-z])\s*(\d)$/.exec(s);
    if (!m) return 0;
    const band = bands().find(b => b.value.toUpperCase() === m[1].toUpperCase());
    const f = band ? band.all[+m[2] - 1] : 0;
    return f && inRange(f) ? f : 0;
  }

  function exportPilots() {
    const lines = [csvLine(PILOT_COLUMNS)].concat(doc.pilots.map(p =>
      csvLine([p.name, p.phonetic, p.color, p.freq ? chName(p.freq) : "", p.freq || "", p.enter || "", p.exit || ""])));
    download(`${fileStamp()}-pilots.csv`, "text/csv", lines.join("\r\n") + "\r\n");
  }

  // New pilots are added; a pilot already in the event (same name) is
  // updated from the file's non-empty fields.
  async function importPilots() {
    const file = await pickFile(".csv,.json,text/csv,application/json");
    if (!file) return;
    let incoming = [];
    try {
      if (/^\s*[[{]/.test(file.text)) {
        const data = JSON.parse(file.text);
        incoming = (Array.isArray(data) ? data : data.pilots || []).map(p => ({
          name: p.name, phonetic: p.phonetic, color: p.color, freq: +p.freq || parseChannel(p.channel), enter: +p.enter || 0, exit: +p.exit || 0 }));
      } else {
        const rows = parseCsv(file.text);
        const head = (rows.shift() || []).map(h => h.trim().toLowerCase());
        const col = (...names) => head.findIndex(h => names.includes(h));
        const iName = col("name", "pilot", "callsign"), iPhon = col("spoken as", "phonetic"), iColor = col("colour", "color");
        const iCh = col("channel"), iFreq = col("frequency", "freq", "mhz"), iEnter = col("enter"), iExit = col("exit");
        if (iName < 0) throw new Error("no Name column");
        incoming = rows.map(r => ({
          name: r[iName], phonetic: iPhon >= 0 ? r[iPhon] : "", color: iColor >= 0 ? r[iColor] : "",
          freq: (iFreq >= 0 && parseChannel(r[iFreq])) || (iCh >= 0 && parseChannel(r[iCh])) || 0,
          enter: iEnter >= 0 ? +r[iEnter] || 0 : 0, exit: iExit >= 0 ? +r[iExit] || 0 : 0 }));
      }
    } catch (e) {
      note = `Couldn't read ${file.name}: ${e.message}. Use a CSV with a Name column (as exported here) or a pilots JSON file.`;
      render();
      return;
    }
    let added = 0, updated = 0;
    for (const x of incoming) {
      const name = String(x.name || "").trim().slice(0, 20);
      if (!name) continue;
      const color = /^#[0-9a-f]{6}$/i.test(String(x.color || "").trim()) ? x.color.trim() : null;
      const p = doc.pilots.find(q => q.name.toLowerCase() === name.toLowerCase());
      if (p) {
        if (x.phonetic) p.phonetic = String(x.phonetic).trim().slice(0, 20);
        if (color) p.color = color;
        if (x.freq) p.freq = x.freq;
        if (x.enter > 0) { p.enter = x.enter; p.exit = x.exit; }
        updated++;
      } else {
        doc.pilots.push({ id: newId(), name, phonetic: String(x.phonetic || "").trim().slice(0, 20),
                          color: color || COLORS[doc.pilots.length % COLORS.length], freq: x.freq || 0,
                          enter: x.enter > 0 ? x.enter : 0, exit: x.enter > 0 ? x.exit : 0 });
        added++;
      }
    }
    note = `${file.name}: ${added} pilot${added === 1 ? "" : "s"} added, ${updated} updated.`;
    save();
    render();
  }

  function exportEvent() {
    syncFromSlots();
    download(`${fileStamp()}-event.json`, "application/json", JSON.stringify({ fpvgateEvent: 1, exported: new Date().toISOString(), ...doc }, null, 2));
  }

  async function importEvent() {
    const file = await pickFile(".json,application/json");
    if (!file) return;
    let incoming;
    try {
      const data = JSON.parse(file.text);
      if (!data || !Array.isArray(data.pilots)) throw new Error("not an FPVGate event");
      incoming = migrate(data);
    } catch (e) {
      note = `Couldn't read ${file.name}: ${e.message}.`;
      render();
      return;
    }
    if (!confirm(`Replace the current event with "${incoming.name || file.name}"? ${incoming.pilots.length} pilots, ${incoming.groups.length} groups, ${incoming.races.length} races. Export the current one first if you want to keep it.`)) return;
    delete incoming.fpvgateEvent;
    delete incoming.exported;
    incoming.active = null;   // the gate's slots hold whatever was loaded before
    doc = incoming;
    note = `Imported ${file.name}. Click a heat to load it into the gate.`;
    save();
    render();
  }

  // Every heat's result, one row per pilot, in the order they were raced.
  function resultRows() {
    const seq = sequence();
    return [...doc.races].sort((a, b) => a.timestamp - b.timestamp).flatMap(race => {
      const group = byId(doc.groups, race.groupId);
      const format = formatById(race.formatId);
      const heat = race.step != null && seq[race.step] === race.groupId ? `Heat ${race.step + 1}` : "";
      return raceStandings(race).map((r, i) => ({
        heat, group: group ? group.name : "", time: new Date(race.timestamp * 1000), position: i + 1,
        pilot: pilotName(r.pilotId), result: resultText(r, format.win), format: format.name, r }));
    });
  }

  function exportResultsCsv() {
    const sec = ms => ms == null ? "" : (ms / 1000).toFixed(3);
    const lines = [csvLine(["Event", "Heat", "Group", "Time", "Format", "Position", "Pilot", "Result", "Laps", "Total (s)", "Best lap (s)", `Best ${CONSECUTIVE} (s)`, "Lap times (s)"])];
    for (const x of resultRows()) {
      lines.push(csvLine([doc.name, x.heat, x.group, x.time.toLocaleString(), x.format, x.position, x.pilot, x.result, x.r.lapCount,
        sec(x.r.total), sec(x.r.best), sec(x.r.best3), x.r.laps.map(ms => (ms / 1000).toFixed(3)).join(" ")]));
    }
    download(`${fileStamp()}-results.csv`, "text/csv", lines.join("\r\n") + "\r\n");
  }

  // A standalone page: leaderboard, each group's standings, and every heat.
  function exportResultsReport() {
    const stats = pilotStats();
    const leaders = [...stats.values()].filter(s => s.races).sort((a, b) => asc(a.best3, b.best3) || asc(a.best, b.best));
    const table = (head, rows) => `<table><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
    const groups = doc.groups.map(g => {
      const rows = groupStandings(g);
      if (!rows.length) return "";
      const win = formatOf(g).win;
      return `<h3>${esc(g.name)} <small>${esc(formatOf(g).name)} · ${esc(WIN[win])}</small></h3>` +
        table(["#", "Pilot", "Result", "Laps", "Best lap", `Best ${CONSECUTIVE}`],
              rows.map((r, i) => [i + 1, esc(pilotName(r.pilotId)), esc(resultText(r, win)), r.lapCount, fmtMs(r.best), fmtMs(r.best3)]));
    }).join("");
    const byRace = new Map();
    for (const x of resultRows()) {
      const key = `${x.heat}|${x.group}|${x.time.getTime()}`;
      if (!byRace.has(key)) byRace.set(key, { title: [x.heat, x.group].filter(Boolean).join(" · "), time: x.time, rows: [] });
      byRace.get(key).rows.push(x);
    }
    const heats = [...byRace.values()].map(h => `<h3>${esc(h.title)} <small>${esc(h.time.toLocaleTimeString())}</small></h3>` +
      table(["#", "Pilot", "Result", "Laps", "Best lap", `Best ${CONSECUTIVE}`],
            h.rows.map(x => [x.position, esc(x.pilot), esc(x.result), x.r.lapCount, fmtMs(x.r.best), fmtMs(x.r.best3)]))).join("");
    const title = esc(doc.name || "Event");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} results</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#222}
h1{margin-bottom:0}h2{margin-top:32px;border-bottom:2px solid #009688;padding-bottom:4px}h3{margin:20px 0 6px}
small{font-weight:normal;color:#666}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd}th{font-size:12px;text-transform:uppercase;color:#666}
td:first-child{width:32px}.meta{color:#666}@media print{h2{break-after:avoid}table{break-inside:avoid}}</style></head><body>
<h1>${title}</h1><p class="meta">${esc(new Date().toLocaleDateString())} · ${doc.pilots.length} pilots · ${doc.races.length} races · FPVGate</p>
<h2>Leaderboard</h2>${table(["#", "Pilot", `Best ${CONSECUTIVE}`, "Best lap", "Elo", "Races", "Laps"],
  leaders.map((r, i) => [i + 1, esc(pilotName(r.pilotId)), fmtMs(r.best3), fmtMs(r.best), Math.round(r.elo), r.races, r.lapCount]))}
${groups ? `<h2>Groups</h2>${groups}` : ""}
<h2>Heats</h2>${heats || "<p>No races yet.</p>"}
</body></html>`;
    download(`${fileStamp()}-results.html`, "text/html", html);
  }

  // ---- editing ---------------------------------------------------------------------------------

  const NUMERIC = new Set(["maxLaps", "timeLimitS", "minLapS", "countdown", "formatId", "freq", "groupSize"]);

  // Which field has focus, by what it edits, so it survives a re-render.
  function focusKey(el) {
    if (!el || !el.closest || !el.closest("#eventPanel")) return null;
    const holder = el.closest("[data-coll]");
    return [holder && holder.dataset.coll, holder && holder.dataset.id, el.dataset.f, el.dataset.pid, el.dataset.act].join("|");
  }

  // "change" fires before Tab moves focus: render once it has moved, then
  // put focus back on the same field.
  let renderQueued = false;
  function renderKeepingFocus() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => {
      renderQueued = false;
      const key = focusKey(document.activeElement);
      render();
      if (!key) return;
      const match = [...document.querySelectorAll("#eventPanel input, #eventPanel select, #eventPanel button")].find(el => focusKey(el) === key);
      if (match) match.focus();
    }, 0);
  }

  function onChange(e) {
    if (!doc) return;
    const t = e.target;
    const holder = t.closest("[data-coll]");
    if (!holder) {
      // Header and heat settings.
      if (t.dataset.f === "name") doc.name = t.value.trim();
      else if (t.dataset.f === "seed") doc.seed = t.value;
      else if (t.dataset.f === "band") doc.band = t.value;
      else if (t.dataset.f === "groupSize") doc.groupSize = Number(t.value);
      else if (t.dataset.f === "auto") doc.schedule.auto = t.checked;
      else return;
      save();
      renderKeepingFocus();
      return;
    }
    const item = byId(doc[holder.dataset.coll], +holder.dataset.id);
    if (!item) return;
    if (t.classList.contains("ev-ch")) {
      // A group's channel for one pilot: the pilot's own channel clears the override.
      const pid = +t.dataset.pid, f = Number(t.value) || 0, p = byId(doc.pilots, pid);
      item.overrides = item.overrides || {};
      if (p && (f === p.freq || !p.freq)) {
        if (!p.freq) p.freq = f;
        delete item.overrides[pid];
      } else {
        item.overrides[pid] = f;
      }
    } else if (t.dataset.actChange === "seat") {
      if (t.value === "") return;
      item.pilotIds.push(+t.value);
    } else if (t.dataset.f) {
      item[t.dataset.f] = NUMERIC.has(t.dataset.f) ? Number(t.value) || 0 : t.value.trim();
      if (t.dataset.f === "timeLimitS") item.timeLimitS = Math.round(item.timeLimitS / 30) * 30;
    }
    save();
    renderKeepingFocus();
  }

  function onClick(e) {
    if (!doc) return;
    const btn = e.target.closest("[data-act]");
    if (!btn) {
      // Clicking a heat loads it.
      const heat = e.target.closest("[data-step]");
      if (heat && +heat.dataset.step !== activeStep()) loadStep(+heat.dataset.step);
      return;
    }
    const holder = e.target.closest("[data-coll]");
    const coll = holder && holder.dataset.coll, id = holder && +holder.dataset.id;
    switch (btn.dataset.act) {
      case "add-pilot":
        doc.pilots.push({ id: newId(), name: "", phonetic: "", color: COLORS[doc.pilots.length % COLORS.length], freq: 0, enter: 0, exit: 0 });
        break;
      case "add-format":
        doc.formats.push({ ...doc.formats[0], id: newId(), name: "New format" });
        break;
      case "add-group":
        doc.groups.push({ id: newId(), name: groupName(doc.groups.length), formatId: doc.formats[0].id, pilotIds: [], overrides: {} });
        break;
      case "build":
        buildGroups();
        break;
      case "channels":
        note = channelNote(assignChannels()) + " Load a heat to send them to the gate.";
        break;
      case "unseat": {
        const group = byId(doc.groups, id), pid = +btn.dataset.pid;
        group.pilotIds = group.pilotIds.filter(x => x !== pid);
        if (group.overrides) delete group.overrides[pid];
        break;
      }
      case "race-now":
        loadGroup(id, null);
        return;
      case "export-pilots": exportPilots(); return;
      case "import-pilots": importPilots(); return;
      case "export-event": exportEvent(); return;
      case "import-event": importEvent(); return;
      case "export-results-csv": exportResultsCsv(); return;
      case "export-results-report": exportResultsReport(); return;
      case "restart":
        if (!confirm("Go back to Heat 1? Results so far are kept.")) return;
        doc.schedule.pos = 0;
        note = "";
        break;
      case "edit-order":
        openOrder();
        return;
      case "sort":
        leaderSort = btn.dataset.key;
        render();
        return;
      case "elo-info": {
        const info = document.getElementById("evEloInfo");
        if (info) info.hidden = !info.hidden;
        return;
      }
      case "del-race":
        if (!confirm("Remove this heat's result?")) return;
        doc.races = doc.races.filter(r => r.id !== +btn.dataset.race);
        break;
      case "del": {
        const item = byId(doc[coll], id);
        if (!item) return;
        const label = { pilots: "pilot", formats: "format", groups: "group" }[coll];
        if (coll === "groups" && racesOf(item).length) {
          if (!confirm(`Remove ${item.name} and its ${racesOf(item).length} race(s) of results?`)) return;
        } else if (coll !== "groups" && !confirm(`Remove this ${label}?`)) {
          return;
        }
        doc[coll] = doc[coll].filter(x => x.id !== id);
        if (coll === "pilots") doc.groups.forEach(g => { g.pilotIds = g.pilotIds.filter(x => x !== id); });
        if (coll === "formats") doc.groups.forEach(g => { if (g.formatId === id) g.formatId = doc.formats[0].id; });
        if (coll === "groups") {
          doc.races = doc.races.filter(r => r.groupId !== id);
          doc.schedule.blocks.forEach(b => { b.groupIds = b.groupIds.filter(x => x !== id); });
          if (doc.active && doc.active.groupId === id) doc.active = null;
        }
        break;
      }
      case "new-event":
        if (!confirm("Start a new event? This removes every pilot, group, heat and result in the current one.")) return;
        doc = blank();
        note = "";
        break;
      default:
        return;
    }
    save();
    render();
  }

  const host = document.getElementById("eventPanel");
  if (host) {
    host.addEventListener("change", onChange);
    host.addEventListener("click", onClick);
  }

  return { show, setEnabled, raceLabel, recordRace, nextHeat, refreshRaceTab: renderRaceTab, reload: load };
})();
