// Transport manager for WiFi/USB connectivity
let transportManager = null;
let currentConnectionMode = "auto"; // 'auto', 'wifi', 'usb'
let usbConnected = false;
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
var raceSyncMode = 0; // 0=disabled, 1=master, 2=slave
var rhEnabled = 0;   // 1=RotorHazard mode enabled
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
      if (config.rhEnabled !== undefined) {
        rhEnabled = config.rhEnabled;
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
  if (rssiSending && !usbConnected) {
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

// Transport initialization functions
async function initializeTransport() {
  // Check if we have USB transport available (Electron or Web Serial API)
  const hasUSB = typeof window.electronAPI !== "undefined" || "serial" in navigator;
  console.log("[Init] USB available:", hasUSB, "Mode:", currentConnectionMode);
  console.log("[Init] electronAPI:", typeof window.electronAPI);

  if (!hasUSB || currentConnectionMode === "wifi") {
    // WiFi-only mode
    console.log("[Init] Initializing WiFi-only mode");
    setupWiFiEvents();
    updateConnectionStatus("WiFi", true);
    return;
  }

  // Try USB first in auto/usb mode
  if (currentConnectionMode === "auto" || currentConnectionMode === "usb") {
    try {
      console.log("[Init] Creating USBTransport...");
      transportManager = new USBTransport();

      // List available ports and auto-connect in auto mode
      console.log("[Init] Listing ports...");
      const ports = await transportManager.listPorts();
      console.log("[Init] Found ports:", ports);

      if (ports.length > 0) {
        // Populate COM port dropdown
        const comPortSelect = document.getElementById("comPort");
        comPortSelect.innerHTML = `<option value="">${i18n.t("settings.wifi.port_option")}</option>`;
        ports.forEach((port) => {
          console.log("[Init] Adding port:", port.path, port.manufacturer);
          const option = document.createElement("option");
          option.value = port.path;
          option.textContent = `${port.path}${port.manufacturer ? " - " + port.manufacturer : ""}`;
          comPortSelect.appendChild(option);
        });

        // Auto-connect to first FPVGate device in auto mode
        if (currentConnectionMode === "auto") {
          // Try to find by manufacturer first
          let fpvgatePort = ports.find((p) => p.manufacturer && (p.manufacturer.includes("Espressif") || p.manufacturer.includes("Silicon Labs")));

          // If not found, look for COM12 specifically (common FPVGate port on Windows)
          if (!fpvgatePort) {
            fpvgatePort = ports.find((p) => p.path === "COM12");
          }

          console.log("[Init] FPVGate port found:", fpvgatePort);
          if (fpvgatePort) {
            await connectUSB(fpvgatePort.path);
            return;
          }
        }
      } else {
        console.log("[Init] No ports found");
      }
    } catch (err) {
      console.error("[Init] USB initialization failed:", err);
    }
  }

  // Fall back to WiFi if USB failed and in auto mode
  if (currentConnectionMode === "auto" && !usbConnected) {
    console.log("USB not available, falling back to WiFi");
    setupWiFiEvents();
    updateConnectionStatus("WiFi", true);
  } else if (currentConnectionMode === "usb" && !usbConnected) {
    updateConnectionStatus("USB", false);
  }
}

async function connectUSB(portPath) {
  try {
    await transportManager.connect(portPath);
    usbConnected = true;
    setupUSBEvents();
    updateConnectionStatus("USB", true);

    // Update COM port dropdown to show selected port
    const comPortSelect = document.getElementById("comPort");
    comPortSelect.value = portPath;

    console.log("Connected to USB:", portPath);
  } catch (err) {
    console.error("Failed to connect USB:", err);
    usbConnected = false;
    updateConnectionStatus("USB", false);
    throw err;
  }
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


    eventSource.addEventListener(
      "lap",
      function (e) {
        window.lastSSEEvent = Date.now();
        var lap = (parseFloat(e.data) / 1000).toFixed(2);
        console.log("[SSE] LAP EVENT RECEIVED - raw:", e.data, "formatted:", lap);
        addLap(lap);
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
      },
      false
    );
  }
}

// Handle race state changes from SSE (for slave mode sync)
function handleRaceStateEvent(state) {
  console.log("[Sync] Handling race state:", state);
  
  if (state === "started") {
    // Race started (from master or local)
    raceRunning = true;
    lapTimerStartMs = Date.now();
    startRaceTimer();
    updateRaceButtons();
    clearRaceLeader();
    console.log("[Sync] Race started via SSE");
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
  } else if (state === "cleared") {
    // Laps cleared - reset UI
    raceRunning = false;
    stopRaceTimer();
    resetLapDisplay();
    updateRaceButtons();
    console.log("[Sync] Laps cleared via SSE");
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
    raceAnalysisContent.innerHTML = '<p class="no-data">Enable an analytics tab to display race analytics</p>';
  }
  
  // Clear remote pilots data
  remotePilots = {};
  
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

// Render the race view - switches between personal (single) and multi-pilot view
function renderUnifiedRaceView() {
  // Use personal (single-pilot) view when sync is disabled
  if (raceSyncMode === 0) {
    renderPersonalRaceView();
    return;
  }
  
  // Use multi-pilot view for master/slave sync modes
  renderMultiPilotRaceView();
}

// Render classic single-pilot race view (Personal mode)
function renderPersonalRaceView() {
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
  
  // Add remote pilots
  for (const hostname of Object.keys(remotePilots)) {
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
    headerHtml += `<th class="pilot-header" style="background-color: ${colorHex}; color: white;">${pilot.name}${localBadge}</th>`;
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
        if (lapIdx > 0 && lapIdx < pilot.lapTimes.length) {
          const prevTime = pilot.lapTimes[lapIdx - 1];
          const diff = (lapTime - prevTime).toFixed(2);
          const gapClass = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : '');
          gapHtml = `<div class="lap-gap ${gapClass}">${diff > 0 ? '+' : ''}${diff}s</div>`;
        }
        
        bodyHtml += `
          <td class="pilot-lap${isFastest ? ' fastest' : ''}" style="border-left: 3px solid ${colorHex};">
            <div class="lap-time">${lapTime.toFixed(2)}s</div>
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

function setupUSBEvents() {
  if (!transportManager) return;

  transportManager.on("rssi", (data) => {
    rssiBuffer.push(data);
    if (rssiBuffer.length > 10) {
      rssiBuffer.shift();
    }
    console.log("USB rssi", data, "buffer size", rssiBuffer.length);
  });

  transportManager.on("lap", (data) => {
    var lap = (parseFloat(data) / 1000).toFixed(2);
    addLap(lap);
    console.log("USB lap raw:", data, " formatted:", lap);
  });

  transportManager.on("disconnect", () => {
    console.log("USB disconnected");
    usbConnected = false;
    updateConnectionStatus("USB", false);

    // Auto-fallback to WiFi if in auto mode
    if (currentConnectionMode === "auto") {
      setupWiFiEvents();
      updateConnectionStatus("WiFi", true);
    }
  });
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

  // Update settings panel status (USB only)
  const statusEl = document.getElementById("comPortStatus");
  if (statusEl) {
    statusEl.style.display = "block";
    const statusText = connected ? i18n.t("race.status_connected") : i18n.t("race.status_disconnected");
    statusEl.textContent = i18n.t("race.status_label", { status: statusText, mode: mode });
    statusEl.style.color = connected ? "var(--success-color, #4CAF50)" : "var(--error-color, #f44336)";
  }
}

async function changeConnectionMode() {
  const modeSelect = document.getElementById("connectionMode");
  currentConnectionMode = modeSelect.value;

  const comPortSection = document.getElementById("comPortSection");

  // Show COM port selector in USB mode
  if (currentConnectionMode === "usb") {
    comPortSection.style.display = "flex";
  } else {
    comPortSection.style.display = "none";
  }

  // Disconnect current connection
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (transportManager && usbConnected) {
    await transportManager.disconnect();
    usbConnected = false;
  }

  // Reinitialize with new mode
  await initializeTransport();
}

async function selectComPort() {
  const comPortSelect = document.getElementById("comPort");
  const portPath = comPortSelect.value;

  if (!portPath) return;

  // Disconnect if already connected
  if (transportManager && usbConnected) {
    await transportManager.disconnect();
    usbConnected = false;
  }

  // Connect to selected port
  if (!transportManager) {
    transportManager = new USBTransport();
  }

  await connectUSB(portPath);
}

onload = async function (e) {
  // Load dark mode preference
  loadDarkMode();
  syncOpenRaceNotesOnRaceEndToggle();
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
    if (usbConnected && transportManager) {
      configData = await transportManager.sendCommand("config", "GET");
    } else {
      const response = await fetch("/config");
      configData = await response.json();
    }
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

    // Load RotorHazard integration settings
    if (configData.rhEnabled !== undefined) {
      rhEnabled = configData.rhEnabled;
    }
    const rhHostIPInput = document.getElementById("rhHostIP");
    const rhNodeIndexSelect = document.getElementById("rhNodeIndex");
    if (rhHostIPInput && configData.rhHostIP !== undefined) {
      rhHostIPInput.value = configData.rhHostIP;
    }
    if (rhNodeIndexSelect && configData.rhNodeIndex !== undefined) {
      rhNodeIndexSelect.value = configData.rhNodeIndex;
    }

    // Update banner now that rhEnabled is known
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
    if (usbConnected && transportManager) {
      configData = await transportManager.sendCommand("config", "GET");
    } else {
      const resp = await fetch("/config");
      configData = await resp.json();
    }

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
      audioAnnouncer.speak("BATTERY CRITICAL");
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
  // Sync slider visibility with toggle state
  toggleNovaFilterSlider("kalman");
  toggleNovaFilterSlider("ema");
  toggleNovaFilterSlider("step");
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
    if (debugRssiChart) debugRssiChart.start();
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
  if (usbConnected && transportManager) {
    transportManager.sendCommand("timer/rssiStart", "POST")
      .then(function() { rssiSending = true; })
      .catch(function(err) { console.error("Failed to start RSSI:", err); });
  } else {
    fetch("/timer/rssiStart", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } })
      .then(function(r) { if (r.ok) rssiSending = true; });
  }
}

function stopRssiStreaming() {
  if (!rssiSending) return;
  if (usbConnected && transportManager) {
    transportManager.sendCommand("timer/rssiStop", "POST")
      .then(function() { rssiSending = false; })
      .catch(function(err) { console.error("Failed to stop RSSI:", err); });
  } else {
    fetch("/timer/rssiStop", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" } })
      .then(function(r) { if (r.ok) rssiSending = false; });
  }
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
    saveConfig();
  }, 1000); // Wait 1 second after last change before saving
}

async function saveConfig() {
  // Don't save until initial config has been loaded from device
  if (!configLoaded) {
    console.log("[Config] Skipping save - config not yet loaded from device");
    return;
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
      return;
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
    rhEnabled: (syncDevices.find(d => d.isThisDevice) || {}).role === 'rotorhazard' ? 1 : 0,
    rhHostIP: document.getElementById("rhHostIP") ? document.getElementById("rhHostIP").value : "",
    rhNodeIndex: document.getElementById("rhNodeIndex") ? parseInt(document.getElementById("rhNodeIndex").value) : 0,
    raceCountdownMode: (function() {
      var el = document.getElementById("raceCountdownMode");
      if (!el) return raceCountdownMode;
      var v = parseInt(el.value);
      return v === 0 ? 0 : 1;
    })(),
  };

  if (usbConnected && transportManager) {
    const response = await transportManager.sendCommand("config", "POST", configData);
    console.log("/config:", response);
  } else {
    fetch("/config", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(configData),
    })
      .then((response) => response.json())
      .then((response) => console.log("/config:" + JSON.stringify(response)));
  }
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
    if (usbConnected && transportManager) {
      configData = await transportManager.sendCommand("config", "GET");
    } else {
      const response = await fetch("/config");
      configData = await response.json();
    }
    
    // Device is authoritative for system/band/channel + frequency; write
    // them straight into the UI via the shared applier. Any unsaved local
    // selector tweak is expected to be overwritten - user saves to make
    // their change win.
    applyBandChannelToUI(configData);
    
    // Device is the source of truth; write the fetched thresholds straight
    // into the UI. Any local drag that hasn't been saved is expected to be
    // overwritten - user must click Save Thresholds to make their change win.
    applyThresholdsToUI(configData);
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

function addLap(lapStr) {
  // Use phonetic name for TTS if available, otherwise use regular pilot name
  const phoneticInput = document.getElementById("pphonetic");
  const pilotName = phoneticInput && phoneticInput.value ? phoneticInput.value : pilotNameInput.value;

  const newLap = parseFloat(lapStr);
  lapNo += 1;
  lapTimes.push(newLap);

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
  const effectiveLapFormat = (raceSyncMode === 1 || raceSyncMode === 2) ? 'full' : lapFormat;
  
  switch (announcerSelect.options[announcerSelect.selectedIndex].value) {
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
          queueSpeak(`<p>${pilotName} Gate 1 ${lapStr}</p>`);
        } else {
          queueSpeak(`<p>Gate 1 ${lapStr}</p>`);
        }
      } else if (last2lapStr != "") {
        const text2 = "<p>" + pilotName + " 2 laps " + last2lapStr + "</p>";
        queueSpeak(text2);
      }
      break;
    case "3lap":
      if (lapNo == 0) {
        if (raceSyncMode === 1 || raceSyncMode === 2) {
          queueSpeak(`<p>${pilotName} Gate 1 ${lapStr}</p>`);
        } else {
          queueSpeak(`<p>Gate 1 ${lapStr}</p>`);
        }
      } else if (last3lapStr != "") {
        const text3 = "<p>" + pilotName + " 3 laps " + last3lapStr + "</p>";
        queueSpeak(text3);
      }
      break;
    default:
      break;
  }

  // Update lap counter
  updateLapCounter();

  // Update lap analysis (mode-dependent)
  updateAnalysisSectionVisibility();

  // Update race leader color on gate LEDs
  const localPilotColor = document.getElementById("pilotColor")?.value || "#0080FF";
  updateRaceLeader(localPilotColor);

  // Auto-stop race if max laps reached (excluding hole shot, and if maxLaps > 0)
  if (maxLaps > 0 && lapNo > 0 && lapNo >= maxLaps) {
    setTimeout(function () {
      if (!stopRaceButton.disabled) {
        stopRace();
        queueSpeak(`<p>${i18n.t("settings.tts.race_complete")}</p>`);
      }
    }, 500); // Small delay to allow lap announcement
  }
}

function startTimer() {
  var millis = 0;
  var seconds = 0;
  var minutes = 0;
  
  // Initialize current lap timer
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
    let m = minutes < 10 ? "0" + minutes : minutes;
    let s = seconds < 10 ? "0" + seconds : seconds;
    let ms = millis < 10 ? "0" + millis : millis;
    timer.innerHTML = `${m}:${s}:${ms}` + i18n.t("race.table.seconds_short");
    
    // Update current lap timer
    updateCurrentLapTimer();
  }, 10);

  if (usbConnected && transportManager) {
    transportManager
      .sendCommand("timer/start", "POST")
      .then((response) => console.log("/timer/start:", response))
      .catch((err) => console.error("Failed to start timer:", err));
  } else {
    fetch("/timer/start", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((response) => console.log("/timer/start:" + JSON.stringify(response)));
  }
}

function queueSpeak(obj) {
  if (!audioEnabled) {
    return;
  }
  audioAnnouncer.queueSpeak(obj);
}

function toggleSpeaker(enabled) {
  console.log("Speaker output:", enabled ? "enabled" : "disabled");
  autoSaveConfig();
}

function saveLapFormat() {
  const lapFormatSelect = document.getElementById("lapFormatSelect");
  if (lapFormatSelect) {
    lapFormat = lapFormatSelect.value;
    console.log("Lap format saved:", lapFormat);
    autoSaveConfig(); // Save to device
  }
}

function saveVoiceSelection() {
  const voiceSelect = document.getElementById("voiceSelect");
  if (voiceSelect) {
    selectedVoice = normalizeVoiceSelectionValue(voiceSelect.value);
    voiceSelect.value = selectedVoice;
    console.log("Voice selection saved:", selectedVoice);

    // Update audioAnnouncer voice (this clears cache and updates voice directory)
    if (audioAnnouncer) {
      audioAnnouncer.setVoice(selectedVoice);
    }

    autoSaveConfig(); // Save to device
  }
}

function updateVoiceButtons() {
  const enableBtn = document.getElementById("EnableAudioButton");
  const disableBtn = document.getElementById("DisableAudioButton");

  if (audioEnabled) {
    enableBtn.style.backgroundColor = "#f39c12";
    enableBtn.style.opacity = "1";
    disableBtn.style.backgroundColor = "";
    disableBtn.style.opacity = "0.5";
  } else {
    enableBtn.style.backgroundColor = "";
    enableBtn.style.opacity = "0.5";
    disableBtn.style.backgroundColor = "#f39c12";
    disableBtn.style.opacity = "1";
  }
}

async function enableAudioLoop() {
  console.log("[Script] Enabling audio...");
  audioEnabled = true;
  audioAnnouncer.enable();
  updateVoiceButtons();
  console.log("[Script] Audio enabled, audioEnabled:", audioEnabled);
}

function disableAudioLoop() {
  audioEnabled = false;
  audioAnnouncer.disable();
  updateVoiceButtons();
}

// Pilot color preview
function updateColorPreview() {
  const colorSelect = document.getElementById("pilotColor");
  const colorPreview = document.getElementById("colorPreview");
  if (colorSelect && colorPreview) {
    colorPreview.style.backgroundColor = colorSelect.value;
  }
}

// Battery monitoring toggle
function toggleBatteryMonitor(enabled) {
  const batterySection = document.getElementById("batteryMonitoringSection");
  if (batterySection) {
    batterySection.style.display = enabled ? "block" : "none";
  }
}

// Battery type change handler
function updateBatteryType() {
  const batteryTypeSelect = document.getElementById("batteryType");
  const alarmSlider = document.getElementById("lowBatteryAlarmPerCell");
  if (batteryTypeSelect && alarmSlider) {
    const batteryType = parseInt(batteryTypeSelect.value);
    // Adjust alarm slider range based on battery type
    if (batteryType === 0) { // LiPo
      alarmSlider.min = "3.0";
      alarmSlider.max = "4.2";
    } else if (batteryType === 1) { // LiPoHV
      alarmSlider.min = "3.0";
      alarmSlider.max = "4.35";
    } else if (batteryType === 2) { // Li-Ion
      alarmSlider.min = "2.5";
      alarmSlider.max = "4.2";
    }
    // Clamp current value to new range
    const currentValue = parseFloat(alarmSlider.value);
    const minVal = parseFloat(alarmSlider.min);
    const maxVal = parseFloat(alarmSlider.max);
    if (currentValue < minVal) alarmSlider.value = minVal.toFixed(2);
    if (currentValue > maxVal) alarmSlider.value = maxVal.toFixed(2);
    updateLowBatteryAlarmPerCell(alarmSlider.value);
  }
  autoSaveConfig();
}

// Battery cells change handler
function updateBatteryCells() {
  autoSaveConfig();
}

// Low battery alarm per cell slider update
function updateLowBatteryAlarmPerCell(value) {
  const displaySpan = document.getElementById("lowBatteryAlarmPerCellValue");
  if (displaySpan) {
    displaySpan.textContent = parseFloat(value).toFixed(2) + "v";
  }
  autoSaveConfig();
}

// Voltage divider ratio slider update
function updateBatteryVoltageDivider(value) {
  const displaySpan = document.getElementById("batteryVoltageDividerValue");
  if (displaySpan) {
    displaySpan.textContent = parseFloat(value).toFixed(1);
  }
  autoSaveConfig();
}

// Generic fetch wrapper that works with both WiFi and USB
async function transportFetch(url, options = {}) {
  const method = options.method || "GET";
  const path = url.startsWith("/") ? url.substring(1) : url;

  if (usbConnected && transportManager) {
    // Parse body if JSON
    let data = null;
    if (options.body) {
      if (options.headers && options.headers["Content-Type"] === "application/json") {
        data = JSON.parse(options.body);
      } else if (options.body instanceof URLSearchParams || typeof options.body === "string") {
        // Parse form data
        const params = new URLSearchParams(options.body);
        data = Object.fromEntries(params.entries());
      }
    }

    return transportManager.sendCommand(path, method, data);
  } else {
    // Standard WiFi fetch
    const response = await fetch(url, options);
    if (options.headers && options.headers["Accept"] === "application/json") {
      return response.json();
    } else {
      return response.text();
    }
  }
}

// Helper function for LED commands
async function sendLedCommand(endpoint, params) {
  if (usbConnected && transportManager) {
    return transportManager.sendCommand(`led/${endpoint}`, "POST", params);
  } else {
    const body = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const response = await fetch(`/led/${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body,
    });
    return response.json();
  }
}

// LED control functions
// Update LED preset UI only (show/hide color sections, speed settings)
function updateLedPresetUI() {
  const presetSelect = document.getElementById("ledPreset");
  const solidColorSection = document.getElementById("solidColorSection");
  const fadeColorSection = document.getElementById("fadeColorSection");
  const strobeColorSection = document.getElementById("strobeColorSection");
  const speedSection = document.getElementById("ledSpeedSection");
  const speedNote = document.getElementById("ledSpeedNote");
  const preset = parseInt(presetSelect.value);

  // Show/hide color pickers based on preset
  if (solidColorSection) {
    solidColorSection.style.display = preset === 1 ? "flex" : "none";
  }
  if (fadeColorSection) {
    fadeColorSection.style.display = preset === 3 ? "flex" : "none";
  }
  if (strobeColorSection) {
    strobeColorSection.style.display = preset === 7 ? "flex" : "none";
  }

  // Hide animation speed for Solid Colour (preset 1), Off (preset 0), and Pilot Colour (preset 9)
  const hideSpeed = preset === 0 || preset === 1 || preset === 9;
  if (speedSection) {
    speedSection.style.display = hideSpeed ? "none" : "flex";
  }
  if (speedNote) {
    speedNote.style.display = hideSpeed ? "none" : "block";
  }
}

// Change LED preset (UI update + send command to device)
function changeLedPreset() {
  const presetSelect = document.getElementById("ledPreset");
  const preset = parseInt(presetSelect.value);

  // Update UI
  updateLedPresetUI();

  // If Pilot Colour preset (9) is selected, use pilot color
  if (preset === 9) {
    const pilotColor = document.getElementById("pilotColor")?.value || "#0080FF";
    const color = pilotColor.substring(1); // Remove #
    sendLedCommand("color", { color }).catch((err) => console.error("Failed to set pilot color:", err));
  }

  // Send preset command to device
  sendLedCommand("preset", { preset })
    .then((data) => console.log("LED preset changed:", data))
    .catch((err) => console.error("Failed to change LED preset:", err));
}

function setSolidColor() {
  const colorInput = document.getElementById("ledSolidColor");
  const color = colorInput.value.substring(1);

  sendLedCommand("color", { color })
    .then((data) => console.log("LED solid color changed:", data))
    .catch((err) => console.error("Failed to change LED solid color:", err));
}

function setFadeColor() {
  const colorInput = document.getElementById("ledFadeColor");
  const color = colorInput.value.substring(1);

  sendLedCommand("fadecolor", { color })
    .then((data) => console.log("LED fade color changed:", data))
    .catch((err) => console.error("Failed to change LED fade color:", err));
}

function setStrobeColor() {
  const colorInput = document.getElementById("ledStrobeColor");
  const color = colorInput.value.substring(1);

  sendLedCommand("strobecolor", { color })
    .then((data) => console.log("LED strobe color changed:", data))
    .catch((err) => console.error("Failed to change LED strobe color:", err));
}

function updateLedBrightness(obj, value) {
  const brightness = parseInt(value);
  $(obj).parent().find("span").text(brightness);

  sendLedCommand("brightness", { brightness })
    .then((data) => console.log("LED brightness changed:", data))
    .catch((err) => console.error("Failed to change LED brightness:", err));
}

function updateLedSpeed(obj, value) {
  const speed = parseInt(value);
  $(obj).parent().find("span").text(speed);

  sendLedCommand("speed", { speed })
    .then((data) => console.log("LED speed changed:", data))
    .catch((err) => console.error("Failed to change LED speed:", err));
}

function toggleLedManualOverride(enabled) {
  const enable = enabled ? 1 : 0;

  sendLedCommand("override", { enable })
    .then((data) => console.log("LED manual override:", enabled ? "enabled" : "disabled", data))
    .catch((err) => console.error("Failed to toggle LED manual override:", err));
}

function toggleGateLEDs(enabled) {
  const enable = enabled ? 1 : 0;

  // Show/hide Gate LED options based on enabled state
  const optionsDiv = document.getElementById("gateLEDOptions");
  if (optionsDiv) {
    optionsDiv.style.display = enabled ? "block" : "none";
  }

  // Load gate devices list when enabling
  if (enabled) loadGateDevices();

  // Send the config update
  fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ gateLEDsEnabled: enable }),
  })
    .then((response) => response.json())
    .then((data) => console.log("Gate LEDs:", enabled ? "enabled" : "disabled", data))
    .catch((err) => console.error("Failed to toggle Gate LEDs:", err));
}

function toggleWebhookRaceStart(enabled) {
  const enable = enabled ? 1 : 0;

  fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookRaceStart: enable }),
  })
    .then((response) => response.json())
    .then((data) => console.log("Webhook Race Start:", enabled ? "enabled" : "disabled", data))
    .catch((err) => console.error("Failed to toggle webhook race start:", err));
}

function toggleWebhookRaceStop(enabled) {
  const enable = enabled ? 1 : 0;

  fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookRaceStop: enable }),
  })
    .then((response) => response.json())
    .then((data) => console.log("Webhook Race Stop:", enabled ? "enabled" : "disabled", data))
    .catch((err) => console.error("Failed to toggle webhook race stop:", err));
}

function toggleWebhookLap(enabled) {
  const enable = enabled ? 1 : 0;

  fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ webhookLap: enable }),
  })
    .then((response) => response.json())
    .then((data) => console.log("Webhook Lap:", enabled ? "enabled" : "disabled", data))
    .catch((err) => console.error("Failed to toggle webhook lap:", err));
}

function generateAudio() {
  if (!audioEnabled) {
    return;
  }

  const pilotName = pilotNameInput.value;
  const phoneticName = document.getElementById("pphonetic")?.value || pilotName;
  queueSpeak(`<div>Testing sound for pilot ${phoneticName}</div>`);
  for (let i = 1; i <= 3; i++) {
    queueSpeak("<div>" + i + "</div>");
  }
}

function doSpeak(obj) {
  audioAnnouncer.queueSpeak(obj);
}

function updateLapCounter() {
  const lapCounterText = document.getElementById("lapCounterText");
  if (!lapCounterText) return;
  
  if (maxLaps === 0) {
    lapCounterText.textContent = i18n.t("race.lap_counter", { n: Math.max(0, lapNo) });
  } else {
    lapCounterText.textContent = i18n.t("race.lap_counter", { n: Math.max(0, lapNo) }) + " / " + maxLaps;
  }
}

// Update current lap timer display
function updateCurrentLapTimer() {
  const currentLapTimerEl = document.getElementById("currentLapTimer");
  if (!currentLapTimerEl || !currentLapStartMs) return;
  
  const elapsed = Date.now() - currentLapStartMs;
  const totalCentis = Math.floor(elapsed / 10);
  const minutes = Math.floor(totalCentis / 6000);
  const seconds = Math.floor((totalCentis % 6000) / 100);
  const centis = totalCentis % 100;
  
  const m = minutes < 10 ? "0" + minutes : minutes;
  const s = seconds < 10 ? "0" + seconds : seconds;
  const ms = centis < 10 ? "0" + centis : centis;
  
  currentLapTimerEl.textContent = `${m}:${s}:${ms}` + i18n.t("race.table.seconds_short");
}

// Reset current lap timer (called when lap is recorded)
function resetCurrentLapTimer() {
  currentLapStartMs = Date.now();
}

function highlightFastestLap() {
  if (lapTimes.length === 0) return;

  // Find fastest lap (excluding gate 1 at index 0)
  let fastestTime = Infinity;
  let fastestIndex = -1;

  for (let i = 1; i < lapTimes.length; i++) {
    // Start from 1 to skip gate 1
    if (lapTimes[i] < fastestTime) {
      fastestTime = lapTimes[i];
      fastestIndex = i;
    }
  }

  // Remove highlight from all rows
  const table = document.getElementById("lapTable");
  for (let i = 1; i < table.rows.length; i++) {
    table.rows[i].classList.remove("fastest-lap");
  }

  // Add highlight to fastest lap row
  if (fastestIndex >= 0) {
    for (let i = 1; i < table.rows.length; i++) {
      const row = table.rows[i];
      const lapIndex = parseInt(row.getAttribute("data-lap-index"));
      if (lapIndex === fastestIndex) {
        row.classList.add("fastest-lap");
        break;
      }
    }
  }
}

