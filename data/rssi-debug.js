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

  // Locale loading is async; fall back to English if a status label is needed
  // before the catalogue has arrived, then re-apply once it is ready.
  const tr = (key, fallback) => {
    const value = i18n.t(key);
    return value === key ? fallback : value;
  };
  let lastStatusKey = null;
  const whenI18nReady = (fn) => {
    if (i18n.ready) return i18n.ready.then(fn);
    window.addEventListener('load', () => {
      if (i18n.ready) i18n.ready.then(fn);
    }, { once: true });
  };

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

  }

  function setConnected(ok, key, fallback) {
    if (ok) {
      connDot.classList.add('connected');
    } else {
      connDot.classList.remove('connected');
    }
    if (key) {
      lastStatusKey = key;
      connLabel.textContent = tr(key, fallback);
      // The label is now live status, not the static placeholder, so a later
      // translatePage() must not reset it to "Connecting...".
      connLabel.removeAttribute('data-i18n');
      whenI18nReady(() => {
        if (lastStatusKey === key) connLabel.textContent = i18n.t(key);
      });
    }
