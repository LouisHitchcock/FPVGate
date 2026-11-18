const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../data/script.js'), 'utf8');
function sandbox(style, suspended = false) {
  const tones = [];
  const context = { currentTime: 5, state: suspended ? 'suspended' : 'running',
    resume: jest.fn(async () => { context.state = 'running'; }),
    createOscillator: () => {
      const tone = { frequency: {}, connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn() };
      tones.push(tone); return tone;
    } };
  const state = { localStorage: { getItem: () => style }, beepAudioContext: context, beepGainNode: {}, console };
  vm.createContext(state);
  vm.runInContext(src.slice(src.indexOf('function beep(duration'), src.indexOf('// The total of the last')), state);
  return { state, tones, context };
}
test.each([null, 'classic', 'invalid'])('default and unknown style %p preserve the classic crossing beep', style => {
  const { state, tones } = sandbox(style);
  state.beep(100, 330, 'square');
  expect(tones).toHaveLength(1);
  expect(tones[0].type).toBe('square');
  expect(tones[0].frequency.value).toBe(330);
  expect(tones[0].start).toHaveBeenCalledWith(5);
  expect(tones[0].stop).toHaveBeenCalledWith(5.1);
});
test.each(['soft', 'high', 'low', 'double'])('%s preset is scheduled and does not change the race start tone', style => {
  const { state, tones } = sandbox(style);
  state.beep(100, 330, 'square');
  expect(tones).toHaveLength(style === 'double' ? 2 : 1);
  expect(tones[0].frequency.value).not.toBe(330);
  for (const tone of tones) { tone.onended(); expect(tone.disconnect).toHaveBeenCalled(); }
  if (style === 'double') {
    expect(tones[1].start).toHaveBeenCalledWith(5.11);
    expect(tones[1].stop).toHaveBeenCalledWith(5.175000000000001);
  }
  state.beep(500, 880, 'square');
  const startTone = tones.at(-1);
  expect(startTone.type).toBe('square');
  expect(startTone.frequency.value).toBe(880);
  expect(startTone.stop).toHaveBeenCalledWith(5.5);
});
test('preview and crossing tones wait for suspended browser audio to resume', async () => {
  const { state, tones, context } = sandbox('double', true);
  state.beep(100, 330, 'square');
  expect(tones).toHaveLength(0);
  await Promise.resolve();
  expect(context.resume).toHaveBeenCalledTimes(1);
  expect(tones).toHaveLength(2);
});
