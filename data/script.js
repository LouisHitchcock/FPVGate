let eventSource = null;
let eventSourceReconnectTimer = null;
let eventSourceReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 2000;
let connectionStatusUpdateInterval = null;

const bcf = document.getElementById("bandChannelFreq");
const systemSelect = document.getElementById("systemSelect");
const bandSelect = document.getElementById("bandSelect");
const channelSelect = document.getElementById("channelSelect");
const freqOutput = document.getElementById("freqOutput");

// Calibration tab band/channel selectors
const calibSystemSelect = document.getElementById("calibSystemSelect");
const calibBandSelect = document.getElementById("calibBandSelect");
const calibChannelSelect = document.getElementById("calibChannelSelect");
const calibFreqOutput = document.getElementById("calibFreqOutput");
const announcerSelect = document.getElementById("announcerSelect");
const announcerRateInput = document.getElementById("rate");
const enterRssiInput = document.getElementById("enter");
const exitRssiInput = document.getElementById("exit");
const enterRssiSpan = document.getElementById("enterSpan");
const exitRssiSpan = document.getElementById("exitSpan");
const pilotNameInput = document.getElementById("pname");
const raceNotesInput = document.getElementById("raceNotesInput");
const raceNotesIndicator = document.getElementById("raceNotesIndicator");
const ssidInput = document.getElementById("ssid");
const pwdInput = document.getElementById("pwd");
const minLapInput = document.getElementById("minLap");
const maxLapsInput = document.getElementById("maxLaps");
const maxHeatTimeInput = document.getElementById("maxHeatTime");

const freqLookup = [
  [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725], // A
  [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866], // B
  [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945], // E
  [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880], // F
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917], // R (RaceBand)
  [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621], // L (LowBand)
  [5660, 5695, 5735, 5770, 5805, 5878, 5914, 5839], // DJIv1-25
  [5735, 5770, 5805, 0, 0, 0, 0, 5839],             // DJIv1-25CE
  [5695, 5770, 5878, 0, 0, 0, 0, 5839],             // DJIv1_50
  [5669, 5705, 5768, 5804, 5839, 5876, 5912, 0],    // DJI03/04-20
  [5768, 5804, 5839, 0, 0, 0, 0, 0],                // DJI03/04-20CE
  [5677, 5794, 5902, 0, 0, 0, 0, 0],                // DJI03/04-40
  [5794, 0, 0, 0, 0, 0, 0, 0],                      // DJI03/04-40CE
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917], // DJI04-R
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917], // HDZero-R
  [5707, 0, 0, 0, 0, 0, 0, 0],                      // HDZero-E
  [5740, 5760, 0, 5800, 0, 0, 0, 0],                // HDZero-F
  [5732, 5769, 5806, 5843, 0, 0, 0, 0],             // HDZero-CE
  [5658, 5659, 5732, 5769, 5806, 5843, 5880, 5917], // WalkSnail-R
  [5660, 5695, 5735, 5770, 5805, 5878, 5914, 5839], // WalkSnail-25
  [5735, 5770, 5805, 0, 0, 0, 0, 5839],             // WalkSnail-25CE
  [5695, 5770, 5878, 0, 0, 0, 0, 5839],             // WalkSnail-50
];

// Band definitions with display names and system
const bandDefinitions = [
  { index: 0, value: "A", label: "A (Boscam A / TBS / IRC)", system: "analog" },
  { index: 1, value: "B", label: "B (Boscam B)", system: "analog" },
  { index: 2, value: "E", label: "E (Boscam E / DJI)", system: "analog" },
  { index: 3, value: "F", label: "F (IRC / Immersion)", system: "analog" },
  { index: 4, value: "R", label: "R (Raceband)", system: "analog" },
  { index: 5, value: "L", label: "L (Lowband)", system: "analog" },
  { index: 6, value: "DJIv1-25", label: "DJI FPV v1 (25mW)", system: "dji" },
  { index: 7, value: "DJIv1-25CE", label: "DJI FPV v1 (25mW CE)", system: "dji" },
  { index: 8, value: "DJIv1_50", label: "DJI FPV v1 (50mW+)", system: "dji" },
  { index: 9, value: "DJI03/04-20", label: "DJI O3/Air Unit (20MHz)", system: "dji" },
  { index: 10, value: "DJI03/04-20CE", label: "DJI O3/Air Unit (20MHz CE)", system: "dji" },
  { index: 11, value: "DJI03/04-40", label: "DJI O3/Air Unit (40MHz)", system: "dji" },
  { index: 12, value: "DJI03/04-40CE", label: "DJI O3/Air Unit (40MHz CE)", system: "dji" },
  { index: 13, value: "DJI04-R", label: "DJI O3 (Raceband)", system: "dji" },
  { index: 14, value: "HDZero-R", label: "HDZero (Raceband)", system: "hdzero" },
  { index: 15, value: "HDZero-E", label: "HDZero (E-band)", system: "hdzero" },
  { index: 16, value: "HDZero-F", label: "HDZero (F-band)", system: "hdzero" },
  { index: 17, value: "HDZero-CE", label: "HDZero (CE)", system: "hdzero" },
  { index: 18, value: "WalkSnail-R", label: "Walksnail (Raceband)", system: "walksnail" },
  { index: 19, value: "WalkSnail-25", label: "Walksnail (25mW)", system: "walksnail" },
  { index: 20, value: "WalkSnail-25CE", label: "Walksnail (25mW CE)", system: "walksnail" },
  { index: 21, value: "WalkSnail-50", label: "Walksnail (50mW+)", system: "walksnail" },
];

// System selection state
let currentSystem = "analog";

const config = document.getElementById("config");
const race = document.getElementById("race");
const calib = document.getElementById("calib");
const ota = document.getElementById("ota");

var enterRssi = 120,
  exitRssi = 100;
var frequency = 0;
var announcerRate = 1.0;
// Pre-race countdown mode: 0 = "Less than 5" (classic random TTS+beep),
// 1 = "10 Second Countdown" (visible 10..1..GO overlay)
var raceCountdownMode = 1;


var lapNo = -1;
var lapTimes = [];
var maxLaps = 0;
// Maximum heat time in 30-second blocks (0 = unlimited, 1 = 30s, 2 = 1 min, ...
// 60 = 30 min). When >0, the race auto-stops via a setTimeout scheduled in
// startRace().
var maxHeatTime30s = 0;
var heatTimeoutId = null;
var currentRaceSessionTimestamp = null;
var pendingRaceSavePromise = null;
var openRaceNotesOnRaceEnd = localStorage.getItem("openRaceNotesOnRaceEnd") === "1";

// Track data for current race
var currentTrackId = 0;
var currentTrackName = "";
var currentTotalDistance = 0;
var currentDistanceRemaining = 0;
var distancePollingInterval = null;

// Per-lap distance tracking
var currentLapDistance = 0.0; // Distance travelled in current lap (meters)
var currentLapStartTime = 0; // When current lap started (ms)
var lastCompletedLapTime = 0; // Duration of previous lap (ms)
var trackLapLength = 0.0; // Length of one lap (meters)

// Race sync state
var timerNumber = 0; // LEGACY: Timer number (no longer used for hostname)
var raceSyncMode = 0; // 0=personal, 1=master, 2=slave, 3=C5 multi
var syncedTimers = []; // Array of synced timer hostnames (for master mode)
var masterHostname = ""; // Master hostname for slave mode
var configLoaded = false; // Flag to prevent saving before initial config load
var _refreshingFromDevice = false; // Flag to suppress auto-save during device-initiated refresh

// Unified sync devices list (new UI)
// Each device: { address: string, role: 'disabled'|'master'|'slave', isThisDevice: boolean }
var syncDevices = [];
var thisDeviceAddress = ""; // This device's IP address

// Remote pilots state (for master mode - tracks laps from slave devices)
var remotePilots = {}; // { slaveHostname: { pilotName, pilotPhonetic, pilotColor, lapTimes: [], lapNo: -1 } }
var remotePilotsCollapsed = false;

var timerInterval;
var lapTimerStartMs = 0; // Start time for current lap timer
var currentLapStartMs = 0; // Start time for current lap (resets each lap)
const timer = document.getElementById("timer");
const lapCounter = document.getElementById("lapCounter");
const startRaceButton = document.getElementById("startRaceButton");
const stopRaceButton = document.getElementById("stopRaceButton");
const addLapButton = document.getElementById("addLapButton");

const batteryVoltageDisplay = document.getElementById("bvolt");

const rssiBuffer = [];
var rssiValue = 0;
var rssiSending = false;
var rssiChart;
var crossing = false;
var rssiSeries = new TimeSeries();
var rssiCrossingSeries = new TimeSeries();
var maxRssiValue = enterRssi + 10;
var minRssiValue = exitRssi - 10;

// Debug mode state
var debugMode = localStorage.getItem('debugMode') === '1';
var debugRssiChart = null;
var debugRssiSeries = new TimeSeries();
var debugCrossingSeries = new TimeSeries();

// RSSI calibration threshold sync model:
//  - Device is the single source of truth for enterRssi / exitRssi.
//  - Dragging the calibration sliders is a UI preview only: updateEnterRssi /
//    updateExitRssi mutate the in-memory `enterRssi` / `exitRssi` vars and
//    the span next to the slider. Nothing touches the device.
//  - Clicking "Save Thresholds" calls saveConfig(), which POSTs /config.
//  - The backend persists the new values, then broadcasts configUpdated.
//  - Every client (including the sender) listens for configUpdated and calls
//    refreshConfigFromDevice(), which fetches /config and writes the
//    authoritative values back into the UI via applyThresholdsToUI().
//  - On page load, onload also calls applyThresholdsToUI() immediately after
//    fetching /config, before any other config work, so the sliders always
//    show the saved device value even if later steps in onload throw.
function applyThresholdsToUI(cfg) {
  if (!cfg) return;
  if (typeof cfg.enterRssi === "number") {
    enterRssi = cfg.enterRssi;
    if (enterRssiInput) enterRssiInput.value = enterRssi;
    if (enterRssiSpan) enterRssiSpan.textContent = enterRssi;
  }
  if (typeof cfg.exitRssi === "number") {
    exitRssi = cfg.exitRssi;
    if (exitRssiInput) exitRssiInput.value = exitRssi;
    if (exitRssiSpan) exitRssiSpan.textContent = exitRssi;
  }
}

// Same "device is the source of truth" pattern for system/band/channel.
// Called immediately after /config fetches (onload + refreshConfigFromDevice)
// so the selectors always match the persisted device state, even if some
// later step in onload throws.
function applyBandChannelToUI(cfg) {
  if (!cfg) return;
  // Always set the authoritative frequency first so any display code below
  // that reads `frequency` sees the right value.
  if (typeof cfg.freq === "number") {
    frequency = cfg.freq;
  }
  const hasIdx = typeof cfg.bandIndex === "number" && typeof cfg.channelIndex === "number";
  if (hasIdx) {
    const bandDef = bandDefinitions[cfg.bandIndex];
    if (!bandDef) return;
    currentSystem = bandDef.system;
    if (systemSelect) systemSelect.value = currentSystem;
    if (calibSystemSelect) calibSystemSelect.value = currentSystem;
    // Repopulate both band <select>s for the correct system, then pick the
    // right option by matching the band's global index.
    populateBandsBySystem(currentSystem, bandSelect);
    populateBandsBySystem(currentSystem, calibBandSelect);
    const filtered = bandDefinitions.filter(b => b.system === currentSystem);
    const localBandIdx = filtered.findIndex(b => b.index === cfg.bandIndex);
    if (localBandIdx >= 0) {
      if (bandSelect) bandSelect.selectedIndex = localBandIdx;
      if (calibBandSelect) calibBandSelect.selectedIndex = localBandIdx;
    }
    updateChannelAvailability(bandSelect);
    updateChannelAvailability(calibBandSelect);
    if (channelSelect) channelSelect.selectedIndex = cfg.channelIndex;
    if (calibChannelSelect) calibChannelSelect.selectedIndex = cfg.channelIndex;
  } else if (typeof cfg.freq === "number") {
    // Fallback: find band/channel purely from frequency.
    setBandChannelIndex(cfg.freq);
  }
  // Refresh the "R1 5658MHz"-style readouts in both tabs.
  try { populateFreqOutput(); } catch (e) { /* ignore */ }
  try { populateCalibFreqOutput(); } catch (e) { /* ignore */ }
}

// Clean up any corrupt saved debug RSSI overlay position from earlier builds
// (NaN -> null from parseInt("") caused off-screen positioning)
(function sanitizeDebugRssiPos() {
  try {
    var raw = localStorage.getItem('debugRssiPos');
    if (!raw) return;
    var pos = JSON.parse(raw);
    if (!pos || typeof pos !== 'object' ||
        !Number.isFinite(pos.top) || !Number.isFinite(pos.left)) {
      localStorage.removeItem('debugRssiPos');
      console.log('[DebugOverlay] Cleared corrupt debugRssiPos from localStorage');
    }
  } catch (e) {
    localStorage.removeItem('debugRssiPos');
  }
})();

// Fetch and display version
async function fetchVersion() {
  try {
    const response = await fetch('/version');
    if (response.ok) {
      const version = await response.text();
      const footerVersion = document.getElementById('footerVersion');
      if (footerVersion) {
        footerVersion.textContent = `FPVGate v${version}`;
      }
    }
  } catch (err) {
    console.error('Failed to fetch version:', err);
  }
}

// Load initial sync state on page load (determines badge and race view)
async function loadInitialSyncState() {
  try {
    const response = await fetch('/config');
    if (response.ok) {
      const config = await response.json();
      
      // Set sync mode from config
      if (config.raceSyncMode !== undefined) {
        raceSyncMode = config.raceSyncMode;
      }
      if (config.syncedTimers && Array.isArray(config.syncedTimers)) {
        syncedTimers = config.syncedTimers.slice();
      }
      if (config.masterHostname !== undefined) {
        masterHostname = config.masterHostname;
      }
      
      // Initialize sync devices and update UI
      initSyncDevicesFromConfig();
      updateSlaveModelUI();
      
      console.log('[Init] Loaded sync state - mode:', raceSyncMode);
    }
  } catch (err) {
    console.error('[Init] Failed to load initial sync state:', err);
  }
}

// Add localized validation message for IP pattern
// The preload skeleton is inlined in index.html so it can paint before
// style.css and the head scripts arrive. It is removed once the real shell is
// ready. A skeleton that never clears is worse than no skeleton at all, so this
// is deliberately hard to get stuck: it runs on DOMContentLoaded, again on
// window load, and behind a timeout, and any one of them is enough.
let skeletonCleared = false;

// The theme lives on the device and arrives with /config, so the page used to
// paint in the default theme and then repaint once the fetch landed. Caching it
// here lets the inline script in index.html apply it before first paint. The
// device stays the source of truth; this is only a hint for the next load.
function cacheThemeForPreload(theme) {
  try {
    if (!theme) return;
    localStorage.setItem("theme", theme);
    if (theme === "custom") {
      // Read the resolved custom-* variables rather than the settings inputs.
      // --custom-primary-dark is derived at apply time and --custom-border is
      // not an input at all, so reading the inputs would miss both.
      const cs = getComputedStyle(document.documentElement);
      const custom = {};
      ["--custom-background", "--custom-primary", "--custom-primary-dark",
       "--custom-secondary", "--custom-menu", "--custom-text",
       "--custom-border"].forEach((name) => {
        const value = cs.getPropertyValue(name).trim();
        if (value) custom[name] = value;
      });
      localStorage.setItem("themeCustomColors", JSON.stringify(custom));
    } else {
      localStorage.removeItem("themeCustomColors");
    }
    // Cache the resolved surface colours so the preload skeleton can match the
    // theme instead of using its hardcoded neutrals.
    const cs = getComputedStyle(document.documentElement);
    const surfaces = {
      bg: cs.getPropertyValue("--background-color").trim(),
      panel: cs.getPropertyValue("--tabcontent-bg").trim(),
      border: cs.getPropertyValue("--border-color").trim(),
    };
    if (surfaces.bg) localStorage.setItem("themeSurfaces", JSON.stringify(surfaces));
  } catch (e) {
    // localStorage can throw in private browsing. A flash is not worth an error.
  }
}

