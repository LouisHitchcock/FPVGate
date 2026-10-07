// ESP32-C5 multi-pilot calibration (receiver type 2).
//
// One panel on the Calibration tab: link status, a band picker that fills
// the 8 pilot slots, the RF gain, a live chart of every pilot with labels
// on each line, and a card per pilot with its frequency, live level and its
// own Enter/Exit thresholds, pilot name, spoken name, colour and Race switch.
// The selected pilot's thresholds are drawn on the chart and can be dragged.
// Changes save themselves (saveConfig() in script.js), so the thresholds the
// lap detector uses are always the ones shown. Slots with Race on count in
// races: one racer is a single-pilot race, two or more a multi-pilot race
// (script.js asks getRacePilots()).
//
// Data: the "c5Rssi" SSE event (lib/WEBSERVER/webserver.cpp), 10 per second:
//   { rssi:[8], freq:[8], in:[8], on, started, st, mhz, gain, race,
//     samples, seqGaps, queueDrops, scan, records, badRecords, pollGapMaxUs,
//     racers (bit mask), multi }
// and "c5Lap" { pilot, lap, lapTimeMs, racer }. The counters are running
// totals; the stats row shows rates and recent increases worked out from them.
//
// Uses freqLookup and bandDefinitions from script.js.
"use strict";