function onRaceCountdownModeChange(el) {
  if (el) {
    var v = parseInt(el.value);
    raceCountdownMode = (v === 0) ? 0 : 1;
  }
  autoSaveConfig();
}

// Open the RSSI debug view in a dedicated popout window so it can stay
// visible while the user navigates other tabs or the settings modal.
function openRssiDebugPopout(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  try {
    var url = window.location.origin + "/rssi-debug.html";
    var features = "popup=yes,width=900,height=400,menubar=no,toolbar=no,location=no,status=no";
    var win = window.open(url, "fpvgateRssiDebug", features);
    if (win && !win.closed) {
      try { win.focus(); } catch (e) { /* ignore cross-origin focus errors */ }
    } else {
      // Popup was blocked - fall back to a normal tab
      window.open(url, "_blank");
    }
  } catch (err) {
    console.error("[RSSI Debug] Failed to open popout:", err);
  }
}

async function startRace() {
  // If slave mode, don't allow local race control
  if (raceSyncMode === 2) {
    console.log("[Race] Slave mode - race control disabled");
    return;
  }

  // Always read the current dropdown value at start, so a just-changed mode
  // applies immediately even before autoSaveConfig() has synced to the device.
  var _rcEl = document.getElementById("raceCountdownMode");
  if (_rcEl) {
    var _rcVal = parseInt(_rcEl.value);
    raceCountdownMode = (_rcVal === 0) ? 0 : 1;
  }
  console.log("[Race] startRace() mode=", raceCountdownMode);

  const RACE_COUNTDOWN_SECONDS = 10;  // Must match device LCD countdown (10.6s total: 10..1 + GO!)
  const raceCountdownEl = document.getElementById("raceCountdownOverlay");
  const raceCountdownNumberEl = document.getElementById("raceCountdownNumber");

  updateLapCounter();
  currentRaceSessionTimestamp = null;
  startRaceButton.disabled = true;
  startRaceButton.classList.add("active");

  // Fire countdown immediately so device LCD + I2S start right away.
  // Backend picks the right flow (visible 10s overlay vs. classic "less than 5"
  // audio-only) from the saved raceCountdownMode.
  fetch("/timer/countdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  }).catch((err) => console.log("[Race] Countdown endpoint not available:", err));

  if (beepAudioContext && beepAudioContext.state === "suspended") {
    beepAudioContext.resume().catch((err) => console.warn("[Race] AudioContext resume failed:", err));
  }
  if (audioEnabled && audioAnnouncer && !audioAnnouncer.audioUnlocked && !audioAnnouncer.isPlaying) {
    audioAnnouncer.unlockAudioContextMobile().catch(() => {});
  }

  // Branch on countdown mode
  if (raceCountdownMode === 0) {
    // Classic "Less than 5": queue TTS, wait for announcements, then random 1-5s delay
    queueSpeak(`<p>${i18n.t("settings.tts.arm_quad")}</p>`);
    queueSpeak(`<p>${i18n.t("settings.tts.starting_soon")}</p>`);

    // Wait for announcements to finish playing (bounded so we never hang)
    const waitStart = Date.now();
    while (audioAnnouncer && (audioAnnouncer.isSpeaking?.() || (audioAnnouncer.audioQueue && audioAnnouncer.audioQueue.length > 0))) {
      if (Date.now() - waitStart > 10000) break;  // safety cap
      await new Promise((r) => setTimeout(r, 100));
    }

    // Random 1-5s pre-start delay
    const delayTime = Math.random() * (5000 - 1000) + 1000;
    await new Promise((r) => setTimeout(r, delayTime));
  } else {
    // Visible 10-second countdown (matches device LCD); total 10.5s so beep aligns with device "GO!"
    queueSpeak(`<p>${i18n.t("settings.tts.arm_quad")}</p>`);
    if (raceCountdownEl && raceCountdownNumberEl) {
      raceCountdownEl.style.display = "flex";
      raceCountdownNumberEl.classList.remove("go");
      for (let s = RACE_COUNTDOWN_SECONDS; s >= 1; s--) {
        raceCountdownNumberEl.textContent = String(s);
        // "Starting in less than 5" only when we actually show 5 (not at start)
        if (s === 5) queueSpeak(`<p>${i18n.t("settings.tts.starting_soon")}</p>`);
        await new Promise((r) => setTimeout(r, 1000));
      }
      raceCountdownNumberEl.textContent = "GO!";
      raceCountdownNumberEl.classList.add("go");
      await new Promise((r) => setTimeout(r, 500));
      raceCountdownEl.style.display = "none";
    } else {
      await new Promise((r) => setTimeout(r, RACE_COUNTDOWN_SECONDS * 1000 + 500));
    }
  }

  // Play start beep and begin race (synced with device)
  beep(1, 1, "square"); // needed for some reason to make sure we fire the first beep
  beep(500, 880, "square");

  // Vibrate for mobile devices (works even in silent mode on iOS)
  if (navigator.vibrate) {
    navigator.vibrate(500); // 500ms vibration
  }

  startTimer();
  startRaceButton.classList.remove("active");
  stopRaceButton.disabled = false;
  addLapButton.disabled = false;

  // Initialize lap timing for distance estimation
  currentLapStartTime = Date.now();
  lapTimerStartMs = Date.now();
  lastCompletedLapTime = 0;
  currentLapDistance = 0.0;

  // Start polling distance if tracks enabled
  startDistancePolling();

  // Auto-stop the race after maxHeatTime30s * 30 seconds (0 = unlimited).
  // Guarded by stopRaceButton.disabled in case stopRace already ran.
  if (heatTimeoutId) {
    clearTimeout(heatTimeoutId);
    heatTimeoutId = null;
  }
  if (maxHeatTime30s > 0) {
    const heatMs = maxHeatTime30s * 30 * 1000;
    console.log(`[Race] Heat time limit ${maxHeatTime30s * 30}s - scheduling auto-stop in ${heatMs} ms`);
    heatTimeoutId = setTimeout(function () {
      heatTimeoutId = null;
      if (!stopRaceButton.disabled) {
        console.log("[Race] Max heat time reached - stopping race");
        stopRace();
        queueSpeak(`<p>${i18n.t("settings.tts.race_complete")}</p>`);
      }
    }, heatMs);
  }

  // Note: Sync commands now sent by master device directly (device-to-device)
}

function stopRace() {
  // If slave mode, don't allow local race control
  if (raceSyncMode === 2) {
    console.log("[Race] Slave mode - race control disabled");
    return;
  }
  // Cancel pending heat-time auto-stop (idempotent)
  if (heatTimeoutId) {
    clearTimeout(heatTimeoutId);
    heatTimeoutId = null;
  }
  // Clear any queued audio to prevent race start sounds
  if (audioAnnouncer) {
    audioAnnouncer.clearQueue();
  }
  queueSpeak(`<p>${i18n.t("settings.tts.race_stopped")}</p>`);
  clearInterval(timerInterval);
  timer.innerHTML = i18n.t("race.timer_default");
  
  // Reset current lap timer display
  currentLapStartMs = 0;
  const currentLapTimerEl = document.getElementById("currentLapTimer");
  if (currentLapTimerEl) currentLapTimerEl.textContent = "00:00:00s";

  if (usbConnected && transportManager) {
    transportManager
      .sendCommand("timer/stop", "POST")
      .then((response) => console.log("/timer/stop:", response))
      .catch((err) => console.error("Failed to stop timer:", err));
  } else {
    fetch("/timer/stop", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((response) => console.log("/timer/stop:" + JSON.stringify(response)));
  }

  stopRaceButton.disabled = true;
  startRaceButton.disabled = false;
  addLapButton.disabled = true;

  // Stop distance polling
  stopDistancePolling();

  const shouldOpenRaceNotes = openRaceNotesOnRaceEnd;
  // Auto-save race if there are laps
  if (lapTimes.length > 0) {
    saveCurrentRace().then(() => {
      if (shouldOpenRaceNotes) {
        openRaceNotesModal();
      }
    });
  } else if (shouldOpenRaceNotes) {
    openRaceNotesModal();
  }

  // Don't clear lapNo or lapTimes here - keep them visible until user clicks "Clear Laps"
  // This allows the lap analysis to remain visible after the race ends
  currentTotalDistance = 0;
  currentDistanceRemaining = 0;
  currentLapDistance = 0.0;
  currentLapStartTime = 0;
  lastCompletedLapTime = 0;
  updateDistanceDisplay();
  
  // Note: Sync commands now sent by master device directly (device-to-device)
}

function clearLaps() {
  // If slave mode, don't allow local race control
  if (raceSyncMode === 2) {
    console.log("[Race] Slave mode - race control disabled");
    return;
  }
  // Cancel pending heat-time auto-stop (idempotent)
  if (heatTimeoutId) {
    clearTimeout(heatTimeoutId);
    heatTimeoutId = null;
  }
  // Auto-save race if there are laps before clearing (only if it wasn't already saved on stopRace)
  if (lapTimes.length > 0 && !currentRaceSessionTimestamp && !pendingRaceSavePromise) {
    saveCurrentRace({ setAsCurrentSession: false });
  }

  var tableHeaderRowCount = 1;
  var rowCount = lapTable.rows.length;
  for (var i = tableHeaderRowCount; i < rowCount; i++) {
    lapTable.deleteRow(tableHeaderRowCount);
  }
  lapNo = -1;
  lapTimes = [];
  updateLapCounter();
  if (raceNotesInput) {
    raceNotesInput.value = "";
  }
  updateRaceNotesIndicator();
  currentRaceSessionTimestamp = null;
  
  // Reset current lap timer display
  currentLapStartMs = 0;
  const currentLapTimerEl = document.getElementById("currentLapTimer");
  if (currentLapTimerEl) currentLapTimerEl.textContent = "00:00:00s";

  // Clear lap analysis
  document.getElementById("analysisContent").innerHTML = `<p class="no-data">${i18n.t("analysis.no_data")}</p>`;
  document.getElementById("statFastest").textContent = "--";
  document.getElementById("statFastestLapNo").textContent = "";
  document.getElementById("statFastest3Consec").textContent = "--";
  document.getElementById("statFastest3ConsecLaps").textContent = "";
  document.getElementById("statMedian").textContent = "--";
  document.getElementById("statBest3").textContent = "--";
  document.getElementById("statBest3Laps").textContent = "";
  
  // Broadcast clearLaps event to OSD and other clients
  if (usbConnected && transportManager) {
    transportManager
      .sendCommand("timer/clearLaps", "POST")
      .then((response) => console.log("/timer/clearLaps:", response))
      .catch((err) => console.error("Failed to clear laps:", err));
  } else {
    fetch("/timer/clearLaps", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((response) => console.log("/timer/clearLaps:" + JSON.stringify(response)));
  }
  
  // Note: Sync commands now sent by master device directly (device-to-device)
}

// ============================================
// Race Sync Functions
// ============================================

// Send HTTP POST to all synced timers
async function sendCommandToSyncedTimers(endpoint) {
  if (syncedTimers.length === 0) return;
  
  console.log(`[Sync] Sending ${endpoint} to ${syncedTimers.length} synced timers`);
  
  for (const timer of syncedTimers) {
    try {
      const url = `http://${timer}${endpoint}`;
      console.log(`[Sync] -> ${url}`);
      
      // Use fetch with timeout - CORS headers are set on the server
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        console.log(`[Sync] OK: ${timer}`);
      } else {
        console.warn(`[Sync] ${timer} returned status ${response.status}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn(`[Sync] Timeout reaching ${timer} (5s)`);
      } else {
        console.warn(`[Sync] Failed to reach ${timer}:`, err.message);
      }
      // Continue to next timer - don't block on errors
    }
  }
}

// Update timer number in config
function updateTimerNumber() {
  const select = document.getElementById("timerNumber");
  if (select) {
    timerNumber = parseInt(select.value);
    console.log("[Sync] Timer number set to:", timerNumber);
    autoSaveConfig();  // Save immediately when timer address changes
  }
}

// Update race sync mode
function updateRaceSyncMode(mode, skipSave = false) {
  raceSyncMode = mode;
  console.log("[Sync] Race sync mode set to:", mode);
  
  // Update UI visibility
  const masterOptions = document.getElementById("masterSyncOptions");
  const slaveIndicator = document.getElementById("slaveModeIndicator");
  
  if (masterOptions) {
    masterOptions.style.display = mode === 1 ? "block" : "none";
  }
  if (slaveIndicator) {
    slaveIndicator.style.display = mode === 2 ? "block" : "none";
  }
  
  // Update race tab UI for slave mode
  updateSlaveModelUI();
  
  // Save config when user changes mode (not when loading from config)
  if (!skipSave) {
    autoSaveConfig();
  }
}

// Update race buttons and banner for slave/master/personal/rotorhazard mode
function updateSlaveModelUI() {
  const personalBanner = document.getElementById("personalModeRaceBanner");
  const slaveBanner = document.getElementById("slaveModeRaceBanner");
  const masterBanner = document.getElementById("masterModeRaceBanner");
  const rotorhazardBanner = document.getElementById("rotorhazardModeRaceBanner");
  const startBtn = document.getElementById("startRaceButton");
  const stopBtn = document.getElementById("stopRaceButton");
  const clearBtn = document.getElementById("clearLapsButton");
  
  if (raceSyncMode === 2) {
    // Slave mode - disable buttons and show slave banner
    if (personalBanner) personalBanner.style.display = "none";
    if (slaveBanner) slaveBanner.style.display = "block";
    if (masterBanner) masterBanner.style.display = "none";
    if (rotorhazardBanner) rotorhazardBanner.style.display = "none";
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.style.opacity = "0.5";
    }
    if (clearBtn) {
      clearBtn.disabled = true;
      clearBtn.style.opacity = "0.5";
    }
  } else if (raceSyncMode === 1) {
    // Master mode - enable buttons and show master banner
    if (personalBanner) personalBanner.style.display = "none";
    if (slaveBanner) slaveBanner.style.display = "none";
    if (masterBanner) masterBanner.style.display = "block";
    if (rotorhazardBanner) rotorhazardBanner.style.display = "none";
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.style.opacity = "1";
    }
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.style.opacity = "1";
    }
  } else {
    // Personal or RotorHazard mode - enable buttons
    if (slaveBanner) slaveBanner.style.display = "none";
    if (masterBanner) masterBanner.style.display = "none";
    if (rhEnabled === 1) {
      // RotorHazard mode - show RH banner instead of personal
      if (personalBanner) personalBanner.style.display = "none";
      if (rotorhazardBanner) rotorhazardBanner.style.display = "block";
    } else {
      // Personal mode
      if (personalBanner) personalBanner.style.display = "block";
      if (rotorhazardBanner) rotorhazardBanner.style.display = "none";
    }
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.style.opacity = "1";
    }
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.style.opacity = "1";
    }
  }
  
  // Re-render the race view when mode changes
  renderUnifiedRaceView();
  
  // Toggle between Lap Analysis and Race Analysis sections
  updateAnalysisSectionVisibility();
}

// Add a synced timer to the list
function addSyncedTimer() {
  const input = document.getElementById("syncTimerInput");
  if (!input) return;
  
  let hostname = input.value.trim();
  if (!hostname) {
    alert(i18n.t("messages.enter_timer_hostname") || "Please enter a timer hostname");
    return;
  }
  
  // Add .local if not present
  if (!hostname.includes(".")) {
    hostname += ".local";
  }
  
  // Check if already in list
  if (syncedTimers.includes(hostname)) {
    alert(i18n.t("messages.timer_already_added") || "Timer already added");
    return;
  }
  
  // Max 5 timers
  if (syncedTimers.length >= 5) {
    alert(i18n.t("messages.max_timers_reached") || "Maximum 5 synced timers allowed");
    return;
  }
  
  syncedTimers.push(hostname);
  input.value = "";
  renderSyncedTimersList();
  console.log("[Sync] Added timer:", hostname, "Total:", syncedTimers.length);
}

// Remove a synced timer from the list
function removeSyncedTimer(hostname) {
  syncedTimers = syncedTimers.filter(t => t !== hostname);
  renderSyncedTimersList();
  console.log("[Sync] Removed timer:", hostname, "Remaining:", syncedTimers.length);
}

// Test connection to a synced timer
async function testSyncedTimer(hostname) {
  const statusSpan = document.getElementById(`status-${hostname.replace(/\./g, '-')}`);
  if (statusSpan) {
    statusSpan.textContent = "Testing...";
    statusSpan.style.color = "var(--secondary-color)";
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for test
    
    const response = await fetch(`http://${hostname}/timer/ping`, {
      method: "GET",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (statusSpan) {
        statusSpan.textContent = `Online (${data.hostname || 'connected'})`;
        statusSpan.style.color = "#2ecc71";
      }
      console.log(`[Sync] Ping OK: ${hostname}`, data);
    } else {
      if (statusSpan) {
        statusSpan.textContent = "Error: " + response.status;
        statusSpan.style.color = "#e74c3c";
      }
    }
  } catch (err) {
    console.warn(`[Sync] Ping failed for ${hostname}:`, err.message);
    if (statusSpan) {
      if (err.name === 'AbortError') {
        statusSpan.textContent = "Timeout (5s)";
      } else {
        statusSpan.textContent = "Unreachable";
      }
      statusSpan.style.color = "#e74c3c";
    }
  }
}

// Test all synced timers
async function testAllSyncedTimers() {
  for (const timer of syncedTimers) {
    await testSyncedTimer(timer);
  }
}

// Test connection from slave to master
async function testMasterConnection() {
  const masterInput = document.getElementById("masterHostname");
  const statusDiv = document.getElementById("masterConnectionStatus");
  
  if (!masterInput || !statusDiv) return;
  
  let masterHostname = masterInput.value.trim();
  if (!masterHostname) {
    statusDiv.style.display = "block";
    statusDiv.style.backgroundColor = "rgba(231, 76, 60, 0.2)";
    statusDiv.style.color = "#e74c3c";
    statusDiv.textContent = i18n.t("messages.enter_master_hostname") || "Please enter master hostname/IP first";
    return;
  }
  
  // Add .local if not present and not an IP address
  if (!masterHostname.includes(".") || (!masterHostname.includes(":") && !masterHostname.match(/^\d+\.\d+\.\d+\.\d+$/))) {
    if (!masterHostname.includes(".")) {
      masterHostname += ".local";
    }
  }
  
  statusDiv.style.display = "block";
  statusDiv.style.backgroundColor = "rgba(52, 152, 219, 0.2)";
  statusDiv.style.color = "#3498db";
  statusDiv.textContent = "Step 1: Testing connection to master...";
  
  try {
    // Step 1: Test direct connection to master via browser fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`http://${masterHostname}/timer/ping`, {
      method: "GET",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      console.log("[Slave] Master ping OK:", data);
      
      // Step 2: Test slave-to-master connection via backend
      statusDiv.textContent = "Step 2: Testing slave firmware -> master...";
      
      try {
        const backendResponse = await fetch("/timer/testSlaveToMaster", { method: "POST" });
        const backendData = await backendResponse.json();
        console.log("[Slave] Backend test response:", backendData);
        
        statusDiv.style.backgroundColor = "rgba(46, 204, 113, 0.2)";
        statusDiv.style.color = "#2ecc71";
        statusDiv.innerHTML = `<div>Browser -> Master: OK (${data.hostname})</div><div>Firmware -> Master: Sent test lap (check master console)</div>`;
      } catch (backendErr) {
        console.warn("[Slave] Backend test failed:", backendErr.message);
        statusDiv.style.backgroundColor = "rgba(241, 196, 15, 0.2)";
        statusDiv.style.color = "#f1c40f";
        statusDiv.innerHTML = `<div>Browser -> Master: OK</div><div>Firmware -> Master: Error - ${backendErr.message}</div>`;
      }
    } else {
      statusDiv.style.backgroundColor = "rgba(231, 76, 60, 0.2)";
      statusDiv.style.color = "#e74c3c";
      statusDiv.textContent = (i18n.t("messages.master_error") || "Error") + ": HTTP " + response.status;
    }
  } catch (err) {
    console.warn("[Slave] Master ping failed:", err.message);
    statusDiv.style.backgroundColor = "rgba(231, 76, 60, 0.2)";
    statusDiv.style.color = "#e74c3c";
    if (err.name === 'AbortError') {
      statusDiv.textContent = i18n.t("messages.master_timeout") || "Connection timeout (5s)";
    } else {
      statusDiv.textContent = i18n.t("messages.master_unreachable") || "Master unreachable";
    }
  }
}

// Render the synced timers list UI (LEGACY - kept for backwards compatibility)
function renderSyncedTimersList() {
  // Now calls the new unified render function
  renderSyncDevicesList();
}

// Fetch this device's IP address
async function fetchThisDeviceAddress() {
  try {
    const response = await fetch('/timer/ping');
    if (response.ok) {
      const data = await response.json();
      // Try to get the IP from the request, fallback to hostname
      thisDeviceAddress = window.location.hostname || data.hostname || 'fpvgate.local';
      console.log('[Sync] This device address:', thisDeviceAddress);
      return thisDeviceAddress;
    }
  } catch (err) {
    console.warn('[Sync] Failed to fetch device address:', err.message);
    thisDeviceAddress = window.location.hostname || 'fpvgate.local';
  }
  return thisDeviceAddress;
}

// Initialize sync devices from legacy config
function initSyncDevicesFromConfig() {
  syncDevices = [];
  
  // Add "This Device" first
  let thisDeviceRole = 'personal';
  if (rhEnabled === 1) {
    thisDeviceRole = 'rotorhazard';
  } else if (raceSyncMode === 1) {
    thisDeviceRole = 'master';
  } else if (raceSyncMode === 2) {
    thisDeviceRole = 'slave';
  }
  
  syncDevices.push({
    address: thisDeviceAddress || window.location.hostname || 'This Device',
    role: thisDeviceRole,
    isThisDevice: true
  });
  
  // Add synced timers (from master config) as slaves
  if (syncedTimers && syncedTimers.length > 0) {
    syncedTimers.forEach(timer => {
      syncDevices.push({
        address: timer,
        role: 'slave',
        isThisDevice: false
      });
    });
  }
  
  // Add master hostname (from slave config) as master
  if (masterHostname && raceSyncMode === 2) {
    // Check if already in list
    const exists = syncDevices.some(d => d.address === masterHostname);
    if (!exists) {
      syncDevices.push({
        address: masterHostname,
        role: 'master',
        isThisDevice: false
      });
    }
  }
  
  console.log('[Sync] Initialized sync devices:', syncDevices);
}

// Map sync devices UI back to legacy config fields
function mapSyncDevicesToConfig() {
  // Find this device's role
  const thisDevice = syncDevices.find(d => d.isThisDevice);
  if (thisDevice) {
    if (thisDevice.role === 'rotorhazard') {
      raceSyncMode = 0;
      rhEnabled = 1;
    } else if (thisDevice.role === 'master') {
      raceSyncMode = 1;
      rhEnabled = 0;
    } else if (thisDevice.role === 'slave') {
      raceSyncMode = 2;
      rhEnabled = 0;
    } else {
      raceSyncMode = 0;
      rhEnabled = 0;
    }
  }
  
  // Find master (for slave config)
  const masterDevice = syncDevices.find(d => d.role === 'master' && !d.isThisDevice);
  masterHostname = masterDevice ? masterDevice.address : '';
  
  // Build syncedTimers array (all slaves except this device)
  syncedTimers = syncDevices
    .filter(d => d.role === 'slave' && !d.isThisDevice)
    .map(d => d.address);
  
  console.log('[Sync] Mapped config - mode:', raceSyncMode, 'master:', masterHostname, 'slaves:', syncedTimers);
  
  // Update UI elements that depend on mode
  updateRaceSyncMode(raceSyncMode, true);
}

// Render the unified sync devices list
function renderSyncDevicesList() {
  const container = document.getElementById("syncDevicesList");
  if (!container) return;
  
  // Ensure we have at least "This Device" in the list
  if (syncDevices.length === 0) {
    syncDevices.push({
      address: thisDeviceAddress || window.location.hostname || 'This Device',
      role: 'personal',
      isThisDevice: true
    });
  }
  
  let html = '';
  syncDevices.forEach((device, index) => {
    const safeId = device.address.replace(/\./g, '-').replace(/:/g, '-');
    const isThisDevice = device.isThisDevice;
    const displayName = isThisDevice ? `${i18n.t("settings.sync.this_device") || "This Device"} (${device.address})` : device.address;
    
    // Check if there's already a master (other than this device if it's master)
    const hasMaster = syncDevices.some(d => d.role === 'master');
    const canBeMaster = !hasMaster || device.role === 'master';
    
    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background-color: var(--bg-secondary); border-radius: 6px; margin-bottom: 8px; ${isThisDevice ? 'border-left: 3px solid var(--primary-color);' : ''}">
        <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: ${isThisDevice ? 'bold' : 'normal'};">${displayName}</span>
          <span id="status-${safeId}" style="font-size: 12px; color: var(--secondary-color);"></span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <select onchange="updateDeviceRole(${index}, this.value)" style="padding: 4px 8px; font-size: 13px; min-width: 110px;">
            <option value="personal" ${device.role === 'personal' ? 'selected' : ''}>${i18n.t("settings.sync.role_personal") || "Personal"}</option>
            <option value="master" ${device.role === 'master' ? 'selected' : ''} ${!canBeMaster ? 'disabled' : ''}>${i18n.t("settings.sync.role_master") || "Master"}</option>
            <option value="slave" ${device.role === 'slave' ? 'selected' : ''}>${i18n.t("settings.sync.role_slave") || "Slave"}</option>
            ${isThisDevice ? `<option value="rotorhazard" ${device.role === 'rotorhazard' ? 'selected' : ''}>RotorHazard</option>` : ''}
          </select>
          ${!isThisDevice ? `
            <button onclick="testSyncDevice(${index})" style="padding: 4px 8px; background-color: var(--accent-color); font-size: 12px;" title="Test connection">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </button>
            <button onclick="removeSyncDevice(${index})" style="padding: 4px 8px; background-color: #e74c3c; font-size: 12px;" title="Remove device">X</button>
          ` : ''}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Show/hide RH config panel vs add-device panel based on role
  const thisDeviceNode = syncDevices.find(d => d.isThisDevice);
  const isRHMode = thisDeviceNode && thisDeviceNode.role === 'rotorhazard';
  const rhPanel = document.getElementById('rhConfigPanel');
  const addPanel = document.getElementById('syncAddDevicePanel');
  if (rhPanel) rhPanel.style.display = isRHMode ? 'block' : 'none';
  if (addPanel) addPanel.style.display = isRHMode ? 'none' : 'block';

  // Update slave mode indicator
  const slaveIndicator = document.getElementById('slaveModeIndicator');
  if (slaveIndicator) {
    slaveIndicator.style.display = (thisDeviceNode && thisDeviceNode.role === 'slave') ? 'block' : 'none';
  }
}

// Add a new sync device
function addSyncDevice() {
  const input = document.getElementById('addSyncDeviceInput');
  if (!input) return;
  
  let address = input.value.trim();
  if (!address) {
    alert(i18n.t("messages.enter_device_address") || "Please enter a device address");
    return;
  }
  
  // Add .local if hostname without dots
  if (!address.includes('.')) {
    address += '.local';
  }
  
  // Check if already in list
  if (syncDevices.some(d => d.address === address)) {
    alert(i18n.t("messages.device_already_added") || "Device already in list");
    return;
  }
  
  // Max 6 devices total (including this device)
  if (syncDevices.length >= 6) {
    alert(i18n.t("messages.max_devices_reached") || "Maximum 6 devices allowed");
    return;
  }
  
  syncDevices.push({
    address: address,
    role: 'slave', // Default to slave
    isThisDevice: false
  });
  
  input.value = '';
  renderSyncDevicesList();
  mapSyncDevicesToConfig();
  autoSaveConfig();
  console.log('[Sync] Added device:', address);
}

// Remove a sync device by index
function removeSyncDevice(index) {
  if (index < 0 || index >= syncDevices.length) return;
  if (syncDevices[index].isThisDevice) return; // Can't remove this device
  
  const removed = syncDevices.splice(index, 1)[0];
  renderSyncDevicesList();
  mapSyncDevicesToConfig();
  autoSaveConfig();
  console.log('[Sync] Removed device:', removed.address);
}

// Update a device's role
function updateDeviceRole(index, newRole) {
  if (index < 0 || index >= syncDevices.length) return;
  
  const device = syncDevices[index];
  const oldRole = device.role;
  
  // If setting to master, clear any other master
  if (newRole === 'master') {
    syncDevices.forEach((d, i) => {
      if (i !== index && d.role === 'master') {
        d.role = 'slave'; // Demote to slave
      }
    });
  }
  
  device.role = newRole;
  console.log('[Sync] Updated device role:', device.address, oldRole, '->', newRole);
  
  renderSyncDevicesList();
  mapSyncDevicesToConfig();
  autoSaveConfig();
}

// Test connection to a sync device
async function testSyncDevice(index) {
  if (index < 0 || index >= syncDevices.length) return;
  
  const device = syncDevices[index];
  const safeId = device.address.replace(/\./g, '-').replace(/:/g, '-');
  const statusSpan = document.getElementById(`status-${safeId}`);
  
  if (statusSpan) {
    statusSpan.textContent = 'Testing...';
    statusSpan.style.color = 'var(--secondary-color)';
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`http://${device.address}/timer/ping`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (statusSpan) {
        statusSpan.textContent = `Online`;
        statusSpan.style.color = '#2ecc71';
      }
      console.log(`[Sync] Ping OK: ${device.address}`, data);
    } else {
      if (statusSpan) {
        statusSpan.textContent = 'Error: ' + response.status;
        statusSpan.style.color = '#e74c3c';
      }
    }
  } catch (err) {
    console.warn(`[Sync] Ping failed for ${device.address}:`, err.message);
    if (statusSpan) {
      if (err.name === 'AbortError') {
        statusSpan.textContent = 'Timeout';
      } else {
        statusSpan.textContent = 'Unreachable';
      }
      statusSpan.style.color = '#e74c3c';
    }
  }
}

// Test all sync devices
async function testAllSyncDevices() {
  for (let i = 0; i < syncDevices.length; i++) {
    if (!syncDevices[i].isThisDevice) {
      await testSyncDevice(i);
    }
  }
}

// EventSource initialization moved to setupWiFiEvents() function above

function setBandChannelIndex(freq) {
  for (var i = 0; i < freqLookup.length; i++) {
    for (var j = 0; j < freqLookup[i].length; j++) {
      if (freqLookup[i][j] == freq) {
        const bandDef = bandDefinitions[i];
        if (bandDef) {
          // Switch system if this band belongs to a different one
          if (currentSystem !== bandDef.system) {
            currentSystem = bandDef.system;
            if (systemSelect) systemSelect.value = currentSystem;
            if (calibSystemSelect) calibSystemSelect.value = currentSystem;
            populateBandsBySystem(currentSystem, bandSelect);
            populateBandsBySystem(currentSystem, calibBandSelect);
          }
          // Find the option by value in the filtered dropdown (not by raw freqLookup index)
          const bandOption = Array.from(bandSelect.options).find(opt => opt.value === bandDef.value);
          if (bandOption) bandSelect.value = bandDef.value;
          channelSelect.selectedIndex = j;
          updateChannelAvailability(bandSelect);
        }
        return; // Stop at first match - prevents overwriting with digital band duplicates
      }
    }
  }
}

// Theme functionality
function changeTheme() {
  const theme = document.getElementById("themeSelect").value;
  const customSection = document.getElementById("customThemeSection");
  
  // Show/hide custom theme section
  if (customSection) {
    customSection.style.display = theme === "custom" ? "block" : "none";
  }
  
  if (theme === "lighter") {
    document.documentElement.removeAttribute("data-theme");
  } else if (theme === "custom") {
    document.documentElement.setAttribute("data-theme", "custom");
    // Apply custom colors from inputs or saved config
    loadCustomThemeColors();
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  updateThemeLogos(theme);
  autoSaveConfig(); // Save to device
}

function updateCustomTheme() {
  const bgColor = document.getElementById("customBgColor")?.value || "#263238";
  const primaryColor = document.getElementById("customPrimaryColor")?.value || "#009688";
  const textColor = document.getElementById("customTextColor")?.value || "#B0BEC5";
  const menuColor = document.getElementById("customMenuColor")?.value || "#37474F";
  const secondaryColor = document.getElementById("customSecondaryColor")?.value || "#607D8B";
  
  // Calculate darker version of primary color for hover states
  const primaryDark = adjustBrightness(primaryColor, -20);
  const borderColor = menuColor;
  
  // Apply custom CSS variables to root
  const root = document.documentElement;
  root.style.setProperty("--custom-background", bgColor);
  root.style.setProperty("--custom-primary", primaryColor);
  root.style.setProperty("--custom-primary-dark", primaryDark);
  root.style.setProperty("--custom-text", textColor);
  root.style.setProperty("--custom-menu", menuColor);
  root.style.setProperty("--custom-secondary", secondaryColor);
  root.style.setProperty("--custom-border", borderColor);
  
  autoSaveConfig(); // Save to device
}

function loadCustomThemeColors() {
  // Load custom colors from inputs (they get populated from config on load)
  const bgColor = document.getElementById("customBgColor")?.value || "#263238";
  const primaryColor = document.getElementById("customPrimaryColor")?.value || "#009688";
  const textColor = document.getElementById("customTextColor")?.value || "#B0BEC5";
  const menuColor = document.getElementById("customMenuColor")?.value || "#37474F";
  const secondaryColor = document.getElementById("customSecondaryColor")?.value || "#607D8B";
  
  const primaryDark = adjustBrightness(primaryColor, -20);
  
  const root = document.documentElement;
  root.style.setProperty("--custom-background", bgColor);
  root.style.setProperty("--custom-primary", primaryColor);
  root.style.setProperty("--custom-primary-dark", primaryDark);
  root.style.setProperty("--custom-text", textColor);
  root.style.setProperty("--custom-menu", menuColor);
  root.style.setProperty("--custom-secondary", secondaryColor);
  root.style.setProperty("--custom-border", menuColor);
}

function resetCustomTheme() {
  // Reset to default custom theme colors
  const bgInput = document.getElementById("customBgColor");
  const primaryInput = document.getElementById("customPrimaryColor");
  const textInput = document.getElementById("customTextColor");
  const menuInput = document.getElementById("customMenuColor");
  const secondaryInput = document.getElementById("customSecondaryColor");
  
  if (bgInput) bgInput.value = "#263238";
  if (primaryInput) primaryInput.value = "#009688";
  if (textInput) textInput.value = "#B0BEC5";
  if (menuInput) menuInput.value = "#37474F";
  if (secondaryInput) secondaryInput.value = "#607D8B";
  
  updateCustomTheme();
}

function adjustBrightness(hex, percent) {
  // Adjust hex color brightness by percent (-100 to 100)
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1).toUpperCase();
}

function updateThemeLogos(theme) {
  // Light themes list
  const lightThemes = new Set(["lighter", "github", "onelight", "solarizedlight", "lightowl"]);
  // For custom theme, determine if it's light based on background color
  let isLight = lightThemes.has(theme);
  if (theme === "custom") {
    const bgColor = document.getElementById("customBgColor")?.value || "#263238";
    isLight = isLightColor(bgColor);
  }
  const favicon = document.getElementById("favicon");
  const headerLogo = document.getElementById("headerLogo");
  const logoPath = isLight ? "logo-black.svg" : "logo-white.svg";
  if (favicon) {
    favicon.href = logoPath;
    favicon.type = "image/svg+xml";
  }
  if (headerLogo) headerLogo.src = logoPath;
}

function isLightColor(hex) {
  // Calculate perceived brightness
  const num = parseInt(hex.replace("#", ""), 16);
  const R = (num >> 16) & 0xFF;
  const G = (num >> 8) & 0xFF;
  const B = num & 0xFF;
  // Using relative luminance formula
  const brightness = (R * 299 + G * 587 + B * 114) / 1000;
  return brightness > 128;
}

function loadDarkMode() {
  // Theme is now loaded from device config on page load
  // This function is kept for compatibility but may not be needed
  const themeSelect = document.getElementById("themeSelect");
  if (themeSelect && themeSelect.value) {
    const theme = themeSelect.value;
    const customSection = document.getElementById("customThemeSection");
    
    if (customSection) {
      customSection.style.display = theme === "custom" ? "block" : "none";
    }
    
    if (theme === "custom") {
      document.documentElement.setAttribute("data-theme", "custom");
      loadCustomThemeColors();
    } else if (theme !== "lighter") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    updateThemeLogos(theme);
  }
}

// Manual lap addition
function addManualLap() {
  // Use the current lap timer value (time since last gate crossing)
  if (!currentLapStartMs) {
    console.warn("[Manual Lap] No lap timer running");
    return;
  }
  
  const lapTimeMs = Date.now() - currentLapStartMs;
  
  console.log("[Manual Lap] Recording lap time:", lapTimeMs, "ms (", (lapTimeMs / 1000).toFixed(2), "s)");

  // Send lap to backend to broadcast to all clients (including OSD)
  if (usbConnected && transportManager) {
    transportManager
      .sendCommand("timer/addLap", "POST", { lapTime: lapTimeMs })
      .then((data) => console.log("Manual lap broadcasted:", data))
      .catch((err) => console.error("Failed to broadcast manual lap:", err));
  } else {
    fetch("/timer/addLap", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lapTime: lapTimeMs }),
    })
      .then((response) => response.json())
      .then((data) => console.log("Manual lap broadcasted:", data))
      .catch((err) => console.error("Failed to broadcast manual lap:", err));
  }

  // Note: The lap will be added via EventSource lap event
  // No need to call addLap() here as it will come back through the event stream
}

// Lap Analysis
let currentAnalysisMode = "history";

// Color palette for bar variations
const barColors = [
  ["#42A5F5", "#1E88E5"], // Blue
  ["#66BB6A", "#43A047"], // Green
  ["#FFA726", "#FB8C00"], // Orange
  ["#AB47BC", "#8E24AA"], // Purple
  ["#26C6DA", "#00ACC1"], // Cyan
  ["#FFCA28", "#FFB300"], // Amber
  ["#EF5350", "#E53935"], // Red
  ["#5C6BC0", "#3F51B5"], // Indigo
  ["#EC407A", "#D81B60"], // Pink
  ["#78909C", "#607D8B"], // Blue Grey
];

function switchAnalysisMode(mode) {
  currentAnalysisMode = mode;
  // Update tab styling
  document.querySelectorAll(".analysis-tab").forEach((tab) => {
    tab.classList.remove("active");
  });
  event.target.classList.add("active");
  // Re-render analysis
  updateAnalysisView();
}

function updateAnalysisView() {
  if (lapTimes.length === 0) {
    document.getElementById("analysisContent").innerHTML = `<p class="no-data">${i18n.t("analysis.no_data")}</p>`;
    return;
  }

  // Update stats boxes
  updateStatsBoxes();

  // Update chart view
  switch (currentAnalysisMode) {
    case "history":
      renderLapHistory();
      break;
    case "fastestRound":
      renderFastestRound();
      break;
  }
}

function updateStatsBoxes() {
  if (lapTimes.length === 0) {
    document.getElementById("statFastest").textContent = "--";
    document.getElementById("statFastestLapNo").textContent = "";
    document.getElementById("statFastest3Consec").textContent = "--";
    document.getElementById("statFastest3ConsecLaps").textContent = "";
    document.getElementById("statMedian").textContent = "--";
    document.getElementById("statBest3").textContent = "--";
    document.getElementById("statBest3Laps").textContent = "";
    return;
  }

  // Fastest Lap (excluding Gate 1 which is just passing through to start)
  const validLaps = lapTimes.slice(1); // Skip Gate 1
  if (validLaps.length === 0) {
    document.getElementById("statFastest").textContent = "--";
    document.getElementById("statFastestLapNo").textContent = i18n.t("analysis.need_1_lap");
  } else {
    const fastest = Math.min(...validLaps);
    const fastestIndex = validLaps.indexOf(fastest) + 1; // +1 to account for skipped Gate 1
    document.getElementById("statFastest").textContent = `${fastest.toFixed(2)}${i18n.t("race.table.seconds_short")}`;
    document.getElementById("statFastestLapNo").textContent = i18n.t("race.lap_counter", { n: fastestIndex });
  }

  // Fastest 3 Consecutive Laps (for RaceGOW format) - skip Gate 1
  if (validLaps.length >= 3) {
    let fastestConsecTime = Infinity;
    let fastestConsecStart = -1;

    // Check all consecutive 3-lap windows (starting from Lap 1, not Gate 1)
    for (let i = 0; i <= validLaps.length - 3; i++) {
      const consecTime = validLaps[i] + validLaps[i + 1] + validLaps[i + 2];
      if (consecTime < fastestConsecTime) {
        fastestConsecTime = consecTime;
        fastestConsecStart = i + 1; // +1 to account for skipped Gate 1
      }
    }

    document.getElementById("statFastest3Consec").textContent = `${fastestConsecTime.toFixed(2)}${i18n.t("race.table.seconds_short")}`;
    const lapNums = `L${fastestConsecStart}-L${fastestConsecStart + 1}-L${fastestConsecStart + 2}`;
    document.getElementById("statFastest3ConsecLaps").textContent = lapNums;
  } else {
    document.getElementById("statFastest3Consec").textContent = "--";
    document.getElementById("statFastest3ConsecLaps").textContent = i18n.t("analysis.need_3_laps");
  }

  // Median Lap (excluding Gate 1)
  if (validLaps.length === 0) {
    document.getElementById("statMedian").textContent = "--";
  } else {
    const sorted = [...validLaps].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    document.getElementById("statMedian").textContent = median.toFixed(2) + i18n.t("race.table.seconds_short");
  }

  // Best 3 Laps (sum of 3 fastest individual laps) - skip Gate 1
  if (validLaps.length >= 3) {
    const lapsWithIndex = validLaps.map((time, index) => ({ time, index: index + 1 })); // +1 for actual lap number
    lapsWithIndex.sort((a, b) => a.time - b.time);
    const best3 = lapsWithIndex.slice(0, 3);
    const totalTime = best3.reduce((sum, l) => sum + l.time, 0);
    const lapNumbers = best3
      .map((l) => `L${l.index}`)
      .sort()
      .join(", ");
    document.getElementById("statBest3").textContent = `${totalTime.toFixed(2)}${i18n.t("race.table.seconds_short")}`;
    document.getElementById("statBest3Laps").textContent = lapNumbers;
  } else {
    document.getElementById("statBest3").textContent = "--";
    document.getElementById("statBest3Laps").textContent = i18n.t("analysis.need_3_laps");
  }
}

function renderLapHistory() {
  // Skip Gate 1 (index 0) and show only actual laps
  const validLaps = lapTimes.slice(1); // Skip Gate 1
  if (validLaps.length === 0) {
    document.getElementById("analysisContent").innerHTML = `<p class="no-data">${i18n.t("analysis.no_data")}</p>`;
    return;
  }

  // Show last 10 valid laps (or all if less than 10)
  const recentLaps = validLaps.slice(-10);
  const startIndex = Math.max(0, validLaps.length - 10);
  const maxTime = Math.max(...recentLaps);

  let html = '<div class="analysis-bars">';
  recentLaps.forEach((time, index) => {
    const lapNumber = startIndex + index + 1; // Lap 1, 2, 3... (not Gate 1)
    const colorIndex = (startIndex + index) % barColors.length;
    html += createBarItemWithColor(i18n.t("race.lap_counter", { n: lapNumber }), time, maxTime, time.toFixed(2) + i18n.t("race.table.seconds_short"), colorIndex);
  });
  html += "</div>";

  if (validLaps.length > 10) {
    html += `<p style="text-align: center; margin-top: 16px; color: var(--secondary-color); font-size: 14px;">Showing last 10 of ${validLaps.length} laps</p>`;
  }

  document.getElementById("analysisContent").innerHTML = html;
}

function renderFastestRound() {
  // Skip Gate 1 (index 0) and only analyze actual laps
  const validLaps = lapTimes.slice(1); // Skip Gate 1
  if (validLaps.length < 3) {
    document.getElementById("analysisContent").innerHTML = `<p class="no-data">${i18n.t("analysis.no_data_3_laps")}</p>`;
    return;
  }

  // Find best consecutive 3 laps from valid laps only
  let bestTime = Infinity;
  let bestStartIndex = 0;

  for (let i = 0; i <= validLaps.length - 3; i++) {
    const sum = validLaps[i] + validLaps[i + 1] + validLaps[i + 2];
    if (sum < bestTime) {
      bestTime = sum;
      bestStartIndex = i;
    }
  }

  const lap1 = validLaps[bestStartIndex];
  const lap2 = validLaps[bestStartIndex + 1];
  const lap3 = validLaps[bestStartIndex + 2];
  const maxTime = Math.max(lap1, lap2, lap3);

  let html = '<div class="analysis-bars">';
  // bestStartIndex is in validLaps array, so add 1 for actual lap number (Lap 1, 2, 3...)
  html += createBarItemWithColor(i18n.t("race.lap_counter", { n: bestStartIndex + 1 }), lap1, maxTime, `${lap1.toFixed(2)}${i18n.t("race.table.seconds_short")}`, 0);
  html += createBarItemWithColor(i18n.t("race.lap_counter", { n: bestStartIndex + 2 }), lap2, maxTime, `${lap2.toFixed(2)}${i18n.t("race.table.seconds_short")}`, 1);
  html += createBarItemWithColor(i18n.t("race.lap_counter", { n: bestStartIndex + 3 }), lap3, maxTime, `${lap3.toFixed(2)}${i18n.t("race.table.seconds_short")}`, 2);
  html += "</div>";
  html += `<p style="text-align: center; margin-top: 16px; font-weight: bold; color: var(--primary-color);">${i18n.t("analysis.total", { n: bestTime.toFixed(2) })}</p>`;

  document.getElementById("analysisContent").innerHTML = html;
}

function createBarItemWithColor(label, time, maxTime, displayTime, colorIndex) {
  const percentage = (time / maxTime) * 100;
  const colors = barColors[colorIndex % barColors.length];
  return `
    <div class="bar-item">
      <div class="bar-label">${label}</div>
      <div class="bar-container">
        <div class="bar-fill" style="width: ${percentage}%; background: linear-gradient(90deg, ${colors[0]}, ${colors[1]});">
          <span class="bar-time">${displayTime}</span>
        </div>
      </div>
    </div>
  `;
}
function renderFastest3ConsecPanel(stats) {
  if (!stats || stats.fastest3ConsecValue == null) {
    return '<p class="no-data">Complete at least 3 laps to see fastest 3 consecutive</p>';
  }
  return `
    <div class="stats-boxes" style="max-width: 420px; margin: 0 auto;">
      <div class="stat-box">
        <div class="stat-label">Fastest 3 Consecutive</div>
        <div class="stat-value">${stats.fastest3ConsecValue.toFixed(2)}s</div>
        <div class="stat-sublabel">${stats.fastest3ConsecLaps}</div>
      </div>
    </div>
  `;
}

function renderAlwaysOnRaceStats(stats) {
  const best3El = document.getElementById("raceAlwaysBest3");
  const medianEl = document.getElementById("raceAlwaysMedian");
  if (!best3El || !medianEl) return;

  if (!stats) {
    best3El.textContent = "--";
    medianEl.textContent = "--";
    return;
  }

  best3El.textContent = stats.best3Value == null ? "--" : `${stats.best3Value.toFixed(2)}s`;
  medianEl.textContent = `${stats.median.toFixed(2)}s`;
}

// ============================================
// Race Analysis (Multi-Pilot + Personal Tabbed Analytics)
// ============================================
const MAX_ENABLED_RACE_ANALYTICS = 3;
const RACE_ANALYTICS_STORAGE_KEY = "raceAnalyticsDisplaySettings";
const RACE_ANALYTICS_DEFAULTS = {
  fastestLap: true,
  fastest3Consec: true,
  lapTimes: true,
  consistency: true,
};
let raceAnalyticsDisplaySettings = loadRaceAnalyticsDisplaySettings();
let currentRaceAnalyticsTab = "fastestLap";

// Pilot color palette for charts
const pilotColors = [
  "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF",
  "#FF9F40", "#7CFC00", "#FF69B4", "#00CED1", "#FFD700"
];

function loadRaceAnalyticsDisplaySettings() {
  try {
    const raw = localStorage.getItem(RACE_ANALYTICS_STORAGE_KEY);
    if (!raw) return { ...RACE_ANALYTICS_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      fastestLap: parsed.fastestLap !== false,
      fastest3Consec: parsed.fastest3Consec !== false,
      lapTimes: parsed.lapTimes !== false,
      consistency: parsed.consistency !== false,
    };
  } catch (err) {
    console.warn("[RaceAnalysis] Failed to parse display settings, using defaults:", err);
    return { ...RACE_ANALYTICS_DEFAULTS };
  }
}

function saveRaceAnalyticsDisplaySettings() {
  localStorage.setItem(RACE_ANALYTICS_STORAGE_KEY, JSON.stringify(raceAnalyticsDisplaySettings));
}

function getEnabledRaceAnalyticsCount() {
  return Object.values(raceAnalyticsDisplaySettings).filter(Boolean).length;
}

function getEnabledRaceAnalyticsTabs() {
  const order = ["fastestLap", "fastest3Consec", "lapTimes", "consistency"];
  return order.filter((key) => !!raceAnalyticsDisplaySettings[key]);
}

function getRaceAnalyticsTabLabel(tabKey) {
  if (tabKey === "fastestLap") return "Fastest Lap";
  if (tabKey === "fastest3Consec") return "Fastest 3 Consecutive";
  if (tabKey === "lapTimes") return "Lap Times";
  if (tabKey === "consistency") return "Consistency";
  return tabKey;
}

function syncRaceAnalyticsToggleUI() {
  const fastestLapToggle = document.getElementById("raceAnalyticsToggleFastestLap");
  if (fastestLapToggle) fastestLapToggle.checked = !!raceAnalyticsDisplaySettings.fastestLap;
  const fastest3ConsecToggle = document.getElementById("raceAnalyticsToggleFastest3Consec");
  if (fastest3ConsecToggle) fastest3ConsecToggle.checked = !!raceAnalyticsDisplaySettings.fastest3Consec;
  const lapToggle = document.getElementById("raceAnalyticsToggleLapTimes");
  if (lapToggle) lapToggle.checked = !!raceAnalyticsDisplaySettings.lapTimes;
  const consistencyToggle = document.getElementById("raceAnalyticsToggleConsistency");
  if (consistencyToggle) consistencyToggle.checked = !!raceAnalyticsDisplaySettings.consistency;
}

function toggleRaceAnalyticsPanel(panelKey, enabled) {
  if (!(panelKey in RACE_ANALYTICS_DEFAULTS)) return;

  const alreadyEnabled = !!raceAnalyticsDisplaySettings[panelKey];
  if (enabled && !alreadyEnabled && getEnabledRaceAnalyticsCount() >= MAX_ENABLED_RACE_ANALYTICS) {
    alert(`You can enable up to ${MAX_ENABLED_RACE_ANALYTICS} analytics panels at once.`);
    syncRaceAnalyticsToggleUI();
    return;
  }

  raceAnalyticsDisplaySettings[panelKey] = enabled;
  if (!raceAnalyticsDisplaySettings[currentRaceAnalyticsTab]) {
    const fallback = getEnabledRaceAnalyticsTabs()[0];
    currentRaceAnalyticsTab = fallback || "fastestLap";
  }
  saveRaceAnalyticsDisplaySettings();
  syncRaceAnalyticsToggleUI();
  updateAnalysisSectionVisibility();
  updateRaceAnalysisView();
}

function switchRaceAnalyticsTab(tabKey) {
  if (!raceAnalyticsDisplaySettings[tabKey]) return;
  currentRaceAnalyticsTab = tabKey;
  updateRaceAnalysisView();
}
function computeRaceStats() {
  const validLaps = lapTimes.slice(1);
  if (validLaps.length === 0) {
    return null;
  }

  const fastest = Math.min(...validLaps);
  const fastestIndex = validLaps.indexOf(fastest) + 1;

  let fastest3ConsecValue = null;
  let fastest3ConsecLaps = null;
  if (validLaps.length >= 3) {
    let best = Infinity;
    let bestStart = -1;
    for (let i = 0; i <= validLaps.length - 3; i++) {
      const total = validLaps[i] + validLaps[i + 1] + validLaps[i + 2];
      if (total < best) {
        best = total;
        bestStart = i + 1;
      }
    }
    fastest3ConsecValue = best;
    fastest3ConsecLaps = `L${bestStart}-L${bestStart + 1}-L${bestStart + 2}`;
  }

  const sorted = [...validLaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  let best3Value = null;
  let best3Laps = null;
  if (validLaps.length >= 3) {
    const top3 = validLaps
      .map((time, idx) => ({ time, idx: idx + 1 }))
      .sort((a, b) => a.time - b.time)
      .slice(0, 3);
    best3Value = top3.reduce((s, l) => s + l.time, 0);
    best3Laps = top3.map((l) => `L${l.idx}`).sort().join(", ");
  }
  return {
    fastest,
    fastestIndex,
    fastest3ConsecValue,
    fastest3ConsecLaps,
    best3Value,
    best3Laps,
    median,
  };
}

function renderFastestLapPanel(stats) {
  if (!stats) return '<p class="no-data">Complete at least 1 lap to see fastest lap</p>';

  return `
    <div class="stats-boxes" style="max-width: 360px; margin: 0 auto;">
      <div class="stat-box">
        <div class="stat-label">Fastest Lap</div>
        <div class="stat-value">${stats.fastest.toFixed(2)}s</div>
        <div class="stat-sublabel">Lap ${stats.fastestIndex}</div>
      </div>
    </div>
  `;
}

function updateRaceAnalysisView() {
  const tabsContainer = document.getElementById("raceAnalyticsTabs");
  const contentContainer = document.getElementById("raceAnalysisContent");
  const emptyMessage = document.getElementById("raceAnalysisEmptyMessage");
  const enabledTabs = getEnabledRaceAnalyticsTabs();
  const stats = computeRaceStats();

  renderAlwaysOnRaceStats(stats);

  if (emptyMessage) emptyMessage.style.display = enabledTabs.length > 0 ? "none" : "block";
  if (!tabsContainer || !contentContainer) return;

  if (enabledTabs.length === 0) {
    tabsContainer.innerHTML = "";
    contentContainer.innerHTML = '<p class="no-data">Enable an analytics tab to display race analytics</p>';
    return;
  }

  if (!enabledTabs.includes(currentRaceAnalyticsTab)) {
    currentRaceAnalyticsTab = enabledTabs[0];
  }

  tabsContainer.innerHTML = enabledTabs
    .map((tabKey) => `<button class="analysis-tab ${tabKey === currentRaceAnalyticsTab ? "active" : ""}" onclick="switchRaceAnalyticsTab('${tabKey}')">${getRaceAnalyticsTabLabel(tabKey)}</button>`)
    .join("");
  if (currentRaceAnalyticsTab === "fastestLap") {
    contentContainer.innerHTML = renderFastestLapPanel(stats);
    return;
  }
  if (currentRaceAnalyticsTab === "fastest3Consec") {
    contentContainer.innerHTML = renderFastest3ConsecPanel(stats);
    return;
  }

  const pilots = collectAllPilotsData();
  if (currentRaceAnalyticsTab === "lapTimes") {
    renderLapTimesChart(pilots, "raceAnalysisContent");
    return;
  }
  if (currentRaceAnalyticsTab === "consistency") {
    renderConsistencyChart(pilots, "raceAnalysisContent");
  }
}

function collectAllPilotsData() {
  const pilots = [];
  
  // Add local pilot
  const localPilotInfo = getLocalPilotInfo();
  const localColorHex = document.getElementById("pilotColor")?.value || "#0080FF";
  pilots.push({
    name: localPilotInfo.pilotName || "Local",
    color: localColorHex,
    lapTimes: lapTimes.slice(), // Copy array
    isLocal: true
  });
  
  // Add remote pilots (in master mode)
  if (raceSyncMode === 1) {
    for (const hostname of Object.keys(remotePilots)) {
      const pilot = remotePilots[hostname];
      const colorHex = pilot.pilotColor ? '#' + pilot.pilotColor.toString(16).padStart(6, '0') : pilotColors[pilots.length % pilotColors.length];
      pilots.push({
        name: pilot.pilotName || hostname,
        color: colorHex,
        lapTimes: pilot.lapTimes || [],
        isLocal: false
      });
    }
  }
  
  return pilots;
}

function renderLapTimesChart(pilots, containerId = "raceAnalysisContent") {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Find max laps and time range
  let maxLaps = 0;
  let minTime = Infinity;
  let maxTime = 0;
  
  pilots.forEach(pilot => {
    const validLaps = pilot.lapTimes.slice(1); // Skip gate 1
    if (validLaps.length > maxLaps) maxLaps = validLaps.length;
    validLaps.forEach(t => {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    });
  });
  
  if (maxLaps < 1) {
    container.innerHTML = '<p class="no-data">Complete at least 1 lap to see chart</p>';
    return;
  }
  
  // Chart dimensions
  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Add padding to time range
  const timeRange = maxTime - minTime || 1;
  minTime = Math.max(0, minTime - timeRange * 0.1);
  maxTime = maxTime + timeRange * 0.1;
  
  // Build SVG
  let svg = `<svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: ${width}px; height: auto;">`;
  
  // Grid lines
  svg += '<g class="grid" stroke="var(--border-color)" stroke-opacity="0.3">';
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight / 5) * i;
    svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
  }
  for (let i = 0; i <= maxLaps; i++) {
    const x = padding.left + (chartWidth / maxLaps) * i;
    svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" />`;
  }
  svg += '</g>';
  
  // Y-axis labels (time)
  svg += '<g class="y-axis" fill="var(--text-color)" font-size="11">';
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight / 5) * i;
    const time = maxTime - ((maxTime - minTime) / 5) * i;
    svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${time.toFixed(1)}s</text>`;
  }
  svg += '</g>';
  
  // X-axis labels (laps)
  svg += '<g class="x-axis" fill="var(--text-color)" font-size="11">';
  for (let i = 1; i <= maxLaps; i++) {
    const x = padding.left + (chartWidth / maxLaps) * (i - 0.5);
    svg += `<text x="${x}" y="${height - padding.bottom + 20}" text-anchor="middle">L${i}</text>`;
  }
  svg += `<text x="${width / 2}" y="${height - 5}" text-anchor="middle" font-size="12" fill="var(--secondary-color)">Lap</text>`;
  svg += '</g>';
  
  // Draw lines and points for each pilot
  pilots.forEach((pilot, pilotIdx) => {
    const validLaps = pilot.lapTimes.slice(1); // Skip gate 1
    if (validLaps.length < 1) return;
    
    // Build path points
    const points = [];
    validLaps.forEach((time, lapIdx) => {
      const x = padding.left + (chartWidth / maxLaps) * (lapIdx + 0.5);
      const y = padding.top + chartHeight - ((time - minTime) / (maxTime - minTime)) * chartHeight;
      points.push({ x, y, time });
    });
    
    // Draw smooth curve using catmull-rom spline converted to bezier
    if (points.length > 1) {
      let pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        
        // Catmull-Rom to Bezier conversion
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        
        pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }
      svg += `<path d="${pathD}" fill="none" stroke="${pilot.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    }
    
    // Draw points
    points.forEach(p => {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${pilot.color}" stroke="white" stroke-width="1.5" />`;
    });
  });
  
  svg += '</svg>';
  container.innerHTML = svg;
}