function hideAppSkeleton() {
  if (skeletonCleared) return;
  const el = document.getElementById("appSkeleton");
  if (!el) return;
  skeletonCleared = true;
  el.classList.add("is-hidden");
  // Remove rather than leave it hidden, so its fixed overlay cannot intercept
  // clicks if the fade is interrupted.
  setTimeout(() => el.remove(), 300);
}

document.addEventListener("DOMContentLoaded", hideAppSkeleton);
window.addEventListener("load", hideAppSkeleton);
// Backstop: if an init step throws before either listener fires, the user still
// gets a usable page rather than staring at a shimmer.
setTimeout(hideAppSkeleton, 8000);

document.addEventListener("DOMContentLoaded", () => {
  // Fetch version on page load
  fetchVersion();
  
  // Fetch this device's address for sync UI
  fetchThisDeviceAddress();
  
  // Load initial sync state (for badge and race view)
  loadInitialSyncState();
  
  const webhookIP = document.getElementById("webhookIP");
  if (webhookIP) {
    const updateValidity = () => {
      if (webhookIP.validity.patternMismatch) {
        webhookIP.setCustomValidity(i18n.t("messages.invalid_ip"));
      } else {
        webhookIP.setCustomValidity("");
      }
    };
    webhookIP.addEventListener("input", updateValidity);
    webhookIP.addEventListener("invalid", updateValidity);
  }
});

// Release the SSE socket + stop RSSI streaming before the page is torn down.
// Without this the ESP32 AsyncTCP keeps the old TCP PCB around until its own
// timeout, which can starve the new page of connection slots on reload and
// leave us waiting ~8 minutes for things like /version, /timer/ping, etc.
// Uses `keepalive: true` so the stop request survives the unload.
function _releaseWifiResourcesOnUnload() {
  try {
    if (eventSource) {
      try { eventSource.close(); } catch (e) { /* ignore */ }
      eventSource = null;
    }
  } catch (e) { /* ignore */ }
  if (eventSourceReconnectTimer) {
    clearTimeout(eventSourceReconnectTimer);
    eventSourceReconnectTimer = null;
  }
  if (connectionStatusUpdateInterval) {
    clearInterval(connectionStatusUpdateInterval);
    connectionStatusUpdateInterval = null;
  }
  // Best-effort request to stop the RSSI stream if we had it running so the
  // device isn't still transmitting into a dead TCP connection.
  if (rssiSending) {
    try {
      fetch("/timer/rssiStop", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        keepalive: true,
      }).catch(function() {});
    } catch (e) { /* ignore */ }
  }
}
window.addEventListener("beforeunload", _releaseWifiResourcesOnUnload);
window.addEventListener("pagehide", _releaseWifiResourcesOnUnload);

var audioEnabled = false;
var speakObjsQueue = [];
var lapFormat = "full"; // 'full', 'laptime', 'timeonly'
var selectedVoice = "default";
const legacyVoiceAliases = {
  piper: "default",
  german: "de",
  spanish: "es",
  french: "fr",
  voice_de: "de",
  voice_es: "es",
  voice_fr: "fr",
};

function normalizeVoiceSelectionValue(value) {
  const normalized = legacyVoiceAliases[value] || value || "default";
  const voiceSelect = document.getElementById("voiceSelect");
  if (!voiceSelect) return normalized;
  const optionValues = Array.from(voiceSelect.options).map((option) => option.value);
  return optionValues.includes(normalized) ? normalized : "default";
}

// Initialize hybrid audio announcer
const audioAnnouncer = new AudioAnnouncer();

// Transport initialization
async function initializeTransport() {
  setupWiFiEvents();
  updateConnectionStatus("WiFi", true);
}

function setupWiFiEvents() {
  // Clear any pending reconnect timer
  if (eventSourceReconnectTimer) {
    clearTimeout(eventSourceReconnectTimer);
    eventSourceReconnectTimer = null;
  }

  if (eventSource) {
    eventSource.close();
  }

  if (window.EventSource) {
    console.log("[SSE] Creating EventSource connection to /events...");
    console.log("[SSE] Page origin:", window.location.origin, "host:", window.location.host);
    
    eventSource = new EventSource("/events");
    
    // Track last event time for debugging
    window.lastSSEEvent = Date.now();

    eventSource.addEventListener(
      "open",
      function (e) {
        console.log("[SSE] Connection OPEN - readyState:", eventSource.readyState);
        eventSourceReconnectAttempts = 0; // Reset counter on successful connect
        if (c5ReceiverSelected()) c5RaceResync();
        updateConnectionStatus("WiFi", true);
        window.lastSSEEvent = Date.now();

        // Update connection info every 5 seconds
        if (connectionStatusUpdateInterval) {
          clearInterval(connectionStatusUpdateInterval);
        }
        connectionStatusUpdateInterval = setInterval(() => {
          updateConnectionStatus("WiFi", true);
          // Log SSE health
          const timeSinceLastEvent = Math.round((Date.now() - window.lastSSEEvent) / 1000);
          console.log("[SSE] Health check - seconds since last event:", timeSinceLastEvent, "readyState:", eventSource?.readyState);
        }, 5000);
      },
      false
    );
    
    // Listen for keepalive pings from server
    eventSource.addEventListener(
      "keepalive",
      function (e) {
        window.lastSSEEvent = Date.now();
        // Don't log every keepalive, just track it
      },
      false
    );

    eventSource.addEventListener(
      "error",
      function (e) {
        console.log("[SSE] ERROR event - readyState:", e.target.readyState, "EventSource.OPEN:", EventSource.OPEN);
        if (e.target.readyState != EventSource.OPEN) {
          console.log("[SSE] Connection CLOSED/CONNECTING - attempting reconnect...");
          updateConnectionStatus("WiFi", false);

          // Attempt to reconnect
          if (eventSourceReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            eventSourceReconnectAttempts++;
            console.log(`[SSE] Reconnect attempt ${eventSourceReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${RECONNECT_DELAY_MS}ms...`);

            eventSourceReconnectTimer = setTimeout(() => {
              console.log("[SSE] Attempting EventSource reconnect...");
              setupWiFiEvents();
            }, RECONNECT_DELAY_MS);
          } else {
            console.error("[SSE] Max reconnect attempts reached. Please refresh the page.");
          }
        }
      },
      false
    );

    eventSource.addEventListener(
      "rssi",
      function (e) {
        rssiBuffer.push(e.data);
        if (rssiBuffer.length > 10) {
          rssiBuffer.shift();
        }
        console.log("rssi", e.data, "buffer size", rssiBuffer.length);
      },
      false
    );

    // ESP32-C5 multi-pilot: live RSSI and laps (data/c5-multipilot.js).
    eventSource.addEventListener("c5Rssi", function (e) {
      const data = JSON.parse(e.data);
      // The C5 wire value is 10-bit (0..1023); keep the public/UI calibration
      // scale at 0..255 with quarter-step resolution.
      window.c5PilotRssi = (data.rssi || []).map(v => Number(v) / 4);
      if (typeof C5UI !== "undefined") C5UI.onRssi(data);
      // A multi-pilot race already running when this page opened.
      if (data.race && !c5Race.active && c5RacePilotsNow().length >= 1) {
        c5RaceReset(true);
        c5RaceResync();
      }
    }, false);

    eventSource.addEventListener("c5Lap", function (e) {
      const data = JSON.parse(e.data);
      if (typeof C5UI !== "undefined") C5UI.onLap(data);
      handleC5RaceLap(data);
      console.log(`[C5] Pilot ${Number(data.pilot) + 1} ${+data.lap === 0 ? "Gate 1" : "lap " + data.lap}: ${(data.lapTimeMs / 1000).toFixed(2)}s`);
    }, false);


    eventSource.addEventListener(
      "lap",
      function (e) {
        window.lastSSEEvent = Date.now();
        var lap = (parseFloat(e.data) / 1000).toFixed(2);
        console.log("[SSE] LAP EVENT RECEIVED - raw:", e.data, "formatted:", lap);
        if (!c5ReceiverSelected()) addLap(lap);
      },
      false
    );
    
    eventSource.addEventListener(
      "raceState",
      function (e) {
        console.log("[SSE] raceState event:", e.data);
        handleRaceStateEvent(e.data);
      },
      false
    );
    
    eventSource.addEventListener(
      "slaveLap",
      function (e) {
        window.lastSSEEvent = Date.now();
        console.log("[SSE] slaveLap event:", e.data);
        try {
          const data = JSON.parse(e.data);
          handleSlaveLapEvent(data);
        } catch (err) {
          console.error("[SSE] Error parsing slaveLap event:", err);
        }
      },
      false
    );
    
    eventSource.addEventListener(
      "configUpdated",
      function (e) {
        window.lastSSEEvent = Date.now();
        console.log("[SSE] configUpdated event - refreshing config from device");
        refreshConfigFromDevice();
        if (typeof RaceEvent !== "undefined" && c5EventManaged && !raceRunning) RaceEvent.reload();
      },
      false
    );
  }
}

// Handle race state changes from SSE (for slave mode sync)
function handleRaceStateEvent(state) {
  console.log("[Sync] Handling race state:", state);
  if (state === "starting") {
    // ELRS starts the device-side countdown.  Mirror only its speech here;
    // do not call startRace() or send a second /timer/start command.
    window.elrsRemoteStarting = true;
    queueSpeak(`<p>${i18n.t("settings.tts.arm_quad")}</p>`);
    if (raceCountdownMode === 0) {
      queueSpeak(`<p>${i18n.t("settings.tts.starting_soon")}</p>`);
    } else {
      setTimeout(() => queueSpeak(`<p>${i18n.t("settings.tts.starting_soon")}</p>`), 5000);
    }
    return;
  }
  
  if (state === "started") {
    if (window.elrsRemoteStarting) {
      window.elrsRemoteStarting = false;
      beep(1, 1, "square");
      beep(500, 880, "square");
      if (navigator.vibrate) navigator.vibrate(500);
    }
    currentRaceSessionTimestamp = null;
    // Race started (from master or local)
    if (!c5Race.active || c5HasRaceLaps()) {
      c5RaceReset(c5MultiMode() ? c5RacePilotsNow().length >= 1 : c5RacePilotsNow().length >= 2);
      renderUnifiedRaceView();
    }
    raceRunning = true;
    c5RaceLabel = typeof RaceEvent !== "undefined" ? RaceEvent.raceLabel(c5Race.racers) : {};
    lapTimerStartMs = Date.now();
    startRaceTimer();
    updateRaceButtons();
    clearRaceLeader();
    console.log("[Sync] Race started via SSE");
    if (c5ReceiverSelected()) c5RaceResync().then((d) => { if (d && d.timestamp) c5ObservedTimestamp = d.timestamp; });
  } else if (state === "stopped") {
    // Race stopped (e.g. from LCD) – stop timer and reset displays like stopRace()
    raceRunning = false;
    stopRaceTimer();
    timer.innerHTML = i18n.t("race.timer_default");
    currentLapStartMs = 0;
    var currentLapTimerEl = document.getElementById("currentLapTimer");
    if (currentLapTimerEl) currentLapTimerEl.textContent = "00:00:00s";
    stopDistancePolling();
    updateRaceButtons();
    clearRaceLeader();
    console.log("[Sync] Race stopped via SSE");
    if (audioAnnouncer) audioAnnouncer.clearQueue();
    queueSpeak(`<p>${i18n.t("settings.tts.race_stopped")}</p>`);
    if (c5ReceiverSelected()) {
      completeC5RaceInBrowser().catch((err) => { console.error("[C5] Save status:", err); alert(err.message); });
    }
  } else if (state === "cleared") {
    // Laps cleared - reset UI
    raceRunning = false;
    stopRaceTimer();
    resetLapDisplay();
    updateRaceButtons();
    console.log("[Sync] Laps cleared via SSE");
  } else if (state === "startFailed" && c5ReceiverSelected()) {
    c5RaceResync().then((d) => { if (d && d.error) alert(d.error); });
  }
}

// Reset lap display without sending commands
function resetLapDisplay() {
  lapNo = -1;
  lapTimes = [];
  updateLapCounter();
  if (raceNotesInput) {
    raceNotesInput.value = "";
  }
  updateRaceNotesIndicator();
  currentRaceSessionTimestamp = null;
  
  // Clear lap analysis
  const analysisContent = document.getElementById("analysisContent");
  if (analysisContent) {
    analysisContent.innerHTML = `<p class="no-data">${i18n.t("analysis.no_data")}</p>`;
  }
  
  // Clear race analysis
  const raceAnalysisContent = document.getElementById("raceAnalysisContent");
  if (raceAnalysisContent) {
    raceAnalysisContent.innerHTML = `<p class="no-data">${i18n.t("analysis.race_no_tab")}</p>`;
  }
  
  // Clear remote pilots data
  remotePilots = {};
  c5RaceReset(false);

  // Re-render unified view (will show empty state)
  renderUnifiedRaceView();
}

// ============================================
// Remote Pilots Functions (Master Mode)
// ============================================

// Handle slave lap event from SSE
function handleSlaveLapEvent(data) {
  const { lapTimeMs, pilotName, pilotPhonetic, pilotColor, slaveHostname } = data;
  
  console.log(`[Remote] Lap from ${slaveHostname}: ${pilotName} - ${lapTimeMs}ms`);
  
  // Initialize pilot if not exists
  if (!remotePilots[slaveHostname]) {
    remotePilots[slaveHostname] = {
      pilotName: pilotName,
      pilotPhonetic: pilotPhonetic || pilotName,
      pilotColor: pilotColor || 0x0080FF,
      lapTimes: [],
      lapNo: -1
    };
  }
  
  // Update pilot info (in case it changed)
  remotePilots[slaveHostname].pilotName = pilotName;
  remotePilots[slaveHostname].pilotPhonetic = pilotPhonetic || pilotName;
  remotePilots[slaveHostname].pilotColor = pilotColor;
  
  // Add lap
  const lapTime = (lapTimeMs / 1000).toFixed(2);
  remotePilots[slaveHostname].lapNo += 1;
  remotePilots[slaveHostname].lapTimes.push(parseFloat(lapTime));
  
  // Show remote pilots section if in master mode
  updateRemotePilotsVisibility();
  
  // Render the updated pilot list
  renderRemotePilotsList();
  
  // Update race analysis charts (in master mode)
  if (raceSyncMode === 1) {
    updateRaceAnalysisView();
  }
  
  // Update race leader color on gate LEDs
  const remotePilotHex = "#" + ("000000" + pilotColor.toString(16)).slice(-6);
  updateRaceLeader(remotePilotHex);

  // Announce via TTS
  announceRemotePilotLap(remotePilots[slaveHostname], lapTime);
}

// Announce remote pilot lap via TTS
function announceRemotePilotLap(pilot, lapTime) {
  if (!audioEnabled) return;
  
  const name = pilot.pilotPhonetic || pilot.pilotName;
  
  // Simple "Pilot, Time" format for multi-pilot sync
  const text = `<p>${name}, ${lapTime}</p>`;
  
  console.log(`[TTS] Remote pilot announcement: ${text}`);
  queueSpeak(text);
}

// Update visibility of remote pilots section based on sync mode
function updateRemotePilotsVisibility() {
  const section = document.getElementById("remotePilotsSection");
  if (!section) return;
  
  // Show in master mode when there are remote pilots
  const hasRemotePilots = Object.keys(remotePilots).length > 0;
  section.style.display = (raceSyncMode === 1 && hasRemotePilots) ? "block" : "none";
}

// Toggle remote pilots collapse
function toggleRemotePilots() {
  remotePilotsCollapsed = !remotePilotsCollapsed;
  const content = document.getElementById("remotePilotsContent");
  const icon = document.getElementById("remotePilotsIcon");
  
  if (content) {
    content.style.display = remotePilotsCollapsed ? "none" : "block";
  }
  if (icon) {
    icon.innerHTML = remotePilotsCollapsed ? "&#9654;" : "&#9660;";
  }
}