const C5UI = (() => {
  const SLOTS = 8;
  const RSSI_SCALE = 4; // C5 wire value is 0..1023; profiles remain 0..255.
  const MIN_MHZ = 5180, MAX_MHZ = 5917;   // includes Raceband R8 via the C5 PHY hop path
  const COLORS = ["#ff6b6b", "#f7b32b", "#06d6a0", "#4cc9f0", "#a78bfa", "#f78c6b", "#7bd389", "#f472b6"];
  const HISTORY_S = 125;
  const SAVE_DELAY_MS = 800;
  const RATE_WINDOW_S = 2;    // sample rate averaged over this
  const RECENT_S = 10;        // link errors counted as "recent" within this
  const SLOT_MS = 16;         // older C5 firmware: one 16 ms slot per pilot (C5Link::SLOT_MS)

  // Frequency alone is not a unique channel identity: F8 and R7 are both
  // 5880 MHz. Keep the selected band alongside each UI profile.
  const pilots = Array.from({ length: SLOTS }, (_, i) => ({ freq: 0, bandIndex: 4, enter: 72, exit: 68, hidden: false,
                                                            name: "", phonetic: "", color: COLORS[i], race: false }));
  const hist = Array.from({ length: SLOTS }, () => ({ t: [], v: [] }));
  const laps = Array.from({ length: SLOTS }, () => ({ count: 0, last: null, best: null, flashUntil: 0 }));
  let gain = 30;
  let focus = 0;
  let live = { on: false, started: false, st: "", mhz: 0, gain: null, race: false, inside: [], at: 0, scan: false };
  // Running link counters from each event: { t, samples, gaps, drops, bad, pollUs }.
  let linkHist = [];
  let windowS = 30;
  let frozenAt = null;
  let showAllThresholds = false;
  let hoverX = null;
  let drag = null;           // { which: "enter" | "exit" }
  let built = false;
  let visible = false;
  let saveTimer = null;
  let saveState = "";        // "", "pending", "saving", "saved", "error"
  let calib = { phase: "idle", ambient: [], samples: [], results: [] };
  let lastCards = 0;
  let geom = null;           // chart geometry from the last draw

  const $ = (sel, root) => (root || document).querySelector(sel);
  const now = () => performance.now() / 1000;
  const inRange = f => f >= MIN_MHZ && f <= MAX_MHZ;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const colorOf = i => pilots[i].color || COLORS[i];
  const hexColor = n => "#" + (Number(n) >>> 0 & 0xffffff).toString(16).padStart(6, "0");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isRacer = i => !!pilots[i].freq && pilots[i].race;
  // "Louis" or, with no name, "P5 R5".
  const pilotLabel = i => pilots[i].name || `P${i + 1}` + (pilots[i].freq ? " " + channelName(pilots[i].freq, pilots[i].bandIndex) : "");

  // ---- channel names ------------------------------------------------------------

  function bandTables() {
    // From script.js; empty if it hasn't loaded.
    return typeof bandDefinitions !== "undefined" && typeof freqLookup !== "undefined"
      ? bandDefinitions.map(b => ({ ...b, freqs: freqLookup[b.index] || [] })) : [];
  }

  function channelName(freq, preferredBandIndex) {
    if (!freq) return "Off";
    const bands = bandTables().filter(b => b.system === "analog");
    // C5 profiles historically store only MHz; Raceband is the default C5
    // profile set, so use it as the unambiguous fallback for shared values.
    const preferred = bands.find(b => b.index === preferredBandIndex) || bands.find(b => b.value === "R");
    if (preferred) {
      const i = preferred.freqs.indexOf(freq);
      if (i >= 0) return preferred.value + (i + 1);
    }
    for (const b of bands) {
      const i = b.freqs.indexOf(freq);
      if (i >= 0) return b.value + (i + 1);
    }
    return freq + "";
  }

  // ---- building the panel ----------------------------------------------------------

  function freqOptions(selected, preferredBandIndex) {
    let html = `<option value="0"${selected ? "" : " selected"}>Off</option>`;
    let found = !selected;
    const tables = bandTables();
    const preferred = tables.find(b => b.index === preferredBandIndex);
    const preferredHas = preferred && preferred.freqs.includes(selected);
    for (const b of tables) {
      if (b.system !== "analog") continue;
      html += `<optgroup label="${b.label}">`;
      b.freqs.forEach((f, i) => {
        if (!f) return;
        const ok = inRange(f);
        const sel = f === selected && !found && (!preferredHas || b.index === preferredBandIndex) ? " selected" : "";
        if (sel) found = true;
        html += `<option value="${f}"${sel}${ok ? "" : " disabled"}>${b.value}${i + 1} · ${f}${ok ? "" : " (not supported)"}</option>`;
      });
      html += "</optgroup>";
    }
    if (!found) html += `<option value="${selected}" selected>${selected} MHz</option>`;
    html += `<option value="custom">Other MHz…</option>`;
    return html;
  }

  function build() {
    const host = document.getElementById("c5Panel");
    if (!host || built) return;
    built = true;
    const bands = bandTables();
    const bandOpts = bands.map(b => {
      const usable = b.freqs.filter(f => f && inRange(f)).length;
      return `<option value="${b.index}"${b.value === "R" ? " selected" : ""}>${b.label} · ${usable}/8 usable</option>`;
    }).join("");
    // One card: receiver controls in the header, the chart with an editor
    // for the selected pilot on the left, and a row per pilot on the right.
    host.innerHTML = `
      <div class="calib-card c5p-panel">
        <div class="calib-card-header c5p-head">
          <span>Multi-Pilot Calibration</span>
          <div class="c5p-headctl">
            <select id="c5pBand" class="c5p-mini" title="Band">${bandOpts}</select>
            <button class="c5p-btn c5p-small" id="c5pFill" title="Put the band's channels in pilots 1-8">Fill</button>
            <span class="c5p-step" title="Receiver gain"><span class="c5p-ctl-l">Gain</span><button class="c5p-btn c5p-small c5p-sq" data-gain="-1">−</button><input type="number" id="c5pGain" class="c5p-mini" min="0" max="89" value="${gain}"><button class="c5p-btn c5p-small c5p-sq" data-gain="1">+</button></span>
            <button class="calib-wizard-btn" id="c5pCalStart" title="Measure the empty gate, then each pilot's passes, and set every threshold">Auto-calibrate</button>
          </div>
        </div>
        <div class="c5p-status" id="c5pStatus"><span class="c5p-dot"></span><span id="c5pStatusText">Waiting for data from FPVGate…</span><span class="c5p-save" id="c5pSave"></span></div>
        <div class="c5p-fillnote" id="c5pFillNote"></div>
        <div class="c5p-auto" id="c5pAuto">
          <span class="c5p-phase" id="c5pPhase"></span>
          <span class="c5p-count" id="c5pCalCount"></span>
          <button class="c5p-btn c5p-small" id="c5pCalStop" disabled>Calculate thresholds</button>
        </div>
        <div class="c5p-main">
          <div class="c5p-left">
            <div class="calib-chart-wrapper c5p-chartwrap"><canvas id="c5pChart"></canvas><div class="c5p-tip" id="c5pTip"></div></div>
            <div class="c5p-chartctl">
              <select id="c5pWindow" class="c5p-mini" title="Chart window"><option value="10">10 s</option><option value="30" selected>30 s</option><option value="60">60 s</option><option value="120">2 min</option></select>
              <label class="c5p-check"><input type="checkbox" id="c5pAllTh"> All thresholds</label>
              <button class="c5p-btn c5p-small" id="c5pPause">Pause</button>
              <span class="c5p-hint" id="c5pFocusHint"></span>
            </div>
            <div class="c5p-editor" id="c5pEditor">
              <div class="c5p-ed-head">
                <span class="c5p-eye" data-i="0"></span>
                <span class="c5p-name" id="c5pEdName"></span>
                <label class="c5p-racetg" title="Count this pilot's laps in races"><input type="checkbox" class="c5p-racechk" data-i="0"> Race</label>
              </div>
              <div class="c5p-ed-grid">
                <div class="calib-input-group"><label>Channel</label><select class="calib-select c5p-freq" data-i="0"></select></div>
                <div class="calib-input-group"><label>Name</label>
                  <div class="c5p-id"><input type="text" class="calib-select c5p-pname" data-i="0" maxlength="20" placeholder="Pilot name">
                  <input type="color" class="c5p-pcolor" data-i="0" title="Pilot colour (chart, race table, gate LEDs)"></div></div>
                <div class="calib-input-group"><label>Spoken as</label><input type="text" class="calib-select c5p-pphon" data-i="0" maxlength="20" placeholder="Optional"></div>
                <div class="calib-threshold-item">
                  <div class="calib-threshold-header"><label>Enter RSSI</label><span class="calib-threshold-value c5p-thv" data-th="enter"></span></div>
                  <input type="range" min="1" max="255" class="calib-slider enter-slider c5p-in" data-i="0" data-th="enter">
                </div>
                <div class="calib-threshold-item">
                  <div class="calib-threshold-header"><label>Exit RSSI</label><span class="calib-threshold-value c5p-thv" data-th="exit"></span></div>
                  <input type="range" min="0" max="254" class="calib-slider exit-slider c5p-in" data-i="0" data-th="exit">
                </div>
                <div class="c5p-ed-meta"><div class="c5p-meta" id="c5pMeta"></div><div class="c5p-calres" id="c5pCal"></div></div>
              </div>
            </div>
          </div>
          <div class="c5p-list" id="c5pCards"></div>
        </div>
        <details class="c5p-diagnostics"><summary>Receiver diagnostics</summary><div class="c5p-stats" id="c5pStats"></div></details>
      </div>`;
    buildCards();
    wire();
  }

  // One compact row per pilot. The editor above shows the selected one.
  function buildCards() {
    const el = document.getElementById("c5pCards");
    if (!el) return;
    el.innerHTML = `<div class="c5p-list-head"><span></span><span>Pilot</span><span>Signal</span><span>Enter/Exit</span><span>Race</span></div>` +
      pilots.map((p, i) => `
      <div class="c5p-row" data-i="${i}" style="--c:${colorOf(i)}">
        <button class="c5p-eye" data-i="${i}" title="Show or hide on the chart"></button>
        <span class="c5p-row-name"><b class="c5p-ch"></b><span class="c5p-nm"></span></span>
        <span class="c5p-row-sig">
          <span class="c5p-bar"><span class="c5p-fill" id="c5pFill${i}"></span><span class="c5p-mk c5p-mk-enter" id="c5pMkE${i}"></span><span class="c5p-mk c5p-mk-exit" id="c5pMkX${i}"></span></span>
          <span class="c5p-val" id="c5pVal${i}">–</span>
          <span class="c5p-gate" id="c5pGate${i}"></span>
        </span>
        <span class="c5p-row-th"></span>
        <input type="checkbox" class="c5p-racechk" data-i="${i}" title="Count this pilot's laps in races">
      </div>`).join("");
    editorKey = "";
    refreshCardStates();
  }

  let editorKey = "";   // focus:freq:band the editor's channel list was built for
  function refreshCardStates() {
    document.querySelectorAll(".c5p-row").forEach(row => {
      const i = +row.dataset.i, p = pilots[i];
      row.classList.toggle("c5p-off", !p.freq);
      row.classList.toggle("c5p-focus", i === focus);
      row.classList.toggle("c5p-hidden", p.hidden);
      row.style.setProperty("--c", colorOf(i));
      row.querySelector(".c5p-ch").textContent = p.freq ? channelName(p.freq, p.bandIndex) : "Off";
      row.querySelector(".c5p-nm").textContent = p.name || `Pilot ${i + 1}`;
      row.querySelector(".c5p-row-th").textContent = p.freq ? `${p.enter} / ${p.exit}` : "–";
      row.querySelector(".c5p-racechk").checked = p.race;
    });
    const ed = $("#c5pEditor");
    if (ed) {
      const p = pilots[focus];
      ed.style.setProperty("--c", colorOf(focus));
      ed.classList.toggle("c5p-race", isRacer(focus));
      ed.classList.toggle("c5p-hidden", p.hidden);
      ed.querySelectorAll("[data-i]").forEach(el => { el.dataset.i = focus; });
      $("#c5pEdName").textContent = `Pilot ${focus + 1}` + (p.freq ? " · " + channelName(p.freq, p.bandIndex) + " · " + p.freq + " MHz" : " · Off");
      const key = `${focus}:${p.freq}:${p.bandIndex}`;
      const freq = ed.querySelector(".c5p-freq");
      if (key !== editorKey && document.activeElement !== freq) {
        freq.innerHTML = freqOptions(p.freq, p.bandIndex);
        editorKey = key;
      }
      for (const [cls, k] of [[".c5p-pname", "name"], [".c5p-pphon", "phonetic"], [".c5p-pcolor", "color"]]) {
        const inp = ed.querySelector(cls);
        if (document.activeElement !== inp) inp.value = p[k];
      }
      ed.querySelector(".c5p-racechk").checked = p.race;
      // Always set: a slider keeps focus after use, and Enter can push Exit.
      ed.querySelectorAll(".c5p-in").forEach(inp => { inp.value = p[inp.dataset.th]; });
      ed.querySelectorAll(".c5p-thv").forEach(el => { el.textContent = p[el.dataset.th]; });
    }
  }

  // ---- interaction --------------------------------------------------------------------

  function wire() {
    $("#c5pFill").onclick = fillFromBand;
    $("#c5pGain").onchange = e => setGain(+e.target.value);
    document.querySelectorAll("[data-gain]").forEach(b => { b.onclick = () => setGain(gain + +b.dataset.gain); });
    $("#c5pWindow").onchange = e => { windowS = +e.target.value; };
    $("#c5pAllTh").onchange = e => { showAllThresholds = e.target.checked; };
    $("#c5pPause").onclick = () => {
      frozenAt = frozenAt === null ? now() : null;
      $("#c5pPause").textContent = frozenAt === null ? "Pause" : "Resume";
      $("#c5pPause").classList.toggle("c5p-on", frozenAt !== null);
    };
    $("#c5pCalStart").onclick = startCalibration;
    $("#c5pCalStop").onclick = stopCalibration;

    // The pilot rows and the selected-pilot editor share these handlers;
    // every pilot control carries its slot in data-i.
    const cards = document.getElementById("c5Panel");
    cards.addEventListener("click", e => {
      const t = e.target;
      if (t.classList.contains("c5p-eye")) {
        const i = +t.dataset.i;
        pilots[i].hidden = !pilots[i].hidden;
        refreshCardStates();
        return;
      }
      // Not on the Race box: re-rendering would undo the tick before "change".
      const row = t.closest(".c5p-row");
      if (row && !t.matches("input") && focus !== +row.dataset.i) {
        focus = +row.dataset.i;
        refreshCardStates();
      }
    });
    cards.addEventListener("change", e => {
      const t = e.target, i = +t.dataset.i;
      if (t.classList.contains("c5p-freq")) {
        let f = t.value;
        if (f === "custom") {
          const v = parseInt(prompt(`Frequency in MHz (${MIN_MHZ}–${MAX_MHZ}):`, pilots[i].freq || ""), 10);
          f = Number.isFinite(v) && inRange(v) ? v : pilots[i].freq;
          t.innerHTML = freqOptions(f);
        }
        const selectedBand = +$("#c5pBand").value;
        setFreq(i, +f, Number.isInteger(selectedBand) ? selectedBand : pilots[i].bandIndex);
      } else if (t.classList.contains("c5p-in")) {
        setThreshold(i, t.dataset.th, parseInt(t.value, 10));
      } else if (t.classList.contains("c5p-pname") || t.classList.contains("c5p-pphon")) {
        pilots[i][t.classList.contains("c5p-pname") ? "name" : "phonetic"] = t.value.trim().slice(0, 20);
        scheduleSave();
      } else if (t.classList.contains("c5p-racechk")) {
        pilots[i].race = t.checked;
        refreshCardStates();
        scheduleSave();
      }
    });
    // Sliders and colours preview live; sliders save on change.
    cards.addEventListener("input", e => {
      const t = e.target;
      if (t.classList.contains("c5p-in")) {
        setThreshold(+t.dataset.i, t.dataset.th, parseInt(t.value, 10), true);
        return;
      }
      if (!t.classList.contains("c5p-pcolor")) return;
      pilots[+t.dataset.i].color = t.value;
      refreshCardStates();
      scheduleSave();
    });

    const cv = document.getElementById("c5pChart");
    cv.addEventListener("pointermove", e => {
      hoverX = e.offsetX;
      if (drag) {
        setThreshold(focus, drag.which, Math.round(geom.invY(e.offsetY)), true);
        return;
      }
      const near = nearThreshold(e.offsetY);
      cv.style.cursor = near ? "ns-resize" : "crosshair";
    });
    cv.addEventListener("pointerleave", () => { if (!drag) hoverX = null; });
    cv.addEventListener("pointerdown", e => {
      const near = nearThreshold(e.offsetY);
      if (!near) return;
      drag = { which: near };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      scheduleSave();
    };
    cv.addEventListener("pointerup", endDrag);
    cv.addEventListener("pointercancel", endDrag);
  }

  function nearThreshold(y) {
    if (!geom || !pilots[focus].freq || pilots[focus].hidden) return null;
    const p = pilots[focus];
    const de = Math.abs(y - geom.Y(p.enter)), dx = Math.abs(y - geom.Y(p.exit));
    if (Math.min(de, dx) > 9) return null;
    return de <= dx ? "enter" : "exit";
  }

  function setGain(v) {
    if (live.race) return;
    v = clamp(Math.round(v) || 0, 0, 89);
    gain = v;
    const inp = $("#c5pGain");
    if (inp) inp.value = v;
    scheduleSave();
  }

  function setFreq(i, f, bandIndex) {
    if (live.race) return;
    pilots[i].freq = f && inRange(f) ? f : 0;
    if (Number.isInteger(bandIndex)) pilots[i].bandIndex = bandIndex;
    hist[i].t.length = hist[i].v.length = 0;
    laps[i] = { count: 0, last: null, best: null, flashUntil: 0 };
    calib.results[i] = undefined;
    refreshCardStates();
    scheduleSave();
  }

  // Keeps exit below enter: moving one past the other pushes it along.
  function setThreshold(i, which, v, dragging) {
    if (live.race) return;
    if (!Number.isFinite(v)) return;
    const p = pilots[i];
    if (which === "enter") {
      p.enter = clamp(v, 1, 255);
      if (p.exit >= p.enter) p.exit = p.enter - 1;
    } else {
      p.exit = clamp(v, 0, 254);
      if (p.enter <= p.exit) p.enter = p.exit + 1;
    }
    refreshCardStates();
    if (!dragging) scheduleSave();
  }

  function fillFromBand() {
    if (live.race) return;
    const idx = +$("#c5pBand").value;
    const b = bandTables().find(x => x.index === idx);
    if (!b) return;
    const skipped = [];
    for (let i = 0; i < SLOTS; i++) {
      const f = b.freqs[i] || 0;
      if (f && !inRange(f)) skipped.push(`${b.value}${i + 1} (${f} MHz)`);
      pilots[i].freq = f && inRange(f) ? f : 0;
      pilots[i].bandIndex = idx;
      hist[i].t.length = hist[i].v.length = 0;
      laps[i] = { count: 0, last: null, best: null, flashUntil: 0 };
    }
    calib.results = [];
    buildCards();
    const note = $("#c5pFillNote");
    if (note) {
      note.textContent = skipped.length
        ? `Filled from ${b.label}. Left off: ${skipped.join(", ")}: outside the C5's ${MIN_MHZ}–${MAX_MHZ} MHz range.`
        : `Filled pilots 1–8 from ${b.label}.`;
    }
    scheduleSave();
  }

  // ---- saving ------------------------------------------------------------------------

  function setSaveState(s) {
    saveState = s;
    const el = $("#c5pSave");
    if (!el) return;
    el.textContent = { pending: "Unsaved changes…", saving: "Saving…", saved: "Saved ✓", error: "Save failed" }[s] || "";
    el.className = "c5p-save" + (s ? " c5p-save-" + s : "");
  }

  function scheduleSave() {
    setSaveState("pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      setSaveState("saving");
      try {
        await saveConfig();
        setSaveState("saved");
      } catch (e) {
        console.error("[C5] save failed", e);
        setSaveState("error");
      }
    }, SAVE_DELAY_MS);
  }

  // ---- data ---------------------------------------------------------------------------

  function onRssi(d) {
    const t = now();
    const rssi = (d.rssi || []).map(v => Number(v) / RSSI_SCALE);
    live = { on: !!d.on, started: d.started !== false, st: d.st || "", mhz: d.mhz || 0, gain: d.gain,
             race: !!d.race, inside: d.in || [], at: t, scan: !!d.scan,
             racers: +d.racers || 0, multi: !!d.multi };
    recordLink(t, d);
    for (let i = 0; i < SLOTS; i++) {
      // Older firmware sends only the enabled pilots' RSSI, no "freq".
      const enabled = d.freq ? !!d.freq[i] : i < rssi.length;
      if (!enabled || rssi[i] == null || !pilots[i].freq) continue;
      const h = hist[i];
      h.t.push(t);
      h.v.push(+rssi[i]);
      if (h.t[0] < t - HISTORY_S - 5) {
        const n = lowerBound(h.t, t - HISTORY_S);
        h.t.splice(0, n);
        h.v.splice(0, n);
      }
    }
    recordCalibrationSample(rssi);
    if (built) {
      document.querySelectorAll("#c5pCards input, #c5pEditor input, #c5pEditor select, #c5pGain, [data-gain], #c5pFill, #c5pBand").forEach(el => { el.disabled = live.race; });
      $("#c5pCalStart").disabled = live.race || calib.phase === "ambient" || calib.phase === "recording";
      if (live.race && (calib.phase === "ambient" || calib.phase === "recording")) {
        calib.phase = "idle";
        $("#c5pCalStop").disabled = true;
      }
      $("#c5pFocusHint").textContent = live.race ? "Race running — stop the race to change calibration." : "Drag the selected pilot's Enter and Exit lines on the chart.";
    }
  }

  function recordLink(t, d) {
    if (d.samples == null) return;   // older S3 firmware: no counters
    const e = { t, samples: +d.samples || 0, gaps: +d.seqGaps || 0, drops: +d.queueDrops || 0,
                bad: +d.badRecords || 0, pollUs: +d.pollGapMaxUs || 0 };
    const prev = linkHist[linkHist.length - 1];
    if (prev && e.samples < prev.samples) linkHist = [];   // the S3 restarted
    linkHist.push(e);
    const keep = lowerBound(linkHist.map(x => x.t), t - RECENT_S - 1);
    if (keep > 0) linkHist.splice(0, keep);
  }

  // Rates over RATE_WINDOW_S, error increases over RECENT_S, worst S3 poll gap.
  function linkStats() {
    if (linkHist.length < 2) return null;
    const last = linkHist[linkHist.length - 1];
    if (now() - last.t > 3) return null;
    const at = s => linkHist[Math.min(lowerBound(linkHist.map(x => x.t), last.t - s), linkHist.length - 2)];
    const r = at(RATE_WINDOW_S), old = at(RECENT_S);
    const dt = last.t - r.t;
    const enabled = pilots.filter(p => p.freq).length;
    const total = dt > 0 ? (last.samples - r.samples) / dt : 0;
    let pollUs = 0;
    for (const x of linkHist) if (x.t >= last.t - RECENT_S) pollUs = Math.max(pollUs, x.pollUs);
    return { total, perPilot: enabled ? total / enabled : 0, enabled, last,
             newGaps: last.gaps - old.gaps, newDrops: last.drops - old.drops, newBad: last.bad - old.bad, pollUs };
  }

  function onLap(d) {
    const i = +d.pilot;
    if (!(i >= 0 && i < SLOTS)) return;
    const L = laps[i];
    L.flashUntil = now() + 1.5;
    if (+d.lap === 0) return;   // Gate 1: start to first pass, not a lap
    L.count++;
    L.last = d.lapTimeMs;
    L.best = L.best == null ? d.lapTimeMs : Math.min(L.best, d.lapTimeMs);
  }

  function lowerBound(a, v) {
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
    return lo;
  }

  function stats(i, secs) {
    const h = hist[i];
    const tEnd = frozenAt ?? now();
    const j = lowerBound(h.t, tEnd - secs), k = lowerBound(h.t, tEnd + 1e-6);
    const vals = h.v.slice(j, k);
    if (!vals.length) return null;
    const sorted = vals.slice().sort((a, b) => a - b);
    return { min: sorted[0], max: sorted[sorted.length - 1], p10: sorted[Math.floor(0.1 * (sorted.length - 1))],
             last: vals[vals.length - 1], n: vals.length };
  }

  // ---- status and cards ------------------------------------------------------------------

  function renderStatus() {
    const el = $("#c5pStatus"), txt = $("#c5pStatusText");
    if (!el || !txt) return;
    const enabled = pilots.filter(p => p.freq).length;
    let cls = "c5p-warn", msg;
    if (!live.at || now() - live.at > 3) {
      msg = "No live data from FPVGate yet. Is the receiver set to ESP32-C5 and saved?";
      cls = "c5p-bad";
    } else if (!live.started) {
      msg = "The C5 link isn't running. Save the configuration with the ESP32-C5 receiver selected.";
      cls = "c5p-bad";
    } else if (!live.on) {
      msg = "No reply from the C5. Check the wiring (S3 D3 → C5 GPIO4, S3 D4 ← C5 GPIO5, GND) and that the C5 is powered.";
      cls = "c5p-bad";
    } else if (!enabled) {
      msg = "C5 online. No pilots set: pick a band and press Fill, or choose a frequency on a card.";
    } else {
      const err = /^ERR/.test(live.st);
      const ls = linkStats();
      const linkErr = ls && (ls.newGaps > 0 || ls.newDrops > 0 || ls.newBad > 0);
      cls = err ? "c5p-bad" : linkErr ? "c5p-warn" : "c5p-ok";
      const plural = `${enabled} pilot${enabled === 1 ? "" : "s"}`;
      msg = live.scan
        ? `C5 online · scanning ${plural} continuously`
        : `C5 online · ${live.st || "?"}${live.mhz ? " · tuning " + live.mhz + " MHz (" + channelName(live.mhz) + ")" : ""}` +
          ` · ${plural}, one ${SLOT_MS} ms slot each every ${enabled * SLOT_MS} ms (older C5 firmware)`;
      msg += ` · gain ${live.gain ?? gain}`;
      const racers = pilots.map((_, i) => i).filter(isRacer);
      if (racers.length === 1) {
        msg += ` · single-pilot race: ${pilotLabel(racers[0])}`;
      } else if (racers.length > 1) {
        msg += ` · ${racers.length} racing`;
      } else {
        msg += " · no pilot has Race on: races won't count laps";
        if (!err) cls = "c5p-warn";
      }
      if (live.race) msg += " · race running";
      if (err) msg += live.st === "ERR_FREQ" ? " · frequency outside 5180–5917 MHz" : " · the C5 reported an RF error";
      if (linkErr) msg += " · link errors in the last " + RECENT_S + " s";
    }
    el.className = "c5p-status " + cls;
    txt.textContent = msg;
    renderStats();
  }

  // Measured link figures, one chip each. Red when a counter rose recently.
  function renderStats() {
    const el = $("#c5pStats");
    if (!el) return;
    const s = linkStats();
    if (!s || !live.on) { el.innerHTML = ""; return; }
    const fmtHz = v => v >= 1000 ? (v / 1000).toFixed(2) + " kHz" : Math.round(v) + " Hz";
    const chip = (label, value, state, title) =>
      `<span class="c5p-chip${state ? " c5p-chip-" + state : ""}" title="${title}"><span class="c5p-chip-l">${label}</span>${value}</span>`;
    const err = (n, total) => `${total}${n > 0 ? ` <span class="c5p-chip-new">+${n}</span>` : ""}`;
    el.innerHTML = [
      chip("Mode", live.scan ? "Scan" : "Slots", live.scan ? "" : "warn",
           live.scan ? "The C5 cycles through every pilot itself" : "Older C5 firmware: the S3 tunes one pilot per 16 ms slot"),
      chip("Per pilot", s.enabled ? fmtHz(s.perPilot) : "–", s.enabled && s.perPilot < 900 ? "warn" : "",
           `Samples per second for each pilot, averaged over ${RATE_WINDOW_S} s`),
      chip("Total", fmtHz(s.total), "", `All pilots together, averaged over ${RATE_WINDOW_S} s`),
      chip("Seq gaps", err(s.newGaps, s.last.gaps), s.newGaps > 0 ? "bad" : "",
           `Records or samples lost on the UART (total; +new in the last ${RECENT_S} s)`),
      chip("Queue drops", err(s.newDrops, s.last.drops), s.newDrops > 0 ? "bad" : "",
           `Samples the S3 couldn't process in time (total; +new in the last ${RECENT_S} s)`),
      chip("Bad records", err(s.newBad, s.last.bad), s.newBad > 0 ? "bad" : "",
           `Records failing their checksum (total; +new in the last ${RECENT_S} s)`),
      chip("S3 poll", s.pollUs ? (s.pollUs / 1000).toFixed(1) + " ms" : "–", s.pollUs > 20000 ? "warn" : "",
           `Longest time between the S3's reads of the C5 link in the last ${RECENT_S} s`),
    ].join("");
  }

  function renderCards() {
    const t = now();
    pilots.forEach((p, i) => {
      const val = $(`#c5pVal${i}`);
      if (!val) return;
      const s = p.freq ? stats(i, 10) : null;
      const v = s ? s.last : null;
      val.textContent = v == null ? (p.freq ? "–" : "off") : v;
      const fill = $(`#c5pFill${i}`);
      fill.style.width = v == null ? "0%" : (v / 255 * 100) + "%";
      $(`#c5pMkE${i}`).style.left = (p.enter / 255 * 100) + "%";
      $(`#c5pMkX${i}`).style.left = (p.exit / 255 * 100) + "%";
      const gate = $(`#c5pGate${i}`);
      const L = laps[i];
      if (L.flashUntil > t) { gate.textContent = "LAP"; gate.className = "c5p-gate c5p-gate-lap"; gate.title = "Lap counted"; }
      else if (live.race && live.inside[i]) { gate.textContent = "IN"; gate.className = "c5p-gate c5p-gate-in"; gate.title = "In the gate"; }
      else if (v != null && v >= p.enter) { gate.textContent = "HIGH"; gate.className = "c5p-gate c5p-gate-above"; gate.title = "Above Enter"; }
      else { gate.textContent = ""; gate.className = "c5p-gate"; gate.title = ""; }
      if (i !== focus) return;
      // The editor's detail lines are for the selected pilot only.
      const lapTxt = L.count ? ` · laps ${L.count} · last ${(L.last / 1000).toFixed(2)} s · best ${(L.best / 1000).toFixed(2)} s` : "";
      $("#c5pMeta").textContent = s ? `Last 10 s: peak ${s.max} · floor ${s.p10}${lapTxt}` : (p.freq ? "Waiting for samples" : "Choose a channel to use this slot");
      const r = calib.results[i];
      $("#c5pCal").innerHTML = r && r.peak != null
        ? `Auto: floor ${r.floor}, noise ${r.noise}, peak ${r.peak} → <span class="${r.peak - r.noise >= 10 ? "c5p-good" : "c5p-badtxt"}">${r.peak - r.noise >= 10 ? "good margin" : "weak margin"}</span>`
        : "";
    });
    const auto = $("#c5pAuto");
    if (auto) auto.classList.toggle("c5p-active", calib.phase !== "idle");
  }

  // ---- chart ----------------------------------------------------------------------------

  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: r.width, H: r.height };
  }

  // Each chart keeps its own y-axis so the two never fight over the scale.
  const mainScale = { lo: 0, hi: 120 }, overlayScale = { lo: 0, hi: 120 };
  function yRange(t0, tEnd, scale, allThresholds) {
    let lo = Infinity, hi = -Infinity;
    pilots.forEach((p, i) => {
      if (!p.freq || p.hidden) return;
      const h = hist[i];
      for (let j = lowerBound(h.t, t0); j < h.t.length && h.t[j] <= tEnd; j++) {
        lo = Math.min(lo, h.v[j]);
        hi = Math.max(hi, h.v[j]);
      }
      if (i === focus || allThresholds) { lo = Math.min(lo, p.exit); hi = Math.max(hi, p.enter); }
    });
    if (!isFinite(lo)) { lo = 0; hi = 120; }
    // Round outwards to tens and only move when needed, so the axis is calm.
    const wantLo = clamp(Math.floor((lo - 8) / 10) * 10, 0, 245), wantHi = clamp(Math.ceil((hi + 8) / 10) * 10, 10, 260);
    if (drag && scale === mainScale) return;   // keep the scale still while dragging
    if (wantLo < scale.lo || wantLo > scale.lo + 30) scale.lo = wantLo;
    if (wantHi > scale.hi || wantHi < scale.hi - 30) scale.hi = Math.max(wantHi, scale.lo + 30);
  }

  function draw() {
    const cv = document.getElementById("c5pChart");
    if (!cv || !visible || cv.offsetParent === null) return;
    drawChart(cv, false);
  }

  // The Calibration chart, or (overlay) a compact copy for the Race tab's
  // debug overlay: fixed 20 s window, every pilot's Enter line, no editing.
  function drawChart(cv, overlay) {
    const { ctx, W, H } = fitCanvas(cv);
    ctx.clearRect(0, 0, W, H);
    const span = overlay ? 20 : windowS;
    const tEnd = overlay ? now() : (frozenAt ?? now()), t0 = tEnd - span;
    const scale = overlay ? overlayScale : mainScale;
    yRange(t0, tEnd, scale, overlay || showAllThresholds);
    const yLo = scale.lo, yHi = scale.hi;
    const box = overlay ? { l: 24, r: W - 58, t: 6, b: H - 14 } : { l: 36, r: W - 92, t: 10, b: H - 22 };
    const X = t => box.l + (t - t0) / span * (box.r - box.l);
    const Y = v => box.b - (v - yLo) / (yHi - yLo) * (box.b - box.t);
    if (!overlay) geom = { Y, invY: y => yLo + (box.b - y) / (box.b - box.t) * (yHi - yLo), box };
    const text = css("--text-color") || "#999", grid = css("--border-color") || "#444";

    ctx.font = overlay ? "9px system-ui, sans-serif" : "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    const step = (yHi - yLo) > 120 ? 40 : (yHi - yLo) > 60 ? 20 : 10;
    for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) {
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(box.l, Y(v)); ctx.lineTo(box.r, Y(v)); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(v, 2, Y(v) + 3);
    }
    const xs = span <= 10 ? 2 : span <= 30 ? 5 : span <= 60 ? 10 : 20;
    for (let s = 0; s <= span; s += xs) {
      const x = X(tEnd - s);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x, box.t); ctx.lineTo(x, box.b); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(s ? `-${s}s` : "now", x - (overlay ? 8 : 12), H - (overlay ? 3 : 6));
    }

    // Thresholds. Main: the selected pilot (draggable), or all of them.
    // Overlay: each pilot's Enter line, faint.
    pilots.forEach((p, i) => {
      if (!p.freq || p.hidden) return;
      if (overlay) {
        ctx.strokeStyle = colorOf(i);
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(box.l, Y(p.enter)); ctx.lineTo(box.r, Y(p.enter)); ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      if (i !== focus && !showAllThresholds) return;
      const sel = i === focus;
      ctx.strokeStyle = colorOf(i);
      ctx.globalAlpha = sel ? 0.95 : 0.4;
      for (const [which, dash] of [["enter", []], ["exit", [6, 5]]]) {
        const y = Y(p[which]);
        ctx.setLineDash(dash);
        ctx.lineWidth = sel ? (drag && drag.which === which ? 3 : 2) : 1;
        ctx.beginPath(); ctx.moveTo(box.l, y); ctx.lineTo(box.r, y); ctx.stroke();
        if (sel) {
          ctx.setLineDash([]);
          ctx.fillStyle = colorOf(i);
          const label = `${channelName(p.freq, p.bandIndex)} ${which} ${p[which]}`;
          const w = ctx.measureText(label).width + 10;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(box.l + 6, y - (which === "enter" ? 17 : -3), w, 14);
          ctx.fillStyle = "#111";
          ctx.fillText(label, box.l + 11, y - (which === "enter" ? 6 : -14));
        }
      }
      ctx.setLineDash([]);
    });
    ctx.globalAlpha = 1;

    // Lines.
    ctx.save();
    ctx.beginPath(); ctx.rect(box.l, box.t, box.r - box.l, box.b - box.t); ctx.clip();
    const labels = [];
    pilots.forEach((p, i) => {
      if (!p.freq || p.hidden) return;
      const h = hist[i];
      const j0 = Math.max(0, lowerBound(h.t, t0) - 1);
      ctx.strokeStyle = colorOf(i);
      ctx.lineWidth = overlay ? 1.4 : i === focus ? 2.4 : 1.6;
      ctx.beginPath();
      let last = null;
      for (let j = j0; j < h.t.length && h.t[j] <= tEnd; j++) {
        const x = X(h.t[j]), y = Y(h.v[j]);
        last === null ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        last = j;
      }
      ctx.stroke();
      if (last !== null && h.t[last] >= t0) labels.push({ i, v: h.v[last], x: X(h.t[last]), y: Y(h.v[last]) });
    });
    ctx.restore();
    drawLabels(ctx, box, labels, overlay);
    if (!overlay) drawHover(ctx, box, t0, X);
  }

  // Name and value at the end of each line, pushed apart so they never overlap.
  function drawLabels(ctx, box, labels, small) {
    const gap = small ? 11 : 15;
    labels.forEach(l => { l.ly = clamp(l.y, box.t + 6, box.b - 6); });
    labels.sort((a, b) => a.ly - b.ly);
    for (let k = 1; k < labels.length; k++) labels[k].ly = Math.max(labels[k].ly, labels[k - 1].ly + gap);
    const over = labels.length ? labels[labels.length - 1].ly - (box.b - 6) : 0;
    if (over > 0) labels.forEach(l => { l.ly -= over; });
    for (let k = labels.length - 2; k >= 0; k--) labels[k].ly = Math.min(labels[k].ly, labels[k + 1].ly - gap);
    ctx.font = small ? "600 10px system-ui, sans-serif" : "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    labels.forEach(l => {
      const c = colorOf(l.i);
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(l.x, clamp(l.y, box.t, box.b)); ctx.lineTo(box.r + 4, l.ly); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(l.x, clamp(l.y, box.t, box.b), 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(`${channelName(pilots[l.i].freq, pilots[l.i].bandIndex)} ${small ? Math.round(l.v) : l.v}`, box.r + 7, l.ly);
    });
    ctx.textBaseline = "alphabetic";
  }

  function drawHover(ctx, box, t0, X) {
    const tip = document.getElementById("c5pTip");
    if (hoverX === null || drag || hoverX < box.l || hoverX > box.r) { tip.style.display = "none"; return; }
    const t = t0 + (hoverX - box.l) / (box.r - box.l) * windowS;
    ctx.strokeStyle = css("--text-color") || "#999";
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(hoverX, box.t); ctx.lineTo(hoverX, box.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    let html = `<div class="c5p-tip-t">${(t - (frozenAt ?? now())).toFixed(1)} s</div>`;
    pilots.forEach((p, i) => {
      const h = hist[i];
      if (!p.freq || p.hidden || !h.t.length) return;
      let j = clamp(lowerBound(h.t, t), 0, h.t.length - 1);
      if (j > 0 && Math.abs(h.t[j - 1] - t) < Math.abs(h.t[j] - t)) j--;
      if (Math.abs(h.t[j] - t) > 1) return;
      html += `<div><span class="c5p-sw" style="background:${colorOf(i)}"></span>${channelName(p.freq, p.bandIndex)} <b>${h.v[j]}</b> <span class="c5p-dim">(enter ${p.enter} / exit ${p.exit})</span></div>`;
    });
    tip.innerHTML = html;
    tip.style.display = "block";
    // The tip sits in the chart wrapper, which pads the canvas.
    const cv = document.getElementById("c5pChart");
    tip.style.left = cv.offsetLeft + (hoverX + 14 + tip.offsetWidth > box.r ? hoverX - 14 - tip.offsetWidth : hoverX + 14) + "px";
    tip.style.top = cv.offsetTop + 8 + "px";
  }

  // ---- auto-calibration (ambient, then passes) ---------------------------------------------------

  function percentile(values, q) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  function startCalibration() {
    if (live.race || !live.on || now() - live.at > 3 || !pilots.some(p => p.freq)) {
      calib.phase = "blocked";
      $("#c5pPhase").textContent = "Stop the race, connect the receiver and assign a channel before calibrating.";
      return;
    }
    calib = { phase: "ambient", ambient: [], samples: [], results: [] };
    $("#c5pCalStart").disabled = true;
    $("#c5pCalStop").disabled = true;
    $("#c5pPhase").textContent = "Measuring the empty gate (5 s): keep every quad away…";
    setTimeout(() => {
      if (calib.phase !== "ambient") return;
      calib.phase = "recording";
      $("#c5pCalStop").disabled = false;
      $("#c5pPhase").textContent = "Now fly every pilot through the gate a few times, then press Calculate.";
    }, 5000);
  }

  function recordCalibrationSample(rssi) {
    if (calib.phase !== "ambient" && calib.phase !== "recording") return;
    const s = Array.from({ length: SLOTS }, (_, i) => Number(rssi[i]));
    const captured = calib.phase === "ambient" ? calib.ambient : calib.samples;
    if (captured.length < 6000) captured.push(s);
    const c = $("#c5pCalCount");
    if (c) c.textContent = `${calib.ambient.length} ambient · ${calib.samples.length} flight samples`;
  }

  function stopCalibration() {
    if (calib.phase !== "recording") return;
    let applied = 0;
    calib.results = pilots.map((p, i) => {
      const amb = calib.ambient.map(s => s[i]).filter(Number.isFinite);
      const fly = calib.samples.map(s => s[i]).filter(Number.isFinite);
      if (!p.freq || amb.length < 3 || fly.length < 3) return undefined;
      const floor = percentile(amb, 0.5), noise = percentile(amb, 0.95), peak = percentile(fly, 0.95);
      const range = Math.max(0, peak - floor);
      if (peak <= noise + 12) return undefined; // no clear gate pass: retain known thresholds
      // A noise margin, then hysteresis so Exit sits below Enter.
      const enter = clamp(Math.round(Math.max(noise + 8, floor + range * 0.55)), 1, 255);
      const exit = clamp(Math.round(Math.max(noise + 3, floor + range * 0.25)), 0, enter - 1);
      p.enter = enter;
      p.exit = exit;
      applied++;
      return { floor: Math.round(floor), noise: Math.round(noise), peak: Math.round(peak) };
    });
    calib.phase = "done";
    $("#c5pCalStart").disabled = false;
    $("#c5pCalStop").disabled = true;
    $("#c5pPhase").textContent = applied
      ? `Updated ${applied} pilot${applied === 1 ? "" : "s"}. Pilots without a clear pass keep their thresholds. Check the chart and wait for Saved.`
      : "No clear passes above background noise. Thresholds unchanged. Try again with each quad passing the gate.";
    refreshCardStates();
    if (applied) scheduleSave();
  }

  // ---- public ---------------------------------------------------------------------------

  function load(profiles, g) {
    if (Number.isFinite(+g)) gain = clamp(+g, 0, 89);
    const byId = {};
    (profiles || []).forEach((p, k) => { byId[p.id ?? k] = p; });
    const freqChanged = [];
    for (let i = 0; i < SLOTS; i++) {
      const p = byId[i];
      const f = p && inRange(+p.frequency) ? +p.frequency : 0;
      if (f !== pilots[i].freq) freqChanged.push(i);
      pilots[i].freq = f;
      pilots[i].enter = p ? +p.enterRssi || 72 : pilots[i].enter;
      pilots[i].exit = p && Number.isFinite(+p.exitRssi) ? +p.exitRssi : pilots[i].exit;
      // Pilot identity (firmware with config v24; older firmware omits it).
      if (p && p.name !== undefined) {
        pilots[i].name = String(p.name || "");
        pilots[i].phonetic = String(p.phonetic || "");
        pilots[i].color = p.color != null ? hexColor(p.color) : COLORS[i];
        pilots[i].race = !!+p.race;
      }
    }
    if (!built) {
      build();
    } else {
      // Update in place, so a refresh after a save doesn't disturb the page.
      freqChanged.forEach(i => {
        const sel = document.querySelector(`.c5p-freq[data-i="${i}"]`);
        if (sel) sel.innerHTML = freqOptions(pilots[i].freq, pilots[i].bandIndex);
        hist[i].t.length = hist[i].v.length = 0;
      });
      refreshCardStates();
    }
    const inp = $("#c5pGain");
    if (inp && document.activeElement !== inp) inp.value = gain;
  }

  function getProfilesForSave() {
    // All 8 slots: the firmware switches off any slot not sent.
    return pilots.map((p, id) => ({ id, frequency: p.freq, enterRssi: p.enter, exitRssi: p.exit,
                                    name: p.name, phonetic: p.phonetic,
                                    color: parseInt(p.color.slice(1), 16), race: p.race ? 1 : 0 }));
  }

  // The slots that count in races (a frequency and Race on), for script.js:
  // { slot, name, label, spoken, color (#rrggbb), freq, channel }.
  function getRacePilots() {
    return pilots.map((p, slot) => ({ p, slot })).filter(({ slot }) => isRacer(slot)).map(({ p, slot }) => ({
      slot, name: p.name, label: pilotLabel(slot), spoken: p.phonetic || p.name || `Pilot ${slot + 1}`,
      color: colorOf(slot), freq: p.freq, channel: channelName(p.freq, p.bandIndex),
    }));
  }

  function setVisible(on) {
    visible = on;
    if (on) build();
  }

  function frame(ts) {
    if (visible) {
      draw();
      // Race tab debug overlay (script.js updateDebugOverlay shows the canvas).
      const dbg = document.getElementById("debugC5Chart");
      if (dbg && dbg.offsetParent !== null) {
        drawChart(dbg, true);
        const readout = document.getElementById("debugRssiValue");
        if (readout) readout.textContent = live.at && now() - live.at < 3 ? `${pilots.filter(p => p.freq).length} pilots` : "no data";
      }
      if (ts - lastCards > 200) {
        renderCards();
        renderStatus();
        lastCards = ts;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { load, getProfilesForSave, getGain: () => gain, onRssi, onLap, setVisible, saveState: () => saveState, channelName,
           getRacePilots };
})();
