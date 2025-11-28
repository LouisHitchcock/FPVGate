const bcf = document.getElementById("bandChannelFreq");
const bandSelect = document.getElementById("bandSelect");
const channelSelect = document.getElementById("channelSelect");
const freqOutput = document.getElementById("freqOutput");
const announcerSelect = document.getElementById("announcerSelect");
const announcerRateInput = document.getElementById("rate");
const enterRssiInput = document.getElementById("enter");
const exitRssiInput = document.getElementById("exit");
const enterRssiSpan = document.getElementById("enterSpan");
const exitRssiSpan = document.getElementById("exitSpan");
const pilotNameInput = document.getElementById("pname");
const ssidInput = document.getElementById("ssid");
const pwdInput = document.getElementById("pwd");
const minLapInput = document.getElementById("minLap");
const alarmThreshold = document.getElementById("alarmThreshold");
const maxLapsInput = document.getElementById("maxLaps");

const freqLookup = [
  [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725],
  [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866],
  [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945],
  [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880],
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917],
  [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621],
];

const config = document.getElementById("config");
const race = document.getElementById("race");
const calib = document.getElementById("calib");
const ota = document.getElementById("ota");

var enterRssi = 120,
  exitRssi = 100;
var frequency = 0;
var announcerRate = 1.0;

var lapNo = -1;
var lapTimes = [];
var maxLaps = 0;

var timerInterval;
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

var audioEnabled = false;
var speakObjsQueue = [];

onload = function (e) {
  // Load dark mode preference
  loadDarkMode();
  
  config.style.display = "none";
  race.style.display = "block";
  calib.style.display = "none";
  fetch("/config")
    .then((response) => response.json())
    .then((config) => {
      console.log(config);
      setBandChannelIndex(config.freq);
      minLapInput.value = (parseFloat(config.minLap) / 10).toFixed(1);
      updateMinLap(minLapInput, minLapInput.value);
      alarmThreshold.value = (parseFloat(config.alarm) / 10).toFixed(1);
      updateAlarmThreshold(alarmThreshold, alarmThreshold.value);
      announcerSelect.selectedIndex = config.anType;
      announcerRateInput.value = (parseFloat(config.anRate) / 10).toFixed(1);
      updateAnnouncerRate(announcerRateInput, announcerRateInput.value);
      enterRssiInput.value = config.enterRssi;
      updateEnterRssi(enterRssiInput, enterRssiInput.value);
      exitRssiInput.value = config.exitRssi;
      updateExitRssi(exitRssiInput, exitRssiInput.value);
      pilotNameInput.value = config.name;
      ssidInput.value = config.ssid;
      pwdInput.value = config.pwd;
      maxLapsInput.value = (config.maxLaps !== undefined) ? config.maxLaps : 0;
      updateMaxLaps(maxLapsInput, maxLapsInput.value);
      
      // Load pilot callsign, phonetic name, and color from localStorage (frontend-only settings)
      const savedCallsign = localStorage.getItem('pilotCallsign') || '';
      const savedPhonetic = localStorage.getItem('pilotPhonetic') || '';
      const savedColor = localStorage.getItem('pilotColor') || '#0080FF';
      const callsignInput = document.getElementById('pcallsign');
      const phoneticInput = document.getElementById('pphonetic');
      const colorInput = document.getElementById('pilotColor');
      if (callsignInput) callsignInput.value = savedCallsign;
      if (phoneticInput) phoneticInput.value = savedPhonetic;
      if (colorInput) {
        colorInput.value = savedColor;
        updateColorPreview();
      }
      populateFreqOutput();
      stopRaceButton.disabled = true;
      startRaceButton.disabled = false;
      addLapButton.disabled = true;
      clearInterval(timerInterval);
      timer.innerHTML = "00:00:00s";
      clearLaps();
      createRssiChart();
      // Auto-enable voice on load
      enableAudioLoop();
      // Setup pilot color preview
      const colorSelect = document.getElementById('pilotColor');
      if (colorSelect) {
        colorSelect.addEventListener('change', updateColorPreview);
        updateColorPreview();
      }
    });
};

function getBatteryVoltage() {
  fetch("/status")
    .then((response) => response.text())
    .then((response) => {
      const batteryVoltageMatch = response.match(/Battery Voltage:\s*([\d.]+v)/);
      const batteryVoltage = batteryVoltageMatch ? batteryVoltageMatch[1] : null;
      batteryVoltageDisplay.innerText = batteryVoltage;
    });
}

setInterval(getBatteryVoltage, 2000);