// Render the remote pilots list (LEGACY - now uses unified view)
function renderRemotePilotsList() {
  // Trigger unified view render instead
  renderUnifiedRaceView();
}

// ============================================
// Unified Multi-Pilot Race View
// ============================================

// Get local pilot info
function getLocalPilotInfo() {
  const callsignInput = document.getElementById("pcallsign");
  const colorInput = document.getElementById("pilotColor");
  const pilotName = callsignInput && callsignInput.value ? callsignInput.value : (pilotNameInput.value || "Local");
  let pilotColor = 0x0080FF; // Default blue
  if (colorInput && colorInput.value) {
    pilotColor = parseInt(colorInput.value.replace("#", ""), 16);
  }
  return { pilotName, pilotColor, lapTimes: lapTimes.slice(), lapNo: lapNo };
}

// ============================================
// ESP32-C5 multi-pilot races (one C5 timing several pilots)
// ============================================
//
// The C5 slots with Race on (Calibration tab, C5UI.getRacePilots()) are the
// pilots. Two or more racers make a multi-pilot race: the firmware times
// every racer (Gate 1 from the start, then pass to pass, minimum lap) and
// sends "c5Lap" { pilot, lap, lapTimeMs, racer }; GET /api/c5/race returns
// the race so far. One racer stays a single-pilot race through LapTimer and
// the normal "lap" event.

// racers: the C5UI.getRacePilots() list when the race started.
// laps[slot]: seconds, [0] = Gate 1. finished: slots past max laps.
let c5Race = { active: false, racers: [], laps: {}, finished: {} };
let c5RaceResyncing = false;
let c5RaceRequest = null;
let c5GateManaged = false;
let c5EventManaged = false;
let c5ObservedTimestamp = 0;
let c5CompletedTimestamp = 0;
let c5CompletionPromise = null;
let c5RaceLabel = {};
let c5StopReason = "";

function c5ReceiverSelected() {
  const sel = document.getElementById("receiverRadio");
  return !!sel && sel.value === "2" && typeof C5UI !== "undefined";
}

function c5MultiMode() {
  return c5ReceiverSelected() || raceSyncMode === 3;
}

// Race director Event tab (event.js), off unless "Event mode" is on.
function applyEventMode(on) {
  const link = document.getElementById("nav-link-event");
  if (link) link.parentElement.style.display = on ? "" : "none";
  const tab = document.getElementById("raceEvent");
  if (!on && tab && tab.style.display !== "none") document.getElementById("nav-link-race").click();
  if (typeof RaceEvent !== "undefined") RaceEvent.setEnabled(on);
}

function loadEventMode(value) {
  const box = document.getElementById("eventMode");
  if (value === undefined || !box) return;
  if (box.checked !== !!+value) box.checked = !!+value;
  applyEventMode(box.checked);
}

function c5RacePilotsNow() {
  return c5ReceiverSelected() ? C5UI.getRacePilots() : [];
}

// A multi-pilot C5 race is running, or would be if one started now.
function c5MultiRaceView() {
  return c5Race.active || c5MultiMode();
}

function c5RaceRacers() {
  return c5Race.active ? c5Race.racers : c5RacePilotsNow();
}

function c5ColorInt(hex) {
  return parseInt(String(hex || "#0080ff").replace("#", ""), 16);
}

function c5RaceReset(active) {
  c5Race = { active: !!active, racers: active ? c5RacePilotsNow() : [], laps: {}, finished: {} };
}

function c5HasRaceLaps() {
  return Object.values(c5Race.laps).some((l) => l && l.length > 0);
}

// Laps in the race table and history, whichever kind of race this is.
function hasRaceLaps() {
  return lapTimes.length > 0 || c5HasRaceLaps();
}

// The racer with most laps, then the shortest total time: the race's
// legacy single-pilot fields in history are theirs.
function c5RaceLeader() {
  let best = null;
  for (const r of c5Race.racers) {
    const laps = c5Race.laps[r.slot] || [];
    const total = laps.reduce((s, t) => s + t, 0);
    if (!best || laps.length > best.laps.length || (laps.length === best.laps.length && total < best.total)) {
      best = { racer: r, laps, total };
    }
  }
  return best;
}

// Rebuild the laps from the device (page opened mid-race, or a lap event
// arrived out of order).
function c5RaceResync() {
  if (c5RaceResyncing) return c5RaceRequest;
  c5RaceResyncing = true;
  const targetRace = c5Race;
  c5RaceRequest = fetch("/api/c5/race")
    .then((r) => r.json())
    .then((d) => {
      if (c5Race !== targetRace || !c5ReceiverSelected()) return d;
      c5GateManaged = d.gateManaged === true;
      c5EventManaged = d.eventManaged === true;
      if (!c5Race.active) c5RaceReset(true);
      if (d.timestamp && (d.pilots || []).some((p) => typeof p.name === "string")) {
        // The device may already have loaded the next heat into config. The
        // current race still belongs to its frozen roster, including on reload.
        c5Race.racers = d.pilots.filter((p) => (d.racers >> p.slot) & 1).map((p) => ({
          slot: p.slot, name: p.name, label: p.name || `Pilot ${p.slot + 1}`,
          spoken: p.phonetic || p.name || `Pilot ${p.slot + 1}`,
          color: `#${(p.color >>> 0).toString(16).padStart(6, "0")}`, freq: p.frequency,
          channel: typeof C5UI !== "undefined" ? C5UI.channelName(p.frequency) : String(p.frequency),
        }));
      }
      for (const p of d.pilots || []) {
        if (!((d.racers >> p.slot) & 1)) continue;
        c5Race.laps[p.slot] = (p.laps || []).map((ms) => ms / 1000);
      }
      renderUnifiedRaceView();
      updateAnalysisSectionVisibility();
      if (c5GateManaged) {
        currentRaceSessionTimestamp = d.savedTimestamp || null;
        c5StopReason = d.stopReason || "";
        const wasRunning = raceRunning;
        raceRunning = !!d.running;
        if (d.running) c5ObservedTimestamp = d.timestamp;
        if (raceRunning && !wasRunning) startRaceTimer();
        if (!raceRunning) stopRaceTimer();
        updateRaceButtons();
        if (d.busy || d.saveFailed) {
          startRaceButton.disabled = true;
          stopRaceButton.disabled = !d.saveFailed;
        }
        if (!raceRunning) {
          timer.innerHTML = i18n.t("race.timer_default");
          currentLapStartMs = 0;
          stopDistancePolling();
        }
      }
      return d;
    })
    .catch((e) => console.warn("[C5] race resync failed", e))
    .finally(() => { c5RaceResyncing = false; c5RaceRequest = null; });
  return c5RaceRequest;
}

async function waitForC5RaceSave() {
  // A stop is queued to loop(); SD writes can outlive the HTTP response.
  for (let attempt = 0; attempt < 100; ++attempt) {
    const state = await c5RaceResync();
    if (!state) throw new Error("Cannot read C5 race status");
    if (!state.gateManaged) return null; // older firmware keeps browser saving
    if (!state.busy && !state.running) {
      if (state.saveFailed) throw new Error(state.error || "Gate could not save race; press Stop to retry before starting another race");
      return state.savedTimestamp || null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Gate is still finishing the race; refresh to check saved history");
}

function completeC5RaceInBrowser() {
  if (c5CompletionPromise) return c5CompletionPromise;
  c5CompletionPromise = (async () => {
    const timestamp = await waitForC5RaceSave();
    if (!timestamp || timestamp === c5CompletedTimestamp) return timestamp;
    const races = await loadRaceHistory();
    const saved = (races || []).find((r) => r.timestamp === timestamp);
    if (!saved) throw new Error("Race is saved on the gate, but history could not be loaded. Retry Stop to refresh it.");
    // Older firmware still uses browser Events. New firmware binds and saves
    // the heat itself; browser notes must not overwrite that frozen label.
    if (saved && timestamp === c5ObservedTimestamp) {
      const notes = raceNotesInput ? raceNotesInput.value.trim() : "";
      if (notes || c5RaceLabel.name || c5RaceLabel.tag) {
        const form = new URLSearchParams({ timestamp: String(timestamp),
          name: c5EventManaged ? saved.name || "" : c5RaceLabel.name || saved.name || "",
          tag: c5EventManaged ? saved.tag || "" : c5RaceLabel.tag || saved.tag || "", notes: notes || saved.notes || "" });
        const response = await fetch("/races/update", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok || result.status !== "OK") throw new Error("Could not update race notes");
        await loadRaceHistory();
      }
      if (typeof RaceEvent !== "undefined" && !c5EventManaged) RaceEvent.recordRace(saved);
    }
    if (c5EventManaged && typeof RaceEvent !== "undefined" && typeof RaceEvent.reload === "function") {
      await RaceEvent.reload();
      if (typeof refreshConfigFromDevice === "function") await refreshConfigFromDevice();
    }
    c5CompletedTimestamp = timestamp;
    if (timestamp === c5ObservedTimestamp && (c5StopReason === "maxLaps" || c5StopReason === "heatTime"))
      queueSpeak(`<p>${i18n.t("settings.tts.race_complete")}</p>`);
    if (openRaceNotesOnRaceEnd && timestamp === c5ObservedTimestamp) openRaceNotesModal();
    return timestamp;
  })().finally(() => { c5CompletionPromise = null; });
  return c5CompletionPromise;
}

function handleC5RaceLap(d) {
  if (!d.racer) return;
  if (!c5Race.active) {
    // A race we didn't see start (another client, the LCD, a reload).
    if (!raceRunning || c5RacePilotsNow().length < (c5MultiMode() ? 1 : 2)) return;
    c5RaceReset(true);
    c5RaceResync();
    return;
  }
  const racer = c5Race.racers.find((r) => r.slot === +d.pilot);
  if (!racer) return;   // Race switched on after the start
  const laps = c5Race.laps[racer.slot] || (c5Race.laps[racer.slot] = []);
  const idx = +d.lap;
  if (idx > laps.length) {   // missed an event
    c5RaceResync();
    return;
  }
  laps[idx] = d.lapTimeMs / 1000;
  renderUnifiedRaceView();
  updateAnalysisSectionVisibility();
  updateRaceLeader(racer.color);
  announceC5RaceLap(racer, idx, laps[idx]);

  // Max laps: each racer finishes on their own; the race stops when all have.
  if (maxLaps > 0 && idx >= maxLaps && !c5Race.finished[racer.slot]) {
    c5Race.finished[racer.slot] = true;
    queueSpeak(`<p>${racer.spoken} finished</p>`);
    if (!c5GateManaged && c5Race.racers.every((r) => c5Race.finished[r.slot])) {
      setTimeout(function () {
        if (!stopRaceButton.disabled) {
          stopRace();
          queueSpeak(`<p>${i18n.t("settings.tts.race_complete")}</p>`);
        }
      }, 500);
    }
  }
}

// A missed pass, added by hand: the gate times it now and sends it back as
// a normal "c5Lap" event, so the tables, callouts and saved race all see it.
function addC5ManualLap(slot, button) {
  if (button) button.disabled = true;
  fetch(`/api/c5/addLap?pilot=${slot}`, { method: "POST" })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .catch((e) => console.warn("[C5] manual lap failed", e))
    .finally(() => { if (button) setTimeout(() => { button.disabled = !raceRunning; }, 400); });
}

// Always include the pilot name when speaking multi-pilot lap times or totals.
function announceC5RaceLap(racer, idx, seconds) {
  const mode = announcerSelect.options[announcerSelect.selectedIndex].value;
  const extras = announcerExtras();
  if (extras.beepEveryLap && mode !== "beep") beep(100, 330, "square");
  if (mode === "beep") {
    beep(100, 330, "square");
    return;
  }
  if (mode === "none" || mode === "") return;
  const t = seconds.toFixed(2);
  if (idx === 0) {
    queueSpeak(`<p>${racer.spoken} ${i18n.t("settings.tts.gate1", { n: t })}</p>`);
    return;
  }
  // 2- and 3-lap modes: this pilot's last 2 or 3 laps, once they have that many.
  const count = mode === "2lap" ? 2 : mode === "3lap" ? 3 : 0;
  if (count) {
    const total = lastLapsTotal((c5Race.laps[racer.slot] || []).slice(0, idx + 1), count);
    const parts = extras.withLapTime ? [t] : [];
    if (total) parts.push(`${count} laps ${total}`);
    if (parts.length) queueSpeak(`<p>${racer.spoken} ${parts.join(", ")}</p>`);
    return;
  }
  queueSpeak(`<p>${racer.spoken}, ${t}</p>`);
}

// Render the race view - switches between personal (single) and multi-pilot view
function renderUnifiedRaceView() {
  const multi = c5MultiRaceView();
  document.getElementById("lapCounter").style.display = multi ? "none" : "";
  document.getElementById("addLapButton").style.display = c5ReceiverSelected() ? "none" : "";
  if (c5MultiRaceView()) {
    renderMultiPilotRaceView();
    return;
  }
  // Use personal (single-pilot) view when sync is disabled
  if (raceSyncMode === 0 && !c5MultiMode()) {
    renderPersonalRaceView();
    return;
  }
  
  // Use multi-pilot view for master/slave sync modes
  renderMultiPilotRaceView();
}

// Render classic single-pilot race view (Personal mode)
function renderPersonalRaceView() {
  const summary = document.getElementById("multiPilotRaceSummary");
  if (summary) summary.innerHTML = "";
  const thead = document.getElementById("lapTableHead");
  const tbody = document.getElementById("lapTableBody");
  if (!thead || !tbody) return;
  
  // Build classic header
  thead.innerHTML = `<tr>
    <th>${i18n.t("race.table.lap_no") || "Lap No"}</th>
    <th>${i18n.t("race.table.lap_time") || "Lap Time"}</th>
    <th>${i18n.t("race.table.gap") || "Gap"}</th>
    <th>${i18n.t("race.table.total_time") || "Total Time"}</th>
  </tr>`;
  
  // Build body rows
  let bodyHtml = '';
  let totalTime = 0;
  let fastestIdx = -1;
  let fastestTime = Infinity;
  
  // Find fastest lap (excluding gate 1)
  for (let i = 1; i < lapTimes.length; i++) {
    if (lapTimes[i] < fastestTime) {
      fastestTime = lapTimes[i];
      fastestIdx = i;
    }
  }
  
  for (let i = 0; i < lapTimes.length; i++) {
    const lapTime = lapTimes[i];
    totalTime += lapTime;
    const lapLabel = i === 0 ? '0' : i;
    const isFastest = i === fastestIdx && i > 0;
    
    // Calculate gap from previous lap
    let gap = '-';
    if (i > 0) {
      const diff = (lapTime - lapTimes[i - 1]).toFixed(2);
      gap = (diff > 0 ? '+' : '') + diff + 's';
    }
    
    // Format lap time display
    let lapTimeDisplay;
    if (i === 0) {
      lapTimeDisplay = i18n.t("race.gate1_table", { s: lapTime.toFixed(2) }) || `Gate 1: ${lapTime.toFixed(2)}s`;
    } else {
      lapTimeDisplay = lapTime.toFixed(2) + 's';
    }
    
    bodyHtml += `<tr class="${isFastest ? 'fastest-lap' : ''}">
      <td>${lapLabel}</td>
      <td>${lapTimeDisplay}</td>
      <td>${gap}</td>
      <td>${totalTime.toFixed(2)}s</td>
    </tr>`;
  }
  
  if (lapTimes.length === 0) {
    bodyHtml = `<tr><td colspan="4" class="no-pilots-message">${i18n.t("race.no_laps") || "No laps recorded yet"}</td></tr>`;
  }
  
  tbody.innerHTML = bodyHtml;
}

// Render multi-pilot race view (Master/Slave sync modes)
function renderMultiPilotRaceView() {
  const thead = document.getElementById("lapTableHead");
  const tbody = document.getElementById("lapTableBody");
  if (!thead || !tbody) return;
  
  // Collect all pilots
  const pilots = [];

  if (c5MultiRaceView()) {
    // One column per C5 racer.
    for (const r of c5RaceRacers()) {
      const laps = c5Race.laps[r.slot] || [];
      pilots.push({ id: 'c5-' + r.slot, name: r.label, color: c5ColorInt(r.color), lapTimes: laps,
                    lapNo: laps.length - 1, isLocal: false });
    }
  } else {
  // Add local pilot first
  const localPilot = getLocalPilotInfo();
  pilots.push({
    id: 'local',
    name: localPilot.pilotName,
    color: localPilot.pilotColor,
    lapTimes: localPilot.lapTimes,
    lapNo: localPilot.lapNo,
    isLocal: true
  });
  }

  // Add remote pilots
  for (const hostname of (c5MultiRaceView() ? [] : Object.keys(remotePilots))) {
    const pilot = remotePilots[hostname];
    pilots.push({
      id: hostname,
      name: pilot.pilotName,
      color: pilot.pilotColor || 0x0080FF,
      lapTimes: pilot.lapTimes,
      lapNo: pilot.lapNo,
      isLocal: false
    });
  }
  
  // Find max laps across all pilots
  let maxLapCount = 0;
  for (const pilot of pilots) {
    if (pilot.lapTimes.length > maxLapCount) {
      maxLapCount = pilot.lapTimes.length;
    }
  }

  const summaryHost = document.getElementById("multiPilotRaceSummary");
  if (summaryHost) {
    const ranked = pilots.slice().sort((a, b) => b.lapTimes.length - a.lapTimes.length ||
      a.lapTimes.reduce((s, v) => s + v, 0) - b.lapTimes.reduce((s, v) => s + v, 0));
    const rows = ranked.map(pilot => {
      const valid = pilot.lapTimes.slice(1).filter(t => Number.isFinite(t) && t > 0);
      return { pilot, valid, total: pilot.lapTimes.reduce((a, b) => a + b, 0), best: valid.length ? Math.min(...valid) : null };
    });
    const leader = rows.find(r => r.pilot.lapTimes.length);
    const overallBest = Math.min(...rows.map(r => r.best ?? Infinity));
    const manual = c5MultiRaceView();   // C5 racers can be given a lap by hand
    summaryHost.innerHTML = `<table class="multi-pilot-standings-table">
      <thead><tr><th>Pos</th><th class="mps-pilot">Pilot</th><th>Laps</th><th>Last</th><th>Best</th><th>Total</th><th>Gap</th><th>Status</th>${manual ? "<th></th>" : ""}</tr></thead>
      <tbody>${rows.map((r, i) => {
        const started = r.pilot.lapTimes.length > 0;
        const colorHex = '#' + ((r.pilot.color || 0) >>> 0).toString(16).padStart(6, '0');
        const last = r.valid.length ? r.valid[r.valid.length - 1].toFixed(3) + "s" : "--";
        let gap = "--";
        if (started && r === leader) gap = "Leader";
        else if (started && leader) {
          const lapsDown = leader.pilot.lapTimes.length - r.pilot.lapTimes.length;
          gap = lapsDown > 0 ? `+${lapsDown} lap${lapsDown === 1 ? "" : "s"}` : `+${(r.total - leader.total).toFixed(3)}s`;
        }
        const [status, statusClass] = maxLaps > 0 && r.valid.length >= maxLaps ? ["Finished", "finished"]
          : started ? (raceRunning ? ["Racing", "racing"] : ["Stopped", ""]) : ["Awaiting Gate 1", ""];
        return `<tr>
          <td class="mps-pos">${started ? i + 1 : "-"}</td>
          <td class="mps-pilot"><span class="mps-name"><span class="multi-pilot-dot" style="--pilot-color:${colorHex}"></span>${escapeHtml(r.pilot.name || `Pilot ${i + 1}`)}</span></td>
          <td>${r.valid.length}</td>
          <td>${last}</td>
          <td${r.best !== null && r.best === overallBest ? ' class="mps-fastest"' : ""}>${r.best !== null ? r.best.toFixed(3) + "s" : "--"}</td>
          <td>${started ? r.total.toFixed(3) + "s" : "--"}</td>
          <td class="mps-gap">${gap}</td>
          <td><span class="multi-pilot-status ${statusClass}">${status}</span></td>
          ${manual ? `<td><button class="mps-add-lap" onclick="addC5ManualLap(${r.pilot.id.slice(3)}, this)"${raceRunning ? "" : " disabled"}
            title="Give ${escapeHtml(r.pilot.name || "this pilot")} a lap now">+ Lap</button></td>` : ""}
        </tr>`;
      }).join("")}</tbody></table>`;
  }
  
  // Find fastest lap for each pilot (excluding gate 1 / lap 0)
  const fastestLaps = {};
  for (const pilot of pilots) {
    let fastest = Infinity;
    let fastestIdx = -1;
    for (let i = 1; i < pilot.lapTimes.length; i++) {
      if (pilot.lapTimes[i] < fastest) {
        fastest = pilot.lapTimes[i];
        fastestIdx = i;
      }
    }
    fastestLaps[pilot.id] = fastestIdx;
  }
  
  // Build header row
  let headerHtml = '<tr><th class="lap-header">' + (i18n.t("race.table.lap_no") || "Lap") + '</th>';
  for (const pilot of pilots) {
    const colorHex = '#' + (pilot.color).toString(16).padStart(6, '0');
    const localBadge = pilot.isLocal ? ' ★' : '';
    headerHtml += `<th class="pilot-header" style="border-top: 4px solid ${colorHex};">${escapeHtml(pilot.name)}${localBadge}</th>`;
  }
  headerHtml += '</tr>';
  thead.innerHTML = headerHtml;
  
  // Build body rows
  let bodyHtml = '';
  for (let lapIdx = 0; lapIdx < maxLapCount; lapIdx++) {
    const lapLabel = lapIdx === 0 ? 'G1' : lapIdx;
    
    bodyHtml += `<tr><td class="lap-number">${lapLabel}</td>`;
    
    for (const pilot of pilots) {
      const colorHex = '#' + (pilot.color).toString(16).padStart(6, '0');
      
      if (lapIdx < pilot.lapTimes.length) {
        const lapTime = pilot.lapTimes[lapIdx];
        const isFastest = lapIdx === fastestLaps[pilot.id] && lapIdx > 0;
        
        // Calculate gap from previous lap
        let gapHtml = '';
        if (lapIdx > 1 && lapIdx < pilot.lapTimes.length) {
          const prevTime = pilot.lapTimes[lapIdx - 1];
          const diff = (lapTime - prevTime).toFixed(2);
          const gapClass = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : '');
          gapHtml = `<div class="lap-gap ${gapClass}">${diff > 0 ? '+' : ''}${diff}s</div>`;
        }
        
        bodyHtml += `
          <td class="pilot-lap${isFastest ? ' fastest' : ''}" style="border-left: 3px solid ${colorHex};">
            <div class="lap-time">${lapTime.toFixed(3)}s</div>
            ${gapHtml}
          </td>
        `;
      } else {
        bodyHtml += `<td class="pilot-lap" style="border-left: 3px solid ${colorHex}; opacity: 0.3;">-</td>`;
      }
    }
    
    bodyHtml += '</tr>';
  }
  
  // Show message if no laps
  if (maxLapCount === 0) {
    bodyHtml = `<tr><td colspan="${pilots.length + 1}" class="no-pilots-message">${i18n.t("race.no_laps") || "No laps recorded yet"}</td></tr>`;
  }
  
  tbody.innerHTML = bodyHtml;
}

// Save master hostname
function saveMasterHostname() {
  const input = document.getElementById("masterHostname");
  if (!input) return;
  
  masterHostname = input.value.trim();
  console.log("[Sync] Saving master hostname:", masterHostname);
  autoSaveConfig();
}

// Race running state
var raceRunning = false;

// Start race timer display (no HTTP call)
function startRaceTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  var millis = 0;
  var seconds = 0;
  var minutes = 0;
  
  // Track current lap start time
  currentLapStartMs = Date.now();
  
  timerInterval = setInterval(function () {
    millis += 1;
    if (millis == 100) {
      millis = 0;
      seconds++;
      if (seconds == 60) {
        seconds = 0;
        minutes++;
        if (minutes == 60) {
          minutes = 0;
        }
      }
    }
    // Total race time
    let m = minutes < 10 ? "0" + minutes : minutes;
    let s = seconds < 10 ? "0" + seconds : seconds;
    let ms = millis < 10 ? "0" + millis : millis;
    timer.innerHTML = `${m}:${s}:${ms}` + i18n.t("race.table.seconds_short");
    
    // Current lap time
    updateCurrentLapTimer();
  }, 10);
}

