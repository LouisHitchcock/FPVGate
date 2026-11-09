const fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'../data/history-filters.js'),'utf8');
function filters(){const c={Date,Number,document,renderRaceHistory:jest.fn()};vm.createContext(c);vm.runInContext(source,c);return c;}
const seconds=(date)=>Math.floor(new Date(date).getTime()/1000);
const legacy={timestamp:seconds('2026-10-01T12:00:00'),pilotName:'Alice',pilotCallsign:'ACE',lapTimes:[4000,10000,11000],name:'Practice',trackName:'North',notes:'wet track'};
const multi={timestamp:seconds('2026-11-09T23:59:59'),pilots:[{name:'Bea',callsign:'BEE',lapTimes:[3000,9000,9500]},{name:'Cal',callsign:'CGG',lapTimes:[3500,12000]}],importedAt:seconds('2026-11-10T01:00:00')};
test('total laps combines pilots, excludes every Gate 1 and avoids double-counting legacy mirror',()=>{
 const c=filters();expect(c.historyRaceLaps(legacy)).toBe(2);expect(c.historyRaceLaps({...multi,lapTimes:[1,2,3]})).toBe(3);expect(c.historyRaceLaps({lapTimes:[0]})).toBe(0);
});
test('pilot matches legacy and multi-pilot names/callsigns case-insensitively',()=>{
 const c=filters();expect(c.filterHistoryRows([legacy,multi],{pilot:' ace '})[0].index).toBe(0);expect(c.filterHistoryRows([legacy,multi],{pilot:'cgg'})[0].index).toBe(1);
});
test('race-date bounds are inclusive local dates, independent of import date',()=>{
 const c=filters();expect(c.filterHistoryRows([legacy,multi],{from:'2026-11-09',to:'2026-11-09'}).map(r=>r.index)).toEqual([1]);
 const midnight={...multi,timestamp:seconds('2026-11-10T00:00:00')};expect(c.filterHistoryRows([midnight],{to:'2026-11-09'})).toHaveLength(0);
});
test('recent import uses importedAt, including old races, and legacy unknowns are not invented',()=>{
 const c=filters(),now=new Date('2026-11-10T02:00:00').getTime();const oldImported={...legacy,importedAt:seconds('2026-11-10T01:00:00')};
 expect(c.filterHistoryRows([legacy,oldImported,multi],{imported:'24h'},now).map(r=>r.index)).toEqual([2,1]);
 expect(c.filterHistoryRows([{...legacy,importedAt:seconds('2026-11-01T01:00:00')}],{imported:'7d'},now)).toHaveLength(0);
});
test('lap ranges and text search combine without mutating source records',()=>{
 const c=filters(),races=[legacy,multi];expect(c.filterHistoryRows(races,{minLaps:'3',maxLaps:'3'})[0].index).toBe(1);
 expect(c.filterHistoryRows(races,{search:'wet',maxLaps:'2'})[0].index).toBe(0);expect(races[0]).toBe(legacy);
 expect(c.filterHistoryRows(races,{minLaps:'4'})).toHaveLength(0);
});
test('sorting preserves original card indices for edit/delete/detail actions',()=>{
 const c=filters();expect(c.filterHistoryRows([legacy,multi],{sort:'race-desc'}).map(r=>r.index)).toEqual([1,0]);
 expect(c.filterHistoryRows([legacy,multi],{sort:'race-asc'}).map(r=>r.index)).toEqual([0,1]);
 expect(c.filterHistoryRows([legacy,multi],{sort:'laps-desc'}).map(r=>r.index)).toEqual([1,0]);
 expect(c.filterHistoryRows([legacy,multi],{sort:'import-desc'}).map(r=>r.index)).toEqual([1,0]);
});
test('clear resets all controls and renders once',()=>{
 document.body.innerHTML=['historyPilot','historySearch','historyFrom','historyTo','historyMinLaps','historyMaxLaps','historyImported','historySort'].map(id=>`<input id="${id}" value="x">`).join('');
 const c=filters();c.clearHistoryFilters();expect(c.readHistoryFilters()).toEqual({pilot:'',search:'',from:'',to:'',minLaps:'',maxLaps:'',imported:'all',sort:'race-desc'});expect(c.renderRaceHistory).toHaveBeenCalledTimes(1);
});
const main=fs.readFileSync(path.join(__dirname,'../data/script.js'),'utf8');const loader=main.slice(main.indexOf('async function loadRaceHistory('),main.indexOf('\nfunction renderRaceHistory()'));
function history(fetch){document.body.innerHTML='<p id="historyFilterStatus"></p>';const c={fetch,document,console:{error:jest.fn()},i18n:{t:key=>key},renderRaceHistory:jest.fn(),raceHistoryData:[],historyLoadGeneration:0};vm.createContext(c);vm.runInContext(loader,c);return c;}
const response=body=>({ok:true,json:async()=>body});
test('loads older races through bounded cursor pages and de-duplicates overlap',async()=>{
 const first=Array.from({length:50},(_,i)=>({timestamp:100-i})),next=Array.from({length:37},(_,i)=>({timestamp:50-i}));
 const fetch=jest.fn().mockResolvedValueOnce(response({races:first,hasMore:true,nextBefore:51})).mockResolvedValueOnce(response({races:next,hasMore:false}));
 const c=history(fetch);const all=await c.loadRaceHistory();expect(all).toHaveLength(87);expect(fetch.mock.calls.map(r=>r[0])).toEqual(['/races?page=1','/races?page=1&before=51']);expect(c.renderRaceHistory).toHaveBeenCalledTimes(1);
});
test('failed page preserves existing history and reports failure',async()=>{
 const c=history(jest.fn(async()=>({ok:false,status:503})));c.raceHistoryData=[legacy];expect(await c.loadRaceHistory()).toBeNull();expect(c.raceHistoryData[0]).toBe(legacy);expect(document.getElementById('historyFilterStatus').textContent).toBe('history.load_error');
});
test('repeating cursor cannot loop indefinitely',async()=>{
 const fetch=jest.fn(async()=>response({races:[{timestamp:10}],hasMore:true,nextBefore:10}));const c=history(fetch);expect(await c.loadRaceHistory()).toBeNull();expect(fetch).toHaveBeenCalledTimes(2);
});