function addRssiPoint() {
  if (calib.style.display != "none") {
    rssiChart.start();
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

    // update horizontal lines and min max values
    rssiChart.options.horizontalLines = [
      { color: "hsl(8.2, 86.5%, 53.7%)", lineWidth: 1.7, value: enterRssi }, // red
      { color: "hsl(25, 85%, 55%)", lineWidth: 1.7, value: exitRssi }, // orange
    ];

    rssiChart.options.maxValue = Math.max(maxRssiValue, enterRssi + 10);

    rssiChart.options.minValue = Math.max(0, Math.min(minRssiValue, exitRssi - 10));

    var now = Date.now();
    rssiSeries.append(now, rssiValue);
    if (crossing) {
      rssiCrossingSeries.append(now, 256);
    } else {
      rssiCrossingSeries.append(now, -10);
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

  // if event comes from calibration tab, signal to start sending RSSI events
  if (tabName === "calib" && !rssiSending) {
    fetch("/timer/rssiStart", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (response.ok) rssiSending = true;
        return response.json();
      })
      .then((response) => console.log("/timer/rssiStart:" + JSON.stringify(response)));
  } else if (rssiSending) {
    fetch("/timer/rssiStop", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
      .then((response) => {
        if (response.ok) rssiSending = false;
        return response.json();
      })
      .then((response) => console.log("/timer/rssiStop:" + JSON.stringify(response)));
  }
  
  // Load race history when opening history tab
  if (tabName === 'history') {
    loadRaceHistory();
  }
}

function updateEnterRssi(obj, value) {
  enterRssi = parseInt(value);
  enterRssiSpan.textContent = enterRssi;
  if (enterRssi <= exitRssi) {
    exitRssi = Math.max(0, enterRssi - 1);
    exitRssiInput.value = exitRssi;
    exitRssiSpan.textContent = exitRssi;
  }
}

function updateExitRssi(obj, value) {
  exitRssi = parseInt(value);
  exitRssiSpan.textContent = exitRssi;
  if (exitRssi >= enterRssi) {
    enterRssi = Math.min(255, exitRssi + 1);
    enterRssiInput.value = enterRssi;
    enterRssiSpan.textContent = enterRssi;
  }
}

// Debounced auto-save to prevent excessive API calls
let saveTimeout = null;
function autoSaveConfig() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveConfig();
  }, 1000); // Wait 1 second after last change before saving
}

function saveConfig() {
  // Save frontend-only settings to localStorage
  const callsignInput = document.getElementById('pcallsign');
  const phoneticInput = document.getElementById('pphonetic');
  const colorInput = document.getElementById('pilotColor');
  if (callsignInput) localStorage.setItem('pilotCallsign', callsignInput.value);
  if (phoneticInput) localStorage.setItem('pilotPhonetic', phoneticInput.value);
  if (colorInput) localStorage.setItem('pilotColor', colorInput.value);
  
  // Save backend settings
  fetch("/config", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      freq: frequency,
      minLap: parseInt(minLapInput.value * 10),
      alarm: parseInt(alarmThreshold.value * 10),
      anType: announcerSelect.selectedIndex,
      anRate: parseInt(announcerRate * 10),
      enterRssi: enterRssi,
      exitRssi: exitRssi,
      maxLaps: maxLaps,
      name: pilotNameInput.value,
      ssid: ssidInput.value,
      pwd: pwdInput.value,
    }),
  })
    .then((response) => response.json())
    .then((response) => console.log("/config:" + JSON.stringify(response)));
}

function populateFreqOutput() {
  let band = bandSelect.options[bandSelect.selectedIndex].value;
  let chan = channelSelect.options[channelSelect.selectedIndex].value;
  frequency = freqLookup[bandSelect.selectedIndex][channelSelect.selectedIndex];
  freqOutput.textContent = band + chan + " " + frequency;
}

bcf.addEventListener("change", function handleChange(event) {
  populateFreqOutput();
  autoSaveConfig();
});

// Add auto-save listeners for other inputs
if (announcerSelect) {
  announcerSelect.addEventListener('change', autoSaveConfig);
}
if (pilotNameInput) {
  pilotNameInput.addEventListener('input', autoSaveConfig);
}
const callsignInput = document.getElementById('pcallsign');
if (callsignInput) {
  callsignInput.addEventListener('input', autoSaveConfig);
}
const phoneticInput = document.getElementById('pphonetic');
if (phoneticInput) {
  phoneticInput.addEventListener('input', autoSaveConfig);
}
const colorInput = document.getElementById('pilotColor');
if (colorInput) {
  colorInput.addEventListener('change', autoSaveConfig);
}
const batteryToggle = document.getElementById('batteryMonitorToggle');
if (batteryToggle) {
  batteryToggle.addEventListener('change', autoSaveConfig);
}

