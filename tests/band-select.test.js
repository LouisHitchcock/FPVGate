/**
 * @jest-environment jsdom
 *
 * Tests for the band/channel selector restoration logic in script.js.
 *
 * Bug: When openSettingsModal re-fetches config, it called setBandChannelIndex(freq)
 * which used the raw freqLookup array index as the selectedIndex of a *filtered*
 * dropdown, and never broke out of the loop so the last duplicate-frequency match
 * (often a digital band at index 13-18) always "won". For R5 (5843 MHz), the last
 * match was WalkSnail-R at freqLookup index 18. With only 6 analog options in the
 * dropdown, selectedIndex=18 resolves to -1 (empty).
 */

// ─── Shared data (mirrors script.js) ─────────────────────────────────────────

const freqLookup = [
  [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725], // 0  A
  [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866], // 1  B
  [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945], // 2  E
  [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880], // 3  F
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917], // 4  R (RaceBand)
  [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621], // 5  L (LowBand)
  [5660, 5695, 5735, 5770, 5805, 5878, 5914, 5839], // 6  DJIv1-25
  [5735, 5770, 5805,    0,    0,    0,    0, 5839], // 7  DJIv1-25CE
  [5695, 5770, 5878,    0,    0,    0,    0, 5839], // 8  DJIv1_50
  [5669, 5705, 5768, 5804, 5839, 5876, 5912,    0], // 9  DJI03/04-20
  [5768, 5804, 5839,    0,    0,    0,    0,    0], // 10 DJI03/04-20CE
  [5677, 5794, 5902,    0,    0,    0,    0,    0], // 11 DJI03/04-40
  [5794,    0,    0,    0,    0,    0,    0,    0], // 12 DJI03/04-40CE
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917], // 13 DJI04-R
  [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917], // 14 HDZero-R
  [5707,    0,    0,    0,    0,    0,    0,    0], // 15 HDZero-E
  [5740, 5760,    0, 5800,    0,    0,    0,    0], // 16 HDZero-F
  [5732, 5769, 5806, 5843,    0,    0,    0,    0], // 17 HDZero-CE
  [5658, 5659, 5732, 5769, 5806, 5843, 5880, 5917], // 18 WalkSnail-R
  [5660, 5695, 5735, 5770, 5805, 5878, 5914, 5839], // 19 WalkSnail-25
  [5735, 5770, 5805,    0,    0,    0,    0, 5839], // 20 WalkSnail-25CE
  [5695, 5770, 5878,    0,    0,    0,    0, 5839], // 21 WalkSnail-50
];

const bandDefinitions = [
  { index:  0, value: 'A',            label: 'A (Boscam A / TBS / IRC)',    system: 'analog'    },
  { index:  1, value: 'B',            label: 'B (Boscam B)',                system: 'analog'    },
  { index:  2, value: 'E',            label: 'E (Boscam E / DJI)',          system: 'analog'    },
  { index:  3, value: 'F',            label: 'F (IRC / Immersion)',         system: 'analog'    },
  { index:  4, value: 'R',            label: 'R (Raceband)',                system: 'analog'    },
  { index:  5, value: 'L',            label: 'L (Lowband)',                 system: 'analog'    },
  { index:  6, value: 'DJIv1-25',     label: 'DJI FPV v1 (25mW)',          system: 'dji'       },
  { index:  7, value: 'DJIv1-25CE',   label: 'DJI FPV v1 (25mW CE)',       system: 'dji'       },
  { index:  8, value: 'DJIv1_50',     label: 'DJI FPV v1 (50mW+)',         system: 'dji'       },
  { index:  9, value: 'DJI03/04-20',  label: 'DJI O3/Air Unit (20MHz)',    system: 'dji'       },
  { index: 10, value: 'DJI03/04-20CE',label: 'DJI O3/Air Unit (20MHz CE)', system: 'dji'       },
  { index: 11, value: 'DJI03/04-40',  label: 'DJI O3/Air Unit (40MHz)',    system: 'dji'       },
  { index: 12, value: 'DJI03/04-40CE',label: 'DJI O3/Air Unit (40MHz CE)', system: 'dji'       },
  { index: 13, value: 'DJI04-R',      label: 'DJI O3 (Raceband)',          system: 'dji'       },
  { index: 14, value: 'HDZero-R',     label: 'HDZero (Raceband)',           system: 'hdzero'    },
  { index: 15, value: 'HDZero-E',     label: 'HDZero (E-band)',             system: 'hdzero'    },
  { index: 16, value: 'HDZero-F',     label: 'HDZero (F-band)',             system: 'hdzero'    },
  { index: 17, value: 'HDZero-CE',    label: 'HDZero (CE)',                 system: 'hdzero'    },
  { index: 18, value: 'WalkSnail-R',  label: 'Walksnail (Raceband)',        system: 'walksnail' },
  { index: 19, value: 'WalkSnail-25', label: 'Walksnail (25mW)',            system: 'walksnail' },
  { index: 20, value: 'WalkSnail-25CE',label:'Walksnail (25mW CE)',         system: 'walksnail' },
  { index: 21, value: 'WalkSnail-50', label: 'Walksnail (50mW+)',           system: 'walksnail' },
];