function renderConsistencyChart(pilots, containerId = "raceAnalysisContent") {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Calculate box plot statistics for each pilot
  const pilotStats = pilots.map(pilot => {
    const validLaps = pilot.lapTimes.slice(1).filter(t => t > 0); // Skip gate 1
    if (validLaps.length < 2) return null;
    
    const sorted = [...validLaps].sort((a, b) => a - b);
    const n = sorted.length;
    const q1Idx = Math.floor(n * 0.25);
    const q3Idx = Math.floor(n * 0.75);
    
    const min = sorted[0];
    const max = sorted[n - 1];
    const q1 = sorted[q1Idx];
    const q3 = sorted[q3Idx];
    const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
    const iqr = q3 - q1;
    const whiskerMin = Math.max(min, q1 - 1.5 * iqr);
    const whiskerMax = Math.min(max, q3 + 1.5 * iqr);
    
    // Find outliers
    const outliers = validLaps.filter(t => t < whiskerMin || t > whiskerMax);
    
    return {
      name: pilot.name,
      color: pilot.color,
      min, max, q1, q3, median, whiskerMin, whiskerMax, outliers,
      allLaps: validLaps
    };
  }).filter(s => s !== null);
  
  if (pilotStats.length === 0) {
    container.innerHTML = '<p class="no-data">Complete at least 2 laps to see consistency chart</p>';
    return;
  }
  
  // Find time range across all pilots
  let globalMin = Infinity;
  let globalMax = 0;
  pilotStats.forEach(s => {
    if (s.min < globalMin) globalMin = s.min;
    if (s.max > globalMax) globalMax = s.max;
  });
  
  const timeRange = globalMax - globalMin || 1;
  globalMin = Math.max(0, globalMin - timeRange * 0.1);
  globalMax = globalMax + timeRange * 0.1;
  
  // Chart dimensions
  const width = 800;
  const rowHeight = 40;
  const height = pilotStats.length * rowHeight + 80;
  const padding = { top: 20, right: 30, bottom: 50, left: 100 };
  const chartWidth = width - padding.left - padding.right;
  
  // Build SVG
  let svg = `<svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: ${width}px; height: auto;">`;
  
  // Grid lines (vertical)
  svg += '<g class="grid" stroke="var(--border-color)" stroke-opacity="0.3">';
  for (let i = 0; i <= 10; i++) {
    const x = padding.left + (chartWidth / 10) * i;
    svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" />`;
  }
  svg += '</g>';
  
  // X-axis labels (time)
  svg += '<g class="x-axis" fill="var(--text-color)" font-size="11">';
  for (let i = 0; i <= 10; i++) {
    const x = padding.left + (chartWidth / 10) * i;
    const time = globalMin + ((globalMax - globalMin) / 10) * i;
    svg += `<text x="${x}" y="${height - padding.bottom + 20}" text-anchor="middle">${time.toFixed(1)}</text>`;
  }
  svg += `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-size="12" fill="var(--secondary-color)">Lap Time (s)</text>`;
  svg += '</g>';
  
  // Draw box plots for each pilot
  pilotStats.forEach((stats, idx) => {
    const y = padding.top + idx * rowHeight + rowHeight / 2;
    const boxHeight = rowHeight * 0.6;
    
    // Helper to convert time to x position
    const timeToX = (t) => padding.left + ((t - globalMin) / (globalMax - globalMin)) * chartWidth;
    
    // Pilot name label
    svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="${stats.color}" font-weight="bold">${stats.name}</text>`;
    
    // Whiskers (lines extending from box)
    const whiskerMinX = timeToX(stats.whiskerMin);
    const whiskerMaxX = timeToX(stats.whiskerMax);
    const q1X = timeToX(stats.q1);
    const q3X = timeToX(stats.q3);
    const medianX = timeToX(stats.median);
    
    // Left whisker
    svg += `<line x1="${whiskerMinX}" y1="${y}" x2="${q1X}" y2="${y}" stroke="${stats.color}" stroke-width="1.5" />`;
    svg += `<line x1="${whiskerMinX}" y1="${y - boxHeight/4}" x2="${whiskerMinX}" y2="${y + boxHeight/4}" stroke="${stats.color}" stroke-width="1.5" />`;
    
    // Right whisker
    svg += `<line x1="${q3X}" y1="${y}" x2="${whiskerMaxX}" y2="${y}" stroke="${stats.color}" stroke-width="1.5" />`;
    svg += `<line x1="${whiskerMaxX}" y1="${y - boxHeight/4}" x2="${whiskerMaxX}" y2="${y + boxHeight/4}" stroke="${stats.color}" stroke-width="1.5" />`;
    
    // Box (Q1 to Q3)
    svg += `<rect x="${q1X}" y="${y - boxHeight/2}" width="${q3X - q1X}" height="${boxHeight}" fill="${stats.color}" fill-opacity="0.3" stroke="${stats.color}" stroke-width="1.5" rx="2" />`;
    
    // Median line
    svg += `<line x1="${medianX}" y1="${y - boxHeight/2}" x2="${medianX}" y2="${y + boxHeight/2}" stroke="${stats.color}" stroke-width="2" />`;
    
    // Fastest lap marker (red circle)
    const fastestX = timeToX(stats.min);
    svg += `<circle cx="${fastestX}" cy="${y}" r="6" fill="#FF0000" stroke="white" stroke-width="1.5" />`;
    
    // Individual lap points (small circles)
    stats.allLaps.forEach(t => {
      const x = timeToX(t);
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="${stats.color}" stroke-opacity="0.5" />`;
    });
    
    // Outliers (hollow circles)
    stats.outliers.forEach(t => {
      const x = timeToX(t);
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="${stats.color}" stroke-width="1.5" />`;
    });
  });
  
  svg += '</svg>';
  container.innerHTML = svg;
}


// Toggle between Lap Analysis and Race Analysis based on sync mode
function updateAnalysisSectionVisibility() {
  const lapAnalysis = document.getElementById("lapAnalysis");
  const raceAnalysis = document.getElementById("raceAnalysis");
  const anyAnalyticsEnabled =
    !!raceAnalyticsDisplaySettings.fastestLap ||
    !!raceAnalyticsDisplaySettings.fastest3Consec ||
    !!raceAnalyticsDisplaySettings.lapTimes ||
    !!raceAnalyticsDisplaySettings.consistency;

  if (anyAnalyticsEnabled) {
    // Show Race Analysis panels selected via toggles in both personal and sync modes.
    if (lapAnalysis) lapAnalysis.style.display = "none";
    if (raceAnalysis) raceAnalysis.style.display = "block";
    updateRaceAnalysisView();
  } else {
    // All toggles off => no analytics content shown.
    if (lapAnalysis) lapAnalysis.style.display = "none";
    if (raceAnalysis) raceAnalysis.style.display = "none";
  }
}

// Race History Functions
let raceHistoryData = [];
let currentDetailRace = null;

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saveCurrentRace(options = {}) {
  const { setAsCurrentSession = true } = options;
  if (lapTimes.length === 0) return Promise.resolve(null);
  if (currentRaceSessionTimestamp && setAsCurrentSession) return Promise.resolve(currentRaceSessionTimestamp);
  if (pendingRaceSavePromise) return pendingRaceSavePromise;

  // Calculate stats (excluding Gate 1)
  const validLaps = lapTimes.slice(1);
  const fastest = validLaps.length > 0 ? Math.min(...validLaps) : 0;
  const sorted = [...validLaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length > 0 ? (sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]) : 0;

  let best3Total = 0;
  if (validLaps.length >= 3) {
    const best3 = sorted.slice(0, 3);
    best3Total = best3.reduce((sum, t) => sum + t, 0);
  }

  // Get current pilot and frequency info
  const pilotCallsign = document.getElementById("pcallsign")?.value || "";
  const bandValue = bandSelect.options[bandSelect.selectedIndex].value;
  const channelValue = parseInt(channelSelect.options[channelSelect.selectedIndex].value);
  const notes = raceNotesInput ? raceNotesInput.value.trim() : "";

  // Calculate total race distance: track length per lap × number of laps
  let totalRaceDistance = 0;
  console.log(`DEBUG: trackLapLength=${trackLapLength}, currentTrackId=${currentTrackId}, currentTrackName='${currentTrackName}'`);
  if (trackLapLength > 0 && lapTimes.length > 0) {
    totalRaceDistance = trackLapLength * lapTimes.length;
    console.log(`Saving race: trackLapLength=${trackLapLength}m, lapCount=${lapTimes.length}, totalDistance=${totalRaceDistance}m`);
  } else {
    console.warn(`WARNING: No track distance to save! trackLapLength=${trackLapLength}, lapCount=${lapTimes.length}`);
    console.warn(`Did you select a track before starting the race? currentTrackId=${currentTrackId}`);
  }

  const raceTimestamp = Math.floor(Date.now() / 1000);
  const raceData = {
    timestamp: raceTimestamp,
    lapTimes: lapTimes.map((t) => Math.round(t * 1000)), // Convert to milliseconds
    fastestLap: Math.round(fastest * 1000),
    medianLap: Math.round(median * 1000),
    best3LapsTotal: Math.round(best3Total * 1000),
    pilotName: pilotNameInput.value || "",
    pilotCallsign: pilotCallsign,
    frequency: frequency,
    band: bandValue,
    channel: channelValue,
    notes: notes,
    trackId: currentTrackId || 0,
    trackName: currentTrackName || "",
    totalDistance: totalRaceDistance,
    syncMode: raceSyncMode,
  };
  
  // Build pilots array for multi-pilot races (sync mode active)
  if (raceSyncMode === 1 || raceSyncMode === 2) {
    const pilots = [];
    
    // Add local pilot
    const localPilotColor = document.getElementById("pilotColor")?.value || "#0080FF";
    const localColorInt = parseInt(localPilotColor.replace("#", ""), 16);
    const localValidLaps = lapTimes.slice(1);
    const localFastest = localValidLaps.length > 0 ? Math.min(...localValidLaps) : 0;
    
    pilots.push({
      name: pilotNameInput.value || "Local",
      callsign: pilotCallsign,
      color: localColorInt,
      lapTimes: lapTimes.map((t) => Math.round(t * 1000)),
      fastestLap: Math.round(localFastest * 1000),
      isLocal: true
    });
    
    // Add remote pilots (only in master mode)
    if (raceSyncMode === 1 && Object.keys(remotePilots).length > 0) {
      for (const hostname of Object.keys(remotePilots)) {
        const pilot = remotePilots[hostname];
        const remoteLapTimes = pilot.lapTimes || [];
        const remoteValidLaps = remoteLapTimes.slice(1);
        const remoteFastest = remoteValidLaps.length > 0 ? Math.min(...remoteValidLaps) : 0;
        
        pilots.push({
          name: pilot.pilotName || hostname,
          callsign: pilot.pilotPhonetic || pilot.pilotName || "",
          color: pilot.pilotColor || 0x0080FF,
          lapTimes: remoteLapTimes.map((t) => Math.round(t * 1000)),
          fastestLap: Math.round(remoteFastest * 1000),
          isLocal: false
        });
      }
    }
    
    raceData.pilots = pilots;
    console.log(`[Race] Saving multi-pilot race with ${pilots.length} pilots`);
  }

  pendingRaceSavePromise = fetch("/races/save", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(raceData),
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data || data.status !== "OK") {
        throw new Error("Race save failed");
      }
      console.log("Race saved:", data);
      if (setAsCurrentSession) {
        currentRaceSessionTimestamp = raceTimestamp;
      }
      loadRaceHistory();
      return raceTimestamp;
    })
    .catch((error) => {
      console.error("Error saving race:", error);
      return null;
    })
    .finally(() => {
      pendingRaceSavePromise = null;
    });

  return pendingRaceSavePromise;
}

function loadRaceHistory() {
  fetch("/races")
    .then((response) => response.json())
    .then((data) => {
      raceHistoryData = data.races || [];
      renderRaceHistory();
    })
    .catch((error) => console.error("Error loading races:", error));
}

function renderRaceHistory() {
  const listContainer = document.getElementById("raceHistoryList");

  if (raceHistoryData.length === 0) {
    listContainer.innerHTML = `<p class="no-data">${i18n.t("history.no_data")}</p>`;
    return;
  }

  let html = "";
  raceHistoryData.forEach((race, index) => {
    const date = new Date(race.timestamp * 1000);
    const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();
    const fastestLap = (race.fastestLap / 1000).toFixed(2);
    // Lap count should exclude Gate 1 (first entry)
    const actualLapCount = race.lapTimes.length > 0 ? race.lapTimes.length - 1 : 0;
    // Calculate total race time (sum of all times)
    const totalTime = race.lapTimes.reduce((sum, t) => sum + t, 0) / 1000;
    const name = race.name || "";
    const tag = race.tag || "";
    const pilotCallsign = race.pilotCallsign || race.pilotName || "";
    const freqDisplay = race.frequency ? `${race.band}${race.channel} (${race.frequency}MHz)` : "";
    const trackDisplay = race.trackName ? race.trackName : "";
    const distanceDisplay = race.totalDistance ? `${race.totalDistance.toFixed(1)}m` : "";
    const notes = (race.notes || "").trim();
    const notesPreview = notes.length > 140 ? notes.substring(0, 137) + "..." : notes;
    
    // Multi-pilot race detection
    const isMultiPilot = race.pilots && race.pilots.length > 1;
    const pilotCount = race.pilots ? race.pilots.length : 1;
    const syncModeLabel = race.syncMode === 1 ? "MASTER" : race.syncMode === 2 ? "SLAVE" : "";
    
    // Build pilots display for multi-pilot races
    let pilotsDisplay = "";
    if (isMultiPilot) {
      const pilotNames = race.pilots.map(p => p.name || p.callsign || "Unknown").join(", ");
      pilotsDisplay = `<div style="font-size: 14px; color: var(--secondary-color); margin-top: 4px;"><strong>${pilotCount} Pilots:</strong> ${pilotNames}</div>`;
    } else if (pilotCallsign) {
      pilotsDisplay = `<div style="font-size: 14px; color: var(--secondary-color); margin-top: 4px;">${i18n.t("history.item_pilot", { n: pilotCallsign })}</div>`;
    }

    html += `
      <div class="race-item" data-race-index="${index}">
        <div class="race-item-buttons">
          <button class="race-item-button" data-action="edit" data-index="${index}">${i18n.t("history.edit")}</button>
          <button class="race-item-button" data-action="download" data-timestamp="${race.timestamp}">${i18n.t("history.download")}</button>
          <button class="race-item-button" style="border-color: #e74c3c; color: #e74c3c;" data-action="delete" data-timestamp="${race.timestamp}">${i18n.t("history.delete")}</button>
        </div>
        <div class="race-item-header">
          <div>
            ${tag ? '<span class="race-tag">' + tag + "</span>" : ""}
            ${syncModeLabel ? '<span class="race-tag" style="background-color: var(--primary-color); margin-left: 4px;">' + syncModeLabel + "</span>" : ""}
            ${isMultiPilot ? '<span class="race-tag" style="background-color: var(--accent-color); margin-left: 4px;">' + pilotCount + ' PILOTS</span>' : ""}
            <div class="race-date">${dateStr}</div>
            ${name ? '<div class="race-name">' + name + "</div>" : ""}
            ${pilotsDisplay}
            ${freqDisplay ? '<div style="font-size: 14px; color: var(--secondary-color);">' + i18n.t("history.item_channel", { n: freqDisplay }) + "</div>" : ""}
            ${trackDisplay ? '<div style="font-size: 14px; color: var(--secondary-color);">' + i18n.t("history.item_track", { n: trackDisplay + (distanceDisplay ? " (" + distanceDisplay + ")" : "") }) + "</div>" : ""}
            ${notesPreview ? '<div class="race-notes-preview">' + i18n.t("history.item_notes", { n: escapeHtml(notesPreview) }) + "</div>" : ""}
          </div>
        </div>
        <div class="race-item-stats">
          <div class="race-item-stat">${i18n.t("history.item_laps", { n: "<strong>" + actualLapCount + "</strong>" })}</div>
          <div class="race-item-stat">${i18n.t("history.item_fastest", { n: "<strong>" + fastestLap + "</strong>" })}</div>
          <div class="race-item-stat">${i18n.t("history.item_total_time", { n: "<strong>" + totalTime.toFixed(2) + "</strong>" })}</div>
          ${distanceDisplay ? '<div class="race-item-stat">' + i18n.t("history.item_distance", { n: "<strong>" + distanceDisplay + "</strong>" }) + "</div>" : ""}
        </div>
      </div>
    `;
  });

  // Preserve the raceDetails div if it exists and has been moved
  const existingRaceDetails = document.getElementById("raceDetails");
  const raceDetailsParent = existingRaceDetails ? existingRaceDetails.parentNode : null;
  const raceDetailsNextSibling = existingRaceDetails ? existingRaceDetails.nextSibling : null;
  
  // Remove raceDetails temporarily if it's in the list container
  if (existingRaceDetails && raceDetailsParent === listContainer) {
    listContainer.removeChild(existingRaceDetails);
  }
  
  // Update the list
  listContainer.innerHTML = html;
  
  // Restore raceDetails if it was in the list
  if (existingRaceDetails && raceDetailsParent === listContainer) {
    // Put it back at the end of the list
    listContainer.appendChild(existingRaceDetails);
  }
  
  // Add event delegation for race item clicks
  setupRaceHistoryEventHandlers();
}

function setupRaceHistoryEventHandlers() {
  const listContainer = document.getElementById("raceHistoryList");
  if (!listContainer) {
    console.error("Race history list container not found");
    return;
  }
  
  // Remove existing listener if any
  const oldHandler = listContainer._raceClickHandler;
  if (oldHandler) {
    listContainer.removeEventListener("click", oldHandler);
  }
  
  // Create new handler
  const handler = (event) => {
    const raceItem = event.target.closest(".race-item");
    const button = event.target.closest(".race-item-button");
    
    console.log("Race history click:", { raceItem, button, target: event.target });
    
    // Handle button clicks
    if (button) {
      event.stopPropagation();
      const action = button.getAttribute("data-action");
      
      if (action === "edit") {
        const index = parseInt(button.getAttribute("data-index"));
        openEditModal(index);
      } else if (action === "download") {
        const timestamp = parseInt(button.getAttribute("data-timestamp"));
        downloadSingleRace(timestamp);
      } else if (action === "delete") {
        const timestamp = parseInt(button.getAttribute("data-timestamp"));
        deleteRace(timestamp);
      }
      return;
    }
    
    // Handle race item click
    if (raceItem) {
      const index = parseInt(raceItem.getAttribute("data-race-index"));
      console.log("Opening race details for index:", index);
      viewRaceDetails(index);
    }
  };
  
  // Store handler reference and add listener
  listContainer._raceClickHandler = handler;
  listContainer.addEventListener("click", handler);
  console.log("Race history event handlers set up");
}

function viewRaceDetails(index) {
  // Check if we're on the history tab
  const historyTab = document.getElementById("history");
  console.log("viewRaceDetails called. historyTab:", historyTab, "display:", historyTab ? historyTab.style.display : "null");
  
  if (!historyTab || historyTab.style.display === "none") {
    console.log("Not on history tab, ignoring click");
    return;
  }

  currentDetailRace = raceHistoryData[index];
  const race = currentDetailRace;
  const date = new Date(race.timestamp * 1000);
  const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();

  // Calculate total race time
  const totalTime = race.lapTimes.reduce((sum, t) => sum + t, 0) / 1000;

  // Get the race details div - must exist in the history tab
  const detailsDiv = document.getElementById("raceDetails");
  console.log("raceDetails div:", detailsDiv);
  
  if (!detailsDiv) {
    console.error("Race details div not found even though history tab is visible!");
    return;
  }

  // Get the clicked race item element
  const raceItem = document.querySelector(`.race-item[data-race-index="${index}"]`);

  // Remove from current position
  if (detailsDiv.parentNode) {
    detailsDiv.parentNode.removeChild(detailsDiv);
  }

  // Insert after the clicked race item
  if (raceItem && raceItem.parentNode) {
    raceItem.parentNode.insertBefore(detailsDiv, raceItem.nextSibling);
  }

  // Show the details div first
  detailsDiv.style.display = "block";

  // Now update the content (elements should be accessible)
  const titleEl = document.getElementById("raceDetailsTitle");
  const fastestEl = document.getElementById("detailFastest");
  const medianEl = document.getElementById("detailMedian");
  const best3El = document.getElementById("detailBest3");
  const totalTimeEl = document.getElementById("detailTotalTime");
  const notesContainerEl = document.getElementById("raceDetailsNotes");
  const notesTextEl = document.getElementById("raceDetailsNotesText");

  if (titleEl) titleEl.textContent = i18n.t("history.details_title_with_date", { date: dateStr });
  if (fastestEl) fastestEl.textContent = (race.fastestLap / 1000).toFixed(2) + i18n.t("race.table.seconds_short");
  if (medianEl) medianEl.textContent = (race.medianLap / 1000).toFixed(2) + i18n.t("race.table.seconds_short");
  if (best3El) best3El.textContent = (race.best3LapsTotal / 1000).toFixed(2) + i18n.t("race.table.seconds_short");
  if (totalTimeEl) totalTimeEl.textContent = totalTime.toFixed(2) + i18n.t("race.table.seconds_short");
  if (notesContainerEl && notesTextEl) {
    const notes = (race.notes || "").trim();
    if (notes) {
      notesTextEl.textContent = notes;
      notesContainerEl.style.display = "block";
    } else {
      notesTextEl.textContent = "";
      notesContainerEl.style.display = "none";
    }
  }

  // Render the race timeline
  renderRaceTimeline(race);

  // Update tabs based on race type (single vs multi-pilot)
  updateRaceDetailTabs();

  // Smooth scroll to the details
  setTimeout(() => {
    detailsDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 50);

  switchDetailMode("history");
}

function renderRaceTimeline(race) {
  const container = document.getElementById("raceTimeline");
  if (!container) return;

  // Clear existing events (keep the bar)
  const existingEvents = container.querySelectorAll(".timeline-event");
  existingEvents.forEach((event) => event.remove());

  const lapTimes = race.lapTimes.map((t) => t / 1000); // Convert to seconds
  const totalTime = lapTimes.reduce((sum, t) => sum + t, 0);

  // Create events array with cumulative times
  const events = [];
  let cumulativeTime = 0;

  // Race Start (time 0)
  events.push({
    type: "start",
    label: i18n.t("history.timeline_start"),
    time: 0,
    percentage: 0,
  });

  // Gate 1 and Laps
  lapTimes.forEach((lapTime, index) => {
    cumulativeTime += lapTime;
    const percentage = (cumulativeTime / totalTime) * 100;

    if (index === 0) {
      // Gate 1
      events.push({
        type: "gate",
        label: i18n.t("race.gate1"),
        time: cumulativeTime,
        percentage: percentage,
      });
    } else {
      // Regular laps
      events.push({
        type: "lap",
        label: `Lap ${index}`,
        time: cumulativeTime,
        percentage: percentage,
      });
    }
  });

  // Race Stop (at total time)
  events.push({
    type: "stop",
    label: i18n.t("history.timeline_stop"),
    time: totalTime,
    percentage: 100,
  });

  // Render events on timeline
  events.forEach((event, index) => {
    const eventDiv = document.createElement("div");
    eventDiv.className = "timeline-event";

    // Race Start and Stop go above, everything else below
    if (event.type === "start" || event.type === "stop") {
      eventDiv.classList.add("above");
    } else {
      eventDiv.classList.add("below");
    }

    eventDiv.style.left = `${event.percentage}%`;
    eventDiv.title = `${event.label} - ${event.time.toFixed(2)}` + i18n.t("race.table.seconds_short");

    eventDiv.innerHTML = `
      <div class="timeline-flag ${event.type}"></div>
      <div class="timeline-label">${event.label}</div>
      <div class="timeline-time">${event.time.toFixed(2)}${i18n.t("race.table.seconds_short")}</div>
    `;

    container.appendChild(eventDiv);
  });

  // Add lap time indicators between events
  for (let i = 1; i < events.length; i++) {
    const prevEvent = events[i - 1];
    const currentEvent = events[i];
    const lapTime = currentEvent.time - prevEvent.time;
    const midPoint = (prevEvent.percentage + currentEvent.percentage) / 2;

    // Only show lap time if there's enough space
    if (currentEvent.percentage - prevEvent.percentage > 5) {
      const lapTimeDiv = document.createElement("div");
      lapTimeDiv.className = "timeline-lap-time";
      lapTimeDiv.style.left = `${midPoint}%`;
      lapTimeDiv.textContent = lapTime.toFixed(2) + i18n.t("race.table.seconds_short");
      lapTimeDiv.title = i18n.t("history.timeline_gap", { prev: prevEvent.label, current: currentEvent.label });
      container.appendChild(lapTimeDiv);
    }
  }
}

function closeRaceDetails() {
  stopPlayback(); // Stop any ongoing playback
  document.getElementById("raceDetails").style.display = "none";
  currentDetailRace = null;
}

// Race Playback
let playbackInterval = null;
let playbackTimeouts = [];
let playbackStartTime = 0;
let playbackTotalTime = 0;

function playbackRace() {
  if (!currentDetailRace) return;

  const playBtn = document.getElementById("playbackBtn");
  const stopBtn = document.getElementById("stopPlaybackBtn");
  const enableWebhooks = document.getElementById("playbackWebhooks").checked;
  const playhead = document.getElementById("timelinePlayhead");

  playBtn.style.display = "none";
  stopBtn.style.display = "inline-block";

  const lapTimes = currentDetailRace.lapTimes.map((t) => t / 1000); // Convert to seconds
  playbackTotalTime = lapTimes.reduce((sum, t) => sum + t, 0);
  playbackStartTime = Date.now();

  // Show and start playhead animation
  if (playhead) {
    playhead.classList.add("active");
    playhead.style.left = "0%";
  }

  // Update playhead position smoothly
  playbackInterval = setInterval(() => {
    const elapsed = (Date.now() - playbackStartTime) / 1000; // seconds
    const percentage = Math.min((elapsed / playbackTotalTime) * 100, 100);
    if (playhead) {
      playhead.style.left = `${percentage}%`;
    }
    if (percentage >= 100) {
      clearInterval(playbackInterval);
    }
  }, 50); // Update every 50ms for smooth animation

  let cumulativeTime = 0;

  // Broadcast race start
  if (enableWebhooks) {
    fetch("/timer/playbackStart", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raceData: currentDetailRace }),
    }).catch((err) => console.error("Playback start failed:", err));
  }

  // Schedule each lap event
  lapTimes.forEach((lapTime, index) => {
    cumulativeTime += lapTime;
    const delay = cumulativeTime * 1000; // Convert to milliseconds

    const timeout = setTimeout(() => {
      // Broadcast lap event
      const lapTimeMs = Math.round(lapTime * 1000);

      if (enableWebhooks) {
        fetch("/timer/playbackLap", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            lapTime: lapTimeMs,
            lapNumber: index,
            isGate1: index === 0,
          }),
        }).catch((err) => console.error("Playback lap failed:", err));
      }

      // Highlight the corresponding timeline flag
      highlightTimelineEvent(index);

      console.log(`Playback: ${index === 0 ? "Gate 1" : "Lap " + index} - ${lapTime.toFixed(2)}s`);
    }, delay);

    playbackTimeouts.push(timeout);
  });

  // Schedule race stop
  const totalTime = lapTimes.reduce((sum, t) => sum + t, 0);
  const stopTimeout = setTimeout(() => {
    if (enableWebhooks) {
      fetch("/timer/playbackStop", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }).catch((err) => console.error("Playback stop failed:", err));
    }

    console.log("Playback: Race complete");
    stopPlayback();
  }, totalTime * 1000);

  playbackTimeouts.push(stopTimeout);
}

function stopPlayback() {
  const playBtn = document.getElementById("playbackBtn");
  const stopBtn = document.getElementById("stopPlaybackBtn");
  const playhead = document.getElementById("timelinePlayhead");

  if (playBtn) playBtn.style.display = "inline-block";
  if (stopBtn) stopBtn.style.display = "none";

  // Hide playhead
  if (playhead) {
    playhead.classList.remove("active");
  }

  // Clear playhead animation interval
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }

  // Clear all scheduled timeouts
  playbackTimeouts.forEach((timeout) => clearTimeout(timeout));
  playbackTimeouts = [];

  // Remove timeline highlights
  document.querySelectorAll(".timeline-event").forEach((event) => {
    event.style.transform = event.style.transform.replace(" scale(1.3)", "");
  });
}

function highlightTimelineEvent(index) {
  const events = document.querySelectorAll(".timeline-event");
  // index + 1 to skip the "Race Start" event
  if (events[index + 1]) {
    events[index + 1].style.transform = "translate(-50%, -50%) scale(1.3)";
    setTimeout(() => {
      events[index + 1].style.transform = "translate(-50%, -50%)";
    }, 500);
  }
}

function switchDetailMode(mode) {
  const tabs = document.querySelectorAll("#raceDetails .analysis-tab");
  tabs.forEach((tab) => tab.classList.remove("active"));
  
  // Find active tab
  const tabModes = ['history', 'fastestRound', 'lapTimesChart', 'consistencyChart'];
  const tabIndex = tabModes.indexOf(mode);
  if (tabIndex >= 0 && tabs[tabIndex]) {
    tabs[tabIndex].classList.add("active");
  }

  if (mode === "history") {
    renderDetailHistory();
  } else if (mode === "fastestRound") {
    renderDetailFastestRound();
  } else if (mode === "lapTimesChart") {
    renderHistoryLapTimesChart();
  } else if (mode === "consistencyChart") {
    renderHistoryConsistencyChart();
  }
}

function renderDetailHistory() {
  if (!currentDetailRace) return;
  
  // Check if this is a multi-pilot race
  const isMultiPilot = currentDetailRace.pilots && currentDetailRace.pilots.length > 1;
  
  if (isMultiPilot) {
    renderMultiPilotDetailHistory();
    return;
  }

  const lapTimes = currentDetailRace.lapTimes.map((t) => t / 1000);
  const displayLaps = lapTimes.slice(-10);
  const maxTime = Math.max(...displayLaps);

  // Get track distance if available
  const trackDistance = currentDetailRace.totalDistance || 0;
  const hasTrackData = trackDistance > 0 && currentDetailRace.lapTimes.length > 0;
  const perLapDistance = hasTrackData ? trackDistance / currentDetailRace.lapTimes.length : 0;

  // Calculate total race time
  const totalTime = lapTimes.reduce((sum, t) => sum + t, 0);

  let html = '<div class="analysis-bars">';
  displayLaps.forEach((time, index) => {
    const actualIndex = lapTimes.length - displayLaps.length + index;
    let label;

    // First entry is Gate 1 (start), not a lap
    if (actualIndex === 0) {
      label = i18n.t("race.gate1");
    } else {
      label = i18n.t("race.lap_counter", { n: actualIndex });
    }

    // Add distance info if available: "Lap x - y/z m"
    if (hasTrackData && actualIndex > 0) {
      label = `${time.toFixed(2)}${i18n.t("race.table.seconds_short")}\n${label} - ${perLapDistance.toFixed(0)}m`;
    } else if (hasTrackData && actualIndex === 0) {
      label = `${time.toFixed(2)}${i18n.t("race.table.seconds_short")}\n${i18n.t("history.gate1_start")}`;
    } else if (actualIndex === 0) {
      label = i18n.t("race.gate1");
    }

    const displayTime = hasTrackData ? "" : `${time.toFixed(2)}${i18n.t("race.table.seconds_short")}`; // Don't show time in bar if it's in label
    html += createBarItemWithColor(label, time, maxTime, displayTime, index);
  });
  html += "</div>";
  html += `<p style="text-align: center; margin-top: 16px; font-weight: bold; color: var(--primary-color);">${i18n.t("history.total_race_time", { n: totalTime.toFixed(2) })}</p>`;

  document.getElementById("detailContent").innerHTML = html;
}

// Update tabs for multi-pilot race details
function updateRaceDetailTabs() {
  const tabsContainer = document.querySelector("#raceDetails .analysis-tabs");
  if (!tabsContainer) return;
  
  const isMultiPilot = currentDetailRace && currentDetailRace.pilots && currentDetailRace.pilots.length > 1;
  
  if (isMultiPilot) {
    tabsContainer.innerHTML = `
      <button class="analysis-tab active" onclick="switchDetailMode('history')">Lap Table</button>
      <button class="analysis-tab" onclick="switchDetailMode('lapTimesChart')">Lap Times</button>
      <button class="analysis-tab" onclick="switchDetailMode('consistencyChart')">Consistency</button>
    `;
  } else {
    tabsContainer.innerHTML = `
      <button class="analysis-tab active" onclick="switchDetailMode('history')" data-i18n="analysis.tab_history">Lap History</button>
      <button class="analysis-tab" onclick="switchDetailMode('fastestRound')" data-i18n="analysis.tab_fastest">Fastest Round (3 Laps)</button>
    `;
    i18n.translatePage();
  }
}

// Render Lap Times chart for race history (multi-pilot)
function renderHistoryLapTimesChart() {
  if (!currentDetailRace || !currentDetailRace.pilots) return;
  
  const container = document.getElementById("detailContent");
  if (!container) return;
  
  // Convert pilots data for chart rendering
  const pilots = currentDetailRace.pilots.map((pilot, idx) => ({
    name: pilot.name || pilot.callsign || 'Unknown',
    color: '#' + (pilot.color || 0x0080FF).toString(16).padStart(6, '0'),
    lapTimes: (pilot.lapTimes || []).map(t => t / 1000), // Convert ms to seconds
    isLocal: pilot.isLocal || false
  }));
  
  // Find max laps and time range
  let maxLaps = 0;
  let minTime = Infinity;
  let maxTime = 0;
  
  pilots.forEach(pilot => {
    const validLaps = pilot.lapTimes.slice(1); // Skip gate 1
    if (validLaps.length > maxLaps) maxLaps = validLaps.length;
    validLaps.forEach(t => {
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    });
  });
  
  if (maxLaps < 1) {
    container.innerHTML = '<p class="no-data">Not enough laps to display chart</p>';
    return;
  }
  
  // Chart dimensions
  const width = 800;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Add padding to time range
  const timeRange = maxTime - minTime || 1;
  minTime = Math.max(0, minTime - timeRange * 0.1);
  maxTime = maxTime + timeRange * 0.1;
  
  // Build SVG
  let svg = `<svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: ${width}px; height: auto;">`;
  
  // Grid lines
  svg += '<g class="grid" stroke="var(--border-color)" stroke-opacity="0.3">';
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight / 5) * i;
    svg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
  }
  for (let i = 0; i <= maxLaps; i++) {
    const x = padding.left + (chartWidth / maxLaps) * i;
    svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" />`;
  }
  svg += '</g>';
  
  // Y-axis labels (time)
  svg += '<g class="y-axis" fill="var(--text-color)" font-size="11">';
  for (let i = 0; i <= 5; i++) {
    const y = padding.top + (chartHeight / 5) * i;
    const time = maxTime - ((maxTime - minTime) / 5) * i;
    svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${time.toFixed(1)}s</text>`;
  }
  svg += '</g>';
  
  // X-axis labels (laps)
  svg += '<g class="x-axis" fill="var(--text-color)" font-size="11">';
  for (let i = 1; i <= maxLaps; i++) {
    const x = padding.left + (chartWidth / maxLaps) * (i - 0.5);
    svg += `<text x="${x}" y="${height - padding.bottom + 20}" text-anchor="middle">L${i}</text>`;
  }
  svg += `<text x="${width / 2}" y="${height - 5}" text-anchor="middle" font-size="12" fill="var(--secondary-color)">Lap</text>`;
  svg += '</g>';
  
  // Draw lines and points for each pilot
  pilots.forEach((pilot, pilotIdx) => {
    const validLaps = pilot.lapTimes.slice(1); // Skip gate 1
    if (validLaps.length < 1) return;
    
    // Build path points
    const points = [];
    validLaps.forEach((time, lapIdx) => {
      const x = padding.left + (chartWidth / maxLaps) * (lapIdx + 0.5);
      const y = padding.top + chartHeight - ((time - minTime) / (maxTime - minTime)) * chartHeight;
      points.push({ x, y, time });
    });
    
    // Draw smooth curve
    if (points.length > 1) {
      let pathD = `M ${points[0].x} ${points[0].y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        
        pathD += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
      }
      svg += `<path d="${pathD}" fill="none" stroke="${pilot.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />`;
    }
    
    // Draw points
    points.forEach(p => {
      svg += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${pilot.color}" stroke="white" stroke-width="1.5" />`;
    });
  });
  
  svg += '</svg>';
  
  // Add legend
  let legend = '<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 16px;">';
  pilots.forEach(pilot => {
    const validLaps = pilot.lapTimes.slice(1);
    const lapCount = validLaps.length;
    const fastest = lapCount > 0 ? Math.min(...validLaps).toFixed(2) : '--';
    legend += `
      <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; background-color: var(--bg-secondary); border-radius: 4px; border-left: 4px solid ${pilot.color};">
        <span style="font-weight: bold;">${pilot.name}${pilot.isLocal ? ' *' : ''}</span>
        <span style="color: var(--secondary-color); font-size: 12px;">${lapCount} laps, best: ${fastest}s</span>
      </div>
    `;
  });
  legend += '</div>';
  
  container.innerHTML = svg + legend;
}

