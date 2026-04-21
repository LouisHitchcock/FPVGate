// FPVGate RSSI Debug popout
// Standalone page that opens the debug RSSI chart in a separate window.
// Subscribes to the same /events SSE feed as the main UI, asks the device to
// stream RSSI while open, and renders a full-window SmoothieChart.

(function () {
  'use strict';

  const liveEl = document.getElementById('liveValue');
  const enterEl = document.getElementById('enterValue');
  const exitEl = document.getElementById('exitValue');
  const minEl = document.getElementById('minValue');
  const maxEl = document.getElementById('maxValue');
  const crossingDot = document.getElementById('crossingDot');
  const connDot = document.getElementById('connDot');
  const connLabel = document.getElementById('connLabel');
  const canvas = document.getElementById('rssiChart');

  let enterRssi = 120;
  let exitRssi = 100;
  let rssiValue = 0;
  let minRssiSeen = Infinity;
  let maxRssiSeen = -Infinity;
  let crossing = false;

  const rssiSeries = new TimeSeries();
  const crossingSeries = new TimeSeries();

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
  chart.addTimeSeries(rssiSeries, {
    lineWidth: 1.7,
    strokeStyle: 'hsl(214, 70%, 65%)',
    fillStyle: 'hsla(214, 70%, 65%, 0.30)',
  });
  chart.addTimeSeries(crossingSeries, {
    lineWidth: 1,
    strokeStyle: 'none',
    fillStyle: 'hsla(136, 71%, 60%, 0.20)',
  });
  chart.streamTo(canvas, 120);

  function updateThresholdLines() {
    chart.options.horizontalLines = [
      { color: 'hsl(8.2, 86.5%, 53.7%)', lineWidth: 1.7, value: enterRssi },
      { color: 'hsl(25, 85%, 55%)', lineWidth: 1.7, value: exitRssi },
    ];
  }

  function setConnected(ok, label) {
    if (ok) {
      connDot.classList.add('connected');
    } else {
      connDot.classList.remove('connected');
    }
    if (label) connLabel.textContent = label;
  }

  async function fetchConfig() {
    try {
      const r = await fetch('/config');
      if (!r.ok) return;
      const cfg = await r.json();
      if (typeof cfg.enterRssi === 'number') enterRssi = cfg.enterRssi;
      if (typeof cfg.exitRssi === 'number') exitRssi = cfg.exitRssi;
      enterEl.textContent = enterRssi;
      exitEl.textContent = exitRssi;
      updateThresholdLines();
    } catch (err) {
      console.warn('[RSSI Debug] Failed to fetch config:', err);
    }
  }

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

  function setupEvents() {
    if (!window.EventSource) {
      setConnected(false, 'SSE not supported');
      return;
    }
    const source = new EventSource('/events');

    source.addEventListener('open', () => setConnected(true, 'Connected'));
    source.addEventListener('error', (e) => {
      if (e.target.readyState !== EventSource.OPEN) {
        setConnected(false, 'Reconnecting...');
      }
    });

    source.addEventListener('rssi', (e) => {
      const v = parseInt(e.data, 10);
      if (!Number.isFinite(v)) return;
      rssiValue = v;
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
      if (crossing) crossingDot.classList.add('active');
      else crossingDot.classList.remove('active');

      // Keep Y range a bit outside thresholds + observed values
      chart.options.maxValue = Math.max(maxRssiSeen, enterRssi + 10);
      chart.options.minValue = Math.max(0, Math.min(minRssiSeen, exitRssi - 10));
    });

    // Refresh thresholds when the main UI updates config
    source.addEventListener('configUpdated', () => {
      fetchConfig();
    });
  }

  window.addEventListener('load', () => {
    fetchConfig();
    setupEvents();
    startStream();
  });

  window.addEventListener('beforeunload', stopStream);
  window.addEventListener('pagehide', stopStream);
})();