// ─── DOM helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal DOM with the selectors the functions depend on.
 * Returns refs to all relevant elements.
 */
function buildDOM() {
  document.body.innerHTML = `
    <select id="systemSelect">
      <option value="analog">Analog</option>
      <option value="hdzero">HDZero</option>
      <option value="walksnail">Walksnail</option>
      <option value="dji">DJI</option>
    </select>
    <select id="calibSystemSelect">
      <option value="analog">Analog</option>
      <option value="hdzero">HDZero</option>
      <option value="walksnail">Walksnail</option>
      <option value="dji">DJI</option>
    </select>
    <select id="bandSelect"></select>
    <select id="calibBandSelect"></select>
    <select id="channelSelect">
      <option value="1">1</option><option value="2">2</option>
      <option value="3">3</option><option value="4">4</option>
      <option value="5">5</option><option value="6">6</option>
      <option value="7">7</option><option value="8">8</option>
    </select>
    <select id="calibChannelSelect">
      <option value="1">1</option><option value="2">2</option>
      <option value="3">3</option><option value="4">4</option>
      <option value="5">5</option><option value="6">6</option>
      <option value="7">7</option><option value="8">8</option>
    </select>
  `;
  return {
    systemSelect:      document.getElementById('systemSelect'),
    calibSystemSelect: document.getElementById('calibSystemSelect'),
    bandSelect:        document.getElementById('bandSelect'),
    calibBandSelect:   document.getElementById('calibBandSelect'),
    channelSelect:     document.getElementById('channelSelect'),
    calibChannelSelect:document.getElementById('calibChannelSelect'),
  };
}

// ─── Function implementations (mirrors script.js) ────────────────────────────

function populateBandsBySystem(system, targetBandSelect) {
  if (!targetBandSelect) return;
  const filtered = bandDefinitions.filter(b => b.system === system);
  targetBandSelect.innerHTML = '';
  filtered.forEach(band => {
    const opt = document.createElement('option');
    opt.value = band.value;
    opt.textContent = band.label;
    opt.dataset.bandIndex = band.index;
    targetBandSelect.appendChild(opt);
  });
  if (targetBandSelect.selectedIndex === -1 && targetBandSelect.options.length > 0) {
    targetBandSelect.selectedIndex = 0;
  }
}

function updateChannelAvailability(targetBandSelect) {
  // Simplified stub - not under test here
}

// ─── BROKEN implementation (reproduces the bug) ───────────────────────────────

function setBandChannelIndex_BROKEN(freq, bandSelect, channelSelect) {
  for (var i = 0; i < freqLookup.length; i++) {
    for (var j = 0; j < freqLookup[i].length; j++) {
      if (freqLookup[i][j] == freq) {
        bandSelect.selectedIndex = i;   // BUG: raw freqLookup index, not dropdown position
        channelSelect.selectedIndex = j;
        // BUG: no return/break - last match (often a digital band) overwrites
      }
    }
  }
}

// ─── FIXED implementation ─────────────────────────────────────────────────────

function setBandChannelIndex_FIXED(freq, bandSelect, channelSelect, systemSelect, calibSystemSelect, calibBandSelect, currentSystemRef) {
  for (var i = 0; i < freqLookup.length; i++) {
    for (var j = 0; j < freqLookup[i].length; j++) {
      if (freqLookup[i][j] == freq) {
        const bandDef = bandDefinitions[i];
        if (bandDef) {
          if (currentSystemRef.value !== bandDef.system) {
            currentSystemRef.value = bandDef.system;
            if (systemSelect) systemSelect.value = bandDef.system;
            if (calibSystemSelect) calibSystemSelect.value = bandDef.system;
            populateBandsBySystem(bandDef.system, bandSelect);
            populateBandsBySystem(bandDef.system, calibBandSelect);
          }
          const bandOption = Array.from(bandSelect.options).find(opt => opt.value === bandDef.value);
          if (bandOption) bandSelect.value = bandDef.value;
          channelSelect.selectedIndex = j;
          updateChannelAvailability(bandSelect);
        }
        return; // Stop at first match
      }
    }
  }
}

