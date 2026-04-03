// FPVGate OSD - Real-time overlay for streaming
// Connects to the FPVGate web server and displays live race data

// State
let lapNo = -1;
let lapTimes = [];
let maxLaps = 0;
let raceStartTime = 0;
let raceRunning = false;
let timerInterval = null;
let currentLapStartTime = 0;

// Split time state: key "from-to" -> {from, to, latest, best, latestLap}
let splitSectors = {};

// Pilot info
let pilotCallsign = '';
let pilotChannel = '';

// DOM elements
const timer = document.getElementById('timer');
const lapCounter = document.getElementById('lapCounter');
const currentLapTime = document.getElementById('currentLapTime');
const lastLapTime = document.getElementById('lastLapTime');
const fastestLap = document.getElementById('fastestLap');
const fastest3Consec = document.getElementById('fastest3Consec');
const medianLap = document.getElementById('medianLap');
const pilotCallsignElem = document.getElementById('pilotCallsign');
const pilotChannelElem = document.getElementById('pilotChannel');
const lapsTableBody = document.getElementById('lapsTableBody');
const splitsSection = document.getElementById('splitsSection');
const splitsTableBody = document.getElementById('splitsTableBody');

// Band/Channel lookup table (same as main script.js)
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
  [5669, 5705, 5768, 5804, 5839, 5876, 5912, 0],    // DJI03/04-10/20
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

const bandNames = ['A', 
                   'B', 
                   'E', 
                   'F', 
                   'R', 
                   'L', 
                   'DJIv1-25', 
                   'DJIv1-25CE', 
                   'DJIv1_50', 
                   'DJI03/04-20', 
                   'DJI03/04-20CE',
                   'DJI03/04-40', 
                   'DJI03/04-40CE', 
                   'DJI04-R',
                   'HDZero-R',
                   'HDZero-E', 
                   'HDZero-F', 
                   'HDZero-CE',
                   'WalkSnail-R',
                   'WalkSnail-25',
                   'WalkSnail-25CE',
                   'WalkSnail-50'];

// Initialize on load
window.addEventListener('load', () => {
  console.log('FPVGate OSD loaded');
  loadConfig();
  connectToEvents();
  startCurrentLapTimer();
  loadSplits();
});

// Load configuration
function loadConfig() {
  fetch('/config')
    .then(response => response.json())
    .then(config => {
      console.log('Config loaded:', config);
      
      // Get pilot callsign from localStorage (frontend setting)
      pilotCallsign = localStorage.getItem('pilotCallsign') || config.name || 'Pilot';
      pilotCallsignElem.textContent = pilotCallsign;
      
      // Apply pilot color from localStorage to pilot name
      const pilotColor = localStorage.getItem('pilotColor') || '#0080FF';
      pilotCallsignElem.style.color = pilotColor;
      pilotCallsignElem.style.textShadow = `0 0 15px ${pilotColor}CC, 2px 2px 8px rgba(0, 0, 0, 0.9)`;
      
      // Determine channel display
      const bandChannel = getBandChannelFromFreq(config.freq);
      pilotChannel = bandChannel ? `${bandChannel.band}${bandChannel.channel} (${config.freq}MHz)` : `${config.freq}MHz`;
      pilotChannelElem.textContent = pilotChannel;
      
      maxLaps = config.maxLaps || 0;
      updateLapCounter();
    })
    .catch(error => {
      console.error('Failed to load config:', error);
      pilotCallsignElem.textContent = i18n.t('osd.connection_error');
    });
}

// Get band/channel from frequency
function getBandChannelFromFreq(freq) {
  for (let i = 0; i < freqLookup.length; i++) {
    for (let j = 0; j < freqLookup[i].length; j++) {
      if (freqLookup[i][j] === freq) {
        return { band: bandNames[i], channel: j + 1 };
      }
    }
  }
  return null;
}

// Connect to EventSource for real-time updates
function connectToEvents() {
  if (!window.EventSource) {
    console.error('EventSource not supported');
    return;
  }

  const source = new EventSource('/events');

  source.addEventListener('open', () => {
    console.log('Connected to event stream');
  });

  source.addEventListener('error', (e) => {
    if (e.target.readyState !== EventSource.OPEN) {
      console.error('Event stream disconnected');
    }
  });

  // Listen for lap events
  source.addEventListener('lap', (e) => {
    const lapTimeMs = parseFloat(e.data);
    const lapTimeSec = (lapTimeMs / 1000).toFixed(2);
    console.log('Lap received:', lapTimeSec);
    addLap(parseFloat(lapTimeSec));
  });

  // Listen for race state events
  source.addEventListener('raceState', (e) => {
    console.log('Race state changed:', e.data);
    if (e.data === 'started') {
      handleRaceStart();
    } else if (e.data === 'stopped') {
      handleRaceStop();
    } else if (e.data === 'cleared') {
      handleClearLaps();
    }
  });

  // Optional: Listen for RSSI updates (not displayed but could be added)
  source.addEventListener('rssi', (e) => {
    // RSSI value received - could be displayed if needed
  });

  // Listen for split gate crossing events
  source.addEventListener('splitUpdate', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.sectors && data.sectors.length > 0) {
        updateSplits(data.sectors);
      }
    } catch (err) {
      console.error('Failed to parse splitUpdate:', err);
    }
  });
}

