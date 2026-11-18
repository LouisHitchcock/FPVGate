const fs = require('fs');
const path = require('path');
const vm = require('vm');
const script = fs.readFileSync(path.join(__dirname, '../data/script.js'), 'utf8');
const source = script.slice(script.indexOf('function importRaces(input) {'), script.indexOf('\nfunction deleteRace('));
function importer(fetch = jest.fn(async () => ({ok: true, json: async () => ({status: 'OK'})}))) {
  const readers = [];
  class FileReader {
    constructor() { readers.push(this); }
    readAsText(file) { this.finished = this.onload({target: {result: file.content}}); }
  }
  const ctx = {FileReader, fetch, alert: jest.fn(), loadRaceHistory: jest.fn(),
    console: {error: jest.fn()}, i18n: {t: key => key}};
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return {ctx, readers, async run(value, raw = false) {
    const input = {files: [{content: raw ? value : JSON.stringify(value)}], value: 'backup.json', disabled: false};
    ctx.importRaces(input); await readers.at(-1).finished; return input;
  }};
}
test('large multi-pilot backup uses sequential complete-race uploads without losing fields', async () => {
  const races = Array.from({length: 12}, (_, i) => ({timestamp: 1800000000+i, syncMode: 3,
    pilots: Array.from({length: 8}, (_, slot) => ({slot, name: `Pilot ${slot}`, frequency: 5658+slot,
      enter: 104, exit: 93, lapTimes: [0, ...Array(120).fill(12345)]}))}));
  expect(JSON.stringify({races}).length).toBeGreaterThan(16384);
  const t = importer(); const input = await t.run({races});
  expect(t.ctx.fetch).toHaveBeenCalledTimes(races.length);
  t.ctx.fetch.mock.calls.forEach(([url, options], i) => {
    expect(url).toBe('/races/upload'); expect(JSON.parse(options.body).races).toEqual([races[i]]);expect(JSON.parse(options.body).importedAt).toBeGreaterThan(1577836800);
    expect(options.body.length).toBeLessThan(16384);
  });
  expect(t.ctx.alert).toHaveBeenCalledWith('messages.race_import_success');
  expect(t.ctx.loadRaceHistory).toHaveBeenCalledTimes(1);
  expect(input.disabled).toBe(false); expect(input.value).toBe('');
});
test('legacy single-pilot backups preserve lap times and metadata', async () => {
 const t=importer(); const race={timestamp:123,lapTimes:[0,12000,13000],pilotName:'Ann',notes:'legacy'};
 await t.run({races:[race]}); expect(JSON.parse(t.ctx.fetch.mock.calls[0][1].body).races).toEqual([race]);
});
test.each([413, 500])('HTTP %s never produces a success message', async status => {
 const json=jest.fn();const t=importer(jest.fn(async()=>({ok:false,status,json})));
 const input=await t.run({races:[{timestamp:1}]});
 expect(t.ctx.alert).toHaveBeenCalledWith('messages.race_import_error');expect(json).not.toHaveBeenCalled();
 expect(t.ctx.loadRaceHistory).not.toHaveBeenCalled();expect(input.disabled).toBe(false);
});
test('HTTP 200 with application ERROR is still a failed import', async () => {
 const t=importer(jest.fn(async()=>({ok:true,json:async()=>({status:'ERROR'})})));
 await t.run({races:[{timestamp:1}]});expect(t.ctx.alert).toHaveBeenCalledWith('messages.race_import_error');
});
test('stops at first refusal and refreshes already imported records', async () => {
 const fetch=jest.fn().mockResolvedValueOnce({ok:true,json:async()=>({status:'OK'})})
   .mockResolvedValueOnce({ok:false,status:413});const t=importer(fetch);
 await t.run({races:[{timestamp:1},{timestamp:2},{timestamp:3}]});
 expect(fetch).toHaveBeenCalledTimes(2);expect(t.ctx.loadRaceHistory).toHaveBeenCalledTimes(1);
 expect(t.ctx.alert.mock.calls).toEqual([['messages.race_import_error']]);
});
test.each(['{', '{}', '{"races":[null]}', '{"races":[{"timestamp":0}]}'])('rejects invalid backup %s before any writes', async raw => {
 const t=importer();const input=await t.run(raw,true);expect(t.ctx.fetch).not.toHaveBeenCalled();
 expect(t.ctx.alert).toHaveBeenCalledWith('messages.race_invalid_json');expect(input.disabled).toBe(false);
});