// Stop race timer display (no HTTP call)
function stopRaceTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update race control buttons based on race state
function updateRaceButtons() {
  document.querySelectorAll(".mps-add-lap").forEach((b) => { b.disabled = !raceRunning; });
  if (typeof RaceEvent !== "undefined") RaceEvent.refreshRaceTab();   // Next Heat button
  if (raceRunning) {
    startRaceButton.disabled = true;
    stopRaceButton.disabled = false;
    addLapButton.disabled = false;
  } else {
    // Check slave mode - keep buttons disabled if slave
    if (raceSyncMode === 2) {
      startRaceButton.disabled = true;
      stopRaceButton.disabled = true;
      addLapButton.disabled = true;
    } else {
      startRaceButton.disabled = false;
      stopRaceButton.disabled = true;
      addLapButton.disabled = true;
    }
  }
}

async function updateConnectionStatus(mode, connected) {
  // Update header indicator
  const indicator = document.getElementById("connectionIndicator");
  if (indicator) {
    const dot = indicator.querySelector(".status-dot");
    const modeEl = indicator.querySelector(".connection-mode");
    const detailsEl = document.getElementById("connectionDetails");

    // Update connection state
    if (connected) {
      dot.classList.add("connected");
    } else {
      dot.classList.remove("connected");
    }

    // Update mode text
    if (modeEl) {
      modeEl.textContent = connected ? i18n.t("race.connected", { mode: mode }) : i18n.t("race.disconnected");
    }

    // Build detailed info for slide-out panel
    let details = "";

    if (mode === "WiFi" && connected) {
      try {
        const response = await fetch("/api/wifi");
        if (response.ok) {
          const wifiData = await response.json();
          if (wifiData.mode === "AP") {
            details = i18n.t("race.wifi_ap_details", { ssid: wifiData.ssid, ip: wifiData.ip, clients: wifiData.clients });
          } else if (wifiData.mode === "STA") {
            const signalQuality = wifiData.rssi > -50 ? i18n.t("messages.wifi_excellent") : wifiData.rssi > -60 ? i18n.t("messages.wifi_good") : wifiData.rssi > -70 ? i18n.t("messages.wifi_fair") : i18n.t("messages.wifi_weak");
            details = i18n.t("race.wifi_sta_details", { ssid: wifiData.ssid, ip: wifiData.ip, quality: signalQuality, rssi: wifiData.rssi });
          }
          // Ethernet boards: the wired connection first, Wi-Fi below it.
          const eth = wifiData.ethernet;
          if (eth && eth.link) {
            if (modeEl) modeEl.textContent = i18n.t("race.connected", { mode: "Ethernet" });
            const ethDetails = eth.ip
              ? i18n.t("race.eth_details", { ip: eth.ip, how: eth.fixed ? i18n.t("race.eth_fixed") : "DHCP" })
              : i18n.t("race.eth_no_ip");
            details = details ? ethDetails + "<br><br>" + details : ethDetails;
          } else if (eth) {
            details = i18n.t("race.eth_unplugged") + (details ? "<br><br>" + details : "");
          }
        }
      } catch (err) {
        console.error("Failed to fetch WiFi info:", err);
        details = i18n.t("messages.wifi_error");
      }
    } else if (mode === "USB" && connected) {
      details = i18n.t("race.usb_details");
    } else if (!connected) {
      details = i18n.t("race.connection_lost");
    }

    if (detailsEl) {
      detailsEl.innerHTML = details;
    }
  }
}