// Update timer display
function startTimer() {
  if (timerInterval) return;
  
  raceStartTime = Date.now();
  raceRunning = true;
  currentLapStartTime = raceStartTime;
  
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - raceStartTime;
    updateTimerDisplay(elapsed);
    updateCurrentLapDisplay();
  }, 50); // Update every 50ms for smooth display
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  raceRunning = false;
}

function updateTimerDisplay(elapsedMs) {
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const centiseconds = Math.floor((elapsedMs % 1000) / 10);
  
  timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

// Update current lap in progress
function startCurrentLapTimer() {
  setInterval(() => {
    updateCurrentLapDisplay();
  }, 100);
}

function updateCurrentLapDisplay() {
  if (!raceRunning || !currentLapStartTime) {
    currentLapTime.textContent = '00.00' + i18n.t('race.table.seconds_short');
    return;
  }

  const elapsed = Date.now() - currentLapStartTime;
  const seconds = (elapsed / 1000).toFixed(2);
  currentLapTime.textContent = seconds + i18n.t('race.table.seconds_short');
}

// Handle race start from backend
function handleRaceStart() {
  console.log('Race started by user');
  // Reset everything
  lapNo = -1;
  lapTimes = [];
  splitSectors = {};
  startTimer();
  updateLapCounter();
  clearStats();
  clearLapsTable();
  updateSplitsDisplay();
}

// Handle race stop from backend
function handleRaceStop() {
  console.log('Race stopped by user');
  stopTimer();
}

// Handle clear laps from backend
function handleClearLaps() {
  console.log('Laps cleared by user');
  // Reset lap data
  lapNo = -1;
  lapTimes = [];
  splitSectors = {};
  updateLapCounter();
  clearStats();
  clearLapsTable();
  updateSplitsDisplay();
  // Reset timer display to default
  timer.textContent = '00:00.00';
  currentLapTime.textContent = '00.00' + i18n.t('race.table.seconds_short');
}

// Add lap
function addLap(lapTimeSec) {
  // If race hasn't started yet, start it now (backup)
  if (!raceRunning) {
    console.log('Race auto-started on first lap');
    startTimer();
  }
  
  lapNo++;
  lapTimes.push(lapTimeSec);
  currentLapStartTime = Date.now(); // Reset for next lap
  
  updateLapCounter();
  updateLastLap(lapTimeSec);
  updateStats();
  updateLapsTable();
  
  // Highlight timer section briefly
  const timerSection = document.querySelector('.timer-section');
  timerSection.classList.add('new-lap');
  setTimeout(() => {
    timerSection.classList.remove('new-lap');
  }, 1000);
  
  // Check if race is complete (if max laps is set)
  if (maxLaps > 0 && lapNo >= maxLaps) {
    stopTimer();
  }
}

// Update lap counter
function updateLapCounter() {
  if (maxLaps === 0) {
    lapCounter.textContent = i18n.t('osd.lap', { n: Math.max(0, lapNo) });
  } else {
    lapCounter.textContent = i18n.t('osd.lap_of', { n: Math.max(0, lapNo), total: maxLaps });
  }
}

// Update last lap
function updateLastLap(lapTime) {
  
  lastLapTime.textContent = lapTime + i18n.t('race.table.seconds_short');
  // Highlight if it's the fastest (excluding Gate 1)
  const validLaps = lapTimes.slice(1); // Skip first lap (Gate 1)
  const fastest = validLaps.length > 0 ? Math.min(...validLaps) : null;
  if (fastest && lapTime === fastest) {
    lastLapTime.style.color = '#ffd700';
  } else {
    lastLapTime.style.color = '#ffffff';
  }
}

// Update statistics
function updateStats() {
  // Exclude first lap (Gate 1) from all statistics
  const validLaps = lapTimes.slice(1);
  
  if (validLaps.length === 0) {
    fastestLap.textContent = '--';
    fastest3Consec.textContent = '--';
    medianLap.textContent = '--';
    return;
  }
  
  // Fastest Lap (excluding Gate 1)
  const fastest = Math.min(...validLaps);
  
  fastestLap.textContent = fastest.toFixed(2) + i18n.t('race.table.seconds_short');
  
  // Fastest 3 Consecutive (excluding Gate 1)
  if (validLaps.length >= 3) {
    let fastestConsecTime = Infinity;
    
    for (let i = 0; i <= validLaps.length - 3; i++) {
      const consecTime = validLaps[i] + validLaps[i + 1] + validLaps[i + 2];
      if (consecTime < fastestConsecTime) {
        fastestConsecTime = consecTime;
      }
    }
    
    fastest3Consec.textContent = fastestConsecTime.toFixed(2) + i18n.t('race.table.seconds_short');
  } else {
    fastest3Consec.textContent = '--';
  }
  
  // Median Lap (excluding Gate 1)
  const sorted = [...validLaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
  medianLap.textContent = median.toFixed(2) + i18n.t('race.table.seconds_short');
}

// Clear stats display
function clearStats() {
  lastLapTime.textContent = '--';
  fastestLap.textContent = '--';
  fastest3Consec.textContent = '--';
  medianLap.textContent = '--';
}

// Clear laps table
function clearLapsTable() {
  lapsTableBody.innerHTML = '';
}

// Load initial split times (for late-joining or page refresh during a race)
function loadSplits() {
  fetch('/api/splits')
    .then(r => r.json())
    .then(data => {
      if (data.sectors && data.sectors.length > 0) {
        const sectors = data.sectors.map(s => ({
          from: s.fromGate,
          to: s.toGate,
          timeMs: s.sectorTimeMs,
          lap: s.lapIndex
        }));
        updateSplits(sectors);
      }
    })
    .catch(() => {});
}

// Rebuild split sector state from a full sector list (SSE or REST)
function updateSplits(sectors) {
  const newSectors = {};
  sectors.forEach(s => {
    const key = `${s.from}-${s.to}`;
    if (!newSectors[key]) {
      newSectors[key] = { from: s.from, to: s.to, latest: s.timeMs, best: s.timeMs, latestLap: s.lap };
    } else {
      if (s.timeMs < newSectors[key].best) newSectors[key].best = s.timeMs;
      if (s.lap > newSectors[key].latestLap) {
        newSectors[key].latest = s.timeMs;
        newSectors[key].latestLap = s.lap;
      }
    }
  });
  splitSectors = newSectors;
  updateSplitsDisplay();
}

// Render the split times table
function updateSplitsDisplay() {
  if (!splitsSection || !splitsTableBody) return;

  const keys = Object.keys(splitSectors);
  if (keys.length === 0) {
    splitsSection.style.display = 'none';
    return;
  }

  splitsSection.style.display = '';
  splitsTableBody.innerHTML = '';

  keys.sort().forEach(key => {
    const s = splitSectors[key];
    const isNewBest = s.latest === s.best;
    const row = splitsTableBody.insertRow();
    if (isNewBest) row.classList.add('split-best-row');

    const labelCell = row.insertCell(0);
    labelCell.textContent = `G${s.from}-G${s.to}`;

    const latestCell = row.insertCell(1);
    latestCell.textContent = (s.latest / 1000).toFixed(2) + i18n.t('race.table.seconds_short');

    const bestCell = row.insertCell(2);
    bestCell.textContent = (s.best / 1000).toFixed(2) + i18n.t('race.table.seconds_short');
    bestCell.classList.add('split-best');
  });
}

// Update laps table (show last 5 laps)
function updateLapsTable() {
  const recentLaps = lapTimes.slice(-5).reverse(); // Last 5 laps, most recent first
  const startIndex = Math.max(0, lapTimes.length - 5);
  // Calculate fastest excluding Gate 1 (first lap)
  const validLaps = lapTimes.slice(1);
  const fastest = validLaps.length > 0 ? Math.min(...validLaps) : null;
  
  lapsTableBody.innerHTML = '';
  
  recentLaps.forEach((lapTime, index) => {
    const actualIndex = lapTimes.length - 1 - index;
    const row = lapsTableBody.insertRow();
    
    // Highlight fastest lap (but not if it's Gate 1)
    if (actualIndex > 0 && fastest && lapTime === fastest) {
      row.classList.add('fastest-lap');
    }
    
    // Lap number
    const lapNumCell = row.insertCell(0);
    
    lapNumCell.textContent = actualIndex === 0 ? i18n.t('osd.gate1_short') : `${i18n.t('osd.lap_prefix')}${actualIndex}`;
    // Lap time
    const lapTimeCell = row.insertCell(1);
    
    lapTimeCell.textContent = lapTime.toFixed(2) + i18n.t('race.table.seconds_short');
    // Gap to fastest
    const gapCell = row.insertCell(2);
    // Don't show gap for Gate 1, and calculate gap to fastest (excluding Gate 1)
    if (actualIndex === 0 || !fastest) {
      gapCell.textContent = '--';
    } else if (lapTime !== fastest) {
      const gap = (lapTime - fastest).toFixed(2);
      gapCell.textContent = `+${gap}` + i18n.t('race.table.seconds_short');
    } else {
      gapCell.textContent = '--';
    }
  });
}