function updateAnnouncerRate(obj, value) {
  announcerRate = parseFloat(value);
  $(obj).parent().find("span").text(announcerRate.toFixed(1));
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
    displayText = "Infinite";
  } else if (maxLaps === 1) {
    displayText = "1 lap";
  } else {
    displayText = maxLaps + " laps";
  }
  $(obj)
    .parent()
    .find("span")
    .text(displayText);
  // Auto-save when changed
  autoSaveConfig();
}

// function getAnnouncerVoices() {
//   $().articulate("getVoices", "#voiceSelect", "System Default Announcer Voice");
// }

function beep(duration, frequency, type) {
  var context = new AudioContext();
  var oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.connect(context.destination);
  oscillator.start();
  // Beep for 500 milliseconds
  setTimeout(function () {
    oscillator.stop();
  }, duration);
}

function addLap(lapStr) {
  // Use phonetic name for TTS if available, otherwise use regular pilot name
  const phoneticInput = document.getElementById('pphonetic');
  const pilotName = (phoneticInput && phoneticInput.value) ? phoneticInput.value : pilotNameInput.value;
  var last2lapStr = "";
  var last3lapStr = "";
  const newLap = parseFloat(lapStr);
  lapNo += 1;
  const table = document.getElementById("lapTable");
  const row = table.insertRow();
  const cell1 = row.insertCell(0);
  const cell2 = row.insertCell(1);
  const cell3 = row.insertCell(2);
  const cell4 = row.insertCell(3);
  cell1.innerHTML = lapNo;
  if (lapNo == 0) {
    cell2.innerHTML = "Hole Shot: " + lapStr + "s";
  } else {
    cell2.innerHTML = lapStr + "s";
  }
  if (lapTimes.length >= 2 && lapNo != 0) {
    last2lapStr = (newLap + lapTimes[lapTimes.length - 1]).toFixed(2);
    cell3.innerHTML = last2lapStr + "s";
  }
  if (lapTimes.length >= 3 && lapNo != 0) {
    last3lapStr = (newLap + lapTimes[lapTimes.length - 2] + lapTimes[lapTimes.length - 1]).toFixed(2);
    cell4.innerHTML = last3lapStr + "s";
  }

  switch (announcerSelect.options[announcerSelect.selectedIndex].value) {
    case "beep":
      beep(100, 330, "square");
      break;
    case "1lap":
      if (lapNo == 0) {
        queueSpeak(`<p>Hole Shot ${lapStr}<p>`);
      } else {
        const lapNoStr = pilotName + " Lap " + lapNo + ", ";
        const text = "<p>" + lapNoStr + lapStr + "</p>";
        queueSpeak(text);
      }
      break;
    case "2lap":
      if (lapNo == 0) {
        queueSpeak(`<p>Hole Shot ${lapStr}<p>`);
      } else if (last2lapStr != "") {
        const text2 = "<p>" + pilotName + " 2 laps " + last2lapStr + "</p>";
        queueSpeak(text2);
      }
      break;
    case "3lap":
      if (lapNo == 0) {
        queueSpeak(`<p>Hole Shot ${lapStr}<p>`);
      } else if (last3lapStr != "") {
        const text3 = "<p>" + pilotName + " 3 laps " + last3lapStr + "</p>";
        queueSpeak(text3);
      }
      break;
    default:
      break;
  }
  lapTimes.push(newLap);
  
  // Update lap counter
  updateLapCounter();
  
  // Update lap analysis
  updateAnalysisView();
  
  // Auto-stop race if max laps reached (excluding hole shot, and if maxLaps > 0)
  if (maxLaps > 0 && lapNo > 0 && lapNo >= maxLaps) {
    setTimeout(function() {
      if (!stopRaceButton.disabled) {
        stopRace();
        queueSpeak('<p>Race complete</p>');
      }
    }, 500); // Small delay to allow lap announcement
  }
}

function startTimer() {
  var millis = 0;
  var seconds = 0;
  var minutes = 0;
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
    timer.innerHTML = `${m}:${s}:${ms}s`;
  }, 10);

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

function queueSpeak(obj) {
  if (!audioEnabled) {
    return;
  }
  speakObjsQueue.push(obj);
}

function updateVoiceButtons() {
  const enableBtn = document.getElementById('EnableAudioButton');
  const disableBtn = document.getElementById('DisableAudioButton');
  
  if (audioEnabled) {
    enableBtn.style.backgroundColor = '#f39c12';
    enableBtn.style.opacity = '1';
    disableBtn.style.backgroundColor = '';
    disableBtn.style.opacity = '0.5';
  } else {
    enableBtn.style.backgroundColor = '';
    enableBtn.style.opacity = '0.5';
    disableBtn.style.backgroundColor = '#f39c12';
    disableBtn.style.opacity = '1';
  }
}