// Render Consistency chart for race history (multi-pilot)
function renderHistoryConsistencyChart() {
  if (!currentDetailRace || !currentDetailRace.pilots) return;
  
  const container = document.getElementById("detailContent");
  if (!container) return;
  
  // Convert pilots data
  const pilots = currentDetailRace.pilots.map((pilot, idx) => ({
    name: pilot.name || pilot.callsign || 'Unknown',
    color: '#' + (pilot.color || 0x0080FF).toString(16).padStart(6, '0'),
    lapTimes: (pilot.lapTimes || []).map(t => t / 1000),
    isLocal: pilot.isLocal || false
  }));
  
  // Calculate box plot statistics for each pilot
  const pilotStats = pilots.map(pilot => {
    const validLaps = pilot.lapTimes.slice(1).filter(t => t > 0);
    if (validLaps.length < 2) return null;
    
    const sorted = [...validLaps].sort((a, b) => a - b);
    const n = sorted.length;
    const q1Idx = Math.floor(n * 0.25);
    const q3Idx = Math.floor(n * 0.75);
    
    const min = sorted[0];
    const max = sorted[n - 1];
    const q1 = sorted[q1Idx];
    const q3 = sorted[q3Idx];
    const median = n % 2 === 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
    const iqr = q3 - q1;
    const whiskerMin = Math.max(min, q1 - 1.5 * iqr);
    const whiskerMax = Math.min(max, q3 + 1.5 * iqr);
    const outliers = validLaps.filter(t => t < whiskerMin || t > whiskerMax);
    
    return {
      name: pilot.name,
      color: pilot.color,
      isLocal: pilot.isLocal,
      min, max, q1, q3, median, whiskerMin, whiskerMax, outliers,
      allLaps: validLaps
    };
  }).filter(s => s !== null);
  
  if (pilotStats.length === 0) {
    container.innerHTML = '<p class="no-data">Complete at least 2 laps to see consistency chart</p>';
    return;
  }
  
  // Find time range across all pilots
  let globalMin = Infinity;
  let globalMax = 0;
  pilotStats.forEach(s => {
    if (s.min < globalMin) globalMin = s.min;
    if (s.max > globalMax) globalMax = s.max;
  });
  
  const timeRange = globalMax - globalMin || 1;
  globalMin = Math.max(0, globalMin - timeRange * 0.1);
  globalMax = globalMax + timeRange * 0.1;
  
  // Chart dimensions
  const width = 800;
  const rowHeight = 50;
  const height = pilotStats.length * rowHeight + 80;
  const padding = { top: 20, right: 30, bottom: 50, left: 100 };
  const chartWidth = width - padding.left - padding.right;
  
  // Build SVG
  let svg = `<svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: ${width}px; height: auto;">`;
  
  // Grid lines (vertical)
  svg += '<g class="grid" stroke="var(--border-color)" stroke-opacity="0.3">';
  for (let i = 0; i <= 10; i++) {
    const x = padding.left + (chartWidth / 10) * i;
    svg += `<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${height - padding.bottom}" />`;
  }
  svg += '</g>';
  
  // X-axis labels (time)
  svg += '<g class="x-axis" fill="var(--text-color)" font-size="11">';
  for (let i = 0; i <= 10; i++) {
    const x = padding.left + (chartWidth / 10) * i;
    const time = globalMin + ((globalMax - globalMin) / 10) * i;
    svg += `<text x="${x}" y="${height - padding.bottom + 20}" text-anchor="middle">${time.toFixed(1)}</text>`;
  }
  svg += `<text x="${width / 2}" y="${height - 10}" text-anchor="middle" font-size="12" fill="var(--secondary-color)">Lap Time (s)</text>`;
  svg += '</g>';
  
  // Draw box plots for each pilot
  pilotStats.forEach((stats, idx) => {
    const y = padding.top + idx * rowHeight + rowHeight / 2;
    const boxHeight = rowHeight * 0.6;
    
    const timeToX = (t) => padding.left + ((t - globalMin) / (globalMax - globalMin)) * chartWidth;
    
    // Pilot name label
    svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="${stats.color}" font-weight="bold">${stats.name}</text>`;
    
    const whiskerMinX = timeToX(stats.whiskerMin);
    const whiskerMaxX = timeToX(stats.whiskerMax);
    const q1X = timeToX(stats.q1);
    const q3X = timeToX(stats.q3);
    const medianX = timeToX(stats.median);
    
    // Left whisker
    svg += `<line x1="${whiskerMinX}" y1="${y}" x2="${q1X}" y2="${y}" stroke="${stats.color}" stroke-width="1.5" />`;
    svg += `<line x1="${whiskerMinX}" y1="${y - boxHeight/4}" x2="${whiskerMinX}" y2="${y + boxHeight/4}" stroke="${stats.color}" stroke-width="1.5" />`;
    
    // Right whisker
    svg += `<line x1="${q3X}" y1="${y}" x2="${whiskerMaxX}" y2="${y}" stroke="${stats.color}" stroke-width="1.5" />`;
    svg += `<line x1="${whiskerMaxX}" y1="${y - boxHeight/4}" x2="${whiskerMaxX}" y2="${y + boxHeight/4}" stroke="${stats.color}" stroke-width="1.5" />`;
    
    // Box (Q1 to Q3)
    svg += `<rect x="${q1X}" y="${y - boxHeight/2}" width="${q3X - q1X}" height="${boxHeight}" fill="${stats.color}" fill-opacity="0.3" stroke="${stats.color}" stroke-width="1.5" rx="2" />`;
    
    // Median line
    svg += `<line x1="${medianX}" y1="${y - boxHeight/2}" x2="${medianX}" y2="${y + boxHeight/2}" stroke="${stats.color}" stroke-width="2" />`;
    
    // Fastest lap marker (red circle)
    const fastestX = timeToX(stats.min);
    svg += `<circle cx="${fastestX}" cy="${y}" r="6" fill="#FF0000" stroke="white" stroke-width="1.5" />`;
    
    // Individual lap points (small circles)
    stats.allLaps.forEach(t => {
      const x = timeToX(t);
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="${stats.color}" stroke-opacity="0.5" />`;
    });
    
    // Outliers (hollow circles)
    stats.outliers.forEach(t => {
      const x = timeToX(t);
      svg += `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="${stats.color}" stroke-width="1.5" />`;
    });
  });
  
  svg += '</svg>';
  
  // Add legend with stats
  let legend = '<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 16px;">';
  pilotStats.forEach(stats => {
    const lapCount = stats.allLaps.length;
    legend += `
      <div style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; background-color: var(--bg-secondary); border-radius: 4px; border-left: 4px solid ${stats.color};">
        <span style="font-weight: bold;">${stats.name}${stats.isLocal ? ' *' : ''}</span>
        <span style="color: var(--secondary-color); font-size: 12px;">Med: ${stats.median.toFixed(2)}s, Range: ${(stats.max - stats.min).toFixed(2)}s</span>
      </div>
    `;
  });
  legend += '</div>';
  
  container.innerHTML = svg + legend;
}