onload = async function (e) {
  // The first render builds table headers and analysis labels through t(), so
  // wait for the locale catalogue instead of emitting raw keys.
  if (i18n.ready) await i18n.ready;
  // Load dark mode preference
  loadDarkMode();
  syncOpenRaceNotesOnRaceEndToggle();
  applyRaceNotesButton();
  syncRaceAnalyticsToggleUI();

  config.style.display = "none";
  race.style.display = "block";
  calib.style.display = "none";

  // Create the RSSI chart up front so it always exists, even if a later step
  // in this handler throws. addRssiPoint() bails out when rssiChart is
  // undefined, so we want it initialised before any awaits.
  try {
    if (typeof createRssiChart === "function" && !rssiChart) {
      createRssiChart();
    }
  } catch (err) {
    console.error("[Script] createRssiChart failed:", err);
  }

  // Initialize transport (USB/WiFi)
  await initializeTransport();

  // Fetch config using appropriate transport
  let configData;
  try {
    const response = await fetch("/config");
    configData = await response.json();
    console.log(configData);
  } catch (err) {
    console.error("[Script] Failed to fetch config:", err);
    // Set defaults if config fetch fails
    configData = {};
  }
  // Apply the authoritative slices of config to the UI FIRST, before the big
  // config-apply block below. Keeps hydration bulletproof - any later failure
  // in this handler can't leave these fields stuck at their HTML defaults.
  // Band selectors must be populated before applyBandChannelToUI so its
  // populateBandsBySystem()/selectedIndex calls have something to work with.
  populateBandsBySystem("analog", bandSelect);
  populateBandsBySystem("analog", calibBandSelect);
  applyBandChannelToUI(configData);
  applyThresholdsToUI(configData);
  // Suppress autoSaveConfig calls from the rest of the load (updateMinLap
  // etc.) so onload doesn't write the just-fetched config back to the device.
  _refreshingFromDevice = true;
  try {
    // System/band/channel and RSSI thresholds are already hydrated above via
    // applyBandChannelToUI() / applyThresholdsToUI(). Everything below is
    // additional config that isn't part of the cross-client live-sync path.
    if (configData.minLap !== undefined) {
      minLapInput.value = (parseFloat(configData.minLap) / 10).toFixed(1);
      updateMinLap(minLapInput, minLapInput.value);
    }
    if (configData.anType !== undefined) announcerSelect.selectedIndex = configData.anType;
    if (configData.anRate !== undefined) {
      announcerRateInput.value = (parseFloat(configData.anRate) / 10).toFixed(1);
      updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
    }
    // enterRssi / exitRssi are hydrated up-front via applyThresholdsToUI().
    if (configData.raceCountdownMode !== undefined) {
      raceCountdownMode = parseInt(configData.raceCountdownMode) === 0 ? 0 : 1;
      var rcEl = document.getElementById("raceCountdownMode");
      if (rcEl) rcEl.value = String(raceCountdownMode);
    }
    if (configData.name !== undefined) pilotNameInput.value = configData.name;
    if (configData.ssid !== undefined) ssidInput.value = configData.ssid;
    if (configData.pwd !== undefined) pwdInput.value = configData.pwd;
    maxLapsInput.value = configData.maxLaps !== undefined ? configData.maxLaps : 0;
    updateMaxLaps(maxLapsInput, maxLapsInput.value);
    if (maxHeatTimeInput) {
      maxHeatTimeInput.value = configData.maxHeatTime30s !== undefined ? configData.maxHeatTime30s : 0;
      updateMaxHeatTime(maxHeatTimeInput, maxHeatTimeInput.value);
    }

    // Load beep volume from localStorage (browser audio volume)
    const beepVolumeInput = document.getElementById("beepVolume");
    const savedBeepVolume = localStorage.getItem('beepVolume');
    if (beepVolumeInput) {
      const vol = savedBeepVolume !== null ? parseInt(savedBeepVolume) : 100;
      beepVolumeInput.value = vol;
      $(beepVolumeInput).parent().find("span").text(vol + "%");
      setBeepVolume(vol / 100);
    }

    // Load pilot callsign, phonetic name, and color from device config
    const callsignInput = document.getElementById("pcallsign");
    const phoneticInput = document.getElementById("pphonetic");
    const colorInput = document.getElementById("pilotColor");
    if (callsignInput && configData.pilotCallsign !== undefined) {
      callsignInput.value = configData.pilotCallsign;
    }
    if (phoneticInput && configData.pilotPhonetic !== undefined) {
      phoneticInput.value = configData.pilotPhonetic;
    }
    if (colorInput && configData.pilotColor !== undefined) {
      const hexColor = "#" + ("000000" + configData.pilotColor.toString(16)).slice(-6).toUpperCase();
      colorInput.value = hexColor;
      updateColorPreview();
    }
    populateFreqOutput();
    populateCalibFreqOutput(); // Also update calibration tab frequency display
    stopRaceButton.disabled = true;
    startRaceButton.disabled = false;
    addLapButton.disabled = true;
    clearInterval(timerInterval);
    timer.innerHTML = i18n.t("race.timer_default");
    clearLaps();
    updateRaceNotesIndicator();
    // Already created up-front; keep call site as a safety net in case the
    // early createRssiChart() above failed for any reason.
    if (!rssiChart) createRssiChart();
    // Restore debug mode toggle from localStorage
    var debugToggle = document.getElementById("debugModeToggle");
    if (debugToggle) debugToggle.checked = debugMode;
    updateDebugOverlay();
    // Auto-enable voice on load
    enableAudioLoop();
    // Setup pilot color preview
    const colorSelect = document.getElementById("pilotColor");
    if (colorSelect) {
      colorSelect.addEventListener("change", updateColorPreview);
      updateColorPreview();
    }

    // Load lap format and voice selection from device config
    lapFormat = configData.lapFormat || "full";
    selectedVoice = normalizeVoiceSelectionValue(configData.selectedVoice || "default");
    const lapFormatSelect = document.getElementById("lapFormatSelect");
    const voiceSelect = document.getElementById("voiceSelect");
    if (lapFormatSelect) lapFormatSelect.value = lapFormat;
    if (voiceSelect) voiceSelect.value = selectedVoice;
    if (audioAnnouncer) audioAnnouncer.setVoice(selectedVoice);

    // Load speaker setting from device config
    const speakerSection = document.getElementById("speakerSection");
    const speakerNote = document.getElementById("speakerNote");
    const speakerToggle = document.getElementById("speakerEnabled");
    if (configData.hasI2SAudio === 1) {
      // Device supports I2S speaker - show the toggle
      if (speakerSection) speakerSection.style.display = "";
      if (speakerNote) speakerNote.style.display = "";
      if (speakerToggle && configData.speakerEnabled !== undefined) {
        speakerToggle.checked = configData.speakerEnabled === 1;
      }
    } else {
      // No I2S support - hide the toggle
      if (speakerSection) speakerSection.style.display = "none";
      if (speakerNote) speakerNote.style.display = "none";
    }

    // Load and apply theme from device config
    if (configData.theme) {
      const savedTheme = configData.theme;
      const themeSelect = document.getElementById("themeSelect");
      const customSection = document.getElementById("customThemeSection");
      
      if (themeSelect) themeSelect.value = savedTheme;
      
      // Load custom theme colors if available
      if (configData.customBgColor) {
        const bgInput = document.getElementById("customBgColor");
        if (bgInput) bgInput.value = configData.customBgColor;
      }
      if (configData.customPrimaryColor) {
        const primaryInput = document.getElementById("customPrimaryColor");
        if (primaryInput) primaryInput.value = configData.customPrimaryColor;
      }
      if (configData.customTextColor) {
        const textInput = document.getElementById("customTextColor");
        if (textInput) textInput.value = configData.customTextColor;
      }
      if (configData.customMenuColor) {
        const menuInput = document.getElementById("customMenuColor");
        if (menuInput) menuInput.value = configData.customMenuColor;
      }
      if (configData.customSecondaryColor) {
        const secondaryInput = document.getElementById("customSecondaryColor");
        if (secondaryInput) secondaryInput.value = configData.customSecondaryColor;
      }
      
      // Show/hide custom section and apply theme
      if (customSection) {
        customSection.style.display = savedTheme === "custom" ? "block" : "none";
      }
      
      if (savedTheme === "custom") {
        document.documentElement.setAttribute("data-theme", "custom");
        loadCustomThemeColors();
      } else if (savedTheme !== "lighter") {
        document.documentElement.setAttribute("data-theme", savedTheme);
      }
      
      updateThemeLogos(savedTheme);
      cacheThemeForPreload(savedTheme);
    }

    // Load LED settings from config (if available)
    const ledPresetSelect = document.getElementById("ledPreset");
    const ledBrightnessInput = document.getElementById("ledBrightness");
    const ledColorInput = document.getElementById("ledColor");
    const ledManualOverrideToggle = document.getElementById("ledManualOverride");
    const customColorSection = document.getElementById("customColorSection");

    // Load ledPreset from backend config
    if (configData.ledPreset !== undefined && ledPresetSelect) {
      ledPresetSelect.value = configData.ledPreset;
    }

    if (configData.ledBrightness !== undefined && ledBrightnessInput) {
      ledBrightnessInput.value = configData.ledBrightness;
      updateLedBrightness(ledBrightnessInput, configData.ledBrightness);
    }

    if (configData.ledColor !== undefined && ledColorInput) {
      // Convert color integer to hex string
      const hexColor = "#" + ("000000" + configData.ledColor.toString(16)).slice(-6).toUpperCase();
      ledColorInput.value = hexColor;
    }

    // Initialize LED preset UI on page load (UI only, no command sent)
    if (ledPresetSelect) {
      updateLedPresetUI();
    }

    // Load Gate LED settings from config
    const gateLEDsEnabledToggle = document.getElementById("gateLEDsEnabled");
    const webhookRaceStartToggle = document.getElementById("webhookRaceStart");
    const webhookRaceStopToggle = document.getElementById("webhookRaceStop");
    const webhookLapToggle = document.getElementById("webhookLap");
    const gateLEDOptions = document.getElementById("gateLEDOptions");

    if (gateLEDsEnabledToggle && configData.gateLEDsEnabled !== undefined) {
      gateLEDsEnabledToggle.checked = configData.gateLEDsEnabled === 1;
      if (gateLEDOptions) {
        gateLEDOptions.style.display = configData.gateLEDsEnabled === 1 ? "block" : "none";
      }
    }

    if (webhookRaceStartToggle && configData.webhookRaceStart !== undefined) {
      webhookRaceStartToggle.checked = configData.webhookRaceStart === 1;
    }

    if (webhookRaceStopToggle && configData.webhookRaceStop !== undefined) {
      webhookRaceStopToggle.checked = configData.webhookRaceStop === 1;
    }

    if (webhookLapToggle && configData.webhookLap !== undefined) {
      webhookLapToggle.checked = configData.webhookLap === 1;
    }

    // Initialize battery monitoring UI on page load
    const batterySection = document.getElementById("batteryMonitoringSection");
    const batteryToggle = document.getElementById("batteryMonitorToggle");
    const batteryTypeSelect = document.getElementById("batteryType");
    const batteryCellsSelect = document.getElementById("batteryCells");
    const lowBatteryAlarmPerCellInput = document.getElementById("lowBatteryAlarmPerCell");
    const batteryVoltageDividerInput = document.getElementById("batteryVoltageDivider");
    
    // Load battery settings from config
    if (batteryToggle && configData.batteryAlarmEnabled !== undefined) {
      batteryToggle.checked = configData.batteryAlarmEnabled === 1;
    }
    if (batteryTypeSelect && configData.batteryType !== undefined) {
      batteryTypeSelect.value = configData.batteryType;
    }
    if (batteryCellsSelect && configData.batteryCells !== undefined) {
      batteryCellsSelect.value = configData.batteryCells;
    }
    if (lowBatteryAlarmPerCellInput && configData.lowBatteryAlarmPerCell !== undefined) {
      lowBatteryAlarmPerCellInput.value = configData.lowBatteryAlarmPerCell.toFixed(2);
      updateLowBatteryAlarmPerCell(configData.lowBatteryAlarmPerCell);
    }
    if (batteryVoltageDividerInput && configData.batteryVoltageDivider !== undefined) {
      batteryVoltageDividerInput.value = configData.batteryVoltageDivider.toFixed(1);
      updateBatteryVoltageDivider(configData.batteryVoltageDivider);
    }
    
    if (batterySection && batteryToggle) {
      batterySection.style.display = batteryToggle.checked ? "block" : "none";
    }

    // Load receiver radio setting
    const receiverRadioSelect = document.getElementById("receiverRadio");
    if (receiverRadioSelect && configData.receiverRadio !== undefined) {
      receiverRadioSelect.value = configData.receiverRadio;
    }
    loadEventMode(configData.eventMode);
    loadC5Profiles(configData.c5Pilots || [], configData.c5Gain);
    if (c5ReceiverSelected()) c5RaceResync();
    toggleNovaFilterSection();

    // Load Novacore filter settings
    const filterFields = [
      { id: "novaFilterKalman", key: "novaFilterKalman", type: "toggle" },
      { id: "novaFilterMedian", key: "novaFilterMedian", type: "toggle" },
      { id: "novaFilterMA", key: "novaFilterMA", type: "toggle" },
      { id: "novaFilterEMA", key: "novaFilterEMA", type: "toggle" },
      { id: "novaFilterStepLimiter", key: "novaFilterStepLimiter", type: "toggle" },
      { id: "novaKalmanQ", key: "novaKalmanQ", type: "range", display: "novaKalmanQValue", fmt: function(v){ return (v/100).toFixed(1); } },
      { id: "novaEmaAlpha", key: "novaEmaAlpha", type: "range", display: "novaEmaAlphaValue", fmt: function(v){ return (v/100).toFixed(2); } },
      { id: "novaStepMax", key: "novaStepMax", type: "range", display: "novaStepMaxValue", fmt: function(v){ return v; } },
    ];
    filterFields.forEach(function(f) {
      var el = document.getElementById(f.id);
      if (!el || configData[f.key] === undefined) return;
      if (f.type === "toggle") {
        el.checked = configData[f.key] === 1;
      } else {
        el.value = configData[f.key];
        var disp = document.getElementById(f.display);
        if (disp) disp.textContent = f.fmt(configData[f.key]);
      }
    });
    toggleNovaFilterSection();

    updateSlaveModelUI();

    // Mark config as loaded so saves from calibration tab work
    configLoaded = true;
  } catch (err) {
    // Surface any silent failure in the config-application block instead of
    // letting the async onload promise swallow it. The RSSI chart has already
    // been created above, so we still get a usable UI.
    console.error("[Script] onload config block failed:", err);
    configLoaded = true;
  } finally {
    _refreshingFromDevice = false;
  }
};

let batteryVoltageInterval = null;
let batteryAlarmActive = false;
let batteryAlarmDismissed = false;
let batteryAlarmDismissTime = 0;
const BATTERY_ALARM_HYSTERESIS = 0.1; // 0.1V hysteresis above threshold
const BATTERY_ALARM_DISMISS_DURATION = 30000; // 30 seconds in milliseconds

async function getBatteryVoltage() {
  // Only fetch if battery monitoring is enabled
  const batteryToggle = document.getElementById("batteryMonitorToggle");
  const batteryIndicator = document.getElementById("batteryIndicator");
  const batteryVoltageHeaderText = document.getElementById("batteryVoltageHeaderText");
  const batteryIcon = document.getElementById("batteryIcon");
  
  if (!batteryToggle || !batteryToggle.checked) {
    if (batteryVoltageDisplay) {
      batteryVoltageDisplay.innerText = "--";
      batteryVoltageDisplay.style.color = "";
    }
    // Hide battery indicator when monitoring disabled
    if (batteryIndicator) {
      batteryIndicator.style.display = "none";
    }
    return;
  }
  
  try {
    let configData = null;
    const resp = await fetch("/config");
    configData = await resp.json();

    if (configData && configData.batteryVoltage !== undefined) {
      const totalVoltage = configData.batteryVoltage;
      const batteryCells = configData.batteryCells || 4;
      const perCellVoltage = totalVoltage / batteryCells;
      const alarmThreshold = configData.lowBatteryAlarmPerCell || 3.5;
      const batteryAlarmEnabled = configData.batteryAlarmEnabled || 0;
      
      // Display format: "16.8V (4.2V/cell)"
      const displayText = totalVoltage.toFixed(1) + "V (" + perCellVoltage.toFixed(2) + "V/cell)";
      
      if (batteryVoltageDisplay) {
        batteryVoltageDisplay.innerText = displayText;
        
        // Color coding based on per-cell voltage vs alarm threshold
        if (batteryAlarmEnabled === 1 && perCellVoltage < alarmThreshold) {
          batteryVoltageDisplay.style.color = "#e74c3c"; // Red for low battery
        } else if (batteryAlarmEnabled === 1 && perCellVoltage < alarmThreshold + 0.1) {
          batteryVoltageDisplay.style.color = "#f39c12"; // Orange for warning
        } else {
          batteryVoltageDisplay.style.color = "#2ecc71"; // Green for good
        }
      }
      
      // Update battery indicator with appropriate SVG icon
      if (batteryIndicator && batteryVoltageHeaderText && batteryIcon) {
        batteryIndicator.style.display = "flex";
        batteryVoltageHeaderText.innerText = totalVoltage.toFixed(1) + "V";
        
        // Determine battery type voltage range
        const batteryType = configData.batteryType || 0; // 0=LiPo, 1=LiPoHV, 2=Li-Ion
        let maxVoltage, halfVoltage, criticalVoltage;
        
        if (batteryType === 0) { // LiPo
          maxVoltage = 4.2;
          halfVoltage = 3.7;
          criticalVoltage = alarmThreshold + 0.15;
        } else if (batteryType === 1) { // LiPoHV
          maxVoltage = 4.35;
          halfVoltage = 3.8;
          criticalVoltage = alarmThreshold + 0.15;
        } else { // Li-Ion
          maxVoltage = 4.2;
          halfVoltage = 3.6;
          criticalVoltage = alarmThreshold + 0.15;
        }
        
        // Switch battery icon based on voltage level
        if (perCellVoltage >= halfVoltage) {
          batteryIcon.src = "bat-full-svg.svg";
          batteryIcon.className = "battery-icon battery-full"; // Green for full charge
        } else if (perCellVoltage >= criticalVoltage) {
          batteryIcon.src = "bat-mid-svg.svg";
          batteryIcon.className = "battery-icon battery-mid"; // Yellow/Orange for half charge
        } else {
          batteryIcon.src = "bat-low-svg.svg";
          batteryIcon.className = "battery-icon battery-low"; // Red for critical
        }
      }
      
      // Alarm logic with hysteresis
      if (batteryAlarmEnabled === 1) {
        // Check if dismiss period has expired
        if (batteryAlarmDismissed && Date.now() > batteryAlarmDismissTime) {
          batteryAlarmDismissed = false;
        }
        
        if (!batteryAlarmActive && !batteryAlarmDismissed && perCellVoltage < alarmThreshold) {
          // Trigger alarm when below threshold
          triggerBatteryAlarm(displayText);
        } else if (batteryAlarmActive && perCellVoltage >= alarmThreshold + BATTERY_ALARM_HYSTERESIS) {
          // Clear alarm when voltage rises above threshold + hysteresis
          batteryAlarmDismissed = false;
          batteryAlarmDismissTime = 0;
        }
      }
    } else {
      if (batteryVoltageDisplay) {
        batteryVoltageDisplay.innerText = "--";
        batteryVoltageDisplay.style.color = "";
      }
      if (batteryIndicator) {
        batteryIndicator.style.display = "none";
      }
    }
  } catch (err) {
    // Silently fail - battery monitoring is optional
    if (batteryVoltageDisplay) {
      batteryVoltageDisplay.innerText = "--";
      batteryVoltageDisplay.style.color = "";
    }
    if (batteryIndicator) {
      batteryIndicator.style.display = "none";
    }
  }
}

