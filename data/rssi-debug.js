// FPVGate RSSI Debug popout
// Standalone page that opens the debug RSSI chart in a separate window.
// Subscribes to the same /events SSE feed as the main UI, asks the device to
// stream RSSI while open, and renders a full-window SmoothieChart.
//
// RX5808 / Novacore: one line from the "rssi" event, with the single
// Enter/Exit pair.
// ESP32-C5 (receiverRadio 2): one line per pilot slot from "c5RssiFast"
// { v:[8] 0..1023 peak since the last frame, in: mask } at 25 Hz (falling
// back to the 10 Hz "c5Rssi" on older firmware). A chip per pilot shows its
// live value and gate state; the selected pilot's thresholds are drawn and
// its figures fill the header.

(function () {
  'use strict';

  const liveEl = document.getElementById('liveValue');
  const enterEl = document.getElementById('enterValue');
  const exitEl = document.getElementById('exitValue');
  const minEl = document.getElementById('minValue');
  const maxEl = document.getElementById('maxValue');
  const pilotEl = document.getElementById('pilotValue');
  const pilotStat = document.getElementById('pilotStat');
  const crossingDot = document.getElementById('crossingDot');
  const connDot = document.getElementById('connDot');
  const connLabel = document.getElementById('connLabel');
  const legendEl = document.getElementById('legend');
  const racersOnlyEl = document.getElementById('racersOnly');
  const canvas = document.getElementById('rssiChart');

  const C5_SCALE = 4;            // C5 values are 0..1023; thresholds 0..255
  const FAST_STALE_MS = 1000;    // after this without c5RssiFast, use c5Rssi
  const C5_DEFAULT_COLORS = ['#ff6b6b', '#f7b32b', '#06d6a0', '#4cc9f0', '#a78bfa', '#f78c6b', '#7bd389', '#f472b6'];

  let mode = 'rx';               // 'rx' or 'c5'

  // ---- single pilot (RX5808 / Novacore) ----
  let enterRssi = 120;
  let exitRssi = 100;
  let minRssiSeen = Infinity;
  let maxRssiSeen = -Infinity;
  let crossing = false;
  const rssiSeries = new TimeSeries();
  const crossingSeries = new TimeSeries();

  // ---- C5 pilots ----
  // { slot, label, color, enter, exit, race, series, live, min, max, inGate, local }
  let pilots = [];
  let selected = -1;             // slot
  let lastFastMs = 0;
  let lastLegendMs = 0;
  const c5CrossingSeries = new TimeSeries();

  const chart = new SmoothieChart({
    responsive: true,
    millisPerPixel: 40,
    grid: {
      strokeStyle: 'rgba(255,255,255,0.1)',
      sharpLines: true,
      verticalSections: 0,
      borderVisible: false,
    },
    labels: { precision: 0, fillStyle: '#9aa7b2' },
    maxValue: 200,
    minValue: 0,
  });
  chart.streamTo(canvas, 120);

  function setConnected(ok, label) {
    connDot.classList.toggle('connected', !!ok);
    if (label) connLabel.textContent = label;
  }

  function setThresholdLines(enter, exit) {
    chart.options.horizontalLines = [
      { color: 'hsl(8.2, 86.5%, 53.7%)', lineWidth: 1.7, value: enter },
      { color: 'hsl(25, 85%, 55%)', lineWidth: 1.7, value: exit },
    ];
  }

  function hexColor(n) {
    return '#' + ((Number(n) >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function fmt(v) {
    return Number.isFinite(v) ? (Math.round(v * 4) / 4).toString() : '--';
  }

  // ---- chart series --------------------------------------------------------------

  function clearSeries() {
    for (const s of chart.seriesSet.slice()) chart.removeTimeSeries(s.timeSeries);
  }

  function buildRxChart() {
    clearSeries();
    chart.addTimeSeries(rssiSeries, {
      lineWidth: 1.7,
      strokeStyle: 'hsl(214, 70%, 65%)',
      fillStyle: 'hsla(214, 70%, 65%, 0.30)',
    });
    chart.addTimeSeries(crossingSeries, { lineWidth: 1, strokeStyle: 'none', fillStyle: 'hsla(136, 71%, 60%, 0.20)' });
    setThresholdLines(enterRssi, exitRssi);
  }

  function visiblePilots() {
    return pilots.filter((p) => !racersOnlyEl.checked || p.race);
  }

  function buildC5Chart() {
    clearSeries();
    const sel = pilots.find((p) => p.slot === selected);
    if (sel) {
      chart.addTimeSeries(c5CrossingSeries, { lineWidth: 1, strokeStyle: 'none', fillStyle: rgba(sel.color, 0.12) });
    }
    for (const p of visiblePilots()) {
      const isSel = p.slot === selected;
      chart.addTimeSeries(p.series, {
        lineWidth: isSel ? 2.4 : 1.4,
        strokeStyle: isSel ? p.color : rgba(p.color, 0.75),
        fillStyle: isSel ? rgba(p.color, 0.18) : undefined,
      });
    }
    if (sel) setThresholdLines(sel.enter, sel.exit);
    else chart.options.horizontalLines = [];
  }

  // ---- C5 legend and header ------------------------------------------------------

  function buildLegend() {
    legendEl.innerHTML = '';
    for (const p of visiblePilots()) {
      const chip = document.createElement('span');
      chip.className = 'rssi-debug-chip' + (p.slot === selected ? ' selected' : '');
      chip.style.setProperty('--c', p.color);
      chip.dataset.slot = p.slot;
      chip.title = `Enter ${p.enter} / Exit ${p.exit} · click to show its thresholds`;
      chip.innerHTML = '<span class="sw"></span><span class="nm"></span>' +
        (p.race ? '<span class="race">RACE</span>' : '') +
        '<span class="val">--</span><span class="rssi-debug-crossing"></span>';
      chip.querySelector('.nm').textContent = p.label;
      chip.addEventListener('click', () => selectPilot(p.slot));
      legendEl.appendChild(chip);
    }
  }

  function selectPilot(slot) {
    selected = slot;
    c5CrossingSeries.clear();   // the shading belongs to the selected pilot
    buildC5Chart();
    buildLegend();
    renderC5Header();
  }

  function renderC5Header() {
    const p = pilots.find((x) => x.slot === selected);
    pilotStat.style.setProperty('--c', p ? p.color : '#e6edf3');
    pilotEl.textContent = p ? p.label : '--';
    liveEl.textContent = p ? fmt(p.live) : '--';
    enterEl.textContent = p ? p.enter : '--';
    exitEl.textContent = p ? p.exit : '--';
    minEl.textContent = p && p.min !== Infinity ? fmt(p.min) : '--';
    maxEl.textContent = p && p.max !== -Infinity ? fmt(p.max) : '--';
    crossingDot.classList.toggle('active', !!(p && p.inGate));
  }

  function renderLegendValues() {
    for (const chip of legendEl.children) {
      const p = pilots.find((x) => x.slot === +chip.dataset.slot);
      if (!p) continue;
      chip.querySelector('.val').textContent = fmt(p.live);
      chip.querySelector('.rssi-debug-crossing').classList.toggle('active', p.inGate);
    }
  }

  // values: 0..1023 per slot; inMask: the race detector's in-gate flags.
  function onC5Values(values, inMask) {
    const now = Date.now();
    let lo = Infinity, hi = -Infinity;
    for (const p of pilots) {
      const raw = values[p.slot];
      if (raw == null) continue;
      const v = raw / C5_SCALE;
      p.live = v;
      if (v < p.min) p.min = v;
      if (v > p.max) p.max = v;
      // Own hysteresis outside races; the detector's state while racing.
      if (p.local && v < p.exit) p.local = false;
      else if (!p.local && v > p.enter) p.local = true;
      p.inGate = p.local || !!((inMask >> p.slot) & 1);
      p.series.append(now, v);
      if (p.slot === selected) c5CrossingSeries.append(now, p.inGate ? 300 : -10);
      if (!racersOnlyEl.checked || p.race) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const sel = pilots.find((p) => p.slot === selected);
    if (sel) {
      lo = Math.min(lo, sel.exit);
      hi = Math.max(hi, sel.enter);
    }
    if (Number.isFinite(lo)) {
      chart.options.minValue = Math.max(0, Math.floor((lo - 10) / 10) * 10);
      chart.options.maxValue = Math.ceil((hi + 10) / 10) * 10;
    }
    if (now - lastLegendMs > 150) {   // ~7 updates a second is plenty for text
      lastLegendMs = now;
      renderLegendValues();
      renderC5Header();
    }
  }

  // ---- config ---------------------------------------------------------------------

  function applyConfig(cfg) {
    if (cfg.receiverRadio === 2) {
      const old = new Map(pilots.map((p) => [p.slot, p]));
      pilots = (cfg.c5Pilots || [])
        .filter((p) => +p.frequency > 0)
        .map((p) => {
          const slot = +(p.id ?? 0);
          const prev = old.get(slot);
          return {
            slot,
            label: p.name || `P${slot + 1} · ${p.frequency}`,
            color: p.color != null ? hexColor(p.color) : C5_DEFAULT_COLORS[slot % 8],
            enter: +p.enterRssi || 72,
            exit: +p.exitRssi || 68,
            race: !!+p.race,
            series: prev ? prev.series : new TimeSeries(),
            live: prev ? prev.live : NaN,
            min: prev ? prev.min : Infinity,
            max: prev ? prev.max : -Infinity,
            inGate: false,
            local: prev ? prev.local : false,
          };
        });
      if (!pilots.some((p) => p.slot === selected)) {
        const first = pilots.find((p) => p.race) || pilots[0];
        selected = first ? first.slot : -1;
      }
      if (mode !== 'c5') {
        mode = 'c5';
        document.body.classList.add('c5-mode');
        document.title = 'FPVGate RSSI Debug · ESP32-C5';
      }
      buildC5Chart();
      buildLegend();
      renderC5Header();
    } else {
      if (typeof cfg.enterRssi === 'number') enterRssi = cfg.enterRssi;
      if (typeof cfg.exitRssi === 'number') exitRssi = cfg.exitRssi;
      if (mode !== 'rx') {
        mode = 'rx';
        document.body.classList.remove('c5-mode');
        document.title = 'FPVGate RSSI Debug';
      }
      enterEl.textContent = enterRssi;
      exitEl.textContent = exitRssi;
      buildRxChart();
    }
  }

  // Rebuilt only when what this page shows changed.
  let configSignature = '';

  async function fetchConfig() {
    try {
      const r = await fetch('/config');
      if (!r.ok) return;
      const cfg = await r.json();
      const sig = JSON.stringify([cfg.receiverRadio, cfg.enterRssi, cfg.exitRssi, cfg.c5Pilots]);
      if (sig === configSignature) return;
      configSignature = sig;
      applyConfig(cfg);
    } catch (err) {
      console.warn('[RSSI Debug] Failed to fetch config:', err);
    }
  }

  // ---- device stream ------------------------------------------------------------------

  async function startStream() {
    try {
      const r = await fetch('/timer/rssiStart', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      if (!r.ok) console.warn('[RSSI Debug] rssiStart returned', r.status);
    } catch (err) {
      console.warn('[RSSI Debug] Failed to start RSSI stream:', err);
    }
  }

  function stopStream() {
    // Best-effort on unload. Use keepalive so the browser will finish sending
    // even as the tab is closing.
    try {
      fetch('/timer/rssiStop', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => {});
    } catch (err) { /* ignore */ }
  }

  var eventSource = null;

  function onRxRssi(v) {
    if (v < minRssiSeen) minRssiSeen = v;
    if (v > maxRssiSeen) maxRssiSeen = v;
    if (crossing && v < exitRssi) crossing = false;
    else if (!crossing && v > enterRssi) crossing = true;

    const now = Date.now();
    rssiSeries.append(now, v);
    crossingSeries.append(now, crossing ? 256 : -10);

    liveEl.textContent = v;
    minEl.textContent = (minRssiSeen === Infinity) ? '--' : minRssiSeen;
    maxEl.textContent = (maxRssiSeen === -Infinity) ? '--' : maxRssiSeen;
    crossingDot.classList.toggle('active', crossing);

    // Keep Y range a bit outside thresholds + observed values
    chart.options.maxValue = Math.max(maxRssiSeen, enterRssi + 10);
    chart.options.minValue = Math.max(0, Math.min(minRssiSeen, exitRssi - 10));
  }

  function setupEvents() {
    if (!window.EventSource) {
      setConnected(false, 'SSE not supported');
      return;
    }
    eventSource = new EventSource('/events');
    const source = eventSource;

    source.addEventListener('open', () => setConnected(true, 'Connected'));
    source.addEventListener('error', (e) => {
      if (e.target.readyState !== EventSource.OPEN) {
        setConnected(false, 'Reconnecting...');
      }
    });

    source.addEventListener('rssi', (e) => {
      if (mode !== 'rx') return;
      const v = parseInt(e.data, 10);
      if (Number.isFinite(v)) onRxRssi(v);
    });

    source.addEventListener('c5RssiFast', (e) => {
      if (mode !== 'c5') return;
      try {
        const d = JSON.parse(e.data);
        lastFastMs = Date.now();
        onC5Values(d.v || [], +d.in || 0);
      } catch (err) { /* ignore a bad frame */ }
    });

    // Older firmware has no fast stream: use the 10 Hz feed.
    source.addEventListener('c5Rssi', (e) => {
      if (mode !== 'c5' || Date.now() - lastFastMs < FAST_STALE_MS) return;
      try {
        const d = JSON.parse(e.data);
        const inMask = (d.in || []).reduce((m, x, i) => m | (x ? 1 << i : 0), 0);
        onC5Values(d.rssi || [], inMask);
      } catch (err) { /* ignore */ }
    });

    // Refresh thresholds, names and colours when the main UI saves config
    source.addEventListener('configUpdated', () => {
      fetchConfig();
    });
  }

  racersOnlyEl.addEventListener('change', () => {
    const vis = visiblePilots();
    if (vis.length && !vis.some((p) => p.slot === selected)) selected = vis[0].slot;
    buildC5Chart();
    buildLegend();
    renderC5Header();
  });

  window.addEventListener('load', () => {
    buildRxChart();
    fetchConfig();
    setupEvents();
    startStream();
    // Saves from the main page don't announce themselves (configUpdated is
    // LCD-only), so pick up renamed pilots and moved thresholds by polling.
    setInterval(fetchConfig, 3000);
  });

  function releaseOnUnload() {
    if (eventSource) {
      try { eventSource.close(); } catch (e) { /* ignore */ }
      eventSource = null;
    }
    stopStream();
  }
  window.addEventListener('beforeunload', releaseOnUnload);
  window.addEventListener('pagehide', releaseOnUnload);
})();