// Render multi-pilot race history with side-by-side lap table
function renderMultiPilotDetailHistory() {
  if (!currentDetailRace || !currentDetailRace.pilots) return;
  
  const pilots = currentDetailRace.pilots;
  
  // Find max laps across all pilots
  let maxLapCount = 0;
  for (const pilot of pilots) {
    const lapCount = pilot.lapTimes ? pilot.lapTimes.length : 0;
    if (lapCount > maxLapCount) maxLapCount = lapCount;
  }
  
  // Find fastest lap for each pilot (excluding gate 1)
  const fastestLaps = {};
  for (let pIdx = 0; pIdx < pilots.length; pIdx++) {
    const pilot = pilots[pIdx];
    let fastest = Infinity;
    let fastestIdx = -1;
    const laps = pilot.lapTimes || [];
    for (let i = 1; i < laps.length; i++) {
      if (laps[i] < fastest) {
        fastest = laps[i];
        fastestIdx = i;
      }
    }
    fastestLaps[pIdx] = fastestIdx;
  }
  
  // Build header row
  let html = '<div style="overflow-x: auto;"><table class="unified-lap-table" style="width: 100%;">';
  html += '<thead><tr><th>' + (i18n.t("race.table.lap_no") || "Lap") + '</th>';
  for (const pilot of pilots) {
    const colorHex = '#' + (pilot.color || 0x0080FF).toString(16).padStart(6, '0');
    const localBadge = pilot.isLocal ? ' *' : '';
    html += `<th style="background-color: ${colorHex}; color: white;">${pilot.name || pilot.callsign || 'Unknown'}${localBadge}</th>`;
  }
  html += '</tr></thead><tbody>';
  
  // Build body rows
  for (let lapIdx = 0; lapIdx < maxLapCount; lapIdx++) {
    const lapLabel = lapIdx === 0 ? 'G1' : lapIdx;
    html += `<tr><td style="font-weight: bold;">${lapLabel}</td>`;
    
    for (let pIdx = 0; pIdx < pilots.length; pIdx++) {
      const pilot = pilots[pIdx];
      const laps = pilot.lapTimes || [];
      const isFastest = fastestLaps[pIdx] === lapIdx && lapIdx > 0;
      
      if (lapIdx < laps.length) {
        const lapTime = (laps[lapIdx] / 1000).toFixed(2);
        const style = isFastest ? 'background-color: rgba(243, 156, 18, 0.3); font-weight: bold;' : '';
        html += `<td style="${style}">${lapTime}s</td>`;
      } else {
        html += '<td style="color: var(--secondary-color);">-</td>';
      }
    }
    html += '</tr>';
  }
  
  html += '</tbody></table></div>';
  
  // Add pilot stats summary
  html += '<div style="display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; justify-content: center;">';
  for (const pilot of pilots) {
    const colorHex = '#' + (pilot.color || 0x0080FF).toString(16).padStart(6, '0');
    const fastest = pilot.fastestLap ? (pilot.fastestLap / 1000).toFixed(2) : '-';
    const totalTime = pilot.lapTimes ? (pilot.lapTimes.reduce((a, b) => a + b, 0) / 1000).toFixed(2) : '-';
    html += `
      <div style="padding: 12px; background-color: var(--bg-secondary); border-radius: 8px; border-left: 4px solid ${colorHex}; min-width: 150px;">
        <div style="font-weight: bold; margin-bottom: 8px;">${pilot.name || 'Unknown'}${pilot.isLocal ? ' *' : ''}</div>
        <div style="font-size: 13px; color: var(--secondary-color);">Fastest: <strong style="color: var(--primary-color);">${fastest}s</strong></div>
        <div style="font-size: 13px; color: var(--secondary-color);">Total: <strong>${totalTime}s</strong></div>
      </div>
    `;
  }
  html += '</div>';
  
  document.getElementById("detailContent").innerHTML = html;
}

function renderDetailFastestRound() {
  if (!currentDetailRace) return;

  // Skip Gate 1 (index 0) - only use actual racing laps
  const allLapTimes = currentDetailRace.lapTimes.map((t) => t / 1000);
  const lapTimes = allLapTimes.slice(1); // Skip Gate 1

  if (lapTimes.length < 3) {
    document.getElementById("detailContent").innerHTML = `<p class="no-data">${i18n.t("analysis.not_enough_laps")}</p>`;
    return;
  }

  let bestTime = Infinity;
  let bestStartIndex = 0;

  for (let i = 0; i <= lapTimes.length - 3; i++) {
    const sum = lapTimes[i] + lapTimes[i + 1] + lapTimes[i + 2];
    if (sum < bestTime) {
      bestTime = sum;
      bestStartIndex = i;
    }
  }

  const lap1 = lapTimes[bestStartIndex];
  const lap2 = lapTimes[bestStartIndex + 1];
  const lap3 = lapTimes[bestStartIndex + 2];
  const maxTime = Math.max(lap1, lap2, lap3);

  let html = '<div class="analysis-bars">';
  // bestStartIndex is in lapTimes array (without Gate 1), so add 1 for actual lap number
  html += createBarItemWithColor(i18n.t("race.lap_counter", { n: bestStartIndex + 1 }), lap1, maxTime, `${lap1.toFixed(2)}${i18n.t("race.table.seconds_short")}`, 0);
  html += createBarItemWithColor(i18n.t("race.lap_counter", { n: bestStartIndex + 2 }), lap2, maxTime, `${lap2.toFixed(2)}${i18n.t("race.table.seconds_short")}`, 1);
  html += createBarItemWithColor(i18n.t("race.lap_counter", { n: bestStartIndex + 3 }), lap3, maxTime, `${lap3.toFixed(2)}${i18n.t("race.table.seconds_short")}`, 2);
  html += "</div>";
  html += `<p style="text-align: center; margin-top: 16px; font-weight: bold; color: var(--primary-color);">${i18n.t("analysis.total", { n: bestTime.toFixed(2) })}</p>`;

  document.getElementById("detailContent").innerHTML = html;
}

function downloadRaces() {
  window.open("/races/download", "_blank");
}

function downloadSingleRace(timestamp) {
  window.open("/races/downloadOne?timestamp=" + timestamp, "_blank");
}

let editingRaceIndex = null;

function openEditModal(index) {
  editingRaceIndex = index;
  const race = raceHistoryData[index];

  document.getElementById("raceName").value = race.name || "";
  document.getElementById("raceTag").value = race.tag || "";
  document.getElementById("raceDistance").value = race.totalDistance || 0;
  document.getElementById("raceEditNotes").value = race.notes || "";

  // Populate lap times for marshalling mode
  renderEditLapsList(race.lapTimes);

  document.getElementById("editRaceModal").style.display = "flex";
}

function renderEditLapsList(lapTimes) {
  const container = document.getElementById("editLapsList");
  let html = "";

  lapTimes.forEach((lapTime, index) => {
    const lapSeconds = (lapTime / 1000).toFixed(3);
    const lapLabel = index === 0 ? i18n.t("race.gate1") : i18n.t("race.lap_counter", { n: index });
    html += `
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background-color: var(--bg-secondary); border-radius: 4px;">
        <span style="min-width: 60px; font-weight: ${index === 0 ? "bold" : "normal"}; color: ${index === 0 ? "var(--accent-color)" : "var(--primary-color)"}">${lapLabel}</span>
        <input type="number" step="0.001" min="0" value="${lapSeconds}" 
               data-lap-index="${index}" 
               style="flex: 1; padding: 6px; background-color: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--primary-color);" 
               title="Edit lap time in seconds" />
        <span style="min-width: 20px;">s</span>
        <button onclick="deleteLapFromEdit(${index})" 
                style="padding: 4px 10px; background-color: var(--danger-color); border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 18px; line-height: 1;" 
                title="Delete this lap">&times;</button>
      </div>
    `;
  });

  container.innerHTML = html;
}

function deleteLapFromEdit(index) {
  if (editingRaceIndex === null) return;
  const race = raceHistoryData[editingRaceIndex];

  if (race.lapTimes.length <= 1) {
    alert(i18n.t("history.edit_lap_last_error"));
    return;
  }

  if (confirm(i18n.t("history.edit_lap_delete_confirm"))) {
    race.lapTimes.splice(index, 1);
    renderEditLapsList(race.lapTimes);
  }
}

function addNewLapToEdit() {
  if (editingRaceIndex === null) return;
  const race = raceHistoryData[editingRaceIndex];

  // Add a new lap with a default value (average of existing laps)
  let defaultValue = 0;
  if (race.lapTimes.length > 0) {
    const sum = race.lapTimes.reduce((a, b) => a + b, 0);
    defaultValue = Math.round(sum / race.lapTimes.length);
  } else {
    defaultValue = 10000; // 10 seconds default
  }

  race.lapTimes.push(defaultValue);
  renderEditLapsList(race.lapTimes);

  // Scroll to bottom to show the new lap
  const container = document.getElementById("editLapsList");
  container.scrollTop = container.scrollHeight;
}

function closeEditModal() {
  document.getElementById("editRaceModal").style.display = "none";
  editingRaceIndex = null;
}

function closeEditModalOnBackdrop(event) {
  // Only close if clicking the backdrop (not the modal content)
  if (event.target.id === "editRaceModal") {
    closeEditModal();
  }
}

function saveRaceEdit() {
  if (editingRaceIndex === null) return;

  const race = raceHistoryData[editingRaceIndex];
  const name = document.getElementById("raceName").value;
  const tag = document.getElementById("raceTag").value;
  const distance = parseFloat(document.getElementById("raceDistance").value) || 0;
  const notes = document.getElementById("raceEditNotes").value.trim();

  // Collect updated lap times from inputs
  const lapInputs = document.querySelectorAll('#editLapsList input[type="number"]');
  const updatedLapTimes = [];
  let hasError = false;

  lapInputs.forEach((input) => {
    const value = parseFloat(input.value);
    if (isNaN(value) || value <= 0) {
      hasError = true;
      input.style.borderColor = "#e74c3c";
    } else {
      input.style.borderColor = "";
      // Convert seconds to milliseconds
      updatedLapTimes.push(Math.round(value * 1000));
    }
  });

  if (hasError) {
    alert(i18n.t("messages.race_edit_invalid_laps"));
    return;
  }

  if (updatedLapTimes.length === 0) {
    alert(i18n.t("messages.race_edit_no_laps"));
    return;
  }

  // First update metadata (name/tag/distance)
  const formData = new URLSearchParams();
  formData.append("timestamp", race.timestamp);
  formData.append("name", name);
  formData.append("tag", tag);
  formData.append("totalDistance", distance);
  formData.append("notes", notes);

  fetch("/races/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("Race metadata updated:", data);

      // Then update lap times if they changed
      return fetch("/races/updateLaps", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timestamp: race.timestamp,
          lapTimes: updatedLapTimes,
        }),
      });
    })
    .then((response) => response.json())
    .then((data) => {
      console.log("Race laps updated:", data);
      loadRaceHistory();
      closeEditModal();
    })
    .catch((error) => {
      console.error("Error updating race:", error);
      alert(i18n.t("messages.race_update_error"));
    });
}

function importRaces(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const json = JSON.parse(e.target.result);

      fetch("/races/upload", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(json),
      })
        .then((response) => response.json())
        .then((data) => {
          console.log("Races imported:", data);
          loadRaceHistory();
          alert(i18n.t("messages.race_import_success"));
        })
        .catch((error) => {
          console.error("Error importing races:", error);
          alert(i18n.t("messages.race_import_error"));
        });
    } catch (error) {
      console.error("Error parsing JSON:", error);
      alert(i18n.t("messages.race_invalid_json"));
    }
  };
  reader.readAsText(file);
  input.value = ""; // Reset file input
}