// Trigger battery alarm
function triggerBatteryAlarm(voltageText) {
  batteryAlarmActive = true;
  const alarmModal = document.getElementById("lowBatteryAlarmModal");
  const alarmVoltageEl = document.getElementById("batteryAlarmVoltage");
  
  if (alarmModal && alarmVoltageEl) {
    alarmVoltageEl.textContent = voltageText;
    alarmModal.style.display = "flex";
    
    // Play beep sound
    if (beepAudioContext) {
      beep(500, 800, "sine");
    }
    
    // Audio announcement
    if (audioEnabled && audioAnnouncer) {
      audioAnnouncer.speak(i18n.t("battery_alarm.critical"));
    }
  }
}

// Dismiss battery alarm
function dismissBatteryAlarm() {
  batteryAlarmActive = false;
  batteryAlarmDismissed = true;
  batteryAlarmDismissTime = Date.now() + BATTERY_ALARM_DISMISS_DURATION;
  const alarmModal = document.getElementById("lowBatteryAlarmModal");
  
  if (alarmModal) {
    alarmModal.style.display = "none";
  }
}

// Start battery voltage polling (will only run when enabled)
batteryVoltageInterval = setInterval(getBatteryVoltage, 2000);

function addRssiPoint() {
  if (!rssiChart) return; // Chart not initialized yet

  var calibVisible = calib.style.display != "none";
  var raceVisible = race.style.display != "none";
  var debugActive = debugMode && raceVisible && debugRssiChart;

  if (calibVisible || debugActive) {
    // Consume RSSI data from buffer
    if (rssiBuffer.length > 0) {
      rssiValue = parseInt(rssiBuffer.shift());
      if (crossing && rssiValue < exitRssi) {
        crossing = false;
      } else if (!crossing && rssiValue > enterRssi) {
        crossing = true;
      }
      maxRssiValue = Math.max(maxRssiValue, rssiValue);
      minRssiValue = Math.min(minRssiValue, rssiValue);
    }

    var now = Date.now();

    // Feed calibration chart (when visible)
    if (calibVisible) {
      rssiChart.start();
      rssiChart.options.horizontalLines = [
        { color: "hsl(8.2, 86.5%, 53.7%)", lineWidth: 1.7, value: enterRssi },
        { color: "hsl(25, 85%, 55%)", lineWidth: 1.7, value: exitRssi },
      ];
      rssiChart.options.maxValue = Math.max(maxRssiValue, enterRssi + 10);
      rssiChart.options.minValue = Math.max(0, Math.min(minRssiValue, exitRssi - 10));
      rssiSeries.append(now, rssiValue);
      if (crossing) {
        rssiCrossingSeries.append(now, 256);
      } else {
        rssiCrossingSeries.append(now, -10);
      }
    } else {
      rssiChart.stop();
    }

    // Feed debug overlay chart (when race tab visible + debug mode on)
    if (debugActive) {
      debugRssiSeries.append(now, rssiValue);
      if (crossing) {
        debugCrossingSeries.append(now, 256);
      } else {
        debugCrossingSeries.append(now, -10);
      }
      debugRssiChart.options.horizontalLines = [
        { color: "hsl(8.2, 86.5%, 53.7%)", lineWidth: 1.7, value: enterRssi },
        { color: "hsl(25, 85%, 55%)", lineWidth: 1.7, value: exitRssi },
      ];
      debugRssiChart.options.maxValue = Math.max(maxRssiValue, enterRssi + 10);
      debugRssiChart.options.minValue = Math.max(0, Math.min(minRssiValue, exitRssi - 10));
      // Update RSSI readout
      var dbgVal = document.getElementById("debugRssiValue");
      if (dbgVal) dbgVal.textContent = rssiValue > 0 ? rssiValue : "--";
    }
  } else {
    rssiChart.stop();
    maxRssiValue = enterRssi + 10;
    minRssiValue = exitRssi - 10;
  }
}

setInterval(addRssiPoint, 200);

function createRssiChart() {
  rssiChart = new SmoothieChart({
    responsive: true,
    millisPerPixel: 50,
    grid: {
      strokeStyle: "rgba(255,255,255,0.25)",
      sharpLines: true,
      verticalSections: 0,
      borderVisible: false,
    },
    labels: {
      precision: 0,
    },
    maxValue: 1,
    minValue: 0,
  });
  rssiChart.addTimeSeries(rssiSeries, {
    lineWidth: 1.7,
    strokeStyle: "hsl(214, 53%, 60%)",
    fillStyle: "hsla(214, 53%, 60%, 0.4)",
  });
  rssiChart.addTimeSeries(rssiCrossingSeries, {
    lineWidth: 1.7,
    strokeStyle: "none",
    fillStyle: "hsla(136, 71%, 70%, 0.3)",
  });
  rssiChart.streamTo(document.getElementById("rssiChart"), 200);

  // Create debug overlay chart
  createDebugRssiChart();
}

function createDebugRssiChart() {
  debugRssiChart = new SmoothieChart({
    responsive: true,
    millisPerPixel: 80,
    grid: {
      strokeStyle: "rgba(255,255,255,0.15)",
      sharpLines: true,
      verticalSections: 0,
      borderVisible: false,
    },
    labels: {
      precision: 0,
      fontSize: 9,
    },
    maxValue: 1,
    minValue: 0,
  });
  debugRssiChart.addTimeSeries(debugRssiSeries, {
    lineWidth: 1.2,
    strokeStyle: "hsl(214, 53%, 60%)",
    fillStyle: "hsla(214, 53%, 60%, 0.3)",
  });
  debugRssiChart.addTimeSeries(debugCrossingSeries, {
    lineWidth: 1,
    strokeStyle: "none",
    fillStyle: "hsla(136, 71%, 70%, 0.25)",
  });
  debugRssiChart.streamTo(document.getElementById("debugRssiChart"), 200);
}

function toggleNovaFilterSection() {
  var sel = document.getElementById("receiverRadio");
  var section = document.getElementById("novaFilterSection");
  if (!sel || !section) return;
  section.style.display = sel.value === "1" ? "block" : "none";
  var c5 = document.getElementById("c5PilotSection");
  if (c5) c5.style.display = sel.value === "2" ? "block" : "none";
  var c5Calib = document.getElementById("c5CalibrationSection");
  if (c5Calib) c5Calib.style.display = sel.value === "2" ? "block" : "none";
  if (sel.value === "2") {
    updateRaceSyncMode(3, true);
    if (typeof initSyncDevicesFromConfig === "function") initSyncDevicesFromConfig();
    if (typeof renderSyncDevicesList === "function") renderSyncDevicesList();
  } else if (raceSyncMode === 3) {
    updateRaceSyncMode(0, true);
    initSyncDevicesFromConfig();
    renderSyncDevicesList();
  }
  var legacyChannel = document.getElementById("legacyCalibrationChannelCard");
  if (legacyChannel) legacyChannel.style.display = sel.value === "2" ? "none" : "block";
  var legacyThresholds = document.getElementById("legacyCalibrationThresholdCard");
  if (legacyThresholds) legacyThresholds.style.display = sel.value === "2" ? "none" : "block";
  var legacyGraph = document.getElementById("legacyCalibrationGraphCard");
  if (legacyGraph) legacyGraph.style.display = sel.value === "2" ? "none" : "block";
  if (typeof C5UI !== "undefined") C5UI.setVisible(sel.value === "2");
  updateDebugOverlay();   // the overlay's chart depends on the receiver
  // Sync slider visibility with toggle state
  toggleNovaFilterSlider("kalman");
  toggleNovaFilterSlider("ema");
  toggleNovaFilterSlider("step");
}

// ESP32-C5 pilots, gain and thresholds live in data/c5-multipilot.js (the
// Calibration tab); these keep the rest of script.js unaware of its layout.
function loadC5Profiles(profiles, gain) {
  if (typeof C5UI !== "undefined") C5UI.load(profiles || [], gain);
}

function getC5ProfilesForSave() {
  return typeof C5UI !== "undefined" ? C5UI.getProfilesForSave() : undefined;
}

function getC5GainForSave() {
  return typeof C5UI !== "undefined" ? C5UI.getGain() : undefined;
}

function openC5Calibration() {
  if (typeof closeSettingsModal === "function") closeSettingsModal();
  const link = document.getElementById("nav-link-calib");
  if (link) link.click();
}

function restoreDefaultNovaFilters() {
  document.getElementById("novaFilterKalman").checked = true;
  document.getElementById("novaFilterMedian").checked = false;
  document.getElementById("novaFilterMA").checked = false;
  document.getElementById("novaFilterEMA").checked = false;
  document.getElementById("novaFilterStepLimiter").checked = true;
  document.getElementById("novaKalmanQ").value = 200;
  document.getElementById("novaKalmanQValue").textContent = "2.0";
  document.getElementById("novaEmaAlpha").value = 15;
  document.getElementById("novaEmaAlphaValue").textContent = "0.15";
  document.getElementById("novaStepMax").value = 20;
  document.getElementById("novaStepMaxValue").textContent = "20";
  toggleNovaFilterSlider("kalman");
  toggleNovaFilterSlider("ema");
  toggleNovaFilterSlider("step");
  autoSaveConfig();
}

function toggleNovaFilterSlider(filter) {
  var map = {
    kalman: { toggle: "novaFilterKalman", slider: "novaKalmanSlider" },
    ema: { toggle: "novaFilterEMA", slider: "novaEmaSlider" },
    step: { toggle: "novaFilterStepLimiter", slider: "novaStepSlider" },
  };
  var entry = map[filter];
  if (!entry) return;
  var tog = document.getElementById(entry.toggle);
  var slider = document.getElementById(entry.slider);
  if (tog && slider) {
    slider.style.display = tog.checked ? "block" : "none";
  }
}

function toggleDebugMode(enabled) {
  debugMode = enabled;
  localStorage.setItem('debugMode', enabled ? '1' : '0');
  updateDebugOverlay();
}

function updateDebugOverlay() {
  var overlay = document.getElementById("debugRssiOverlay");
  if (!overlay) return;
  var raceVisible = race.style.display != "none";
  // The C5 sends no single-channel RSSI; its overlay is the 8-pilot chart.
  var c5 = c5ReceiverSelected();
  document.getElementById("debugRssiChart").style.display = c5 ? "none" : "block";
  document.getElementById("debugC5Chart").style.display = c5 ? "block" : "none";
  overlay.style.width = c5 ? "460px" : "320px";
  overlay.style.height = c5 ? "220px" : "120px";
  if (debugMode && raceVisible) {
    overlay.style.display = "block";
    // Restore saved position (only if it's a valid, in-viewport numeric pair)
    var saved = localStorage.getItem('debugRssiPos');
    if (saved) {
      try {
        var pos = JSON.parse(saved);
        if (pos && typeof pos === 'object' &&
            Number.isFinite(pos.top) && Number.isFinite(pos.left)) {
          var w = overlay.offsetWidth || 320;
          var h = overlay.offsetHeight || 120;
          var maxLeft = Math.max(0, window.innerWidth - w);
          var maxTop = Math.max(0, window.innerHeight - h);
          var clampedLeft = Math.max(0, Math.min(pos.left, maxLeft));
          var clampedTop = Math.max(0, Math.min(pos.top, maxTop));
          overlay.style.top = clampedTop + 'px';
          overlay.style.left = clampedLeft + 'px';
          overlay.style.bottom = 'auto';
          overlay.style.right = 'auto';
        } else {
          // Corrupt entry - nuke it so we fall back to the default bottom/right anchor
          localStorage.removeItem('debugRssiPos');
        }
      } catch(e) {
        localStorage.removeItem('debugRssiPos');
      }
    }
    if (debugRssiChart && !c5) debugRssiChart.start();
    // Ensure RSSI streaming is active
    if (!rssiSending) startRssiStreaming();
  } else {
    overlay.style.display = "none";
    if (debugRssiChart) debugRssiChart.stop();
  }
}

// --- Debug RSSI Overlay Drag ---
(function() {
  var dragHandle, overlay, offsetX, offsetY, dragging = false, moved = false;

  function persistPosition() {
    // Only persist if the overlay was actually dragged to new coordinates.
    // Guards against click-only interactions poisoning localStorage with NaN.
    if (!overlay || !moved) return;
    var top = parseInt(overlay.style.top, 10);
    var left = parseInt(overlay.style.left, 10);
    if (!Number.isFinite(top) || !Number.isFinite(left)) return;
    localStorage.setItem('debugRssiPos', JSON.stringify({ top: top, left: left }));
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    overlay = document.getElementById('debugRssiOverlay');
    if (!overlay) return;
    dragging = true;
    moved = false;
    var rect = overlay.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    dragHandle.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    var newLeft = e.clientX - offsetX;
    var newTop = e.clientY - offsetY;
    // Clamp to viewport
    var w = overlay.offsetWidth, h = overlay.offsetHeight;
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - h));
    overlay.style.left = newLeft + 'px';
    overlay.style.top = newTop + 'px';
    overlay.style.bottom = 'auto';
    overlay.style.right = 'auto';
    moved = true;
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    dragHandle.style.cursor = 'grab';
    persistPosition();
    moved = false;
  }

  // Touch support
  function onTouchStart(e) {
    var t = e.touches[0];
    overlay = document.getElementById('debugRssiOverlay');
    if (!overlay) return;
    dragging = true;
    moved = false;
    var rect = overlay.getBoundingClientRect();
    offsetX = t.clientX - rect.left;
    offsetY = t.clientY - rect.top;
    e.preventDefault();
  }

  function onTouchMove(e) {
    if (!dragging) return;
    var t = e.touches[0];
    var newLeft = t.clientX - offsetX;
    var newTop = t.clientY - offsetY;
    var w = overlay.offsetWidth, h = overlay.offsetHeight;
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - w));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - h));
    overlay.style.left = newLeft + 'px';
    overlay.style.top = newTop + 'px';
    overlay.style.bottom = 'auto';
    overlay.style.right = 'auto';
    moved = true;
    e.preventDefault();
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;
    persistPosition();
    moved = false;
  }

  dragHandle = document.getElementById('debugRssiDragHandle');
  if (dragHandle) {
    dragHandle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    dragHandle.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }
})();

function startRssiStreaming() {
  if (rssiSending) return;
  fetch("/timer/rssiStart", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } })
    .then(function(r) { if (r.ok) rssiSending = true; });
}

function stopRssiStreaming() {
  if (!rssiSending) return;
  fetch("/timer/rssiStop", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } })
    .then(function(r) { if (r.ok) rssiSending = false; });
}
function updateRaceNotesIndicator() {
  if (!raceNotesIndicator || !raceNotesInput) return;
  const hasNotes = raceNotesInput.value.trim().length > 0;
  raceNotesIndicator.style.display = hasNotes ? "inline-flex" : "none";
}

function syncOpenRaceNotesOnRaceEndToggle() {
  const notesToggle = document.getElementById("openRaceNotesOnRaceEnd");
  if (notesToggle) {
    notesToggle.checked = openRaceNotesOnRaceEnd;
  }
}

function toggleOpenRaceNotesOnRaceEnd(enabled) {
  openRaceNotesOnRaceEnd = !!enabled;
  localStorage.setItem("openRaceNotesOnRaceEnd", openRaceNotesOnRaceEnd ? "1" : "0");
  syncOpenRaceNotesOnRaceEndToggle();
}

// Race Notes button on the Race tab, shown unless turned off on this device.
function toggleShowRaceNotesButton(show) {
  localStorage.setItem("showRaceNotesButton", show ? "1" : "0");
  applyRaceNotesButton();
}

function applyRaceNotesButton() {
  const show = localStorage.getItem("showRaceNotesButton") !== "0";
  const btn = document.getElementById("raceNotesButton");
  if (btn) btn.style.display = show ? "" : "none";
  const toggle = document.getElementById("showRaceNotesButton");
  if (toggle) toggle.checked = show;
}

