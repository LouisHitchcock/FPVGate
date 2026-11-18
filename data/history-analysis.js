/* Pure history calculations. Stored values are milliseconds; Gate 1 is raw[0]. */
const HistoryAnalysis = (() => {
  const sum = values => values.reduce((total, value) => total + value, 0);
  const median = values => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a,b)=>a-b), middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
  };
  const palette = ['#4fc3f7','#ff8a65','#ffd54f','#81c784','#ba68c8','#4db6ac','#f06292','#a1887f'];
  const hex = (value,index) => value == null ? palette[index%palette.length] : '#'+((Number(value)>>>0)&0xffffff).toString(16).padStart(6,'0');
  function pilots(race) {
    const source = Array.isArray(race.pilots)&&race.pilots.length ? race.pilots : [{name:race.pilotName,callsign:race.pilotCallsign,lapTimes:race.lapTimes}];
    return source.map((pilot,index)=>{
      const raw = (Array.isArray(pilot.lapTimes)?pilot.lapTimes:[]).map(v=>Number.isFinite(v)&&v>=0?v:null);
      const laps = raw.slice(1), valid = laps.filter(v=>v!==null&&v>0);
      const best = valid.length?Math.min(...valid):null, average = valid.length?sum(valid)/valid.length:null;
      const sd = valid.length>1?Math.sqrt(sum(valid.map(v=>(v-average)**2))/(valid.length-1)):null;
      return {index,name:String(pilot.name||pilot.callsign||'Pilot '+(index+1)),callsign:String(pilot.callsign||''),color:hex(pilot.color,index),raw,laps,valid,best,bestLap:best===null?null:laps.indexOf(best)+1,gate1:raw[0]??null,total:raw.every(v=>v!==null)?sum(raw):null,average,median:median(valid),sd};
    });
  }
  function standings(race) {
    const ordered=pilots(race).sort((a,b)=>b.valid.length-a.valid.length||(a.total??Infinity)-(b.total??Infinity)||a.index-b.index);
    return ordered.map((pilot,index)=>({...pilot,position:index&&pilot.valid.length===ordered[index-1].valid.length&&pilot.total===ordered[index-1].total?null:index+1})).map((pilot,index,all)=>({...pilot,position:pilot.position??all.slice(0,index).reverse().find(p=>p.position!==null).position}));
  }
  function fastest(pilots) { return pilots.filter(p=>p.best!==null).sort((a,b)=>a.best-b.best||a.index-b.index)[0]||null; }
  function consecutive(pilot) {
    let best=null;
    for(let i=0;i+3<=pilot.laps.length;i++){
      const values=pilot.laps.slice(i,i+3);
      if(values.every(v=>v!==null&&v>0)){const total=sum(values);if(!best||total<best.total)best={total,from:i+1,pilot};}
    }
    return best;
  }
  function bestThree(pilots) { return pilots.map(consecutive).filter(Boolean).sort((a,b)=>a.total-b.total)[0]||null; }
  function checks(pilot) {
    if(pilot.valid.length<3||!pilot.median)return [];
    return pilot.laps.flatMap((value,index)=>value>2*pilot.median?[{lap:index+1,value,ratio:value/pilot.median}]:[]);
  }
  function trackKey(race) {
    return race.trackId>0?'id:'+race.trackId:race.trackName?'name:'+String(race.trackName).trim().toLowerCase():'unknown';
  }
  function previousBest(pilot,race,history) {
    const identity=String(pilot.callsign||pilot.name).trim().toLowerCase();let best=null;
    for(const earlier of history){
      if(earlier.timestamp>=race.timestamp||trackKey(earlier)!==trackKey(race))continue;
      for(const p of pilots(earlier))if(String(p.callsign||p.name).trim().toLowerCase()===identity&&p.best!==null&&(best===null||p.best<best))best=p.best;
    }
    return best;
  }
  function dayKey(timestamp) {
    const date=new Date(timestamp*1000);
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  }
  function group(rows,allRaces,sort='race-desc') {
    // Session membership and numbering use the complete day, so filtering never
    // renumbers a race or merges separate sessions. A >45 minute gap starts one.
    const metadata=new Map(),complete=new Map();
    for(const race of allRaces){const key=dayKey(race.timestamp);if(!complete.has(key))complete.set(key,[]);complete.get(key).push(race);}
    for(const [key,races] of complete){
      let session=0,number=0,last=null;
      for(const race of races.slice().sort((a,b)=>a.timestamp-b.timestamp)){
        if(last===null||race.timestamp-last>45*60){session++;number=0;}
        metadata.set(race.timestamp,{day:key,session,number:++number});last=race.timestamp;
      }
    }
    // Preserve global ordering for non-date sorts; grouping would silently
    // change "most laps" or "latest import" into a different sort order.
    if(!['race-desc','race-asc'].includes(sort))return {grouped:false,rows,metadata};
    const days=[];
    for(const row of rows){
      const meta=metadata.get(row.race.timestamp);let day=days.at(-1);
      if(!day||day.key!==meta.day){day={key:meta.day,sessions:[],rows:[]};days.push(day);}
      day.rows.push(row);let session=day.sessions.at(-1);
      if(!session||session.number!==meta.session){session={number:meta.session,rows:[]};day.sessions.push(session);}
      session.rows.push(row);
    }
    return {grouped:true,days,metadata};
  }
  function flow(pilots) {
    const cumulative=pilots.map(p=>{let total=0;return p.raw.map(value=>{if(value===null||total===null)return total=null;return total+=value;});});
    const length=Math.max(0,...cumulative.map(v=>v.length));
    const leader=Array.from({length},(_,i)=>{const present=cumulative.map(values=>values[i]).filter(Number.isFinite);return present.length?Math.min(...present):null;});
    return {leader,gaps:cumulative.map(values=>values.map((value,i)=>value===null||leader[i]===null?null:value-leader[i]))};
  }
  return {sum,median,pilots,standings,fastest,consecutive,bestThree,checks,trackKey,previousBest,dayKey,group,flow};
})();