function deleteRace(timestamp) {
  if (!confirm(i18n.t("history.delete_confirm"))) return;

  const formData = new URLSearchParams();
  formData.append("timestamp", timestamp);

  fetch("/races/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("Race deleted:", data);
      loadRaceHistory();
      if (currentDetailRace && currentDetailRace.timestamp === timestamp) {
        closeRaceDetails();
      }
    })
    .catch((error) => console.error("Error deleting race:", error));
}

function clearAllRaces() {
  if (!confirm(i18n.t("messages.confirm_clear_history"))) return;

  fetch("/races/clear", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("All races cleared:", data);
      loadRaceHistory();
      closeRaceDetails();
    })
    .catch((error) => console.error("Error clearing races:", error));
}

// OSD Overlay Functions
function openHorizontalOSD() {
  const osdUrl = window.location.origin + "/osd.html";
  window.open(osdUrl, "_blank");
}

function openVerticalOSD() {
  const osdUrl = window.location.origin + "/vert-osd.html";
  window.open(osdUrl, "_blank");
}

function copyHorizontalOSDUrl() {
  const osdUrl = window.location.origin + "/osd.html";
  copyOSDUrl(osdUrl, event.target);
}

function copyVerticalOSDUrl() {
  const osdUrl = window.location.origin + "/vert-osd.html";
  copyOSDUrl(osdUrl, event.target);
}

function openHandcamOverlay() {
  const osdUrl = window.location.origin + "/handcamOverlay";
  window.open(osdUrl, "_blank");
}

function copyHandcamOverlayUrl() {
  const osdUrl = window.location.origin + "/handcamOverlay";
  copyOSDUrl(osdUrl, event.target);
}