function updateSavedRaceNotes(timestamp, notes) {
  const existingRace = raceHistoryData.find((race) => race.timestamp === timestamp) || {};
  const formData = new URLSearchParams();
  formData.append("timestamp", String(timestamp));
  formData.append("name", existingRace.name || "");
  formData.append("tag", existingRace.tag || "");
  formData.append("notes", notes);
  if (typeof existingRace.totalDistance === "number") {
    formData.append("totalDistance", existingRace.totalDistance);
  }
  return fetch("/races/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data || data.status !== "OK") {
        throw new Error("Race update failed");
      }
      return true;
    });
}

function saveRaceNotes() {
  if (!raceNotesInput) {
    closeRaceNotesModal();
    return;
  }

  const notes = raceNotesInput.value.trim();
  updateRaceNotesIndicator();

  const raceInProgress = stopRaceButton && !stopRaceButton.disabled;
  if (raceInProgress) {
    closeRaceNotesModal();
    return;
  }

  const timestampPromise = currentRaceSessionTimestamp ? Promise.resolve(currentRaceSessionTimestamp) : pendingRaceSavePromise;
  if (!timestampPromise) {
    closeRaceNotesModal();
    return;
  }

  timestampPromise
    .then((timestamp) => {
      if (!timestamp) {
        return false;
      }
      return updateSavedRaceNotes(timestamp, notes);
    })
    .then((saved) => {
      if (saved) {
        loadRaceHistory();
      }
      closeRaceNotesModal();
    })
    .catch((error) => {
      console.error("Error saving race notes:", error);
      alert(i18n.t("messages.race_update_error"));
    });
}

function openRaceNotesModal() {
  const modal = document.getElementById("raceNotesModal");
  if (!modal) return;
  modal.classList.add("active");
  if (raceNotesInput) {
    setTimeout(() => raceNotesInput.focus(), 50);
  }
}

function closeRaceNotesModal() {
  const modal = document.getElementById("raceNotesModal");
  if (!modal) return;
  modal.classList.remove("active");
}

if (raceNotesInput) {
  raceNotesInput.addEventListener("input", updateRaceNotesIndicator);
}

function openTab(evt, tabName) {
  // Declare all variables
  var i, tabcontent, tablinks;

  // Get all elements with class="tabcontent" and hide them
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Get all elements with class="tablinks" and remove the class "active"
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(tabName).style.display = "block";
  evt.currentTarget.className += " active";

  // Refresh config from device when opening config or calib tabs
  // This ensures touchscreen-set values are always reflected in the web UI
  if (tabName === "config" || tabName === "calib") {
    refreshConfigFromDevice();
  }

  // Start/stop RSSI streaming based on tab and debug mode
  if (tabName === "calib" || (tabName === "race" && debugMode)) {
    startRssiStreaming();
  } else if (rssiSending && !(tabName === "race" && debugMode)) {
    // Only stop if not needed by debug overlay on race tab
    var needsRssi = (debugMode && document.getElementById("race").style.display != "none");
    if (!needsRssi) stopRssiStreaming();
  }

  // Update debug overlay visibility
  updateDebugOverlay();

  // Notes modal only applies to race tab
  if (tabName !== "race") {
    closeRaceNotesModal();
  }

  if (tabName === "raceEvent" && typeof RaceEvent !== "undefined") {
    RaceEvent.show();
  }

  // Load race history when opening history tab
  if (tabName === "history") {
    // Close any open race details to ensure clean state
    closeRaceDetails();
    // Small delay to ensure DOM is ready after tab switch
    setTimeout(() => {
      loadRaceHistory();
    }, 50);
  }
}

function updateEnterRssi(obj, value) {
  enterRssi = parseInt(value);
  enterRssiSpan.textContent = enterRssi;
  if (enterRssi <= exitRssi) {
    exitRssi = Math.max(50, enterRssi - 1);
    exitRssiInput.value = exitRssi;
    exitRssiSpan.textContent = exitRssi;
  }
  // No save here - the user must press "Save Thresholds" to persist + broadcast.
}

function updateExitRssi(obj, value) {
  exitRssi = parseInt(value);
  exitRssiSpan.textContent = exitRssi;
  if (exitRssi >= enterRssi) {
    enterRssi = Math.min(255, exitRssi + 1);
    enterRssiInput.value = enterRssi;
    enterRssiSpan.textContent = enterRssi;
  }
  // No save here - the user must press "Save Thresholds" to persist + broadcast.
}


// Debounced auto-save to prevent excessive API calls
let saveTimeout = null;
function autoSaveConfig() {
  if (_refreshingFromDevice) return; // Suppress saves during device-initiated refresh
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveConfig().catch(error => console.error("Configuration save failed:", error));
  }, 1000); // Wait 1 second after last change before saving
}

async function saveConfig() {
  // Don't save until initial config has been loaded from device
  if (!configLoaded) {
    console.log("[Config] Skipping save - config not yet loaded from device");
    throw new Error("Configuration has not loaded yet");
  }
  
  // Get pilot settings
  const callsignInput = document.getElementById("pcallsign");
  const phoneticInput = document.getElementById("pphonetic");
  const colorInput = document.getElementById("pilotColor");
  const themeSelect = document.getElementById("themeSelect");
  const voiceSelect = document.getElementById("voiceSelect");
  const lapFormatSelect = document.getElementById("lapFormatSelect");
  const normalizedSelectedVoice = normalizeVoiceSelectionValue(
    voiceSelect ? voiceSelect.value : selectedVoice
  );
  selectedVoice = normalizedSelectedVoice;
  if (voiceSelect) voiceSelect.value = normalizedSelectedVoice;

  // Convert hex color to integer
  let pilotColorInt = 0x0080ff; // default
  if (colorInput && colorInput.value) {
    pilotColorInt = parseInt(colorInput.value.replace("#", ""), 16);
  }

  // Save all settings to device
  const receiverRadioSelect = document.getElementById("receiverRadio");
  
  // Save band and channel indices along with frequency for accurate restoration
  // Get the actual band index from the dataset
  let selectedBandIndex = 0;
  let selectedChannelIndex = 0;
  if (bandSelect && bandSelect.selectedIndex !== -1) {
    const selectedOption = bandSelect.options[bandSelect.selectedIndex];
    if (selectedOption && selectedOption.dataset.bandIndex) {
      selectedBandIndex = parseInt(selectedOption.dataset.bandIndex);
    }
    selectedChannelIndex = channelSelect ? channelSelect.selectedIndex : 0;
  } else if (calibBandSelect && calibBandSelect.selectedIndex !== -1) {
    // Fallback: bandSelect is in an invalid state (e.g. was corrupted by a stale
    // openSettingsModal fetch). Use calibBandSelect which is always reliable.
    const calibOption = calibBandSelect.options[calibBandSelect.selectedIndex];
    if (calibOption && calibOption.dataset.bandIndex) {
      selectedBandIndex = parseInt(calibOption.dataset.bandIndex);
    }
    selectedChannelIndex = calibChannelSelect ? calibChannelSelect.selectedIndex : 0;
    console.warn('[Config] bandSelect was empty during save - used calibBandSelect as fallback');
  } else {
    // Last resort: fetch current values from device (e.g. touch UI / empty selectors)
    console.log("[Config] Band selector blank, fetching current freq from device");
    try {
      const resp = await fetch("/config");
      const devCfg = await resp.json();
      if (devCfg.bandIndex !== undefined) selectedBandIndex = devCfg.bandIndex;
      if (devCfg.channelIndex !== undefined) selectedChannelIndex = devCfg.channelIndex;
      if (devCfg.freq !== undefined) frequency = devCfg.freq;
    } catch (e) {
      console.error("[Config] Failed to fetch device config, skipping save");
      throw e;
    }
  }
  
  // Get battery settings
  const batteryTypeSelect = document.getElementById("batteryType");
  const batteryCellsSelect = document.getElementById("batteryCells");
  const lowBatteryAlarmPerCellInput = document.getElementById("lowBatteryAlarmPerCell");
  const batteryMonitorToggle = document.getElementById("batteryMonitorToggle");
  const batteryVoltageDividerInput = document.getElementById("batteryVoltageDivider");
  
  // Get custom theme colors
  const customBgColor = document.getElementById("customBgColor");
  const customPrimaryColor = document.getElementById("customPrimaryColor");
  const customTextColor = document.getElementById("customTextColor");
  const customMenuColor = document.getElementById("customMenuColor");
  const customSecondaryColor = document.getElementById("customSecondaryColor");
  
  const configData = {
    freq: frequency,
    bandIndex: selectedBandIndex,
    channelIndex: selectedChannelIndex,
    minLap: parseInt(minLapInput.value * 10),
    alarm: 0,  // Legacy alarm field (no longer used)
    anType: announcerSelect.selectedIndex,
    anRate: parseInt(announcerRate * 10),
    enterRssi: enterRssi,
    exitRssi: exitRssi,
    maxLaps: maxLaps,
    maxHeatTime30s: maxHeatTime30s,
    receiverRadio: receiverRadioSelect ? parseInt(receiverRadioSelect.value) : 0,
    eventMode: document.getElementById("eventMode")?.checked ? 1 : 0,
    c5Gain: getC5GainForSave(),
    c5Pilots: getC5ProfilesForSave(),
    novaFilterKalman: document.getElementById("novaFilterKalman") ? (document.getElementById("novaFilterKalman").checked ? 1 : 0) : 1,
    novaFilterMedian: document.getElementById("novaFilterMedian") ? (document.getElementById("novaFilterMedian").checked ? 1 : 0) : 0,
    novaFilterMA: document.getElementById("novaFilterMA") ? (document.getElementById("novaFilterMA").checked ? 1 : 0) : 0,
    novaFilterEMA: document.getElementById("novaFilterEMA") ? (document.getElementById("novaFilterEMA").checked ? 1 : 0) : 0,
    novaFilterStepLimiter: document.getElementById("novaFilterStepLimiter") ? (document.getElementById("novaFilterStepLimiter").checked ? 1 : 0) : 1,
    novaKalmanQ: parseInt(document.getElementById("novaKalmanQ")?.value || 200),
    novaEmaAlpha: parseInt(document.getElementById("novaEmaAlpha")?.value || 15),
    novaStepMax: parseInt(document.getElementById("novaStepMax")?.value || 20),
    name: pilotNameInput.value,
    pilotCallsign: callsignInput ? callsignInput.value : "",
    pilotPhonetic: phoneticInput ? phoneticInput.value : "",
    pilotColor: pilotColorInt,
    theme: themeSelect ? themeSelect.value : "oceanic",
    customBgColor: customBgColor ? customBgColor.value : "#263238",
    customPrimaryColor: customPrimaryColor ? customPrimaryColor.value : "#009688",
    customTextColor: customTextColor ? customTextColor.value : "#B0BEC5",
    customMenuColor: customMenuColor ? customMenuColor.value : "#37474F",
    customSecondaryColor: customSecondaryColor ? customSecondaryColor.value : "#607D8B",
    selectedVoice: normalizedSelectedVoice,
    lapFormat: lapFormatSelect ? lapFormatSelect.value : "full",
    ssid: ssidInput.value,
    pwd: pwdInput.value,
    batteryType: batteryTypeSelect ? parseInt(batteryTypeSelect.value) : 0,
    batteryCells: batteryCellsSelect ? parseInt(batteryCellsSelect.value) : 4,
    lowBatteryAlarmPerCell: lowBatteryAlarmPerCellInput ? parseFloat(lowBatteryAlarmPerCellInput.value) : 3.5,
    batteryAlarmEnabled: batteryMonitorToggle ? (batteryMonitorToggle.checked ? 1 : 0) : 0,
    batteryVoltageDivider: batteryVoltageDividerInput ? parseFloat(batteryVoltageDividerInput.value) : 2.0,
    timerNumber: timerNumber,
    raceSyncMode: raceSyncMode,
    syncedTimers: syncedTimers,
    masterHostname: masterHostname,
    speakerEnabled: document.getElementById("speakerEnabled") ? (document.getElementById("speakerEnabled").checked ? 1 : 0) : 1,
    raceCountdownMode: (function() {
      var el = document.getElementById("raceCountdownMode");
      if (!el) return raceCountdownMode;
      var v = parseInt(el.value);
      return v === 0 ? 0 : 1;
    })(),
  };

  return fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(configData),
  })
    .then(async response => {
      const data = await response.json();
      if (!response.ok || data.status === "ERROR") throw new Error(data.message || "Configuration save failed");
      return data;
    });
}

// Populate band selector based on selected system
function populateBandsBySystem(system, targetBandSelect, maintainSelection = false) {
  if (!targetBandSelect) return;
  
  const previousValue = targetBandSelect.value;
  const filteredBands = bandDefinitions.filter(b => b.system === system);
  
  targetBandSelect.innerHTML = '';
  filteredBands.forEach(band => {
    const option = document.createElement('option');
    option.value = band.value;
    option.textContent = band.label;
    option.dataset.bandIndex = band.index;
    targetBandSelect.appendChild(option);
  });
  
  // Try to maintain previous selection if possible
  if (maintainSelection && previousValue) {
    const matchingOption = Array.from(targetBandSelect.options).find(opt => opt.value === previousValue);
    if (matchingOption) {
      targetBandSelect.value = previousValue;
    }
  }
  
  // If no selection or couldn't maintain, select first option
  if (targetBandSelect.selectedIndex === -1 && targetBandSelect.options.length > 0) {
    targetBandSelect.selectedIndex = 0;
  }
  
  updateChannelAvailability(targetBandSelect);
}

// Update channel selector based on selected band (disable unused channels)
function updateChannelAvailability(targetBandSelect) {
  // Determine which channel selector to use
  let targetChannelSelect;
  if (targetBandSelect && targetBandSelect.id === 'bandSelect') {
    targetChannelSelect = document.getElementById('channelSelect');
  } else if (targetBandSelect && targetBandSelect.id === 'calibBandSelect') {
    targetChannelSelect = document.getElementById('calibChannelSelect');
  }
  
  if (!targetChannelSelect || !targetBandSelect || targetBandSelect.selectedIndex === -1) return;
  
  const selectedOption = targetBandSelect.options[targetBandSelect.selectedIndex];
  if (!selectedOption) return;
  
  const bandIndex = parseInt(selectedOption.dataset.bandIndex);
  const frequencies = freqLookup[bandIndex];
  
  // Enable/disable channels based on whether they have non-zero frequencies
  for (let i = 0; i < targetChannelSelect.options.length; i++) {
    if (i < frequencies.length && frequencies[i] > 0) {
      targetChannelSelect.options[i].disabled = false;
    } else {
      targetChannelSelect.options[i].disabled = true;
    }
  }
  
  // If current selection is disabled, select first available channel
  if (targetChannelSelect.options[targetChannelSelect.selectedIndex]?.disabled) {
    for (let i = 0; i < targetChannelSelect.options.length; i++) {
      if (!targetChannelSelect.options[i].disabled) {
        targetChannelSelect.selectedIndex = i;
        break;
      }
    }
  }
}

// Handle system selection change (settings)
function onSystemChange() {
  if (!systemSelect) return;
  currentSystem = systemSelect.value;
  populateBandsBySystem(currentSystem, bandSelect);
  
  // Sync to calibration
  if (calibSystemSelect) {
    calibSystemSelect.value = currentSystem;
    populateBandsBySystem(currentSystem, calibBandSelect);
  }
  
  populateFreqOutput();
  autoSaveConfig();
}

// Handle system selection change (calibration)
function onCalibSystemChange() {
  if (!calibSystemSelect) return;
  currentSystem = calibSystemSelect.value;
  populateBandsBySystem(currentSystem, calibBandSelect);
  
  // Sync to settings
  if (systemSelect) {
    systemSelect.value = currentSystem;
    populateBandsBySystem(currentSystem, bandSelect);
  }
  
  populateCalibFreqOutput();
  autoSaveConfig();
}