async function enableAudioLoop() {
  audioEnabled = true;
  updateVoiceButtons();
  while(audioEnabled) {
    if (speakObjsQueue.length > 0) {
      let isSpeakingFlag = $().articulate('isSpeaking');
      if (!isSpeakingFlag) {
        let obj = speakObjsQueue.shift();
        doSpeak(obj);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function disableAudioLoop() {
  audioEnabled = false;
  updateVoiceButtons();
}

// Pilot color preview
function updateColorPreview() {
  const colorSelect = document.getElementById('pilotColor');
  const colorPreview = document.getElementById('colorPreview');
  if (colorSelect && colorPreview) {
    colorPreview.style.backgroundColor = colorSelect.value;
  }
}

// Battery monitoring toggle
function toggleBatteryMonitor(enabled) {
  const batterySection = document.getElementById('batteryMonitoringSection');
  if (batterySection) {
    batterySection.style.display = enabled ? 'block' : 'none';
  }
}
function generateAudio() {
  if (!audioEnabled) {
    return;
  }

  const pilotName = pilotNameInput.value;
  queueSpeak('<div>testing sound for pilot ' + pilotName + '</div>');
  for (let i = 1; i <= 3; i++) {
    queueSpeak('<div>' + i + '</div>')
  }
}

function doSpeak(obj) {
  $(obj).articulate("rate", announcerRate).articulate('speak');
}

function updateLapCounter() {
  if (maxLaps === 0) {
    lapCounter.textContent = `Lap ${Math.max(0, lapNo)}`;
  } else {
    lapCounter.textContent = `Lap ${Math.max(0, lapNo)} / ${maxLaps}`;
  }
}

async function startRace() {
  updateLapCounter();
  startRaceButton.disabled = true;
  startRaceButton.classList.add('active');
  // Calculate time taken to say starting phrase
  const baseWordsPerMinute = 150;
  let baseWordsPerSecond = baseWordsPerMinute / 60;
  let wordsPerSecond = baseWordsPerSecond * announcerRate;
  // 3 words in "Arm your quad"
  let timeToSpeak1 = 3 / wordsPerSecond * 1000; 
  queueSpeak("<p>Arm your quad</p>");
  await new Promise((r) => setTimeout(r, timeToSpeak1));
  // 8 words in "Starting on the tone in less than five"
  let timeToSpeak2 = 8 / wordsPerSecond * 1000; 
  queueSpeak("<p>Starting on the tone in less than five</p>");
  // Random start time between 1 and 5 seconds
  // Accounts for time taken to make previous announcement
  let delayTime = (Math.random() * (5000 - 1000)) + timeToSpeak2;
  await new Promise((r) => setTimeout(r, delayTime));
  beep(1, 1, "square"); // needed for some reason to make sure we fire the first beep
  beep(500, 880, "square");
  startTimer();
  startRaceButton.classList.remove('active');
  stopRaceButton.disabled = false;
  addLapButton.disabled = false;
}

function stopRace() {
  queueSpeak('<p>Race stopped</p>');
  clearInterval(timerInterval);
  timer.innerHTML = "00:00:00s";

  fetch("/timer/stop", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((response) => console.log("/timer/stop:" + JSON.stringify(response)));

  stopRaceButton.disabled = true;
  startRaceButton.disabled = false;
  addLapButton.disabled = true;

  // Auto-save race if there are laps
  if (lapTimes.length > 0) {
    saveCurrentRace();
  }

  lapNo = -1;
  lapTimes = [];
  updateLapCounter();
}

function clearLaps() {
  // Auto-save race if there are laps before clearing
  if (lapTimes.length > 0) {
    saveCurrentRace();
  }

  var tableHeaderRowCount = 1;
  var rowCount = lapTable.rows.length;
  for (var i = tableHeaderRowCount; i < rowCount; i++) {
    lapTable.deleteRow(tableHeaderRowCount);
  }
  lapNo = -1;
  lapTimes = [];
  updateLapCounter();
  
  // Clear lap analysis
  document.getElementById('analysisContent').innerHTML = 
    '<p class="no-data">Complete at least 1 lap to see analysis</p>';
  document.getElementById('statFastest').textContent = '--';
  document.getElementById('statMedian').textContent = '--';
  document.getElementById('statBest3').textContent = '--';
  document.getElementById('statBest3Laps').textContent = '';
}

if (!!window.EventSource) {
  var source = new EventSource("/events");

  source.addEventListener(
    "open",
    function (e) {
      console.log("Events Connected");
    },
    false
  );

  source.addEventListener(
    "error",
    function (e) {
      if (e.target.readyState != EventSource.OPEN) {
        console.log("Events Disconnected");
      }
    },
    false
  );

  source.addEventListener(
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

  source.addEventListener(
    "lap",
    function (e) {
      var lap = (parseFloat(e.data) / 1000).toFixed(2);
      addLap(lap);
      console.log("lap raw:", e.data, " formatted:", lap);
    },
    false
  );
}

function setBandChannelIndex(freq) {
  for (var i = 0; i < freqLookup.length; i++) {
    for (var j = 0; j < freqLookup[i].length; j++) {
      if (freqLookup[i][j] == freq) {
        bandSelect.selectedIndex = i;
        channelSelect.selectedIndex = j;
      }
    }
  }
}

// Theme functionality
function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    if (theme === 'lighter') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('theme', theme);
    updateThemeLogos(theme);
  }
  
  function updateThemeLogos(theme) {
    // Light themes list
    const lightThemes = new Set(['lighter','github','onelight','solarizedlight','lightowl']);
    const isLight = lightThemes.has(theme);
    const favicon = document.getElementById('favicon');
    const headerLogo = document.getElementById('headerLogo');
    const logoPath = isLight ? 'logo-black.svg' : 'logo-white.svg';
    if (favicon) {
      favicon.href = logoPath;
      favicon.type = 'image/svg+xml';
    }
    if (headerLogo) headerLogo.src = logoPath;
  }

function loadDarkMode() {
    const theme = localStorage.getItem('theme') || 'oceanic';
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.value = theme;
      if (theme !== 'lighter') {
        document.documentElement.setAttribute('data-theme', theme);
      }
    }
    // Apply correct logos on initial load
    updateThemeLogos(theme);
  }

// Manual lap addition
function addManualLap() {
  // Get current timer value and convert to milliseconds
  const timerText = timer.innerHTML;
  const match = timerText.match(/(\d{2}):(\d{2}):(\d{2})s/);
  if (match) {
    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    const centiseconds = parseInt(match[3]);
    const totalMs = (minutes * 60000) + (seconds * 1000) + (centiseconds * 10);
    
    // Calculate lap time
    const lapTime = totalMs - (lapNo >= 0 ? lapTimes.reduce((a, b) => a + (b * 1000), 0) : 0);
    const lapTimeSeconds = (lapTime / 1000).toFixed(2);
    
    addLap(lapTimeSeconds);
  }
}

// Lap Analysis
let currentAnalysisMode = 'history';

// Color palette for bar variations
const barColors = [
  ['#42A5F5', '#1E88E5'], // Blue
  ['#66BB6A', '#43A047'], // Green
  ['#FFA726', '#FB8C00'], // Orange
  ['#AB47BC', '#8E24AA'], // Purple
  ['#26C6DA', '#00ACC1'], // Cyan
  ['#FFCA28', '#FFB300'], // Amber
  ['#EF5350', '#E53935'], // Red
  ['#5C6BC0', '#3F51B5'], // Indigo
  ['#EC407A', '#D81B60'], // Pink
  ['#78909C', '#607D8B'], // Blue Grey
];

function switchAnalysisMode(mode) {
  currentAnalysisMode = mode;
  // Update tab styling
  document.querySelectorAll('.analysis-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  event.target.classList.add('active');
  // Re-render analysis
  updateAnalysisView();
}

function updateAnalysisView() {
  if (lapTimes.length === 0) {
    document.getElementById('analysisContent').innerHTML = 
      '<p class="no-data">Complete at least 1 lap to see analysis</p>';
    return;
  }
  
  // Update stats boxes
  updateStatsBoxes();
  
  // Update chart view
  switch(currentAnalysisMode) {
    case 'history':
      renderLapHistory();
      break;
    case 'fastestRound':
      renderFastestRound();
      break;
  }
}

function updateStatsBoxes() {
  if (lapTimes.length === 0) {
    document.getElementById('statFastest').textContent = '--';
    document.getElementById('statMedian').textContent = '--';
    document.getElementById('statBest3').textContent = '--';
    document.getElementById('statBest3Laps').textContent = '';
    return;
  }
  
  // Fastest Lap
  const fastest = Math.min(...lapTimes);
  const fastestIndex = lapTimes.indexOf(fastest);
  document.getElementById('statFastest').textContent = `${fastest.toFixed(2)}s`;
  
  // Median Lap
  const sorted = [...lapTimes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? 
    (sorted[mid - 1] + sorted[mid]) / 2 : 
    sorted[mid];
  document.getElementById('statMedian').textContent = `${median.toFixed(2)}s`;
  
  // Best 3 Laps (sum of 3 fastest individual laps)
  if (lapTimes.length >= 3) {
    const lapsWithIndex = lapTimes.map((time, index) => ({ time, index }));
    lapsWithIndex.sort((a, b) => a.time - b.time);
    const best3 = lapsWithIndex.slice(0, 3);
    const totalTime = best3.reduce((sum, l) => sum + l.time, 0);
    const lapNumbers = best3.map(l => l.index + 1).sort((a, b) => a - b).join(', ');
    document.getElementById('statBest3').textContent = `${totalTime.toFixed(2)}s`;
    document.getElementById('statBest3Laps').textContent = `Laps: ${lapNumbers}`;
  } else {
    document.getElementById('statBest3').textContent = '--';
    document.getElementById('statBest3Laps').textContent = 'Need 3 laps';
  }
}

function renderLapHistory() {
  // Show last 10 laps (or all if less than 10)
  const recentLaps = lapTimes.slice(-10);
  const startIndex = Math.max(0, lapTimes.length - 10);
  const maxTime = Math.max(...recentLaps);
  
  let html = '<div class="analysis-bars">';
  recentLaps.forEach((time, index) => {
    const lapNumber = startIndex + index + 1;
    const colorIndex = (startIndex + index) % barColors.length;
    html += createBarItemWithColor(`Lap ${lapNumber}`, time, maxTime, `${time.toFixed(2)}s`, colorIndex);
  });
  html += '</div>';
  
  if (lapTimes.length > 10) {
    html += `<p style="text-align: center; margin-top: 16px; color: var(--secondary-color); font-size: 14px;">Showing last 10 of ${lapTimes.length} laps</p>`;
  }
  
  document.getElementById('analysisContent').innerHTML = html;
}

function renderFastestRound() {
  if (lapTimes.length < 3) {
    document.getElementById('analysisContent').innerHTML = 
      '<p class="no-data">Complete at least 3 laps to see fastest round</p>';
    return;
  }
  
  // Find best consecutive 3 laps
  let bestTime = Infinity;
  let bestStartIndex = 0;
  
  for (let i = 0; i <= lapTimes.length - 3; i++) {
    const sum = lapTimes[i] + lapTimes[i+1] + lapTimes[i+2];
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
  html += createBarItemWithColor(`Lap ${bestStartIndex + 1}`, lap1, maxTime, `${lap1.toFixed(2)}s`, 0);
  html += createBarItemWithColor(`Lap ${bestStartIndex + 2}`, lap2, maxTime, `${lap2.toFixed(2)}s`, 1);
  html += createBarItemWithColor(`Lap ${bestStartIndex + 3}`, lap3, maxTime, `${lap3.toFixed(2)}s`, 2);
  html += '</div>';
  html += `<p style="text-align: center; margin-top: 16px; font-weight: bold; color: var(--primary-color);">Total: ${bestTime.toFixed(2)}s</p>`;
  
  document.getElementById('analysisContent').innerHTML = html;
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

// Race History Functions
let raceHistoryData = [];
let currentDetailRace = null;

function saveCurrentRace() {
  if (lapTimes.length === 0) return;
  
  // Calculate stats
  const fastest = Math.min(...lapTimes);
  const sorted = [...lapTimes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  
  let best3Total = 0;
  if (lapTimes.length >= 3) {
    const best3 = sorted.slice(0, 3);
    best3Total = best3.reduce((sum, t) => sum + t, 0);
  }
  
  // Get current pilot and frequency info
  const pilotCallsign = document.getElementById('pcallsign')?.value || '';
  const bandValue = bandSelect.options[bandSelect.selectedIndex].value;
  const channelValue = parseInt(channelSelect.options[channelSelect.selectedIndex].value);
  
  const raceData = {
    timestamp: Math.floor(Date.now() / 1000),
    lapTimes: lapTimes.map(t => Math.round(t * 1000)), // Convert to milliseconds
    fastestLap: Math.round(fastest * 1000),
    medianLap: Math.round(median * 1000),
    best3LapsTotal: Math.round(best3Total * 1000),
    pilotName: pilotNameInput.value || '',
    pilotCallsign: pilotCallsign,
    frequency: frequency,
    band: bandValue,
    channel: channelValue
  };
  
  fetch('/races/save', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(raceData)
  })
  .then(response => response.json())
  .then(data => {
    console.log('Race saved:', data);
    loadRaceHistory();
  })
  .catch(error => console.error('Error saving race:', error));
}

function loadRaceHistory() {
  fetch('/races')
    .then(response => response.json())
    .then(data => {
      raceHistoryData = data.races || [];
      renderRaceHistory();
    })
    .catch(error => console.error('Error loading races:', error));
}

function renderRaceHistory() {
  const listContainer = document.getElementById('raceHistoryList');
  
  if (raceHistoryData.length === 0) {
    listContainer.innerHTML = '<p class="no-data">No races saved yet</p>';
    return;
  }
  
  let html = '';
  raceHistoryData.forEach((race, index) => {
    const date = new Date(race.timestamp * 1000);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    const fastestLap = (race.fastestLap / 1000).toFixed(2);
    const lapCount = race.lapTimes.length;
    const name = race.name || '';
    const tag = race.tag || '';
    const pilotCallsign = race.pilotCallsign || race.pilotName || '';
    const freqDisplay = race.frequency ? `${race.band}${race.channel} (${race.frequency}MHz)` : '';
    
    html += `
      <div class="race-item" onclick="viewRaceDetails(${index})">
        <div class="race-item-buttons">
          <button class="race-item-button" onclick="event.stopPropagation(); openEditModal(${index})">Edit</button>
          <button class="race-item-button" onclick="event.stopPropagation(); downloadSingleRace(${race.timestamp})">Download</button>
          <button class="race-item-button" style="border-color: #e74c3c; color: #e74c3c;" onclick="event.stopPropagation(); deleteRace(${race.timestamp})">Delete</button>
        </div>
        <div class="race-item-header">
          <div>
            ${tag ? '<span class="race-tag">' + tag + '</span>' : ''}
            <div class="race-date">${dateStr}</div>
            ${name ? '<div class="race-name">' + name + '</div>' : ''}
            ${pilotCallsign ? '<div style="font-size: 14px; color: var(--secondary-color); margin-top: 4px;">Pilot: ' + pilotCallsign + '</div>' : ''}
            ${freqDisplay ? '<div style="font-size: 14px; color: var(--secondary-color);">Channel: ' + freqDisplay + '</div>' : ''}
          </div>
        </div>
        <div class="race-item-stats">
          <div class="race-item-stat">Laps: <strong>${lapCount}</strong></div>
          <div class="race-item-stat">Fastest: <strong>${fastestLap}s</strong></div>
        </div>
      </div>
    `;
  });
  
  listContainer.innerHTML = html;
}

function viewRaceDetails(index) {
  currentDetailRace = raceHistoryData[index];
  const race = currentDetailRace;
  const date = new Date(race.timestamp * 1000);
  const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  
  document.getElementById('raceDetailsTitle').textContent = `Race - ${dateStr}`;
  document.getElementById('detailFastest').textContent = (race.fastestLap / 1000).toFixed(2) + 's';
  document.getElementById('detailMedian').textContent = (race.medianLap / 1000).toFixed(2) + 's';
  document.getElementById('detailBest3').textContent = (race.best3LapsTotal / 1000).toFixed(2) + 's';
  
  document.getElementById('raceDetails').style.display = 'block';
  switchDetailMode('history');
}

function closeRaceDetails() {
  document.getElementById('raceDetails').style.display = 'none';
  currentDetailRace = null;
}

function switchDetailMode(mode) {
  const tabs = document.querySelectorAll('#raceDetails .analysis-tab');
  tabs.forEach(tab => tab.classList.remove('active'));
  
  if (mode === 'history') {
    tabs[0].classList.add('active');
    renderDetailHistory();
  } else if (mode === 'fastestRound') {
    tabs[1].classList.add('active');
    renderDetailFastestRound();
  }
}

function renderDetailHistory() {
  if (!currentDetailRace) return;
  
  const lapTimes = currentDetailRace.lapTimes.map(t => t / 1000);
  const displayLaps = lapTimes.slice(-10);
  const maxTime = Math.max(...displayLaps);
  
  let html = '<div class="analysis-bars">';
  displayLaps.forEach((time, index) => {
    const lapNo = lapTimes.length - displayLaps.length + index + 1;
    html += createBarItemWithColor(`Lap ${lapNo}`, time, maxTime, `${time.toFixed(2)}s`, index);
  });
  html += '</div>';
  
  document.getElementById('detailContent').innerHTML = html;
}

function renderDetailFastestRound() {
  if (!currentDetailRace) return;
  
  const lapTimes = currentDetailRace.lapTimes.map(t => t / 1000);
  
  if (lapTimes.length < 3) {
    document.getElementById('detailContent').innerHTML = 
      '<p class="no-data">Not enough laps for fastest round</p>';
    return;
  }
  
  let bestTime = Infinity;
  let bestStartIndex = 0;
  
  for (let i = 0; i <= lapTimes.length - 3; i++) {
    const sum = lapTimes[i] + lapTimes[i+1] + lapTimes[i+2];
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
  html += createBarItemWithColor(`Lap ${bestStartIndex + 1}`, lap1, maxTime, `${lap1.toFixed(2)}s`, 0);
  html += createBarItemWithColor(`Lap ${bestStartIndex + 2}`, lap2, maxTime, `${lap2.toFixed(2)}s`, 1);
  html += createBarItemWithColor(`Lap ${bestStartIndex + 3}`, lap3, maxTime, `${lap3.toFixed(2)}s`, 2);
  html += '</div>';
  html += `<p style="text-align: center; margin-top: 16px; font-weight: bold; color: var(--primary-color);">Total: ${bestTime.toFixed(2)}s</p>`;
  
  document.getElementById('detailContent').innerHTML = html;
}

function downloadRaces() {
  window.open('/races/download', '_blank');
}

function downloadSingleRace(timestamp) {
  window.open('/races/downloadOne?timestamp=' + timestamp, '_blank');
}

let editingRaceIndex = null;

function openEditModal(index) {
  editingRaceIndex = index;
  const race = raceHistoryData[index];
  
  document.getElementById('raceName').value = race.name || '';
  document.getElementById('raceTag').value = race.tag || '';
  document.getElementById('editRaceModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editRaceModal').style.display = 'none';
  editingRaceIndex = null;
}

function saveRaceEdit() {
  if (editingRaceIndex === null) return;
  
  const race = raceHistoryData[editingRaceIndex];
  const name = document.getElementById('raceName').value;
  const tag = document.getElementById('raceTag').value;
  
  const formData = new URLSearchParams();
  formData.append('timestamp', race.timestamp);
  formData.append('name', name);
  formData.append('tag', tag);
  
  fetch('/races/update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData
  })
  .then(response => response.json())
  .then(data => {
    console.log('Race updated:', data);
    loadRaceHistory();
    closeEditModal();
  })
  .catch(error => {
    console.error('Error updating race:', error);
    alert('Error updating race');
  });
}

function importRaces(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const json = JSON.parse(e.target.result);
      
      fetch('/races/upload', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(json)
      })
      .then(response => response.json())
      .then(data => {
        console.log('Races imported:', data);
        loadRaceHistory();
        alert('Races imported successfully!');
      })
      .catch(error => {
        console.error('Error importing races:', error);
        alert('Error importing races');
      });
    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Invalid JSON file');
    }
  };
  reader.readAsText(file);
  input.value = ''; // Reset file input
}

function deleteRace(timestamp) {
  if (!confirm('Delete this race?')) return;
  
  const formData = new URLSearchParams();
  formData.append('timestamp', timestamp);
  
  fetch('/races/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData
  })
  .then(response => response.json())
  .then(data => {
    console.log('Race deleted:', data);
    loadRaceHistory();
    if (currentDetailRace && currentDetailRace.timestamp === timestamp) {
      closeRaceDetails();
    }
  })
  .catch(error => console.error('Error deleting race:', error));
}

function clearAllRaces() {
  if (!confirm('Are you sure you want to clear all race history? This cannot be undone.')) return;
  
  fetch('/races/clear', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  })
  .then(response => response.json())
  .then(data => {
    console.log('All races cleared:', data);
    loadRaceHistory();
    closeRaceDetails();
  })
  .catch(error => console.error('Error clearing races:', error));
}

// Config Download/Import Functions
function downloadConfig() {
  fetch('/config')
    .then(response => response.json())
    .then(config => {
      // Add client-side settings
      const fullConfig = {
        ...config,
        theme: localStorage.getItem('theme') || 'oceanic',
        audioEnabled: audioEnabled,
        timestamp: new Date().toISOString()
      };
      
      const dataStr = JSON.stringify(fullConfig, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fpvgate-config-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })
    .catch(error => {
      console.error('Error downloading config:', error);
      alert('Error downloading configuration');
    });
}

function importConfig(input) {
  const file = input.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const config = JSON.parse(e.target.result);
      
      // Apply backend config
      fetch('/config', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
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
          name: config.name || '',
          ssid: config.ssid || '',
          pwd: config.pwd || ''
        })
      })
      .then(response => response.json())
      .then(data => {
        console.log('Config imported:', data);
        
        // Apply client-side settings
        if (config.theme) {
          localStorage.setItem('theme', config.theme);
          const themeSelect = document.getElementById('themeSelect');
          if (themeSelect) {
            themeSelect.value = config.theme;
            changeTheme();
          }
        }
        
        // Reload config to update UI
        location.reload();
      })
      .catch(error => {
        console.error('Error importing config:', error);
        alert('Error importing configuration');
      });
    } catch (error) {
      console.error('Error parsing config JSON:', error);
      alert('Invalid configuration file');
    }
  };
  reader.readAsText(file);
  input.value = ''; // Reset file input
}