function copyOSDUrl(url, button) {
  navigator.clipboard
    .writeText(url)
    .then(() => {
      const originalText = button.textContent;
      button.textContent = i18n.t("messages.url_copied");
      button.style.backgroundColor = "#27ae60";

      setTimeout(() => {
        button.textContent = originalText;
        button.style.backgroundColor = "";
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy URL:", err);
      alert(i18n.t("messages.osd_opened_copy_fail", { url: url }));
    });
}

// Legacy function for backwards compatibility
function openOSD() {
  openHorizontalOSD();
  copyHorizontalOSDUrl();
}

// Config Download/Import Functions
function downloadConfig() {
  fetch("/config")
    .then((response) => response.json())
    .then((config) => {
      // Add all client-side settings
      const fullConfig = {
        ...config,
        // Theme
        theme: localStorage.getItem("theme") || "oceanic",
        // Audio settings
        audioEnabled: audioEnabled,
        lapFormat: document.getElementById("lapFormatSelect")?.value || lapFormat || "full",
        selectedVoice: normalizeVoiceSelectionValue(document.getElementById("voiceSelect")?.value || selectedVoice || "default"),
        ttsEngine: localStorage.getItem("ttsEngine") || "webspeech",
        // Pilot frontend settings
        pilotCallsign: localStorage.getItem("pilotCallsign") || "",
        pilotPhonetic: localStorage.getItem("pilotPhonetic") || "",
        pilotColor: localStorage.getItem("pilotColor") || "#0080FF",
        // LED settings (get from current UI state)
        ledPreset: parseInt(document.getElementById("ledPreset")?.value || 2),
        ledSolidColor: document.getElementById("ledSolidColor")?.value || "#FF00FF",
        ledFadeColor: document.getElementById("ledFadeColor")?.value || "#0080FF",
        ledStrobeColor: document.getElementById("ledStrobeColor")?.value || "#FFFFFF",
        ledSpeed: parseInt(document.getElementById("ledSpeed")?.value || 5),
        ledManualOverride: document.getElementById("ledManualOverride")?.checked || false,
        // Battery monitoring
        batteryMonitoring: document.getElementById("batteryMonitorToggle")?.checked !== false,
        timestamp: new Date().toISOString(),
      };

      const dataStr = JSON.stringify(fullConfig, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `fpvgate-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })
    .catch((error) => {
      console.error("Error downloading config:", error);
      alert(i18n.t("messages.config_download_error"));
    });
}

function importConfig(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const config = JSON.parse(e.target.result);

      // Apply backend config
      fetch("/config", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          freq: config.freq,
          minLap: config.minLap,
          alarm: config.alarm,
          anType: config.anType,
          anRate: config.anRate,
          enterRssi: config.enterRssi,
          exitRssi: config.exitRssi,
          maxLaps: config.maxLaps,
          name: config.name || "",
          ssid: config.ssid || "",
          pwd: config.pwd || "",
          // LED settings
          ledMode: config.ledMode,
          ledBrightness: config.ledBrightness,
          ledColor: config.ledColor,
          ledPreset: config.ledPreset,
          ledSpeed: config.ledSpeed,
          ledFadeColor: config.ledFadeColor,
          ledStrobeColor: config.ledStrobeColor,
          ledManualOverride: config.ledManualOverride,
          // Track settings
          tracksEnabled: config.tracksEnabled,
          selectedTrackId: config.selectedTrackId,
          // Webhook settings
          webhooksEnabled: config.webhooksEnabled,
          webhookCount: config.webhookCount,
          webhookIPs: config.webhookIPs,
          gateLEDsEnabled: config.gateLEDsEnabled,
          webhookRaceStart: config.webhookRaceStart,
          webhookRaceStop: config.webhookRaceStop,
          webhookLap: config.webhookLap,
          // Operation mode
          opMode: config.opMode,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          console.log("Config imported:", data);

          // Apply all client-side settings
          // Theme
          if (config.theme) {
            localStorage.setItem("theme", config.theme);
          }
          // Audio settings
          if (config.lapFormat) {
            localStorage.setItem("lapFormat", config.lapFormat);
          }
          if (config.selectedVoice) {
            localStorage.setItem("selectedVoice", normalizeVoiceSelectionValue(config.selectedVoice));
          }
          if (config.ttsEngine) {
            localStorage.setItem("ttsEngine", config.ttsEngine);
          }
          // Pilot frontend settings
          if (config.pilotCallsign !== undefined) {
            localStorage.setItem("pilotCallsign", config.pilotCallsign);
          }
          if (config.pilotPhonetic !== undefined) {
            localStorage.setItem("pilotPhonetic", config.pilotPhonetic);
          }
          if (config.pilotColor) {
            localStorage.setItem("pilotColor", config.pilotColor);
          }
          // LED settings
          if (config.ledPreset !== undefined) {
            const ledPresetSelect = document.getElementById("ledPreset");
            if (ledPresetSelect) ledPresetSelect.value = config.ledPreset;
          }
          if (config.ledSolidColor) {
            const ledSolidColor = document.getElementById("ledSolidColor");
            if (ledSolidColor) ledSolidColor.value = config.ledSolidColor;
          }
          if (config.ledFadeColor) {
            const ledFadeColor = document.getElementById("ledFadeColor");
            if (ledFadeColor) ledFadeColor.value = config.ledFadeColor;
          }
          if (config.ledStrobeColor) {
            const ledStrobeColor = document.getElementById("ledStrobeColor");
            if (ledStrobeColor) ledStrobeColor.value = config.ledStrobeColor;
          }
          if (config.ledSpeed !== undefined) {
            const ledSpeed = document.getElementById("ledSpeed");
            if (ledSpeed) ledSpeed.value = config.ledSpeed;
          }
          if (config.ledManualOverride !== undefined) {
            const ledManualOverride = document.getElementById("ledManualOverride");
            if (ledManualOverride) ledManualOverride.checked = config.ledManualOverride;
          }
          // Battery monitoring
          if (config.batteryMonitoring !== undefined) {
            const batteryToggle = document.getElementById("batteryMonitorToggle");
            if (batteryToggle) batteryToggle.checked = config.batteryMonitoring;
          }

          alert(i18n.t("messages.config_imported"));
          // Reload config to update UI
          setTimeout(() => location.reload(), 500);
        })
        .catch((error) => {
          console.error("Error importing config:", error);
          alert(i18n.t("messages.config_import_error"));
        });
    } catch (error) {
      console.error("Error parsing config JSON:", error);
      alert(i18n.t("messages.config_invalid"));
    }
  };
  reader.readAsText(file);
  input.value = ""; // Reset file input
}

// Calibration Wizard
let wizardState = {
  phase: "idle", // idle | ambient | recording | processing | results
  data: [],
  ambientEnd: 0,   // index where ambient phase ends
  peaks: [],       // auto-detected peak indices
  allPeaks: [],    // original unfiltered peaks (preserved for ignore recalc)
  ignoredRegions: [], // [{startIdx, endIdx}]
  calculatedEnter: 0,
  calculatedExit: 0,
  calculatedMinLap: 0,
  noiseCeiling: 0,
  avgPeak: 0,
};

function startCalibrationWizard() {
  wizardState = {
    phase: "idle", data: [], ambientEnd: 0, peaks: [], allPeaks: [],
    ignoredRegions: [],
    calculatedEnter: 0, calculatedExit: 0, calculatedMinLap: 0,
    noiseCeiling: 0, avgPeak: 0,
  };

  // Show modal with ambient countdown
  document.getElementById("calibrationWizardModal").style.display = "flex";
  document.getElementById("wizardAmbient").style.display = "block";
  document.getElementById("wizardRecording").style.display = "none";
  document.getElementById("wizardResults").style.display = "none";

  // Start device recording
  fetch("/calibration/start", { method: "POST" })
    .then((r) => r.json())
    .then(() => {
      wizardState.phase = "ambient";
      runAmbientCountdown(5);
    })
    .catch((error) => {
      console.error("Error starting calibration wizard:", error);
      alert(i18n.t("messages.calib_wizard_error"));
      closeCalibrationWizard();
    });
}

function runAmbientCountdown(seconds) {
  const el = document.getElementById("ambientCountdown");
  if (!el) return;
  if (seconds <= 0) {
    // Ambient phase done - mark the boundary, switch to flight recording
    fetch("/calibration/data")
      .then((r) => r.json())
      .then((data) => {
        wizardState.ambientEnd = data.count;
        console.log("[Wizard] Ambient phase captured", wizardState.ambientEnd, "samples");
        wizardState.phase = "recording";
        document.getElementById("wizardAmbient").style.display = "none";
        document.getElementById("wizardRecording").style.display = "block";
        wizardRecordingLoop();
      })
      .catch(() => {
        wizardState.ambientEnd = 250; // ~5s at 50Hz fallback
        wizardState.phase = "recording";
        document.getElementById("wizardAmbient").style.display = "none";
        document.getElementById("wizardRecording").style.display = "block";
        wizardRecordingLoop();
      });
    return;
  }
  el.textContent = seconds;
  setTimeout(() => runAmbientCountdown(seconds - 1), 1000);
}

function wizardRecordingLoop() {
  if (wizardState.phase !== "recording") return;
  fetch("/calibration/data")
    .then((r) => r.json())
    .then((data) => {
      var flightSamples = Math.max(0, data.count - wizardState.ambientEnd);
      document.getElementById("wizardSampleCount").textContent =
        i18n.t("calib.wizard_samples", { n: flightSamples });
      if (wizardState.phase === "recording") {
        setTimeout(wizardRecordingLoop, 200);
      }
    })
    .catch((err) => console.error("Error fetching calibration data:", err));
}

function stopCalibrationWizard() {
  wizardState.phase = "processing";
  fetch("/calibration/stop", { method: "POST" })
    .then((r) => r.json())
    .then(() => fetch("/calibration/data"))
    .then((r) => r.json())
    .then((data) => {
      wizardState.data = data.data;
      if (wizardState.data.length < 50) {
        alert(i18n.t("messages.calib_not_enough_data"));
        closeCalibrationWizard();
        return;
      }
      autoDetectAndShow();
    })
    .catch((error) => {
      console.error("Error stopping calibration wizard:", error);
      alert(i18n.t("messages.calib_process_error"));
      closeCalibrationWizard();
    });
}

// Auto-detect peaks and calculate thresholds
function autoDetectAndShow() {
  var allData = wizardState.data;
  var ambientEnd = Math.min(wizardState.ambientEnd, allData.length);

  // Compute noise ceiling from ambient phase
  var ambientValues = allData.slice(0, ambientEnd).map((d) => d.rssi);
  if (ambientValues.length < 10) ambientValues = allData.slice(0, 50).map((d) => d.rssi);
  ambientValues.sort((a, b) => a - b);
  var noiseCeiling = ambientValues[Math.floor(ambientValues.length * 0.95)];
  wizardState.noiseCeiling = noiseCeiling;

  // Detect peaks in flight phase: local maxima above noiseCeiling+margin with 2s min separation
  var flightData = allData.slice(ambientEnd);
  var peakThreshold = noiseCeiling + 5;
  var minSepMs = 2000;
  var peaks = []; // [{index (global), rssi, timeMs}]

  // Smooth flight data for peak detection (window=15)
  var smoothed = [];
  for (var i = 0; i < flightData.length; i++) {
    var sum = 0, cnt = 0;
    for (var j = Math.max(0, i - 7); j <= Math.min(flightData.length - 1, i + 7); j++) {
      sum += flightData[j].rssi; cnt++;
    }
    smoothed.push(sum / cnt);
  }

  // Find local maxima
  for (var i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > peakThreshold && smoothed[i] >= smoothed[i - 1] && smoothed[i] >= smoothed[i + 1]) {
      var globalIdx = ambientEnd + i;
      var tMs = allData[globalIdx].time;
      // Enforce min separation
      if (peaks.length === 0 || (tMs - peaks[peaks.length - 1].timeMs) >= minSepMs) {
        // Check if this is higher than a recent peak within separation window (keep highest)
        if (peaks.length > 0 && (tMs - peaks[peaks.length - 1].timeMs) < minSepMs) continue;
        peaks.push({ index: globalIdx, rssi: flightData[i].rssi, timeMs: tMs });
      } else if (flightData[i].rssi > peaks[peaks.length - 1].rssi) {
        // Replace last peak if this one is higher and within separation
        peaks[peaks.length - 1] = { index: globalIdx, rssi: flightData[i].rssi, timeMs: tMs };
      }
    }
  }

  wizardState.peaks = peaks;
  wizardState.allPeaks = peaks.slice(); // preserve original set
  wizardState.ignoredRegions = [];
  console.log("[Wizard] Detected", peaks.length, "peaks, noiseCeiling=", noiseCeiling);

  if (peaks.length < 3) {
    // Fall back to manual peak-marking
    alert(i18n.t("messages.calib_auto_few_peaks", { n: peaks.length }));
    showManualPeakMarking();
    return;
  }

  // Calculate thresholds
  var peakRssiValues = peaks.map((p) => p.rssi);
  var avgPeak = peakRssiValues.reduce((a, b) => a + b, 0) / peakRssiValues.length;
  wizardState.avgPeak = avgPeak;

  // enter = noiseCeiling + 0.6*(avgPeak - noiseCeiling)
  // exit  = noiseCeiling + 0.3*(avgPeak - noiseCeiling)
  var range = avgPeak - noiseCeiling;
  var calcEnter = Math.round(noiseCeiling + 0.6 * range);
  var calcExit = Math.round(noiseCeiling + 0.3 * range);

  // Enforce minimum gap
  if (calcEnter <= calcExit + 5) calcEnter = calcExit + 10;
  calcEnter = Math.max(50, Math.min(255, calcEnter));
  calcExit = Math.max(50, Math.min(255, calcExit));

  wizardState.calculatedEnter = calcEnter;
  wizardState.calculatedExit = calcExit;

  // Min lap time: 70% of shortest gap between consecutive peaks, clamped 1-20s
  var gaps = [];
  for (var i = 1; i < peaks.length; i++) {
    gaps.push(peaks[i].timeMs - peaks[i - 1].timeMs);
  }
  var minGap = Math.min(...gaps);
  var calcMinLap = Math.round(minGap * 0.7);
  calcMinLap = Math.max(1000, Math.min(20000, calcMinLap));
  wizardState.calculatedMinLap = calcMinLap;

  showResults();
}

function showManualPeakMarking() {
  // Fallback: show chart with manual click-to-mark peaks
  document.getElementById("wizardRecording").style.display = "none";
  document.getElementById("wizardManualMarking").style.display = "block";
  wizardState.phase = "manual";
  wizardState.peaks = [];
  drawWizardChart();
}

function showResults() {
  document.getElementById("wizardRecording").style.display = "none";
  document.getElementById("wizardAmbient").style.display = "none";
  document.getElementById("wizardManualMarking").style.display = "none";
  document.getElementById("wizardResults").style.display = "block";
  wizardState.phase = "results";
  setupWizardResultInputHandlers();

  updateResultsDisplay();
  drawResultsChart();
  setupIgnoreRegionHandlers();
}

function clampWizardResultValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyWizardResultInputEdits() {
  var enterInput = document.getElementById("calculatedEnterRssi");
  var exitInput = document.getElementById("calculatedExitRssi");
  var minLapInput = document.getElementById("calculatedMinLap");

  if (enterInput) {
    var enterVal = parseInt(enterInput.value, 10);
    if (!isNaN(enterVal)) {
      wizardState.calculatedEnter = clampWizardResultValue(Math.round(enterVal), 50, 255);
    }
  }

  if (exitInput) {
    var exitVal = parseInt(exitInput.value, 10);
    if (!isNaN(exitVal)) {
      wizardState.calculatedExit = clampWizardResultValue(Math.round(exitVal), 50, 255);
    }
  }

  if (minLapInput) {
    var minLapSeconds = parseFloat(minLapInput.value);
    if (!isNaN(minLapSeconds)) {
      wizardState.calculatedMinLap = clampWizardResultValue(Math.round(minLapSeconds * 1000), 1000, 20000);
    }
  }
}

function setupWizardResultInputHandlers() {
  var enterInput = document.getElementById("calculatedEnterRssi");
  var exitInput = document.getElementById("calculatedExitRssi");
  var minLapInput = document.getElementById("calculatedMinLap");

  function onInputChanged() {
    applyWizardResultInputEdits();
    drawResultsChart();
  }

  function onInputBlur() {
    applyWizardResultInputEdits();
    updateResultsDisplay();
    drawResultsChart();
  }

  if (enterInput && !enterInput.dataset.bound) {
    enterInput.addEventListener("input", onInputChanged);
    enterInput.addEventListener("blur", onInputBlur);
    enterInput.dataset.bound = "1";
  }

  if (exitInput && !exitInput.dataset.bound) {
    exitInput.addEventListener("input", onInputChanged);
    exitInput.addEventListener("blur", onInputBlur);
    exitInput.dataset.bound = "1";
  }

  if (minLapInput && !minLapInput.dataset.bound) {
    minLapInput.addEventListener("input", onInputChanged);
    minLapInput.addEventListener("blur", onInputBlur);
    minLapInput.dataset.bound = "1";
  }
}

function updateResultsDisplay() {
  var activePeaks = getActivePeaks();
  var tooFew = activePeaks.length < 3;
  var enterInput = document.getElementById("calculatedEnterRssi");
  var exitInput = document.getElementById("calculatedExitRssi");
  var minLapInput = document.getElementById("calculatedMinLap");

  if (enterInput) {
    enterInput.value = tooFew ? "" : wizardState.calculatedEnter;
    enterInput.disabled = tooFew;
  }
  if (exitInput) {
    exitInput.value = tooFew ? "" : wizardState.calculatedExit;
    exitInput.disabled = tooFew;
  }
  if (minLapInput) {
    minLapInput.value = tooFew ? "" : (wizardState.calculatedMinLap / 1000).toFixed(1);
    minLapInput.disabled = tooFew;
  }
  document.getElementById("calculatedPeakCount").textContent = activePeaks.length;
  document.getElementById("calculatedNoiseCeiling").textContent = wizardState.noiseCeiling;
  document.getElementById("calculatedAvgPeak").textContent = tooFew ? "--" : Math.round(wizardState.avgPeak);

  // Warning and apply button state
  var warning = document.getElementById("wizardIgnoreWarning");
  var applyBtn = document.getElementById("wizardApplyBtn");
  if (warning) warning.style.display = tooFew ? "block" : "none";
  if (applyBtn) applyBtn.disabled = tooFew;

  // Clear button visibility
  var clearBtn = document.getElementById("clearIgnoredBtn");
  if (clearBtn) clearBtn.style.display = wizardState.ignoredRegions.length > 0 ? "inline-block" : "none";
}

function getActivePeaks() {
  return wizardState.allPeaks.filter(function(p) {
    return !wizardState.ignoredRegions.some(function(r) {
      return p.index >= r.startIdx && p.index <= r.endIdx;
    });
  });
}

function recalculateWithIgnoredRegions() {
  var activePeaks = getActivePeaks();
  wizardState.peaks = activePeaks;

  if (activePeaks.length >= 3) {
    var peakRssiValues = activePeaks.map(function(p) { return p.rssi; });
    var avgPeak = peakRssiValues.reduce(function(a, b) { return a + b; }, 0) / peakRssiValues.length;
    wizardState.avgPeak = avgPeak;

    var range = avgPeak - wizardState.noiseCeiling;
    var calcEnter = Math.round(wizardState.noiseCeiling + 0.6 * range);
    var calcExit = Math.round(wizardState.noiseCeiling + 0.3 * range);
    if (calcEnter <= calcExit + 5) calcEnter = calcExit + 10;
    wizardState.calculatedEnter = Math.max(50, Math.min(255, calcEnter));
    wizardState.calculatedExit = Math.max(50, Math.min(255, calcExit));

    var gaps = [];
    var sorted = activePeaks.slice().sort(function(a, b) { return a.timeMs - b.timeMs; });
    for (var i = 1; i < sorted.length; i++) gaps.push(sorted[i].timeMs - sorted[i - 1].timeMs);
    var minGap = gaps.length > 0 ? Math.min.apply(null, gaps) : 5000;
    wizardState.calculatedMinLap = Math.max(1000, Math.min(20000, Math.round(minGap * 0.7)));
  }

  updateResultsDisplay();
  drawResultsChart();
}

function clearIgnoredRegions() {
  wizardState.ignoredRegions = [];
  recalculateWithIgnoredRegions();
}

function rerecordCalibration() {
  // Reset and restart the full wizard
  closeCalibrationWizard();
  startCalibrationWizard();
}

function setupIgnoreRegionHandlers() {
  var canvas = document.getElementById("wizardResultsChart");
  if (!canvas) return;
  var dragStart = null;

  canvas.onmousedown = function(e) {
    if (e.button !== 0) return; // left click only for drag
    var rect = canvas.getBoundingClientRect();
    dragStart = e.clientX - rect.left;
  };

  canvas.onmousemove = function(e) {
    if (dragStart === null) return;
    var rect = canvas.getBoundingClientRect();
    var dragEnd = e.clientX - rect.left;
    drawResultsChart(dragStart, dragEnd);
  };

  canvas.onmouseup = function(e) {
    if (dragStart === null) return;
    var rect = canvas.getBoundingClientRect();
    var dragEnd = e.clientX - rect.left;
    var pad = 40;
    var cw = canvas.width - 2 * pad;
    var len = wizardState.data.length;

    var startIdx = Math.round(((Math.min(dragStart, dragEnd) - pad) / cw) * (len - 1));
    var endIdx = Math.round(((Math.max(dragStart, dragEnd) - pad) / cw) * (len - 1));
    startIdx = Math.max(0, Math.min(len - 1, startIdx));
    endIdx = Math.max(0, Math.min(len - 1, endIdx));
    dragStart = null;

    // Only add if region spans at least a few samples
    if (endIdx - startIdx < 3) return;

    wizardState.ignoredRegions.push({ startIdx: startIdx, endIdx: endIdx });
    recalculateWithIgnoredRegions();
  };

  canvas.onmouseleave = function() {
    if (dragStart !== null) {
      dragStart = null;
      drawResultsChart();
    }
  };

  canvas.oncontextmenu = function(e) {
    e.preventDefault();
    if (wizardState.ignoredRegions.length === 0) return;
    var rect = canvas.getBoundingClientRect();
    var clickX = e.clientX - rect.left;
    var pad = 40;
    var cw = canvas.width - 2 * pad;
    var len = wizardState.data.length;
    var clickIdx = Math.round(((clickX - pad) / cw) * (len - 1));

    // Find which region was right-clicked
    for (var i = wizardState.ignoredRegions.length - 1; i >= 0; i--) {
      var r = wizardState.ignoredRegions[i];
      if (clickIdx >= r.startIdx && clickIdx <= r.endIdx) {
        wizardState.ignoredRegions.splice(i, 1);
        recalculateWithIgnoredRegions();
        return;
      }
    }
  };
}

function drawResultsChart(previewStart, previewEnd) {
  var canvas = document.getElementById("wizardResultsChart");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  canvas.width = canvas.offsetWidth;
  canvas.height = 300;

  var w = canvas.width, h = canvas.height, pad = 40;
  var cw = w - 2 * pad, ch = h - 2 * pad;
  var allData = wizardState.data;
  var rssiVals = allData.map(function(d) { return d.rssi; });
  var minR = Math.min.apply(null, rssiVals), maxR = Math.max.apply(null, rssiVals);
  var range = Math.max(maxR - minR, 1);

  // Visual smoothing
  var sm = [];
  for (var i = 0; i < rssiVals.length; i++) {
    var s = 0, c = 0;
    for (var j = Math.max(0, i - 7); j <= Math.min(rssiVals.length - 1, i + 7); j++) { s += rssiVals[j]; c++; }
    sm.push(s / c);
  }

  // Background
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--bg-primary").trim() || "#1a1a2e";
  ctx.fillRect(0, 0, w, h);

  // Draw ignored regions (behind everything)
  wizardState.ignoredRegions.forEach(function(r) {
    var x1 = pad + (r.startIdx / (allData.length - 1)) * cw;
    var x2 = pad + (r.endIdx / (allData.length - 1)) * cw;
    ctx.fillStyle = "rgba(231, 76, 60, 0.2)";
    ctx.fillRect(x1, pad, x2 - x1, ch);
    // Strikethrough line
    ctx.strokeStyle = "rgba(231, 76, 60, 0.5)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x1, pad + ch / 2); ctx.lineTo(x2, pad + ch / 2); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Draw drag preview
  if (previewStart !== undefined && previewEnd !== undefined) {
    var px1 = Math.min(previewStart, previewEnd);
    var px2 = Math.max(previewStart, previewEnd);
    ctx.fillStyle = "rgba(231, 76, 60, 0.15)";
    ctx.fillRect(px1, pad, px2 - px1, ch);
    ctx.strokeStyle = "rgba(231, 76, 60, 0.6)"; ctx.lineWidth = 1;
    ctx.strokeRect(px1, pad, px2 - px1, ch);
  }

  // Axes
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--border-color").trim() || "#444";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();

  // RSSI fill
  ctx.fillStyle = "rgba(0, 212, 255, 0.3)";
  ctx.beginPath();
  for (var i = 0; i < sm.length; i++) {
    var x = pad + (i / (sm.length - 1)) * cw;
    var y = h - pad - ((sm[i] - minR) / range) * ch;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.lineTo(w - pad, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath(); ctx.fill();

  // RSSI line
  ctx.strokeStyle = "#00d4ff"; ctx.lineWidth = 2; ctx.beginPath();
  for (var i = 0; i < sm.length; i++) {
    var x = pad + (i / (sm.length - 1)) * cw;
    var y = h - pad - ((sm[i] - minR) / range) * ch;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Ambient boundary
  if (wizardState.ambientEnd > 0 && wizardState.ambientEnd < allData.length) {
    var ax = pad + (wizardState.ambientEnd / (allData.length - 1)) * cw;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, pad); ctx.lineTo(ax, h - pad); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "11px Arial"; ctx.textAlign = "center";
    ctx.fillText("Ambient", ax / 2 + pad / 2, pad - 6);
  }

  // Threshold lines (only if enough active peaks)
  var activePeaks = getActivePeaks();
  if (activePeaks.length >= 3) {
    function drawHLine(val, color, label) {
      var y = h - pad - ((val - minR) / range) * ch;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = "11px Arial"; ctx.textAlign = "right";
      ctx.fillText(label + " (" + val + ")", w - pad - 4, y - 4);
    }
    drawHLine(wizardState.calculatedEnter, "#ff5555", "Enter");
    drawHLine(wizardState.calculatedExit, "#ff9944", "Exit");
  }
  // Always draw noise ceiling
  var noiseY = h - pad - ((wizardState.noiseCeiling - minR) / range) * ch;
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
  ctx.beginPath(); ctx.moveTo(pad, noiseY); ctx.lineTo(w - pad, noiseY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "11px Arial"; ctx.textAlign = "right";
  ctx.fillText("Noise (" + wizardState.noiseCeiling + ")", w - pad - 4, noiseY - 4);

  // Peak markers - all peaks from allPeaks, greyed out if ignored
  var activeSet = new Set(activePeaks.map(function(p) { return p.index; }));
  var activeIdx = 0;
  wizardState.allPeaks.forEach(function(p) {
    var x = pad + (p.index / (allData.length - 1)) * cw;
    var y = h - pad - ((p.rssi - minR) / range) * ch;
    var isActive = activeSet.has(p.index);
    if (isActive) {
      activeIdx++;
      ctx.fillStyle = "#ff5555"; ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "12px Arial"; ctx.textAlign = "center";
      ctx.fillText(activeIdx.toString(), x, y - 10);
    } else {
      ctx.fillStyle = "rgba(150, 150, 150, 0.5)"; ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill();
      // Draw X through ignored peak
      ctx.strokeStyle = "rgba(231, 76, 60, 0.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    }
  });
}

// Manual peak-marking fallback (chart + click)
function drawWizardChart() {
  var canvas = document.getElementById("wizardChart");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  canvas.width = canvas.offsetWidth;
  canvas.height = 400;

  var w = canvas.width, h = canvas.height, pad = 40;
  var cw = w - 2 * pad, ch = h - 2 * pad;
  var rssiVals = wizardState.data.map((d) => d.rssi);
  var minR = Math.min(...rssiVals), maxR = Math.max(...rssiVals);
  var range = Math.max(maxR - minR, 1);

  var sm = [];
  for (var i = 0; i < rssiVals.length; i++) {
    var s = 0, c = 0;
    for (var j = Math.max(0, i - 7); j <= Math.min(rssiVals.length - 1, i + 7); j++) { s += rssiVals[j]; c++; }
    sm.push(s / c);
  }

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--bg-primary").trim() || "#1a1a2e";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--border-color").trim() || "#444";
  ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();

  ctx.fillStyle = "rgba(0, 212, 255, 0.4)"; ctx.beginPath();
  for (var i = 0; i < sm.length; i++) {
    var x = pad + (i / (sm.length - 1)) * cw;
    var y = h - pad - ((sm[i] - minR) / range) * ch;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.lineTo(w - pad, h - pad); ctx.lineTo(pad, h - pad); ctx.closePath(); ctx.fill();

  ctx.strokeStyle = "#00d4ff"; ctx.lineWidth = 2; ctx.beginPath();
  for (var i = 0; i < sm.length; i++) {
    var x = pad + (i / (sm.length - 1)) * cw;
    var y = h - pad - ((sm[i] - minR) / range) * ch;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw manually placed peaks
  wizardState.peaks.forEach(function (p, idx) {
    var x = pad + (p.index / (wizardState.data.length - 1)) * cw;
    var rssi = wizardState.data[p.index].rssi;
    var y = h - pad - ((rssi - minR) / range) * ch;
    ctx.fillStyle = "#ff5555"; ctx.beginPath(); ctx.arc(x, y, 8, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "14px Arial"; ctx.textAlign = "center";
    ctx.fillText("Peak " + (idx + 1), x, y - 12);
  });

  canvas.onclick = function (event) {
    if (wizardState.peaks.length >= 3) return;
    var rect = canvas.getBoundingClientRect();
    var clickX = event.clientX - rect.left;
    var dataIndex = Math.round(((clickX - pad) / cw) * (wizardState.data.length - 1));
    if (dataIndex >= 0 && dataIndex < wizardState.data.length) {
      wizardState.peaks.push({ index: dataIndex, rssi: wizardState.data[dataIndex].rssi, timeMs: wizardState.data[dataIndex].time });
      var status = document.getElementById("wizardManualStatus");
      if (wizardState.peaks.length < 3) {
        if (status) status.textContent = i18n.t("calib.wizard_mark_peak_n", { n: wizardState.peaks.length + 1 });
      } else {
        if (status) status.textContent = i18n.t("messages.calib_peaks_marked");
        var calcBtn = document.getElementById("wizardManualCalcButton");
        if (calcBtn) calcBtn.disabled = false;
      }
      var undoBtn = document.getElementById("wizardManualUndoButton");
      if (undoBtn) undoBtn.disabled = false;
      drawWizardChart();
    }
  };
}

function undoLastMarker() {
  if (wizardState.peaks.length === 0) return;
  wizardState.peaks.pop();
  var status = document.getElementById("wizardManualStatus");
  if (status) status.textContent = i18n.t("calib.wizard_mark_peak_n", { n: wizardState.peaks.length + 1 });
  var undoBtn = document.getElementById("wizardManualUndoButton");
  if (undoBtn) undoBtn.disabled = (wizardState.peaks.length === 0);
  var calcBtn = document.getElementById("wizardManualCalcButton");
  if (calcBtn) calcBtn.disabled = true;
  drawWizardChart();
}

function calculateThresholdsManual() {
  if (wizardState.peaks.length < 3) {
    alert(i18n.t("messages.calib_mark_all_peaks"));
    return;
  }
  // Compute noise ceiling from ambient portion
  var ambientEnd = Math.min(wizardState.ambientEnd, wizardState.data.length);
  var ambientValues = wizardState.data.slice(0, Math.max(ambientEnd, 50)).map((d) => d.rssi);
  ambientValues.sort((a, b) => a - b);
  var noiseCeiling = ambientValues[Math.floor(ambientValues.length * 0.95)];
  wizardState.noiseCeiling = noiseCeiling;

  var peakRssiValues = wizardState.peaks.map((p) => p.rssi);
  var avgPeak = peakRssiValues.reduce((a, b) => a + b, 0) / peakRssiValues.length;
  wizardState.avgPeak = avgPeak;

  var range = avgPeak - noiseCeiling;
  var calcEnter = Math.round(noiseCeiling + 0.6 * range);
  var calcExit = Math.round(noiseCeiling + 0.3 * range);
  if (calcEnter <= calcExit + 5) calcEnter = calcExit + 10;
  calcEnter = Math.max(50, Math.min(255, calcEnter));
  calcExit = Math.max(50, Math.min(255, calcExit));

  wizardState.calculatedEnter = calcEnter;
  wizardState.calculatedExit = calcExit;

  // Min lap from peak gaps
  var gaps = [];
  var sorted = wizardState.peaks.slice().sort((a, b) => a.timeMs - b.timeMs);
  for (var i = 1; i < sorted.length; i++) gaps.push(sorted[i].timeMs - sorted[i - 1].timeMs);
  var minGap = gaps.length > 0 ? Math.min(...gaps) : 5000;
  wizardState.calculatedMinLap = Math.max(1000, Math.min(20000, Math.round(minGap * 0.7)));

  document.getElementById("wizardManualMarking").style.display = "none";
  showResults();
}

function applyCalculatedThresholds() {
  applyWizardResultInputEdits();
  enterRssiInput.value = wizardState.calculatedEnter;
  exitRssiInput.value = wizardState.calculatedExit;
  updateEnterRssi(enterRssiInput, wizardState.calculatedEnter);
  updateExitRssi(exitRssiInput, wizardState.calculatedExit);

  // Apply min lap time (stored in 0.1s units in the input)
  minLapInput.value = (wizardState.calculatedMinLap / 1000).toFixed(1);
  updateMinLap(minLapInput, minLapInput.value);

  saveConfig();
  closeCalibrationWizard();
  alert(i18n.t("messages.calib_applied"));
}

function cancelCalibrationWizard() {
  if (wizardState.phase === "ambient" || wizardState.phase === "recording") {
    fetch("/calibration/stop", { method: "POST" })
      .then(() => closeCalibrationWizard())
      .catch(() => closeCalibrationWizard());
  } else {
    closeCalibrationWizard();
  }
}

function closeCalibrationWizard() {
  wizardState.phase = "idle";
  document.getElementById("calibrationWizardModal").style.display = "none";
  var ids = ["wizardAmbient", "wizardRecording", "wizardManualMarking", "wizardResults"];
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

// RotorHazard Integration Functions
function toggleRHEnabled(enabled) {
  const rhContentDiv = document.getElementById("rhContent");
  if (rhContentDiv) rhContentDiv.style.display = enabled ? "block" : "none";

  fetch("/config", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ rhEnabled: enabled ? 1 : 0 }),
  })
    .then((response) => response.json())
    .then((data) => console.log("RH enabled:", enabled, data))
    .catch((err) => console.error("Failed to toggle RH enabled:", err));
}

function refreshRHStatus() {
  const badge = document.getElementById("rhStatusBadge");
  const syncStatus = document.getElementById("rhSyncStatus");
  if (!badge) return;
  badge.textContent = "Checking...";
  badge.style.backgroundColor = "var(--bg-secondary)";
  badge.style.color = "var(--secondary-color)";

  fetch("/api/rh/status")
    .then((response) => response.json())
    .then((data) => {
      if (!data.enabled) {
        badge.textContent = "Disabled";
        badge.style.backgroundColor = "rgba(100,100,100,0.2)";
        badge.style.color = "var(--secondary-color)";
      } else if (data.connected) {
        badge.textContent = "Connected";
        badge.style.backgroundColor = "rgba(74, 222, 128, 0.2)";
        badge.style.color = "#4ade80";
      } else {
        badge.textContent = "Disconnected";
        badge.style.backgroundColor = "rgba(255, 85, 85, 0.2)";
        badge.style.color = "#ff5555";
      }
      // Update clock sync status
      if (syncStatus) {
        if (data.clockSynced) {
          syncStatus.textContent = "Synced (RTT: " + data.rttMs + "ms)";
          syncStatus.style.color = "#4ade80";
        } else {
          syncStatus.textContent = "Not synced";
          syncStatus.style.color = "var(--secondary-color)";
        }
      }
    })
    .catch((err) => {
      console.error("Failed to fetch RH status:", err);
      badge.textContent = "Error";
      badge.style.backgroundColor = "rgba(255, 85, 85, 0.2)";
      badge.style.color = "#ff5555";
    });
}

async function syncRHClock() {
  const btn = document.getElementById("rhSyncBtn");
  const status = document.getElementById("rhSyncStatus");
  if (!btn || !status) return;

  btn.disabled = true;
  status.textContent = "Syncing...";
  status.style.color = "var(--secondary-color)";

  try {
    await fetch("/api/rh/syncClock", { method: "POST" });
    // Give the main loop ~2 s to perform the sync
    await new Promise(resolve => setTimeout(resolve, 2000));
    const resp = await fetch("/api/rh/status");
    const data = await resp.json();
    if (data.clockSynced) {
      status.textContent = "Synced (RTT: " + data.rttMs + "ms)";
      status.style.color = "#4ade80";
    } else {
      status.textContent = "Sync failed - check RH Host IP";
      status.style.color = "#ff5555";
    }
  } catch (e) {
    status.textContent = "Error: " + e.message;
    status.style.color = "#ff5555";
  } finally {
    btn.disabled = false;
  }
}

// WiFi Settings Functions
function applyWiFiSettings() {
  const ssid = document.getElementById("ssid")?.value;
  const pwd = document.getElementById("pwd")?.value;

  if (!ssid) {
    alert(i18n.t("messages.wifi_enter_ssid"));
    return;
  }

  if (!pwd) {
    if (!confirm(i18n.t("messages.wifi_password_empty"))) {
      return;
    }
  }

  if (!confirm(i18n.t("messages.wifi_apply_confirm"))) {
    return;
  }

  // Save configuration first
  saveConfig();

  // Give a moment for save to complete
  setTimeout(() => {
    // Send reboot command
    if (usbConnected && transportManager) {
      transportManager
        .sendCommand("reboot", "POST")
        .then(() => {
          alert(i18n.t("messages.wifi_applied_restarting"));
        })
        .catch((err) => console.error("Failed to restart device:", err));
    } else {
      fetch("/reboot", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      })
        .then(() => {
          alert(i18n.t("messages.wifi_applied_restarting"));
        })
        .catch((err) => console.error("Failed to restart device:", err));
    }
  }, 500);
}

function resetWiFiSettings() {
  if (!confirm(i18n.t("messages.wifi_reset_confirm"))) {
    return;
  }

  // Reload config from device
  if (usbConnected && transportManager) {
    transportManager
      .sendCommand("config", "GET")
      .then((configData) => {
        if (configData.ssid !== undefined) document.getElementById("ssid").value = configData.ssid;
        if (configData.pwd !== undefined) document.getElementById("pwd").value = configData.pwd;
      })
      .catch((err) => console.error("Failed to fetch config:", err));
  } else {
    fetch("/config")
      .then((response) => response.json())
      .then((configData) => {
        if (configData.ssid !== undefined) document.getElementById("ssid").value = configData.ssid;
        if (configData.pwd !== undefined) document.getElementById("pwd").value = configData.pwd;
      })
      .catch((err) => console.error("Failed to fetch config:", err));
  }
}

// Settings Modal Functions
// (openSettingsModal is defined later with full config loading)
// Race Notes Modal Functions
// (openRaceNotesModal/closeRaceNotesModal are defined above)

function closeSettingsModal() {
  const modal = document.getElementById("settingsModal");
  if (modal) {
  modal.classList.remove("active");
  }
}

// Close modal when clicking on the overlay background
document.addEventListener("click", function (event) {
  const modal = document.getElementById("settingsModal");
    const notesModal = document.getElementById("raceNotesModal");
  if (modal && event.target === modal) {
    closeSettingsModal();
  }
  if (notesModal && event.target === notesModal) {
    closeRaceNotesModal();
  }
});

function switchSettingsSection(ev, sectionName) {
  // Hide all sections
  const sections = document.querySelectorAll(".settings-section");
  sections.forEach((section) => section.classList.remove("active"));

  // Show selected section
  const targetSection = document.getElementById(`settings-${sectionName}`);
  if (targetSection) {
    targetSection.classList.add("active");
  }

  // Update nav items
  const navItems = document.querySelectorAll(".settings-nav-item");
  navItems.forEach((item) => {
    item.classList.remove("active");
  });

  const clicked = ev && ev.target ? ev.target.closest(".settings-nav-item") : null;
  if (clicked) {
    clicked.classList.add("active");
  } else {
    navItems.forEach((item) => {
      if (item.dataset.settingsSection === sectionName) {
        item.classList.add("active");
      }
    });
  }
}

// Keyboard shortcut for closing modal (ESC key)
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    const modal = document.getElementById("settingsModal");
    const notesModal = document.getElementById("raceNotesModal");
    if (modal && modal.classList.contains("active")) {
      closeSettingsModal();
      return;
    }
    if (notesModal && notesModal.classList.contains("active")) {
      closeRaceNotesModal();
    }
  }
});

// Self-Test Functions
function runSelfTest() {
  const button = document.getElementById("runTestsButton");
  const loadingDiv = document.getElementById("testLoading");
  const resultsDiv = document.getElementById("testResults");
  const resultsListDiv = document.getElementById("testResultsList");

  // Show loading, hide results
  button.disabled = true;
  button.textContent = i18n.t("settings.diagnostics.running");
  loadingDiv.style.display = "block";
  resultsDiv.style.display = "none";

  fetch("/api/selftest")
    .then((response) => response.json())
    .then((data) => {
      // Hide loading
      loadingDiv.style.display = "none";
      // Newer firmware reports an explicit status: "pass" | "fail" | "skip".
      // Fall back to the legacy boolean for older firmware.
      const statusOf = (test) => test.status || (test.passed ? "pass" : "fail");

      let html = "";
      let anyFailed = false;
      let passedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      data.tests.forEach((test) => {
        const status = statusOf(test);
        const durationMs = test.duration != null ? test.duration : (test.duration_ms || 0);

        let statusIcon = "✓";
        let statusColor = "#4ade80";
        let bgColor = "rgba(74, 222, 128, 0.1)";

        if (status === "skip") {
          skippedCount++;
          statusIcon = "–";
          statusColor = "#9ca3af";
          bgColor = "rgba(156, 163, 175, 0.1)";
        } else if (status === "fail") {
          failedCount++;
          anyFailed = true;
          statusIcon = "✗";
          statusColor = "#ff5555";
          bgColor = "rgba(255, 85, 85, 0.1)";
        } else {
          passedCount++;
        }

        html += `
          <div style="margin-bottom: 12px; padding: 12px; background-color: ${bgColor}; border-left: 4px solid ${statusColor}; border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 20px; color: ${statusColor};">${statusIcon}</span>
                <span style="font-weight: bold; font-size: 16px;">${test.name}</span>
                ${status === "skip" ? '<span style="font-size: 11px; color: var(--secondary-color); border: 1px solid var(--secondary-color); border-radius: 3px; padding: 1px 6px; margin-left: 4px;">SKIPPED</span>' : ""}
              </div>
              <span style="font-size: 12px; color: var(--secondary-color);">${durationMs}ms</span>
            </div>
            <div style="font-size: 14px; color: var(--secondary-color); margin-left: 28px;">
              ${test.details || ""}
            </div>
          </div>
        `;
      });

      // Add summary
      const totalCount = data.tests.length;
      const summaryColor = anyFailed ? "#ff9f43" : "#4ade80";
      const summaryTitle = anyFailed
        ? i18n.t("settings.diagnostics.some_failed")
        : i18n.t("settings.diagnostics.all_passed");

      let summaryLine = `${passedCount} passed`;
      if (skippedCount > 0) summaryLine += `, ${skippedCount} skipped`;
      if (failedCount > 0) summaryLine += `, ${failedCount} failed`;
      summaryLine += ` (of ${totalCount})`;

      html =
        `
        <div style="margin-bottom: 20px; padding: 16px; background-color: var(--bg-secondary); border-radius: 8px; text-align: center;">
          <div style="font-size: 18px; font-weight: bold; margin-bottom: 8px; color: ${summaryColor};">
            ${summaryTitle}
          </div>
          <div style="font-size: 14px; color: var(--secondary-color);">
            ${summaryLine}
          </div>
        </div>
      ` + html;

      resultsListDiv.innerHTML = html;
      resultsDiv.style.display = "block";

      // Re-enable button
      button.disabled = false;
      button.textContent = i18n.t("settings.diagnostics.run_again");
    })
    .catch((error) => {
      console.error("Error running self-test:", error);
      loadingDiv.style.display = "none";
      resultsListDiv.innerHTML = `
        <div style="padding: 16px; background-color: rgba(255, 85, 85, 0.1); border-left: 4px solid #ff5555; border-radius: 4px;">
          <div style="font-weight: bold; color: #ff5555; margin-bottom: 6px;">${i18n.t("settings.diagnostics.error_running")}</div>
          <div style="font-size: 14px; color: var(--secondary-color);">${error.message}</div>
        </div>
      `;
      resultsDiv.style.display = "block";
      button.disabled = false;
      button.textContent = i18n.t("settings.diagnostics.run_all");
    });
}

// SPI Mod Test
function runSPITest() {
  const button = document.getElementById("runSPITestButton");
  const loadingDiv = document.getElementById("spiTestLoading");
  const resultsDiv = document.getElementById("spiTestResults");
  const verdictDiv = document.getElementById("spiTestVerdict");
  const chartDiv = document.getElementById("spiTestChart");

  button.disabled = true;
  button.textContent = i18n.t("settings.diagnostics.spi_running");
  loadingDiv.style.display = "block";
  resultsDiv.style.display = "none";

  fetch("/api/spitest")
    .then((response) => response.json())
    .then((data) => {
      loadingDiv.style.display = "none";

      const passed = data.passed;
      const verdictColor = passed ? "#4ade80" : "#ff5555";
      const verdictBg = passed ? "rgba(74, 222, 128, 0.1)" : "rgba(255, 85, 85, 0.1)";
      const verdictIcon = passed ? "\u2713" : "\u2717";
      const verdictText = passed
        ? i18n.t("settings.diagnostics.spi_pass")
        : i18n.t("settings.diagnostics.spi_fail");

      verdictDiv.innerHTML = `
        <div style="margin-bottom: 16px; padding: 16px; background-color: ${verdictBg}; border-left: 4px solid ${verdictColor}; border-radius: 4px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 20px; color: ${verdictColor};">${verdictIcon}</span>
            <span style="font-weight: bold; font-size: 16px;">${verdictText}</span>
          </div>
          <div style="font-size: 14px; color: var(--secondary-color);">
            Spread: ${data.spread} | Min: ${data.min} | Max: ${data.max}
          </div>
        </div>
      `;

      // Render bar chart
      const maxRssi = Math.max(...data.channels.map((c) => c.rssi), 1);
      let barsHtml = '<div style="display: flex; align-items: flex-end; gap: 6px; height: 120px;">';
      data.channels.forEach((ch) => {
        const pct = (ch.rssi / maxRssi) * 100;
        const barColor = passed ? "var(--primary-color)" : "var(--secondary-color)";
        barsHtml += `
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%;">
            <span style="font-size: 11px; color: var(--text-color); margin-bottom: 4px;">${ch.rssi}</span>
            <div style="width: 100%; flex: 1; display: flex; align-items: flex-end;">
              <div style="width: 100%; height: ${pct}%; background-color: ${barColor}; border-radius: 3px 3px 0 0; min-height: 2px;"></div>
            </div>
            <span style="font-size: 11px; color: var(--secondary-color); margin-top: 4px;">${ch.label}</span>
            <span style="font-size: 10px; color: var(--secondary-color);">${ch.freq}</span>
          </div>
        `;
      });
      barsHtml += "</div>";
      chartDiv.innerHTML = barsHtml;

      resultsDiv.style.display = "block";
      button.disabled = false;
      button.textContent = i18n.t("settings.diagnostics.spi_run_again");
    })
    .catch((error) => {
      console.error("Error running SPI test:", error);
      loadingDiv.style.display = "none";
      verdictDiv.innerHTML = `
        <div style="padding: 16px; background-color: rgba(255, 85, 85, 0.1); border-left: 4px solid #ff5555; border-radius: 4px;">
          <div style="font-weight: bold; color: #ff5555; margin-bottom: 6px;">${i18n.t("settings.diagnostics.error_running")}</div>
          <div style="font-size: 14px; color: var(--secondary-color);">${error.message}</div>
        </div>
      `;
      chartDiv.innerHTML = "";
      resultsDiv.style.display = "block";
      button.disabled = false;
      button.textContent = i18n.t("settings.diagnostics.spi_run");
    });
}

// ============================================
// Serial Monitor Functions
// ============================================

let serialMonitorActive = false;
let serialMonitorPollInterval = null;
let serialMonitorBuffer = [];
let lastSeenTimestamp = 0;
const MAX_SERIAL_LINES = 500;

function toggleSerialMonitor() {
  if (serialMonitorActive) {
    stopSerialMonitor();
  } else {
    startSerialMonitor();
  }
}

function startSerialMonitor() {
  const button = document.getElementById("serialMonitorToggle");
  const monitor = document.getElementById("serialMonitor");

  button.textContent = i18n.t("settings.diagnostics.stop_monitor");
  button.style.backgroundColor = "#ff5555";
  serialMonitorActive = true;
  lastSeenTimestamp = 0;

  // Clear monitor and show starting message
  monitor.innerHTML = `<div style="color: #4ade80;">${i18n.t("settings.diagnostics.monitor_started")}</div>`;

  // Poll for new debug logs every 500ms
  serialMonitorPollInterval = setInterval(pollDebugLogs, 500);

  // Initial poll
  pollDebugLogs();
}

function pollDebugLogs() {
  if (!serialMonitorActive) return;

  fetch("/api/debuglog")
    .then((response) => response.json())
    .then((data) => {
      if (data.logs && data.logs.length > 0) {
        // Add new logs that we haven't seen yet
        data.logs.forEach((log) => {
          if (log.timestamp > lastSeenTimestamp) {
            appendSerialLine(log.message, "#00ff00", log.timestamp);
            lastSeenTimestamp = log.timestamp;
          }
        });
      }
    })
    .catch((error) => {
      if (serialMonitorActive) {
        console.error("Failed to fetch debug logs:", error);
      }
    });
}

function stopSerialMonitor() {
  const button = document.getElementById("serialMonitorToggle");
  const monitor = document.getElementById("serialMonitor");

  button.textContent = i18n.t("settings.diagnostics.start_monitor");
  button.style.backgroundColor = "";
  serialMonitorActive = false;

  if (serialMonitorPollInterval) {
    clearInterval(serialMonitorPollInterval);
    serialMonitorPollInterval = null;
  }

  const line = document.createElement("div");
  line.style.color = "#888";
  line.textContent = i18n.t("settings.diagnostics.monitor_stopped");
  monitor.appendChild(line);
}

function appendSerialLine(text, color = "#00ff00", deviceTimestamp = null) {
  const monitor = document.getElementById("serialMonitor");
  const autoScroll = document.getElementById("serialAutoScroll")?.checked;

  // Add line to buffer
  serialMonitorBuffer.push({ text, color, deviceTimestamp });

  // Trim buffer if too large
  if (serialMonitorBuffer.length > MAX_SERIAL_LINES) {
    serialMonitorBuffer.shift();
    // Rebuild monitor from buffer
    rebuildSerialMonitor();
  } else {
    // Just append new line
    const line = document.createElement("div");
    line.style.color = color;
    line.textContent = text;
    monitor.appendChild(line);
  }

  // Auto-scroll to bottom
  if (autoScroll) {
    monitor.scrollTop = monitor.scrollHeight;
  }
}

function rebuildSerialMonitor() {
  const monitor = document.getElementById("serialMonitor");
  monitor.innerHTML = "";

  serialMonitorBuffer.forEach(({ text, color }) => {
    const line = document.createElement("div");
    line.style.color = color;
    line.textContent = text;
    monitor.appendChild(line);
  });
}

function clearSerialMonitor() {
  const monitor = document.getElementById("serialMonitor");
  serialMonitorBuffer = [];
  monitor.innerHTML = serialMonitorActive ? `<div style="color: #888;">${i18n.t("settings.diagnostics.monitor_cleared")}</div>` : `<div style="color: #888;">${i18n.t("settings.diagnostics.monitor_stopped")}</div>`;
}

// ============================================
// Distance Tracking Functions
// ============================================

function startDistancePolling() {
  // Poll distance every 5 seconds during race (less aggressive)
  if (distancePollingInterval) {
    clearInterval(distancePollingInterval);
  }

  // Initial fetch
  fetchDistance();

  distancePollingInterval = setInterval(() => {
    fetchDistance();
    // Also update the display to refresh the estimated distance
    updateDistanceDisplay();
  }, 5000);

  // Also update display more frequently (every 100ms) for smoother estimation
  if (!window.distanceDisplayInterval) {
    window.distanceDisplayInterval = setInterval(() => {
      updateDistanceDisplay();
    }, 100);
  }
}

function stopDistancePolling() {
  if (distancePollingInterval) {
    clearInterval(distancePollingInterval);
    distancePollingInterval = null;
  }
  if (window.distanceDisplayInterval) {
    clearInterval(window.distanceDisplayInterval);
    window.distanceDisplayInterval = null;
  }
}

function fetchDistance() {
  fetch("/timer/distance", {
    signal: AbortSignal.timeout(3000), // 3 second timeout
  })
    .then((response) => {
      if (!response.ok) throw new Error("Distance fetch failed");
      return response.json();
    })
    .then((data) => {
      currentTrackId = data.trackId || 0;
      currentTrackName = data.trackName || "";
      trackLapLength = data.trackDistance || 0.0;
      currentTotalDistance = data.totalDistance || 0;
      currentDistanceRemaining = data.distanceRemaining || 0;
      updateDistanceDisplay();
    })
    .catch((error) => {
      // Silently fail - don't spam console or cause issues
      if (error.name !== "TimeoutError" && error.name !== "AbortError") {
        console.warn("Distance fetch error:", error.message);
      }
    });
}

function updateDistanceDisplay() {
  // Update lap counter to include current lap time and per-lap distance
  const lapCounter = document.getElementById("lapCounter");
  if (!lapCounter) return;

  // Base lap counter text
  let lapText = "";
  if (maxLaps === 0) {
    lapText = i18n.t("race.lap_counter", { n: Math.max(0, lapNo) });
  } else {
    lapText = i18n.t("race.lap_of", { n: Math.max(0, lapNo), total: maxLaps });
  }

  // Calculate current lap time (time since last lap or race start)
  if (lapTimerStartMs > 0) {
    const currentLapMs = Date.now() - lapTimerStartMs;
    const minutes = Math.floor(currentLapMs / 60000);
    const seconds = Math.floor((currentLapMs % 60000) / 1000);
    const centiseconds = Math.floor((currentLapMs % 1000) / 10);

    const m = minutes < 10 ? "0" + minutes : minutes;
    const s = seconds < 10 ? "0" + seconds : seconds;
    const ms = centiseconds < 10 ? "0" + centiseconds : centiseconds;
    const lapTimeText = `${m}:${s}:${ms}` + i18n.t("race.table.seconds_short");

    lapText += ` - ${lapTimeText}`;
  }

  // Add per-lap distance if track is selected and race is running
  if (currentTrackId && trackLapLength > 0) {
    // Estimate distance travelled in current lap using time extrapolation
    let estimatedDistance = 0;
    if (currentLapStartTime > 0 && lastCompletedLapTime > 0) {
      const currentLapElapsed = Date.now() - currentLapStartTime;
      const progress = Math.min(currentLapElapsed / lastCompletedLapTime, 1.0);
      estimatedDistance = progress * trackLapLength;
    }

    lapText += ` - ${estimatedDistance.toFixed(1)}/${trackLapLength.toFixed(1)}m`;
  }

  lapCounter.textContent = lapText;
}

// ============================================
// Track Management Functions
// ============================================

let currentEditTrackId = null;
let allTracks = [];

function toggleTracksEnabled(enabled) {
  const tracksContent = document.getElementById("tracksContent");
  if (tracksContent) {
    tracksContent.style.display = enabled ? "block" : "none";
  }

  // Save to config
  fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tracksEnabled: enabled ? 1 : 0,
    }),
  })
    .then((response) => response.json())
    .then(() => {
      if (enabled) {
        loadTracks();
      }
    })
    .catch((error) => console.error("Error toggling tracks:", error));
}

function loadTracks() {
  fetch("/tracks")
    .then((response) => response.json())
    .then((data) => {
      allTracks = data.tracks || [];
      displayTracks();
      updateTrackSelect();
    })
    .catch((error) => console.error("Error loading tracks:", error));
}

function displayTracks() {
  const tracksList = document.getElementById("tracksList");
  if (!tracksList) return;

  if (allTracks.length === 0) {
    tracksList.innerHTML = `<p style="color: var(--secondary-color); text-align: center;">${i18n.t("settings.tracks.no_tracks")}</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

  allTracks.forEach((track) => {
    html += `
      <div style="padding: 12px; background-color: var(--bg-secondary); border-radius: 8px; border-left: 4px solid var(--accent-color);">
        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 8px;">
          <div style="flex: 1;">
            <div style="font-weight: bold; font-size: 16px; margin-bottom: 4px;">${track.name}</div>
            <div style="font-size: 14px; color: var(--secondary-color);">
              ${i18n.t("modals.track.unit_meters", { n: track.distance })}${track.tags ? " • " + track.tags : ""}
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="editTrack(${track.trackId})" style="padding: 6px 12px; font-size: 14px;">${i18n.t("history.edit")}</button>
            <button onclick="deleteTrack(${track.trackId})" style="padding: 6px 12px; font-size: 14px; background-color: var(--danger-color);">${i18n.t("history.delete")}</button>
          </div>
        </div>
        ${track.notes ? `<div style="font-size: 13px; color: var(--secondary-color); margin-top: 8px;">${track.notes}</div>` : ""}
      </div>
    `;
  });

  html += "</div>";
  tracksList.innerHTML = html;
}

function updateTrackSelect() {
  const selectEl = document.getElementById("selectedTrack");
  if (!selectEl) return;

  // Save current selection
  const currentSelection = selectEl.value;

  // Clear and repopulate
  selectEl.innerHTML = `<option value="0">${i18n.t("settings.tracks.none")}</option>`;

  allTracks.forEach((track) => {
    const option = document.createElement("option");
    option.value = track.trackId;
    option.textContent = `${track.name} (${track.distance}m)`;
    selectEl.appendChild(option);
  });

  // Restore selection if it still exists
  if (currentSelection) {
    selectEl.value = currentSelection;
  }
}

function openCreateTrackModal() {
  currentEditTrackId = null;
  document.getElementById("trackModalTitle").textContent = i18n.t("modals.track.create_title");
  document.getElementById("trackName").value = "";
  document.getElementById("trackDistance").value = "";
  document.getElementById("trackTags").value = "";
  document.getElementById("trackNotes").value = "";
  document.getElementById("saveTrackBtn").textContent = i18n.t("modals.track.save");
  document.getElementById("trackModal").style.display = "flex";
}

function editTrack(trackId) {
  const track = allTracks.find((t) => t.trackId === trackId);
  if (!track) return;

  currentEditTrackId = trackId;
  document.getElementById("trackModalTitle").textContent = i18n.t("modals.track.edit_title");
  document.getElementById("trackName").value = track.name;
  document.getElementById("trackDistance").value = track.distance;
  document.getElementById("trackTags").value = track.tags || "";
  document.getElementById("trackNotes").value = track.notes || "";
  document.getElementById("saveTrackBtn").textContent = i18n.t("modals.track.update");
  document.getElementById("trackModal").style.display = "flex";
}

function closeTrackModal() {
  document.getElementById("trackModal").style.display = "none";
  currentEditTrackId = null;
}

function saveTrack() {
  const name = document.getElementById("trackName").value.trim();
  const distance = parseFloat(document.getElementById("trackDistance").value);
  const tags = document.getElementById("trackTags").value.trim();
  const notes = document.getElementById("trackNotes").value.trim();

  if (!name) {
    alert("Please enter a track name");
    return;
  }

  if (!distance || distance <= 0) {
    alert("Please enter a valid distance");
    return;
  }

  const trackData = {
    trackId: currentEditTrackId || Math.floor(Date.now() / 1000),
    name: name,
    distance: distance,
    tags: tags,
    notes: notes,
  };

  const endpoint = currentEditTrackId ? "/tracks/update" : "/tracks/create";

  fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(trackData),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "OK") {
        closeTrackModal();
        loadTracks();
      } else {
        alert(i18n.t("messages.track_save_error"));
      }
    })
    .catch((error) => {
      console.error("Error saving track:", error);
      alert(i18n.t("messages.track_save_error"));
    });
}

function deleteTrack(trackId) {
  if (!confirm(i18n.t("messages.track_delete_confirm"))) {
    return;
  }

  fetch("/tracks/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "trackId=" + trackId,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "OK") {
        loadTracks();
      } else {
        alert(i18n.t("messages.track_delete_error"));
      }
    })
    .catch((error) => {
      console.error("Error deleting track:", error);
      alert(i18n.t("messages.track_delete_error"));
    });
}