// Handle band selection change - update channels
function onBandChange() {
  updateChannelAvailability(bandSelect);
  populateFreqOutput();
  syncSettingsToCalib();
  autoSaveConfig();
}

function onCalibBandChange() {
  updateChannelAvailability(calibBandSelect);
  populateCalibFreqOutput();
  autoSaveConfig();
}

function populateFreqOutput() {
  if (!bandSelect || bandSelect.selectedIndex === -1) return;
  const selectedOption = bandSelect.options[bandSelect.selectedIndex];
  if (!selectedOption) return;
  
  const bandIndex = parseInt(selectedOption.dataset.bandIndex);
  const band = selectedOption.value;
  const chan = channelSelect.options[channelSelect.selectedIndex].value;
  frequency = freqLookup[bandIndex][channelSelect.selectedIndex];
  freqOutput.textContent = band + chan + " " + frequency;
}

function populateCalibFreqOutput() {
  if (!calibBandSelect || !calibChannelSelect || !calibFreqOutput) return;
  if (calibBandSelect.selectedIndex === -1) return;
  
  const selectedOption = calibBandSelect.options[calibBandSelect.selectedIndex];
  if (!selectedOption) return;
  
  const bandIndex = parseInt(selectedOption.dataset.bandIndex);
  const band = selectedOption.value;
  const chan = calibChannelSelect.options[calibChannelSelect.selectedIndex].value;
  frequency = freqLookup[bandIndex][calibChannelSelect.selectedIndex];
  calibFreqOutput.textContent = band + chan + " " + frequency + "MHz";
  
  // Sync to settings (without triggering another update)
  if (systemSelect && bandSelect && channelSelect) {
    // Ensure settings system matches calib system
    if (systemSelect.value !== currentSystem) {
      systemSelect.value = currentSystem;
      populateBandsBySystem(currentSystem, bandSelect);
    }
    
    // Sync band and channel by index (both selects have the same options in the same order)
    bandSelect.selectedIndex = calibBandSelect.selectedIndex;
    channelSelect.selectedIndex = calibChannelSelect.selectedIndex;
    updateChannelAvailability(bandSelect);
    populateFreqOutput();
  }
}

// Sync settings band/channel changes to calibration tab
function syncSettingsToCalib() {
  if (!bandSelect || !calibBandSelect) return;
  
  // Sync system first
  if (systemSelect && calibSystemSelect) {
    calibSystemSelect.value = systemSelect.value;
  }
  
  // Sync band and channel by index (both selects have the same options in the same order)
  calibBandSelect.selectedIndex = bandSelect.selectedIndex;
  updateChannelAvailability(calibBandSelect);
  
  // Sync channel
  if (calibChannelSelect && channelSelect) {
    calibChannelSelect.selectedIndex = channelSelect.selectedIndex;
  }
}

// Initialize event listeners after DOM is ready
function initializeBandSelectors() {
  // System selector event listeners
  if (systemSelect) {
    systemSelect.addEventListener("change", onSystemChange);
  }
  if (calibSystemSelect) {
    calibSystemSelect.addEventListener("change", onCalibSystemChange);
  }

  // Band/channel selector event listeners
  if (bandSelect) {
    bandSelect.addEventListener("change", onBandChange);
  }
  if (channelSelect) {
    channelSelect.addEventListener("change", function() {
      populateFreqOutput();
      syncSettingsToCalib();
      autoSaveConfig();
    });
  }

  // Calibration tab band/channel change handlers
  if (calibBandSelect) {
    calibBandSelect.addEventListener("change", onCalibBandChange);
  }
  if (calibChannelSelect) {
    calibChannelSelect.addEventListener("change", function() {
      populateCalibFreqOutput();
      autoSaveConfig();
    });
  }
}

// Call initialization when script loads
initializeBandSelectors();

// Refresh band/channel/frequency from device config (called on SSE configUpdated and tab switch)
async function refreshConfigFromDevice() {
  _refreshingFromDevice = true;
  // Cancel any pending save so stale values never overwrite the device
  clearTimeout(saveTimeout);
  try {
    let configData;
    const response = await fetch("/config");
    configData = await response.json();
    
    // Device is authoritative for system/band/channel + frequency; write
    // them straight into the UI via the shared applier. Any unsaved local
    // selector tweak is expected to be overwritten - user saves to make
    // their change win.
    applyBandChannelToUI(configData);
    
    // Device is the source of truth; write the fetched thresholds straight
    // into the UI. Any local drag that hasn't been saved is expected to be
    // overwritten - user must click Save Thresholds to make their change win.
    applyThresholdsToUI(configData);
    // Receiver type and the C5 pilots, so a page that stays open shows what
    // the device has (the C5 panel keeps its own edits until they're saved).
    const receiverRadioSelect = document.getElementById("receiverRadio");
    if (receiverRadioSelect && configData.receiverRadio !== undefined &&
        String(configData.receiverRadio) !== receiverRadioSelect.value) {
      receiverRadioSelect.value = configData.receiverRadio;
      toggleNovaFilterSection();
    }
    loadEventMode(configData.eventMode);
    if (configData.c5Pilots && typeof C5UI !== "undefined" && !/^(pending|saving)$/.test(C5UI.saveState())) {
      loadC5Profiles(configData.c5Pilots, configData.c5Gain);
    }
    if (configData.raceCountdownMode !== undefined) {
      raceCountdownMode = parseInt(configData.raceCountdownMode) === 0 ? 0 : 1;
      const rcEl = document.getElementById("raceCountdownMode");
      if (rcEl) rcEl.value = String(raceCountdownMode);
    }
    if (configData.maxHeatTime30s !== undefined && maxHeatTimeInput) {
      maxHeatTimeInput.value = configData.maxHeatTime30s;
      updateMaxHeatTime(maxHeatTimeInput, maxHeatTimeInput.value);
    }
    if (configData.maxLaps !== undefined && maxLapsInput) {
      maxLapsInput.value = configData.maxLaps;
      updateMaxLaps(maxLapsInput, maxLapsInput.value);
    }
    
    console.log("[Config] Refreshed from device: band=" + configData.bandIndex + " ch=" + configData.channelIndex + " freq=" + configData.freq);
  } catch (err) {
    console.error("[Config] Failed to refresh from device:", err);
  } finally {
    _refreshingFromDevice = false;
  }
}

// Add auto-save listeners for other inputs
if (announcerSelect) {
  announcerSelect.addEventListener("change", autoSaveConfig);
}
["announcerBeepEveryLap", "announcerWithLapTime"].forEach((id) => {
  const box = document.getElementById(id);
  if (!box) return;
  box.checked = localStorage.getItem(id) === "1";
  box.addEventListener("change", () => localStorage.setItem(id, box.checked ? "1" : "0"));
});
if (pilotNameInput) {
  pilotNameInput.addEventListener("input", autoSaveConfig);
}
const callsignInput = document.getElementById("pcallsign");
if (callsignInput) {
  callsignInput.addEventListener("input", autoSaveConfig);
}
const phoneticInput = document.getElementById("pphonetic");
if (phoneticInput) {
  phoneticInput.addEventListener("input", autoSaveConfig);
}
const colorInput = document.getElementById("pilotColor");
if (colorInput) {
  colorInput.addEventListener("change", autoSaveConfig);
}
const batteryToggle = document.getElementById("batteryMonitorToggle");
if (batteryToggle) {
  batteryToggle.addEventListener("change", autoSaveConfig);
}

function updateAnnouncerRate(obj, value) {
  announcerRate = parseFloat(value);
  $(obj).parent().find("span").text(announcerRate.toFixed(1));
  audioAnnouncer.setRate(announcerRate);
  // Auto-save when changed
  autoSaveConfig();
}

function updateMinLap(obj, value) {
  $(obj)
    .parent()
    .find("span")
    .text(parseFloat(value).toFixed(1) + "s");
  // Auto-save when changed
  autoSaveConfig();
}

function updateBeepVolume(obj, value) {
  const vol = parseInt(value);
  $(obj).parent().find("span").text(vol + "%");
  // Set browser audio volume (0-100 -> 0.0-1.0)
  setBeepVolume(vol / 100);
  // Save to localStorage for persistence
  localStorage.setItem('beepVolume', vol);
}

function updateAlarmThreshold(obj, value) {
  $(obj)
    .parent()
    .find("span")
    .text(parseFloat(value).toFixed(1) + "v");
  // Auto-save when changed
  autoSaveConfig();
}

function updateMaxLaps(obj, value) {
  maxLaps = parseInt(value);
  let displayText;
  if (maxLaps === 0) {
    displayText = i18n.t("settings.race_setup.infinite_label");
  } else if (maxLaps === 1) {
    displayText = i18n.t("race.table.lap_singular");
  } else {
    displayText = i18n.t("race.table.lap_plural", { n: maxLaps });
  }
  $(obj).parent().find("span").text(displayText);
  // Auto-save when changed
  autoSaveConfig();
}

function updateMaxHeatTime(obj, value) {
  maxHeatTime30s = parseInt(value);
  let displayText;
  if (maxHeatTime30s === 0) {
    displayText = i18n.t("settings.race_setup.unlimited_label");
  } else {
    // Format N 30-second blocks as M:SS (e.g. 1 -> "0:30", 2 -> "1:00", 3 -> "1:30")
    const totalSeconds = maxHeatTime30s * 30;
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    displayText = `${mm}:${ss < 10 ? "0" + ss : ss}`;
  }
  $(obj).parent().find("span").text(displayText);
  // Auto-save when changed
  autoSaveConfig();
}

// function getAnnouncerVoices() {
//   $().articulate("getVoices", "#voiceSelect", "System Default Announcer Voice");
// }

// Shared AudioContext for beeps (reused to avoid iOS issues)
var beepAudioContext = null;
var beepGainNode = null;
var browserAudioUnlocked = false;

// Browser policy requires Web Audio to be created/resumed from a user gesture.
// ELRS start events arrive via SSE, so unlock the shared beep context on the
// first interaction with the race page; later remote starts can then play the
// tone without attempting an autoplay-violating AudioContext start.
function unlockBrowserBeepAudio() {
  if (browserAudioUnlocked) return;
  try {
    if (!beepAudioContext) {
      beepAudioContext = new AudioContext();
      beepGainNode = beepAudioContext.createGain();
      beepGainNode.gain.value = beepVolume;
      beepGainNode.connect(beepAudioContext.destination);
    }
    const resume = beepAudioContext.resume ? beepAudioContext.resume() : Promise.resolve();
    Promise.resolve(resume).then(() => {
      browserAudioUnlocked = beepAudioContext.state === "running";
    }).catch(() => {});
  } catch (_) {}
}

document.addEventListener("pointerdown", unlockBrowserBeepAudio, { once: true, passive: true });
document.addEventListener("keydown", unlockBrowserBeepAudio, { once: true, passive: true });
var beepVolume = 1.0;  // 0.0 to 1.0

function setBeepVolume(volume) {
  beepVolume = Math.max(0, Math.min(1, volume));
  if (beepGainNode) {
    beepGainNode.gain.value = beepVolume;
  }
  // Also set audio announcer volume
  if (typeof audioAnnouncer !== 'undefined' && audioAnnouncer) {
    audioAnnouncer.setVolume(beepVolume);
  }
  console.log("[Audio] Volume set to " + (beepVolume * 100).toFixed(0) + "%");
}

function beep(duration, frequency, type) {
  // Create or reuse AudioContext
  if (!beepAudioContext) {
    beepAudioContext = new AudioContext();
    // Create gain node for volume control
    beepGainNode = beepAudioContext.createGain();
    beepGainNode.gain.value = beepVolume;
    beepGainNode.connect(beepAudioContext.destination);
  }

  // iOS/Safari: ensure AudioContext is running
  if (beepAudioContext.state === "suspended") {
    beepAudioContext
      .resume()
      .then(() => {
        playBeepTone(duration, frequency, type);
      })
      .catch((err) => {
        console.warn("[Beep] AudioContext resume failed:", err);
      });
  } else {
    playBeepTone(duration, frequency, type);
  }
}

function playBeepTone(duration, frequency, type) {
  var oscillator = beepAudioContext.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  // Connect through gain node for volume control
  oscillator.connect(beepGainNode);
  oscillator.start();
  // Beep for specified duration
  setTimeout(function () {
    oscillator.stop();
  }, duration);
}

// The total of the last `count` laps, Gate 1 ([0]) excluded, to 2 decimals;
// "" until there are that many. laps: seconds, [0] = Gate 1.
function lastLapsTotal(laps, count) {
  const real = laps.slice(1);
  if (real.length < count) return "";
  return real.slice(-count).reduce((sum, t) => sum + t, 0).toFixed(2);
}

// Per-browser additions to the announcer. The gate stores only the mode
// (anType 0-4), so these live in localStorage like the beep volume: a beep on
// every lap alongside the chosen mode, and the lap time spoken with the 2- and
// 3-lap totals.
function announcerExtras() {
  return {
    beepEveryLap: localStorage.getItem("announcerBeepEveryLap") === "1",
    withLapTime: localStorage.getItem("announcerWithLapTime") === "1",
  };
}

function addLap(lapStr) {
  // Use phonetic name for TTS if available, otherwise use regular pilot name
  const phoneticInput = document.getElementById("pphonetic");
  const pilotName = phoneticInput && phoneticInput.value ? phoneticInput.value : pilotNameInput.value;

  const newLap = parseFloat(lapStr);
  lapNo += 1;
  lapTimes.push(newLap);
  // For the 2- and 3-lap announcers. Their declarations went with the old lap
  // table in v1.1.0, so reading them threw and ended addLap: no announcement,
  // and no max-laps stop, after Gate 1.
  const last2lapStr = lastLapsTotal(lapTimes, 2);
  const last3lapStr = lastLapsTotal(lapTimes, 3);

  // Track lap timing for distance estimation
  lastCompletedLapTime = newLap * 1000; // Convert to milliseconds
  currentLapStartTime = Date.now(); // Reset lap start time
  lapTimerStartMs = Date.now(); // Reset lap timer
  currentLapDistance = 0.0; // Reset distance counter
  
  // Reset current lap timer display
  resetCurrentLapTimer();

  // Render unified multi-pilot view
  renderUnifiedRaceView();

  // Determine effective lap format - force "Pilot + Time" in sync modes
  const effectiveLapFormat = (raceSyncMode === 1 || raceSyncMode === 2 || raceSyncMode === 3) ? 'full' : lapFormat;
  
  const announceMode = announcerSelect.options[announcerSelect.selectedIndex].value;
  const extras = announcerExtras();
  if (extras.beepEveryLap && announceMode !== "beep") beep(100, 330, "square");
  switch (announceMode) {
    case "beep":
      beep(100, 330, "square");
      break;
    case "1lap":
      if (lapNo == 0) {
        // Gate 1 - always include pilot name in sync mode
        if (raceSyncMode === 1 || raceSyncMode === 2) {
          queueSpeak(`<p>${pilotName} ${i18n.t("settings.tts.gate1", { n: lapStr })}</p>`);
        } else {
          queueSpeak(`<p>${i18n.t("settings.tts.gate1", { n: lapStr })}</p>`);
        }
      } else {
        let text;
        switch (effectiveLapFormat) {
          case "full":
            text = `<p>${pilotName}, ${lapStr}</p>`;
            break;
          case "laptime":
            text = `<p>${i18n.t("race.lap_counter", { n: lapNo })}, ${lapStr}</p>`;
            break;
          case "timeonly":
            text = `<p>${lapStr}</p>`;
            break;
          default:
            text = `<p>${pilotName}, ${lapStr}</p>`;
        }
        queueSpeak(text);
      }
      break;
    case "2lap":
      if (lapNo == 0) {
        if (raceSyncMode === 1 || raceSyncMode === 2) {
          queueSpeak(`<p>${pilotName} ${i18n.t("settings.tts.gate1", { n: lapStr })}</p>`);
        } else {
          queueSpeak(`<p>${i18n.t("settings.tts.gate1", { n: lapStr })}</p>`);
        }
