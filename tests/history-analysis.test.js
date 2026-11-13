const fs=require('fs'),path=require('path'),vm=require('vm');
function analysis(){const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../data/history-analysis.js'),'utf8')+'\nthis.A=HistoryAnalysis;',context);return context.A;}
const timestamp=value=>new Date(value).getTime()/1000;
test('Gate 1 contributes elapsed time but never lap statistics or best-three',()=>{
 const a=analysis(),p=a.pilots({lapTimes:[1,10000,11000,12000,20000]})[0];
 expect(p.best).toBe(10000);expect(p.bestLap).toBe(1);expect(p.total).toBe(53001);expect(p.average).toBe(13250);expect(p.median).toBe(11500);expect(a.consecutive(p).total).toBe(33000);
});
test('multi-pilot standings use each pilot, exclude mirrored top-level laps and preserve ties',()=>{
 const a=analysis(),race={lapTimes:[1,2,3],pilots:[{name:'A',lapTimes:[2000,10000]},{name:'B',lapTimes:[1000,11000]},{name:'C',lapTimes:[4000,5000,5000]},{name:'D',lapTimes:[1000,11000]}]};
 const result=a.standings(race);expect(result.map(p=>p.name)).toEqual(['C','A','B','D']);expect(result.map(p=>p.position)).toEqual([1,2,2,2]);expect(result[0].total).toBe(14000);
});
test('empty and Gate-1-only races have no invented best lap or best-three',()=>{
 const a=analysis();for(const race of [{},{lapTimes:[]},{lapTimes:[1000]}]){const p=a.pilots(race);expect(a.fastest(p)).toBeNull();expect(a.bestThree(p)).toBeNull();expect(p[0].valid).toHaveLength(0);}
});
test('review flags use only the same pilot median and need at least three completed laps',()=>{
 const a=analysis();expect(a.checks(a.pilots({lapTimes:[1,10000,10000,40000]})[0]).map(p=>p.lap)).toEqual([3]);expect(a.checks(a.pilots({lapTimes:[1,10000,40000]})[0])).toHaveLength(0);
});
test('previous best matches identity, track and earlier date without including this race or other tracks',()=>{
 const a=analysis(),race={timestamp:500,trackId:7,pilots:[{name:'Alice',callsign:'Ace',lapTimes:[100,10000]}]},p=a.pilots(race)[0];
 expect(a.previousBest(p,race,[race,{timestamp:499,trackId:8,pilotCallsign:'Ace',lapTimes:[100,1000]},{timestamp:499,trackId:7,pilotCallsign:'ACE',lapTimes:[100,11000]},{timestamp:501,trackId:7,pilotCallsign:'Ace',lapTimes:[100,1000]}])).toBe(11000);
});
test('sessions split after 45 minutes and keep race numbering stable under filters',()=>{
 const a=analysis(),base=timestamp('2026-11-10T12:00:00'),races=[0,60,2800,2900].map(seconds=>({timestamp:base+seconds}));
 const result=a.group([{race:races[1],index:1},{race:races[3],index:3}],races,'race-asc');
 expect(result.days).toHaveLength(1);expect(result.days[0].sessions.map(s=>s.number)).toEqual([1,2]);expect(result.metadata.get(races[1].timestamp).number).toBe(2);expect(result.metadata.get(races[3].timestamp).number).toBe(2);
});
test('non-date sorts remain globally ordered rather than silently regrouping by day',()=>{
 const a=analysis(),races=[{timestamp:timestamp('2026-11-10T12:00:00')},{timestamp:timestamp('2026-11-11T12:00:00')}],rows=[{race:races[0],index:0},{race:races[1],index:1}];
 for(const sort of ['laps-desc','laps-asc','import-desc']){const result=a.group(rows,races,sort);expect(result.grouped).toBe(false);expect(result.rows).toBe(rows);}
});
test('gap chart compares actual cumulative crossings at the same lap and never extends a missing pilot',()=>{
 const a=analysis(),p=a.pilots({pilots:[{lapTimes:[1000,10000,12000]},{lapTimes:[2000,9000]}]});const flow=a.flow(p);expect(flow.leader).toEqual([1000,11000,23000]);expect(flow.gaps[0]).toEqual([0,0,0]);expect(flow.gaps[1]).toEqual([1000,0]);
});
test('null lap data is not converted to a zero or bridged by consecutive metrics',()=>{
 const a=analysis(),p=a.pilots({lapTimes:[1000,10000,null,11000,12000]})[0];expect(p.total).toBeNull();expect(p.bestLap).toBe(1);expect(a.consecutive(p)).toBeNull();expect(a.flow([p]).gaps[0]).toEqual([0,0,null,null,null]);
});