function selectTrack() {
  const selectEl = document.getElementById("selectedTrack");
  const trackId = parseInt(selectEl.value);

  // Update local track length when track is selected
  if (trackId === 0) {
    trackLapLength = 0;
    currentTrackId = 0;
    currentTrackName = "";
  } else {
    const selectedTrack = allTracks.find((t) => t.trackId === trackId);
    if (selectedTrack) {
      trackLapLength = selectedTrack.distance;
      currentTrackId = selectedTrack.trackId;
      currentTrackName = selectedTrack.name;
      console.log(`Track selected: ${selectedTrack.name}, length: ${trackLapLength}m`);
    }
  }

  fetch("/tracks/select", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "trackId=" + trackId,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "OK") {
        console.log("Track selected on backend:", trackId);
        // Save to config
        fetch("/config", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selectedTrackId: trackId,
          }),
        });
      }
    })
    .catch((error) => console.error("Error selecting track:", error));
}

// ===== WEBHOOK MANAGEMENT =====

function toggleWebhooks(enabled) {
  const webhooksContent = document.getElementById("webhooksContent");
  if (webhooksContent) {
    webhooksContent.style.display = enabled ? "block" : "none";
  }

  // Enable/disable webhooks on backend
  fetch("/webhooks/enable", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "enabled=" + (enabled ? "1" : "0"),
  })
    .then((response) => response.json())
    .then((data) => {
      console.log("Webhooks:", enabled ? "enabled" : "disabled", data);
      if (enabled) {
        loadWebhooks();
      }
    })
    .catch((error) => console.error("Error toggling webhooks:", error));
}

function loadWebhooks() {
  fetch("/webhooks")
    .then((response) => response.json())
    .then((data) => {
      displayWebhooks(data.webhooks || []);
    })
    .catch((error) => console.error("Error loading webhooks:", error));
}

function displayWebhooks(webhooks) {
  const webhooksListContent = document.getElementById("webhooksListContent");
  if (!webhooksListContent) return;

  if (webhooks.length === 0) {
    webhooksListContent.innerHTML = `<p style="color: var(--secondary-color); text-align: center; padding: 16px;">${i18n.t("settings.webhooks.no_webhooks")}</p>`;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';

  webhooks.forEach((ip) => {
    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background-color: var(--bg-secondary); border-radius: 8px; border-left: 4px solid var(--accent-color);">
        <div>
          <a href="http://${ip}" target="_blank" style="font-weight: bold; font-size: 15px; color: var(--primary-color); text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${ip}</a>
          <div style="font-size: 13px; color: var(--secondary-color); margin-top: 2px;">http://${ip}/Lap, /RaceStart, /RaceStop</div>
        </div>
        <button onclick="removeWebhook('${ip}')" style="padding: 6px 12px; font-size: 14px; background-color: var(--danger-color);">${i18n.t("history.remove")}</button>
      </div>
    `;
  });

  html += "</div>";
  webhooksListContent.innerHTML = html;
}

function addWebhook() {
  const ipInput = document.getElementById("webhookIP");
  const ip = ipInput.value.trim();

  if (!ip) {
    alert(i18n.t("messages.webhook_enter_ip"));
    return;
  }

  // Basic IP validation
  const ipPattern = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (!ipPattern.test(ip)) {
    alert(i18n.t("messages.webhook_valid_ip"));
    return;
  }

  fetch("/webhooks/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "ip=" + encodeURIComponent(ip),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "OK") {
        ipInput.value = ""; // Clear input
        loadWebhooks(); // Reload list
        console.log("Webhook added:", ip);
      } else {
        alert(i18n.t("messages.webhook_add_error") + ": " + (data.message || "Unknown error"));
      }
    })
    .catch((error) => {
      console.error("Error adding webhook:", error);
      alert(i18n.t("messages.webhook_add_error"));
    });
}

function removeWebhook(ip) {
  if (!confirm(i18n.t("messages.webhook_remove_confirm", { ip: ip }))) {
    return;
  }

  fetch("/webhooks/remove", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "ip=" + encodeURIComponent(ip),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.status === "OK") {
        loadWebhooks(); // Reload list
        console.log("Webhook removed:", ip);
      } else {
        alert(i18n.t("messages.webhook_remove_error"));
      }
    })
    .catch((error) => {
      console.error("Error removing webhook:", error);
      alert("Error removing webhook");
    });
}

// ===== RACE LEADER COLOR =====

var currentLeaderColor = null; // Track last sent color to avoid redundant sends

function getLeaderColorMode() {
  return parseInt(localStorage.getItem("leaderColorMode") || "0");
}

function saveLeaderColorMode() {
  const mode = document.getElementById("leaderColorMode").value;
  localStorage.setItem("leaderColorMode", mode);
  console.log("Leader color mode set to:", mode);
}

// Restore dropdown on page load
document.addEventListener("DOMContentLoaded", function () {
  const sel = document.getElementById("leaderColorMode");
  if (sel) sel.value = localStorage.getItem("leaderColorMode") || "0";
});

function fastest3Consecutive(times) {
  if (times.length < 3) return Infinity;
  let best = Infinity;
  for (let i = 0; i <= times.length - 3; i++) {
    const sum = times[i] + times[i + 1] + times[i + 2];
    if (sum < best) best = sum;
  }
  return best;
}

function collectAllPilots() {
  const pilots = [];

  // Local pilot
  const localColor = document.getElementById("pilotColor")?.value || "#0080FF";
  if (lapTimes.length > 0) {
    pilots.push({
      name: pilotNameInput?.value || "Local",
      color: localColor,
      lapTimes: lapTimes,
      lapCount: lapTimes.length,
    });
  }

  // Remote pilots
  for (const [hostname, pilot] of Object.entries(remotePilots)) {
    if (pilot.lapTimes.length > 0) {
      const hex = "#" + ("000000" + pilot.pilotColor.toString(16)).slice(-6);
      pilots.push({
        name: pilot.pilotName,
        color: hex,
        lapTimes: pilot.lapTimes,
        lapCount: pilot.lapTimes.length,
      });
    }
  }

  return pilots;
}

function updateRaceLeader(mostRecentColor) {
  const mode = getLeaderColorMode();
  if (mode === 0 || !raceRunning) return;

  let leaderColor = null;

  if (mode === 4) {
    // Most recent lap - use the color passed in
    leaderColor = mostRecentColor || null;
  } else {
    const pilots = collectAllPilots();
    if (pilots.length === 0) return;

    let leader = null;

    if (mode === 1) {
      // Highest lap count
      leader = pilots.reduce((a, b) => (b.lapCount > a.lapCount ? b : a));
    } else if (mode === 2) {
      // Fastest single lap
      leader = pilots.reduce((a, b) => {
        const af = Math.min(...a.lapTimes);
        const bf = Math.min(...b.lapTimes);
        return bf < af ? b : a;
      });
    } else if (mode === 3) {
      // Fastest 3 consecutive
      leader = pilots.reduce((a, b) => {
        const af = fastest3Consecutive(a.lapTimes);
        const bf = fastest3Consecutive(b.lapTimes);
        return bf < af ? b : a;
      });
    } else if (mode === 5) {
      // Fastest average lap time
      leader = pilots.reduce((a, b) => {
        const aAvg = a.lapTimes.reduce((s, t) => s + t, 0) / a.lapTimes.length;
        const bAvg = b.lapTimes.reduce((s, t) => s + t, 0) / b.lapTimes.length;
        return bAvg < aAvg ? b : a;
      });
    }

    if (leader) leaderColor = leader.color;
  }

  if (!leaderColor || leaderColor === currentLeaderColor) return;

  currentLeaderColor = leaderColor;
  const hex = leaderColor.replace("#", "");
  console.log("[Leader] Race leader color:", hex);

  fetch("/led/racecolor", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "color=" + hex,
  }).catch((e) => console.error("[Leader] Failed to send race color:", e));
}

function clearRaceLeader() {
  currentLeaderColor = null;
}

// ===== GATE LED CONTROL =====

function loadGateDevices() {
  fetch("/webhooks")
    .then((r) => r.json())
    .then((data) => renderGateDevices(data.webhooks || []))
    .catch((e) => console.error("Error loading gate devices:", e));
}

function renderGateDevices(webhooks) {
  const container = document.getElementById("gateDevicesList");
  if (!container) return;

  if (webhooks.length === 0) {
    container.innerHTML = '<p style="color: var(--secondary-color); text-align: center; padding: 12px; font-size: 13px">No gate devices configured. Add webhook IPs in the Webhooks tab.</p>';
    return;
  }

  const esc = (ip) => ip.replace(/\./g, "_");
  let html = '';

  webhooks.forEach((ip, idx) => {
    const eid = esc(ip);
    html += `
      <div style="padding: 14px; background-color: var(--bg-secondary); border-radius: 8px; margin-bottom: 8px; border-left: 4px solid var(--accent-color)">
        <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer" onclick="toggleGateDetail('${eid}')">
          <div>
            <span style="font-weight: bold; font-size: 14px">Gate ${idx + 1}</span>
            <span style="font-size: 12px; color: var(--secondary-color); margin-left: 8px">${ip}</span>
          </div>
          <span id="gateArrow_${eid}" style="font-size: 12px; color: var(--secondary-color); transition: transform 0.2s">&#9660;</span>
        </div>
        <div id="gateDetail_${eid}" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color)">
          <div class="config-item" style="margin-bottom: 8px">
            <label style="min-width: 80px">Effect:</label>
            <select id="gateEffect_${eid}" style="flex: 1">
              <option value="off">Off</option>
              <option value="solid" selected>Solid</option>
              <option value="rainbow">Rainbow</option>
              <option value="fade">Color Fade</option>
              <option value="pulse">Pulse</option>
              <option value="sparkle">Sparkle</option>
            </select>
          </div>
          <div class="config-item" style="margin-bottom: 8px">
            <label style="min-width: 80px">Color:</label>
            <input type="color" id="gateColor_${eid}" value="#FF0000" style="height: 36px; flex: 1; max-width: 80px; border: 2px solid var(--border-color); border-radius: 4px" />
          </div>
          <div class="config-item" style="margin-bottom: 8px">
            <label style="min-width: 80px">Brightness:</label>
            <div style="flex: 1; display: flex; align-items: center; gap: 8px">
              <input type="range" id="gateBri_${eid}" min="0" max="255" value="200" style="flex: 1" oninput="document.getElementById('gateBriV_${eid}').textContent=this.value" />
              <span id="gateBriV_${eid}" style="font-size: 13px; min-width: 28px">200</span>
            </div>
          </div>
          <div class="config-item" style="margin-bottom: 12px">
            <label style="min-width: 80px">Speed:</label>
            <div style="flex: 1; display: flex; align-items: center; gap: 8px">
              <input type="range" id="gateSpd_${eid}" min="1" max="100" value="50" style="flex: 1" oninput="document.getElementById('gateSpdV_${eid}').textContent=this.value" />
              <span id="gateSpdV_${eid}" style="font-size: 13px; min-width: 28px">50</span>
            </div>
          </div>
          <button onclick="sendToGate('${ip}')" style="width: 100%; background-color: var(--accent-color)">Apply to Gate ${idx + 1}</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleGateDetail(eid) {
  const detail = document.getElementById("gateDetail_" + eid);
  const arrow = document.getElementById("gateArrow_" + eid);
  if (!detail) return;
  const visible = detail.style.display !== "none";
  detail.style.display = visible ? "none" : "block";
  if (arrow) arrow.style.transform = visible ? "" : "rotate(180deg)";
}

function sendToGate(ip) {
  const eid = ip.replace(/\./g, "_");
  const colorHex = document.getElementById("gateColor_" + eid).value;
  const r = parseInt(colorHex.substring(1, 3), 16);
  const g = parseInt(colorHex.substring(3, 5), 16);
  const b = parseInt(colorHex.substring(5, 7), 16);
  const payload = {
    ip: ip,
    effect: document.getElementById("gateEffect_" + eid).value,
    brightness: parseInt(document.getElementById("gateBri_" + eid).value),
    speed: parseInt(document.getElementById("gateSpd_" + eid).value),
    color: [r, g, b],
  };
  fetch("/webhooks/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((d) => console.log("Gate " + ip + ":", d))
    .catch((e) => console.error("Gate send error:", e));
}

function sendToAllGates() {
  const colorHex = document.getElementById("gateColorAll").value;
  const r = parseInt(colorHex.substring(1, 3), 16);
  const g = parseInt(colorHex.substring(3, 5), 16);
  const b = parseInt(colorHex.substring(5, 7), 16);
  const payload = {
    ip: "all",
    effect: document.getElementById("gateEffectAll").value,
    brightness: parseInt(document.getElementById("gateBrightnessAll").value),
    speed: parseInt(document.getElementById("gateSpeedAll").value),
    color: [r, g, b],
  };
  fetch("/webhooks/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .then((d) => console.log("All gates:", d))
    .catch((e) => console.error("Gate send error:", e));
}

function testWebhook() {
  fetch("/webhooks/trigger/flash", {
    method: "POST",
  })
    .then((response) => {
      if (!response.ok) {
        return response.json().then((data) => {
          throw new Error(data.message || "Unknown error");
        });
      }
      return response.json();
    })
    .then((data) => {
      if (data.status === "OK") {
        alert(i18n.t("messages.webhook_test_sent"));
      } else {
        alert(i18n.t("messages.error_generic", { n: data.message || "Unknown error" }));
      }
    })
    .catch((error) => {
      console.error("Error testing webhook:", error);
      alert(i18n.t("messages.error_generic", { n: error.message }));
    });
}

// Load tracks when settings modal opens
function openSettingsModal() {
  closeRaceNotesModal();
  const modal = document.getElementById("settingsModal");
  if (modal) {
  modal.classList.add("active");
    syncOpenRaceNotesOnRaceEndToggle();

    // Load full config to populate all settings
    _refreshingFromDevice = true;
    clearTimeout(saveTimeout);
    fetch("/config")
      .then((response) => response.json())
      .then((config) => {
        // When band selectors look invalid, sync band/channel from device (touch / stale DOM).
        // If band DOM looks healthy, keep current selection so an unsaved local change is not
        // overwritten after clearTimeout(saveTimeout) (main debounce behavior).
        const bandOpt =
          bandSelect && bandSelect.selectedIndex >= 0
            ? bandSelect.options[bandSelect.selectedIndex]
            : null;
        const needBandFromDevice =
          !bandSelect ||
          bandSelect.selectedIndex < 0 ||
          !(bandOpt && bandOpt.dataset && bandOpt.dataset.bandIndex);
        if (needBandFromDevice && config.bandIndex !== undefined && config.channelIndex !== undefined) {
          const bandDef = bandDefinitions[config.bandIndex];
          if (bandDef) {
            currentSystem = bandDef.system;
            if (systemSelect) systemSelect.value = currentSystem;
            if (calibSystemSelect) calibSystemSelect.value = currentSystem;
            populateBandsBySystem(currentSystem, bandSelect);
            populateBandsBySystem(currentSystem, calibBandSelect);
            const filteredBands = bandDefinitions.filter(b => b.system === currentSystem);
            const localBandIdx = filteredBands.findIndex(b => b.index === config.bandIndex);
            if (localBandIdx >= 0) {
              if (bandSelect) bandSelect.selectedIndex = localBandIdx;
              if (calibBandSelect) calibBandSelect.selectedIndex = localBandIdx;
            }
            updateChannelAvailability(bandSelect);
            updateChannelAvailability(calibBandSelect);
            if (channelSelect) channelSelect.selectedIndex = config.channelIndex;
            if (calibChannelSelect) calibChannelSelect.selectedIndex = config.channelIndex;
            if (config.freq !== undefined) frequency = config.freq;
            populateFreqOutput();
            if (calibBandSelect && calibChannelSelect && calibFreqOutput && calibBandSelect.selectedIndex !== -1) {
              const selOpt = calibBandSelect.options[calibBandSelect.selectedIndex];
              if (selOpt) {
                const cv = calibChannelSelect.options[calibChannelSelect.selectedIndex]?.value || "1";
                calibFreqOutput.textContent = selOpt.value + cv + " " + frequency + "MHz";
              }
            }
          }
        } else if (needBandFromDevice && config.freq !== undefined) {
          setBandChannelIndex(config.freq);
        }
        if (config.minLap !== undefined) {
          minLapInput.value = (parseFloat(config.minLap) / 10).toFixed(1);
          updateMinLap(minLapInput, minLapInput.value);
        }
        if (config.anType !== undefined) announcerSelect.selectedIndex = config.anType;
        if (config.anRate !== undefined) {
          announcerRateInput.value = (parseFloat(config.anRate) / 10).toFixed(1);
          updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
        }
        if (config.enterRssi !== undefined) {
          enterRssiInput.value = config.enterRssi;
          updateEnterRssi(enterRssiInput, enterRssiInput.value);
        }
        if (config.exitRssi !== undefined) {
          exitRssiInput.value = config.exitRssi;
          updateExitRssi(exitRssiInput, exitRssiInput.value);
        }
        if (config.raceCountdownMode !== undefined) {
          raceCountdownMode = parseInt(config.raceCountdownMode) === 0 ? 0 : 1;
          const rcEl = document.getElementById("raceCountdownMode");
          if (rcEl) rcEl.value = String(raceCountdownMode);
        }
        if (config.name !== undefined) pilotNameInput.value = config.name;
        if (config.ssid !== undefined) ssidInput.value = config.ssid;
        if (config.pwd !== undefined) pwdInput.value = config.pwd;
        if (config.maxLaps !== undefined) {
          maxLapsInput.value = config.maxLaps;
          updateMaxLaps(maxLapsInput, maxLapsInput.value);
        }

        // LED settings
        const ledBrightnessInput = document.getElementById("ledBrightness");
        if (config.ledBrightness !== undefined && ledBrightnessInput) {
          ledBrightnessInput.value = config.ledBrightness;
          updateLedBrightness(ledBrightnessInput, config.ledBrightness);
        }

        // Pilot settings
        const callsignInput = document.getElementById("pcallsign");
        const phoneticInput = document.getElementById("pphonetic");
        const colorInput = document.getElementById("pilotColor");
        if (callsignInput && config.pilotCallsign !== undefined) {
          callsignInput.value = config.pilotCallsign;
        }
        if (phoneticInput && config.pilotPhonetic !== undefined) {
          phoneticInput.value = config.pilotPhonetic;
        }
        if (colorInput && config.pilotColor !== undefined) {
          const hexColor = "#" + ("000000" + config.pilotColor.toString(16)).slice(-6).toUpperCase();
          colorInput.value = hexColor;
          updateColorPreview();
        }

        // Voice and lap format settings
        const voiceSelect = document.getElementById("voiceSelect");
        const lapFormatSelect = document.getElementById("lapFormatSelect");
        if (voiceSelect) {
          selectedVoice = normalizeVoiceSelectionValue(config.selectedVoice || "default");
          voiceSelect.value = selectedVoice;
          if (audioAnnouncer) audioAnnouncer.setVoice(selectedVoice);
        }
        if (lapFormatSelect && config.lapFormat) {
          lapFormatSelect.value = config.lapFormat;
          lapFormat = config.lapFormat;
        }

        // Theme setting
        const themeSelect = document.getElementById("themeSelect");
        if (themeSelect && config.theme) {
          themeSelect.value = config.theme;
        }

        // Gate LEDs and webhook event settings
        const gateLEDsEnabledToggle = document.getElementById("gateLEDsEnabled");
        const webhookRaceStartToggle = document.getElementById("webhookRaceStart");
        const webhookRaceStopToggle = document.getElementById("webhookRaceStop");
        const webhookLapToggle = document.getElementById("webhookLap");
        const gateLEDOptions = document.getElementById("gateLEDOptions");

        if (gateLEDsEnabledToggle && config.gateLEDsEnabled !== undefined) {
          gateLEDsEnabledToggle.checked = config.gateLEDsEnabled === 1;
          if (gateLEDOptions) {
            gateLEDOptions.style.display = config.gateLEDsEnabled === 1 ? "block" : "none";
          }
          if (config.gateLEDsEnabled === 1) loadGateDevices();
        }

        if (webhookRaceStartToggle && config.webhookRaceStart !== undefined) {
          webhookRaceStartToggle.checked = config.webhookRaceStart === 1;
        }

        if (webhookRaceStopToggle && config.webhookRaceStop !== undefined) {
          webhookRaceStopToggle.checked = config.webhookRaceStop === 1;
        }

        if (webhookLapToggle && config.webhookLap !== undefined) {
          webhookLapToggle.checked = config.webhookLap === 1;
        }

        // Tracks
        const tracksEnabled = config.tracksEnabled === 1;
        const tracksCheckbox = document.getElementById("tracksEnabled");
        if (tracksCheckbox) {
          tracksCheckbox.checked = tracksEnabled;
          toggleTracksEnabled(tracksEnabled);
        }

        // Set selected track
        if (config.selectedTrackId) {
          const selectEl = document.getElementById("selectedTrack");
          if (selectEl) {
            selectEl.value = config.selectedTrackId;
          }
        }

        // Webhooks
        const webhooksEnabled = config.webhooksEnabled === 1;
        const webhooksCheckbox = document.getElementById("webhooksEnabled");
        if (webhooksCheckbox) {
          webhooksCheckbox.checked = webhooksEnabled;
          toggleWebhooks(webhooksEnabled);
        }
        
        // Race Sync Settings
        if (config.timerNumber !== undefined) {
          timerNumber = config.timerNumber;
          const timerSelect = document.getElementById("timerNumber");
          if (timerSelect) {
            timerSelect.value = String(config.timerNumber);
            console.log("[Sync] Loaded timerNumber:", config.timerNumber, "dropdown value:", timerSelect.value);
          }
        }
        
        if (config.raceSyncMode !== undefined) {
          raceSyncMode = config.raceSyncMode;
          updateRaceSyncMode(config.raceSyncMode, true);  // skipSave=true when loading
        }
        if (config.rhEnabled !== undefined) {
          rhEnabled = config.rhEnabled;
        }
        if (config.rhHostIP !== undefined) {
          const rhHostIPEl = document.getElementById('rhHostIP');
          if (rhHostIPEl) rhHostIPEl.value = config.rhHostIP;
        }
        if (config.rhNodeIndex !== undefined) {
          const rhNodeIndexEl = document.getElementById('rhNodeIndex');
          if (rhNodeIndexEl) rhNodeIndexEl.value = config.rhNodeIndex;
        }
        
        if (config.syncedTimers && Array.isArray(config.syncedTimers)) {
          syncedTimers = config.syncedTimers.slice(); // Copy array
        }
        
        if (config.masterHostname !== undefined) {
          masterHostname = config.masterHostname;
        }
        
        // Initialize unified sync devices list from loaded config
        initSyncDevicesFromConfig();
        renderSyncDevicesList();
        
        // Ensure mode UI is updated (badges, race view)
        updateSlaveModelUI();
        
        // Mark config as loaded - now saves are allowed
        configLoaded = true;
        _refreshingFromDevice = false;
        console.log("[Config] Initial config loaded from device");
      })
      .catch((error) => {
        _refreshingFromDevice = false;
        console.error("Error loading config:", error);
      });

    // Switch to general section by default
    switchSettingsSection(null, "general");
  }
}