test('filtered cards keep their original indices; hiding an expanded race stops playback without losing details DOM',()=>{
 document.body.innerHTML='<div id="raceHistoryList"></div><div id="raceDetails" style="display:block"></div><p id="historyFilterStatus"></p>';
 const c=filters(),bob={...legacy,timestamp:legacy.timestamp+1,pilotName:'Bob',pilotCallsign:'B'};
 Object.assign(c,{raceHistoryData:[legacy,bob],currentDetailRace:bob,i18n:{t:key=>key},escapeHtml:s=>s,setupRaceHistoryEventHandlers:jest.fn(),stopPlayback:jest.fn()});
 c.readHistoryFilters=()=>({pilot:'bob'});
 vm.runInContext(main.slice(main.indexOf('function renderRaceHistory()'),main.indexOf('\nfunction setupRaceHistoryEventHandlers()')),c);
 vm.runInContext(main.slice(main.indexOf('function closeRaceDetails()'),main.indexOf('\n// Race Playback',main.indexOf('function closeRaceDetails()'))),c);
 c.renderRaceHistory();expect(document.querySelector('.race-item').dataset.raceIndex).toBe('1');
 expect(document.getElementById('raceDetails').parentNode.dataset.raceIndex).toBe('1');
 c.readHistoryFilters=()=>({pilot:'alice'});c.renderRaceHistory();expect(c.stopPlayback).toHaveBeenCalledTimes(1);expect(c.currentDetailRace).toBeNull();
 c.raceHistoryData=[];c.renderRaceHistory();expect(document.getElementById('raceDetails')).not.toBeNull();
});

test('full backup uses every fetched race, not the old capped download endpoint',async()=>{
 const races=Array.from({length:87},(_,i)=>({timestamp:i+1}));let blob;
 const ctx={loadRaceHistory:jest.fn(async()=>races),document,Blob:class{constructor(parts){blob=parts[0];}},URL:{createObjectURL:jest.fn(()=> 'blob:backup'),revokeObjectURL:jest.fn()},setTimeout:fn=>fn()};
 const click=jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 vm.createContext(ctx);vm.runInContext(main.slice(main.indexOf('async function downloadRaces()'),main.indexOf('\nfunction downloadSingleRace(')),ctx);
 await ctx.downloadRaces();expect(JSON.parse(blob).races).toHaveLength(87);expect(click).toHaveBeenCalledTimes(1);expect(ctx.URL.revokeObjectURL).toHaveBeenCalledWith('blob:backup');click.mockRestore();
});
