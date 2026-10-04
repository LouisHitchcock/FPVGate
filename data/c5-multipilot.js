// ESP32-C5 multi-pilot calibration (receiver type 2).
//
// One panel on the Calibration tab: link status, a band picker that fills
// the 8 pilot slots, the RF gain, a live chart of every pilot with labels
// on each line, and a card per pilot with its frequency, live level and its
// own Enter/Exit thresholds. The selected pilot's thresholds are drawn on
// the chart and can be dragged. Changes save themselves (saveConfig() in
// script.js), so the thresholds the lap detector uses are always the ones
// shown.
//
// Data: the "c5Rssi" SSE event (lib/WEBSERVER/webserver.cpp), 10 per second:
//   { rssi:[8], freq:[8], in:[8], on, started, st, mhz, gain, race }
// and "c5Lap" { pilot, lapTimeMs }.
//
// Uses freqLookup and bandDefinitions from script.js.
"use strict";

const C5UI = (() => {
  const SLOTS = 8;
  const MIN_MHZ = 5180, MAX_MHZ = 5917;   // includes Raceband R8 via the C5 PHY hop path
  const COLORS = ["#ff6b6b", "#f7b32b", "#06d6a0", "#4cc9f0", "#a78bfa", "#f78c6b", "#7bd389", "#f472b6"];
  const HISTORY_S = 125;
  const SAVE_DELAY_MS = 800;

  const pilots = Array.from({ length: SLOTS }, () => ({ freq: 0, enter: 72, exit: 68, hidden: false }));
  const hist = Array.from({ length: SLOTS }, () => ({ t: [], v: [] }));
  const laps = Array.from({ length: SLOTS }, () => ({ count: 0, last: null, best: null, flashUntil: 0 }));
  let gain = 30;
  let focus = 0;
  let live = { on: false, started: false, st: "", mhz: 0, gain: null, race: false, inside: [], at: 0 };
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

  // ---- channel names ------------------------------------------------------------

  function bandTables() {
    // From script.js; empty if it hasn't loaded.
    return typeof bandDefinitions !== "undefined" && typeof freqLookup !== "undefined"
      ? bandDefinitions.map(b => ({ ...b, freqs: freqLookup[b.index] || [] })) : [];
  }

  function channelName(freq) {
    if (!freq) return "Off";
    for (const b of bandTables().filter(b => b.system === "analog")) {
      const i = b.freqs.indexOf(freq);
      if (i >= 0) return b.value + (i + 1);
    }
    return freq + "";
  }

  // ---- building the panel ----------------------------------------------------------

  function freqOptions(selected) {
    let html = `<option value="0"${selected ? "" : " selected"}>Off</option>`;
    let found = !selected;
    for (const b of bandTables()) {
      if (b.system !== "analog") continue;
      html += `<optgroup label="${b.label}">`;
      b.freqs.forEach((f, i) => {
        if (!f) return;
        const ok = inRange(f);
        const sel = f === selected && !found ? " selected" : "";
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
    host.innerHTML = `
      <div class="c5p-status" id="c5pStatus"><span class="c5p-dot"></span><span id="c5pStatusText">Waiting for data from FPVGate…</span></div>
      <div class="c5p-toolbar">
        <label class="c5p-lbl">Band <select id="c5pBand">${bandOpts}</select></label>
        <button class="c5p-btn" id="c5pFill" title="Put the band's channels in pilots 1-8">Fill pilots from band</button>
        <label class="c5p-lbl">Gain
          <span class="c5p-step"><button class="c5p-btn c5p-sq" data-gain="-1">−</button><input type="number" id="c5pGain" min="0" max="89" value="${gain}"><button class="c5p-btn c5p-sq" data-gain="1">+</button></span>
        </label>
        <span class="c5p-spacer"></span>
        <label class="c5p-lbl">Window <select id="c5pWindow"><option value="10">10 s</option><option value="30" selected>30 s</option><option value="60">60 s</option><option value="120">2 min</option></select></label>
        <label class="c5p-lbl"><input type="checkbox" id="c5pAllTh"> all thresholds</label>
        <button class="c5p-btn" id="c5pPause">Pause</button>
        <span class="c5p-save" id="c5pSave"></span>
      </div>
      <div class="c5p-fillnote" id="c5pFillNote"></div>
      <div class="c5p-chartwrap"><canvas id="c5pChart"></canvas><div class="c5p-tip" id="c5pTip"></div></div>
      <div class="c5p-hint">Click a pilot's card to select it, then drag its <b>Enter</b> and <b>Exit</b> lines on the chart, or use the − / + buttons. Changes save automatically.</div>
      <div class="c5p-cards" id="c5pCards"></div>
      <div class="c5p-auto">
        <div class="c5p-auto-head">
          <b>Auto-calibrate</b>
          <span class="c5p-phase" id="c5pPhase">Leave the gate clear, start, then fly every pilot through the gate a few times.</span>
        </div>
        <div class="c5p-auto-actions">
          <button class="c5p-btn c5p-primary" id="c5pCalStart">Start (5 s ambient)</button>
          <button class="c5p-btn" id="c5pCalStop" disabled>Calculate thresholds</button>
          <span class="c5p-count" id="c5pCalCount"></span>
        </div>
      </div>`;
    buildCards();
    wire();
  }

  function buildCards() {
    const el = document.getElementById("c5pCards");
    if (!el) return;
    el.innerHTML = pilots.map((p, i) => `
      <div class="c5p-card" data-i="${i}" style="--c:${COLORS[i]}">
        <div class="c5p-card-head">
          <span class="c5p-name">P${i + 1}</span>
          <select class="c5p-freq" data-i="${i}">${freqOptions(p.freq)}</select>
          <button class="c5p-eye" data-i="${i}" title="Show or hide on the chart">${p.hidden ? "◌" : "●"}</button>
        </div>
        <div class="c5p-liverow"><span class="c5p-val" id="c5pVal${i}">–</span><span class="c5p-gate" id="c5pGate${i}"></span></div>
        <div class="c5p-bar"><div class="c5p-fill" id="c5pFill${i}"></div><div class="c5p-mk c5p-mk-enter" id="c5pMkE${i}"></div><div class="c5p-mk c5p-mk-exit" id="c5pMkX${i}"></div></div>
        <div class="c5p-th"><span>Enter</span><span class="c5p-step"><button class="c5p-btn c5p-sq" data-i="${i}" data-th="enter" data-d="-1">−</button><input type="number" min="1" max="255" class="c5p-in" data-i="${i}" data-th="enter" value="${p.enter}"><button class="c5p-btn c5p-sq" data-i="${i}" data-th="enter" data-d="1">+</button></span></div>
        <div class="c5p-th"><span>Exit</span><span class="c5p-step"><button class="c5p-btn c5p-sq" data-i="${i}" data-th="exit" data-d="-1">−</button><input type="number" min="0" max="254" class="c5p-in" data-i="${i}" data-th="exit" value="${p.exit}"><button class="c5p-btn c5p-sq" data-i="${i}" data-th="exit" data-d="1">+</button></span></div>
        <div class="c5p-meta" id="c5pMeta${i}"></div>
        <div class="c5p-calres" id="c5pCal${i}"></div>
      </div>`).join("");
    refreshCardStates();
  }

  function refreshCardStates() {
    document.querySelectorAll(".c5p-card").forEach(card => {
      const i = +card.dataset.i;
      card.classList.toggle("c5p-off", !pilots[i].freq);
      card.classList.toggle("c5p-focus", i === focus);
      card.classList.toggle("c5p-hidden", pilots[i].hidden);
      const name = card.querySelector(".c5p-name");
      if (name) name.textContent = `P${i + 1}` + (pilots[i].freq ? " · " + channelName(pilots[i].freq) : "");
      const eye = card.querySelector(".c5p-eye");
      if (eye) eye.textContent = pilots[i].hidden ? "◌" : "●";
      card.querySelectorAll(".c5p-in").forEach(inp => {
        const v = pilots[i][inp.dataset.th];
        if (document.activeElement !== inp) inp.value = v;
      });
    });
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

    const cards = document.getElementById("c5pCards");
    cards.addEventListener("click", e => {
      const t = e.target;
      const card = t.closest(".c5p-card");
      if (!card) return;
      const i = +card.dataset.i;
      if (t.classList.contains("c5p-eye")) {
        pilots[i].hidden = !pilots[i].hidden;
        refreshCardStates();
        return;
      }
      if (t.dataset.th && t.dataset.d) {
        setThreshold(i, t.dataset.th, pilots[i][t.dataset.th] + +t.dataset.d);
      }
      if (focus !== i) {
        focus = i;
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
        setFreq(i, +f);
      } else if (t.classList.contains("c5p-in")) {
        setThreshold(i, t.dataset.th, parseInt(t.value, 10));
      }
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
    v = clamp(Math.round(v) || 0, 0, 89);
    gain = v;
    const inp = $("#c5pGain");
    if (inp) inp.value = v;
    scheduleSave();
  }

  function setFreq(i, f) {
    pilots[i].freq = f && inRange(f) ? f : 0;
    hist[i].t.length = hist[i].v.length = 0;
    laps[i] = { count: 0, last: null, best: null, flashUntil: 0 };
    calib.results[i] = undefined;
    refreshCardStates();
    scheduleSave();
  }

  // Keeps exit below enter: moving one past the other pushes it along.
  function setThreshold(i, which, v, dragging) {
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
    const idx = +$("#c5pBand").value;
    const b = bandTables().find(x => x.index === idx);
    if (!b) return;
    const skipped = [];
    for (let i = 0; i < SLOTS; i++) {
      const f = b.freqs[i] || 0;
      if (f && !inRange(f)) skipped.push(`${b.value}${i + 1} (${f} MHz)`);
      pilots[i].freq = f && inRange(f) ? f : 0;
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
    const rssi = d.rssi || [];
    live = { on: !!d.on, started: d.started !== false, st: d.st || "", mhz: d.mhz || 0, gain: d.gain,
             race: !!d.race, inside: d.in || [], at: t };
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
  }

  function onLap(d) {
    const i = +d.pilot;
    if (!(i >= 0 && i < SLOTS)) return;
    const L = laps[i];
    L.count++;
    L.last = d.lapTimeMs;
    L.best = L.best == null ? d.lapTimeMs : Math.min(L.best, d.lapTimeMs);
    L.flashUntil = now() + 1.5;
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
      cls = err ? "c5p-bad" : "c5p-ok";
      msg = `C5 online · ${live.st || "?"}${live.mhz ? " · tuning " + live.mhz + " MHz (" + channelName(live.mhz) + ")" : ""}` +
            ` · gain ${live.gain ?? gain} · ${enabled} pilot${enabled === 1 ? "" : "s"}, each read every ${enabled * 20} ms` +
            (live.race ? " · race running: laps counted" : " · laps count while a race runs");
      if (err) msg += live.st === "ERR_FREQ" ? " · frequency outside 5180–5917 MHz" : " · the C5 reported an RF error";
    }
    el.className = "c5p-status " + cls;
    txt.textContent = msg;
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
      if (L.flashUntil > t) { gate.textContent = "LAP"; gate.className = "c5p-gate c5p-gate-lap"; }
      else if (live.race && live.inside[i]) { gate.textContent = "IN GATE"; gate.className = "c5p-gate c5p-gate-in"; }
      else if (v != null && v >= p.enter) { gate.textContent = "above enter"; gate.className = "c5p-gate c5p-gate-above"; }
      else { gate.textContent = ""; gate.className = "c5p-gate"; }
      const lapTxt = L.count ? ` · laps ${L.count} · last ${(L.last / 1000).toFixed(2)} s · best ${(L.best / 1000).toFixed(2)} s` : "";
      $(`#c5pMeta${i}`).textContent = s ? `10 s: peak ${s.max} · floor ${s.p10}${lapTxt}` : (p.freq ? "waiting for samples" : "");
      const r = calib.results[i];
      $(`#c5pCal${i}`).innerHTML = r && r.peak != null
        ? `auto: floor ${r.floor}, noise ${r.noise}, peak ${r.peak} → <span class="${r.peak - r.noise >= 10 ? "c5p-good" : "c5p-badtxt"}">${r.peak - r.noise >= 10 ? "good margin" : "weak margin"}</span>`
        : "";
    });
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

  let yLo = 0, yHi = 120;
  function yRange(t0, tEnd) {
    let lo = Infinity, hi = -Infinity;
    pilots.forEach((p, i) => {
      if (!p.freq || p.hidden) return;
      const h = hist[i];
      for (let j = lowerBound(h.t, t0); j < h.t.length && h.t[j] <= tEnd; j++) {
        lo = Math.min(lo, h.v[j]);
        hi = Math.max(hi, h.v[j]);
      }
      if (i === focus || showAllThresholds) { lo = Math.min(lo, p.exit); hi = Math.max(hi, p.enter); }
    });
    if (!isFinite(lo)) { lo = 0; hi = 120; }
    // Round outwards to tens and only move when needed, so the axis is calm.
    const wantLo = clamp(Math.floor((lo - 8) / 10) * 10, 0, 245), wantHi = clamp(Math.ceil((hi + 8) / 10) * 10, 10, 260);
    if (drag) return;   // keep the scale still while dragging
    if (wantLo < yLo || wantLo > yLo + 30) yLo = wantLo;
    if (wantHi > yHi || wantHi < yHi - 30) yHi = Math.max(wantHi, yLo + 30);
  }

  function draw() {
    const cv = document.getElementById("c5pChart");
    if (!cv || !visible || cv.offsetParent === null) return;
    const { ctx, W, H } = fitCanvas(cv);
    ctx.clearRect(0, 0, W, H);
    const tEnd = frozenAt ?? now(), t0 = tEnd - windowS;
    yRange(t0, tEnd);
    const box = { l: 36, r: W - 92, t: 10, b: H - 22 };
    const X = t => box.l + (t - t0) / windowS * (box.r - box.l);
    const Y = v => box.b - (v - yLo) / (yHi - yLo) * (box.b - box.t);
    geom = { Y, invY: y => yLo + (box.b - y) / (box.b - box.t) * (yHi - yLo), box };
    const text = css("--text-color") || "#999", grid = css("--border-color") || "#444";

    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    const step = (yHi - yLo) > 120 ? 40 : (yHi - yLo) > 60 ? 20 : 10;
    for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) {
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(box.l, Y(v)); ctx.lineTo(box.r, Y(v)); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(v, 4, Y(v) + 4);
    }
    const xs = windowS <= 10 ? 2 : windowS <= 30 ? 5 : windowS <= 60 ? 10 : 20;
    for (let s = 0; s <= windowS; s += xs) {
      const x = X(tEnd - s);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(x, box.t); ctx.lineTo(x, box.b); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(s ? `-${s}s` : "now", x - 12, H - 6);
    }

    // Thresholds: the selected pilot (draggable), or all of them.
    pilots.forEach((p, i) => {
      if (!p.freq || p.hidden || (i !== focus && !showAllThresholds)) return;
      const sel = i === focus;
      ctx.strokeStyle = COLORS[i];
      ctx.globalAlpha = sel ? 0.95 : 0.4;
      for (const [which, dash] of [["enter", []], ["exit", [6, 5]]]) {
        const y = Y(p[which]);
        ctx.setLineDash(dash);
        ctx.lineWidth = sel ? (drag && drag.which === which ? 3 : 2) : 1;
        ctx.beginPath(); ctx.moveTo(box.l, y); ctx.lineTo(box.r, y); ctx.stroke();
        if (sel) {
          ctx.setLineDash([]);
          ctx.fillStyle = COLORS[i];
          const label = `${channelName(p.freq)} ${which} ${p[which]}`;
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
      ctx.strokeStyle = COLORS[i];
      ctx.lineWidth = i === focus ? 2.4 : 1.6;
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
    drawLabels(ctx, box, labels);
    drawHover(ctx, box, t0, X);
  }

  // Name and value at the end of each line, pushed apart so they never overlap.
  function drawLabels(ctx, box, labels) {
    const gap = 15;
    labels.forEach(l => { l.ly = clamp(l.y, box.t + 6, box.b - 6); });
    labels.sort((a, b) => a.ly - b.ly);
    for (let k = 1; k < labels.length; k++) labels[k].ly = Math.max(labels[k].ly, labels[k - 1].ly + gap);
    const over = labels.length ? labels[labels.length - 1].ly - (box.b - 6) : 0;
    if (over > 0) labels.forEach(l => { l.ly -= over; });
    for (let k = labels.length - 2; k >= 0; k--) labels[k].ly = Math.min(labels[k].ly, labels[k + 1].ly - gap);
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    labels.forEach(l => {
      const c = COLORS[l.i];
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(l.x, clamp(l.y, box.t, box.b)); ctx.lineTo(box.r + 4, l.ly); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(l.x, clamp(l.y, box.t, box.b), 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillText(`${channelName(pilots[l.i].freq)} ${l.v}`, box.r + 7, l.ly);
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
      html += `<div><span class="c5p-sw" style="background:${COLORS[i]}"></span>${channelName(p.freq)} <b>${h.v[j]}</b> <span class="c5p-dim">(enter ${p.enter} / exit ${p.exit})</span></div>`;
    });
    tip.innerHTML = html;
    tip.style.display = "block";
    tip.style.left = (hoverX + 14 + tip.offsetWidth > box.r ? hoverX - 14 - tip.offsetWidth : hoverX + 14) + "px";
    tip.style.top = "8px";
  }

  // ---- auto-calibration (ambient, then passes) ---------------------------------------------------

  function percentile(values, q) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  function startCalibration() {
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
    (calib.phase === "ambient" ? calib.ambient : calib.samples).push(s);
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
    $("#c5pCalStart").textContent = "Start again";
    $("#c5pCalStop").disabled = true;
    $("#c5pPhase").textContent = applied
      ? `Thresholds set for ${applied} pilot${applied === 1 ? "" : "s"} and saved. Check them against the chart.`
      : "Not enough samples. Try again with longer passes.";
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
    }
    if (!built) {
      build();
    } else {
      // Update in place, so a refresh after a save doesn't disturb the page.
      freqChanged.forEach(i => {
        const sel = document.querySelector(`.c5p-freq[data-i="${i}"]`);
        if (sel) sel.innerHTML = freqOptions(pilots[i].freq);
        hist[i].t.length = hist[i].v.length = 0;
      });
      refreshCardStates();
    }
    const inp = $("#c5pGain");
    if (inp && document.activeElement !== inp) inp.value = gain;
  }

  function getProfilesForSave() {
    // All 8 slots: the firmware switches off any slot not sent.
    return pilots.map((p, id) => ({ id, frequency: p.freq, enterRssi: p.enter, exitRssi: p.exit }));
  }

  function setVisible(on) {
    visible = on;
    if (on) build();
  }

  function frame(ts) {
    if (visible) {
      draw();
      if (ts - lastCards > 200) {
        renderCards();
        renderStatus();
        lastCards = ts;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { load, getProfilesForSave, getGain: () => gain, onRssi, onLap, setVisible, saveState: () => saveState };
})();