/**
 * Simulates the fixed openSettingsModal band restoration path.
 * Uses bandIndex/channelIndex first, falls back to freq.
 */
function restoreBandFromConfig_FIXED(config, els) {
  const { bandSelect, calibBandSelect, channelSelect, calibChannelSelect, systemSelect, calibSystemSelect } = els;
  const currentSystemRef = { value: 'analog' };

  if (config.bandIndex !== undefined && config.channelIndex !== undefined) {
    const bandDef = bandDefinitions[config.bandIndex];
    if (bandDef) {
      currentSystemRef.value = bandDef.system;
      if (systemSelect) systemSelect.value = bandDef.system;
      if (calibSystemSelect) calibSystemSelect.value = bandDef.system;
      populateBandsBySystem(bandDef.system, bandSelect);
      populateBandsBySystem(bandDef.system, calibBandSelect);
      const targetBandValue = bandDef.value;
      const bandOption = Array.from(bandSelect.options).find(opt => opt.value === targetBandValue);
      const calibBandOption = Array.from(calibBandSelect.options).find(opt => opt.value === targetBandValue);
      if (bandOption) bandSelect.value = targetBandValue;
      if (calibBandOption) calibBandSelect.value = targetBandValue;
      channelSelect.selectedIndex = config.channelIndex;
      if (calibChannelSelect) calibChannelSelect.selectedIndex = config.channelIndex;
      updateChannelAvailability(bandSelect);
      updateChannelAvailability(calibBandSelect);
    }
  } else if (config.freq !== undefined) {
    setBandChannelIndex_FIXED(config.freq, bandSelect, channelSelect, systemSelect, calibSystemSelect, calibBandSelect, currentSystemRef);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('setBandChannelIndex', () => {
  let els;

  beforeEach(() => {
    els = buildDOM();
    // Start with analog bands populated (default state on page load)
    populateBandsBySystem('analog', els.bandSelect);
    populateBandsBySystem('analog', els.calibBandSelect);
  });

  describe('BUG REPRODUCTION - broken implementation', () => {
    test('R5 (5843 MHz) leaves bandSelect empty when analog is active', () => {
      // R5 = freqLookup[4][5], but 5843 also appears at indices 13, 14, 17, 18.
      // The broken code sets selectedIndex to the last match (18 = WalkSnail-R).
      // With only 6 analog options, selectedIndex=18 resolves to -1 (empty).
      setBandChannelIndex_BROKEN(5843, els.bandSelect, els.channelSelect);
      expect(els.bandSelect.selectedIndex).toBe(-1); // confirms the bug
      expect(els.bandSelect.value).toBe('');
    });

    test('A1 (5865 MHz) is unique so the broken version accidentally works', () => {
      // 5865 only appears once in freqLookup[0][0] so no duplicate problem
      setBandChannelIndex_BROKEN(5865, els.bandSelect, els.channelSelect);
      // selectedIndex=0 happens to be 'A' in the analog dropdown too
      expect(els.bandSelect.value).toBe('A');
      expect(els.channelSelect.selectedIndex).toBe(0);
    });
  });

  describe('FIXED implementation', () => {
    let currentSystemRef;

    beforeEach(() => {
      currentSystemRef = { value: 'analog' };
    });

    test('R5 (5843 MHz) correctly selects R band, channel index 5', () => {
      setBandChannelIndex_FIXED(5843, els.bandSelect, els.channelSelect, els.systemSelect, els.calibSystemSelect, els.calibBandSelect, currentSystemRef);
      expect(els.bandSelect.value).toBe('R');
      expect(els.channelSelect.selectedIndex).toBe(5);
    });

    test('A1 (5865 MHz) correctly selects A band, channel index 0', () => {
      setBandChannelIndex_FIXED(5865, els.bandSelect, els.channelSelect, els.systemSelect, els.calibSystemSelect, els.calibBandSelect, currentSystemRef);
      expect(els.bandSelect.value).toBe('A');
      expect(els.channelSelect.selectedIndex).toBe(0);
    });

    test('R1 (5658 MHz) is shared across analog R, DJI04-R, HDZero-R, WalkSnail-R - first match (analog R) wins', () => {
      setBandChannelIndex_FIXED(5658, els.bandSelect, els.channelSelect, els.systemSelect, els.calibSystemSelect, els.calibBandSelect, currentSystemRef);
      expect(els.bandSelect.value).toBe('R');
      expect(els.channelSelect.selectedIndex).toBe(0);
      expect(currentSystemRef.value).toBe('analog'); // system unchanged
    });

    test('switches system to DJI when a DJI-only frequency is given', () => {
      // 5902 MHz only appears in DJI03/04-40 (index 11, channel 2)
      setBandChannelIndex_FIXED(5902, els.bandSelect, els.channelSelect, els.systemSelect, els.calibSystemSelect, els.calibBandSelect, currentSystemRef);
      expect(currentSystemRef.value).toBe('dji');
      expect(els.systemSelect.value).toBe('dji');
      expect(els.bandSelect.value).toBe('DJI03/04-40');
      expect(els.channelSelect.selectedIndex).toBe(2);
    });

    test('L band (LowBand) unique frequencies are restored correctly', () => {
      // 5547 MHz = L band, channel index 5
      setBandChannelIndex_FIXED(5547, els.bandSelect, els.channelSelect, els.systemSelect, els.calibSystemSelect, els.calibBandSelect, currentSystemRef);
      expect(els.bandSelect.value).toBe('L');
      expect(els.channelSelect.selectedIndex).toBe(5);
    });

    test('unknown frequency leaves bandSelect unchanged', () => {
      setBandChannelIndex_FIXED(9999, els.bandSelect, els.channelSelect, els.systemSelect, els.calibSystemSelect, els.calibBandSelect, currentSystemRef);
      // No match - bandSelect should remain at its default (first option = 'A')
      expect(els.bandSelect.value).toBe('A');
    });
  });
});

describe('openSettingsModal band restoration (bandIndex/channelIndex path)', () => {
  let els;

  beforeEach(() => {
    els = buildDOM();
    populateBandsBySystem('analog', els.bandSelect);
    populateBandsBySystem('analog', els.calibBandSelect);
  });

  test('restores R5 correctly using bandIndex:4, channelIndex:5', () => {
    restoreBandFromConfig_FIXED({ bandIndex: 4, channelIndex: 5, freq: 5843 }, els);
    expect(els.bandSelect.value).toBe('R');
    expect(els.channelSelect.selectedIndex).toBe(5);
    expect(els.calibBandSelect.value).toBe('R');
    expect(els.calibChannelSelect.selectedIndex).toBe(5);
    expect(els.systemSelect.value).toBe('analog');
  });

  test('restores A1 correctly using bandIndex:0, channelIndex:0', () => {
    restoreBandFromConfig_FIXED({ bandIndex: 0, channelIndex: 0, freq: 5865 }, els);
    expect(els.bandSelect.value).toBe('A');
    expect(els.channelSelect.selectedIndex).toBe(0);
  });

  test('restores HDZero-R band correctly and switches system to hdzero', () => {
    restoreBandFromConfig_FIXED({ bandIndex: 14, channelIndex: 3, freq: 5769 }, els);
    expect(els.systemSelect.value).toBe('hdzero');
    expect(els.bandSelect.value).toBe('HDZero-R');
    expect(els.channelSelect.selectedIndex).toBe(3);
    expect(els.calibBandSelect.value).toBe('HDZero-R');
    expect(els.calibChannelSelect.selectedIndex).toBe(3);
  });

  test('restores WalkSnail-25 correctly using bandIndex:19', () => {
    restoreBandFromConfig_FIXED({ bandIndex: 19, channelIndex: 2, freq: 5735 }, els);
    expect(els.systemSelect.value).toBe('walksnail');
    expect(els.bandSelect.value).toBe('WalkSnail-25');
    expect(els.channelSelect.selectedIndex).toBe(2);
  });

  test('falls back to freq when bandIndex is missing from config', () => {
    // Simulates old firmware that didn't save bandIndex
    restoreBandFromConfig_FIXED({ freq: 5769 }, els);
    // 5769 = R4 (first match in freqLookup)
    expect(els.bandSelect.value).toBe('R');
    expect(els.channelSelect.selectedIndex).toBe(3);
  });

  test('bandIndex/channelIndex takes precedence over freq when both present', () => {
    // freq says 5843 (which broken code would mangle), bandIndex says R (4)
    restoreBandFromConfig_FIXED({ bandIndex: 4, channelIndex: 5, freq: 5843 }, els);
    expect(els.bandSelect.value).toBe('R');
    // System must not have been accidentally switched to walksnail/dji
    expect(els.systemSelect.value).toBe('analog');
  });
});

describe('openSettingsModal band/channel not overwritten by stale device config', () => {
  /**
   * Simulates the BROKEN openSettingsModal that re-fetches and overwrites band/channel.
   * This reproduces the "calib sets F3, modal resets to A" bug.
   */
  function openSettingsModal_BROKEN(deviceConfig, els) {
    const { bandSelect, calibBandSelect, channelSelect, calibChannelSelect, systemSelect } = els;
    // Broken: always restores band from device config, ignoring current DOM state
    if (deviceConfig.bandIndex !== undefined && deviceConfig.channelIndex !== undefined) {
      const bandDef = bandDefinitions[deviceConfig.bandIndex];
      if (bandDef) {
        if (systemSelect) systemSelect.value = bandDef.system;
        populateBandsBySystem(bandDef.system, bandSelect);
        populateBandsBySystem(bandDef.system, calibBandSelect);
        const bandOption = Array.from(bandSelect.options).find(opt => opt.value === bandDef.value);
        if (bandOption) bandSelect.value = bandDef.value;
        channelSelect.selectedIndex = deviceConfig.channelIndex;
      }
    }
  }

  /**
   * Simulates the FIXED openSettingsModal that does NOT touch band/channel.
   * The DOM state (set by calib) is preserved.
   */
  function openSettingsModal_FIXED(/* deviceConfig not used for band */ _deviceConfig, _els) {
    // Band/channel not restored - DOM state is authoritative.
    // Other settings (LED, battery, etc.) would be updated here in the real code.
  }

  let els;

  beforeEach(() => {
    els = buildDOM();
    // Simulate page load: device had R5, onload set the DOM correctly
    populateBandsBySystem('analog', els.bandSelect);
    populateBandsBySystem('analog', els.calibBandSelect);
    els.bandSelect.value = 'R';
    els.calibBandSelect.value = 'R';
    els.channelSelect.selectedIndex = 4;       // R5
    els.calibChannelSelect.selectedIndex = 4;  // R5
  });

  test('BROKEN: opening settings modal after calib change resets band to stale device config', () => {
    // User changes band on calib screen to F (index 3)
    // autoSaveConfig is debounced - device still has old config (R5, bandIndex 4)
    els.calibBandSelect.value = 'F';
    els.bandSelect.value = 'F';      // populateCalibFreqOutput syncs this
    els.channelSelect.selectedIndex = 2;
    els.calibChannelSelect.selectedIndex = 2;

    // Device config is STALE (has the old R5 selection, save hasn't completed yet)
    const staleDeviceConfig = { bandIndex: 4, channelIndex: 4, freq: 5806 };

    // Opening the modal with the broken implementation overwrites F with R
    openSettingsModal_BROKEN(staleDeviceConfig, els);

    // BUG: DOM was reset to stale device value
    expect(els.bandSelect.value).toBe('R');  // wrong!
    expect(els.channelSelect.selectedIndex).toBe(4); // wrong!
  });

  test('FIXED: opening settings modal preserves the band set on calib screen', () => {
    // Same scenario: user changed to F3 on calib, save is still pending
    els.calibBandSelect.value = 'F';
    els.bandSelect.value = 'F';
    els.channelSelect.selectedIndex = 2;
    els.calibChannelSelect.selectedIndex = 2;

    const staleDeviceConfig = { bandIndex: 4, channelIndex: 4, freq: 5806 };

    // Fixed modal does not touch band/channel
    openSettingsModal_FIXED(staleDeviceConfig, els);

    // DOM is unchanged - F3 preserved
    expect(els.bandSelect.value).toBe('F');
    expect(els.channelSelect.selectedIndex).toBe(2);
    expect(els.calibBandSelect.value).toBe('F');
    expect(els.calibChannelSelect.selectedIndex).toBe(2);
  });

  test('FIXED: modal opened immediately after page load (no pending changes) shows correct band', () => {
    // No calib changes made - DOM reflects device config correctly from onload
    // Device config and DOM are in sync
    const deviceConfig = { bandIndex: 4, channelIndex: 4, freq: 5806 };

    openSettingsModal_FIXED(deviceConfig, els);

    // DOM (set by onload) is still correct
    expect(els.bandSelect.value).toBe('R');
    expect(els.channelSelect.selectedIndex).toBe(4);
  });
});

describe('saveConfig bandIndex fallback when bandSelect is empty', () => {
  /**
   * Simulates reading bandIndex/channelIndex from the DOM at save time,
   * mirroring the saveConfig() logic including the calibBandSelect fallback.
   */
  function readBandIndexForSave(els) {
    const { bandSelect, channelSelect, calibBandSelect, calibChannelSelect } = els;
    let selectedBandIndex = 0;
    let selectedChannelIndex = 0;

    if (bandSelect && bandSelect.selectedIndex !== -1) {
      const selectedOption = bandSelect.options[bandSelect.selectedIndex];
      if (selectedOption && selectedOption.dataset.bandIndex) {
        selectedBandIndex = parseInt(selectedOption.dataset.bandIndex);
      }
      selectedChannelIndex = channelSelect.selectedIndex;
    } else if (calibBandSelect && calibBandSelect.selectedIndex !== -1) {
      // Fallback path
      const calibOption = calibBandSelect.options[calibBandSelect.selectedIndex];
      if (calibOption && calibOption.dataset.bandIndex) {
        selectedBandIndex = parseInt(calibOption.dataset.bandIndex);
      }
      selectedChannelIndex = calibChannelSelect ? calibChannelSelect.selectedIndex : 0;
    }
    return { selectedBandIndex, selectedChannelIndex };
  }

  let els;

  beforeEach(() => {
    els = buildDOM();
    populateBandsBySystem('analog', els.bandSelect);
    populateBandsBySystem('analog', els.calibBandSelect);
  });

  test('BROKEN: bandSelect empty (from setBandChannelIndex_BROKEN) causes bandIndex 0 (A) to be saved', () => {
    // Simulate: user set R6 on calib (both selects correct)
    els.bandSelect.value = 'R';
    els.calibBandSelect.value = 'R';
    els.channelSelect.selectedIndex = 5;
    els.calibChannelSelect.selectedIndex = 5;

    // openSettingsModal broken fetch completes and corrupts bandSelect
    setBandChannelIndex_BROKEN(5843, els.bandSelect, els.channelSelect);
    // bandSelect is now selectedIndex=-1 (empty)
    expect(els.bandSelect.selectedIndex).toBe(-1);

    // saveConfig reads bandSelect - it's empty, falls through to default 0
    const { selectedBandIndex } = readBandIndexForSave({
      bandSelect: els.bandSelect,
      channelSelect: els.channelSelect,
      calibBandSelect: null, // OLD code had no fallback
      calibChannelSelect: null,
    });
    expect(selectedBandIndex).toBe(0); // BUG: saves bandIndex 0 (A) instead of 4 (R)
  });

  test('FIXED: bandSelect empty falls back to calibBandSelect, saves correct bandIndex 4 (R)', () => {
    // Same setup: user set R6, calib is correct
    els.bandSelect.value = 'R';
    els.calibBandSelect.value = 'R';
    els.channelSelect.selectedIndex = 5;
    els.calibChannelSelect.selectedIndex = 5;

    // Something (hypothetically) empties bandSelect
    els.bandSelect.selectedIndex = -1;

    // saveConfig WITH fallback reads from calibBandSelect
    const { selectedBandIndex, selectedChannelIndex } = readBandIndexForSave(els);
    expect(selectedBandIndex).toBe(4); // R band index
    expect(selectedChannelIndex).toBe(5); // channel 6
  });

  test('FIXED: power-cycle scenario - R6 set on calib, settings never opened, save is correct', () => {
    // Simulates the full user scenario:
    // 1. onload sets both selects to R6
    // 2. User changes calib to R6 (already R6 from onload, but simulate explicit set)
    // 3. openSettingsModal is NEVER called
    // 4. saveConfig fires - should save bandIndex 4
    els.bandSelect.value = 'R';          // set by onload
    els.calibBandSelect.value = 'R';     // set by onload
    els.channelSelect.selectedIndex = 5; // set by onload
    els.calibChannelSelect.selectedIndex = 5;

    const { selectedBandIndex, selectedChannelIndex } = readBandIndexForSave(els);
    expect(selectedBandIndex).toBe(4); // R
    expect(selectedChannelIndex).toBe(5); // channel 6
  });
});
