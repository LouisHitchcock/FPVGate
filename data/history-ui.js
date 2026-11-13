/* Race-day presentation over the existing history, editor and playback APIs. */
const HistoryUI = (() => {
  const A=HistoryAnalysis, $=id=>document.getElementById(id);
  const messages={refresh:'Refresh',lapCount:'Laps',race:'Race {n}',session:'Session {n}',downloadDay:'Download day',races:'{n} races',pilots:'{n} pilots',laps:'{n} laps',fastest:'Fastest lap',winner:'Winner',pilot:'Pilot',noLaps:'No completed laps',bestThree:'Best 3 consecutive',median:'Median lap',results:'Results',lapTable:'Laps',flow:'Race flow',consistency:'Consistency',lapTimes:'Lap times',againstBest:'Against own best',gap:'Gap',best:'Best',average:'Average',spread:'Spread',time:'Time',previous:'vs previous best',first:'first race',newBest:'new best',gate:'Gate 1',lap:'Lap',lapNumber:'lap {lap}',racesOne:'{n} race',pilotsOne:'{n} pilot',lapsOne:'{n} lap',review:'{n} laps to review',reviewOne:'{n} lap to review',lapsIn:'{laps} in {time}',threeNeeded:'needs 3 laps',allPilots:'all pilots',bestLapNumber:'{pilot}, lap {lap}',threeRange:'{pilot}, laps {from}–{to}',threeRangeSolo:'laps {from}–{to}',wonBy:'{pilot} won by {gap} from {second}.',wonByLaps:'{pilot} won by {laps}; {second} was second.',tied:'{pilot} and {second} finished level on laps and time.',gateFirstLed:'{pilot} reached Gate 1 first ({time}) and led from the start.',gateFirst:'{pilot} reached Gate 1 first ({time}).',steady:'Most consistent: {pilot}, laps within ±{sd} of a {average} average.',soloHalves:'Second half averaged {second} against {first} in the first half.',personalBest:'Personal bests: {list}.',personalBestOne:'Personal best: {list}.',checkLaps:'{n} laps worth checking for a missed pass: {list}.',checkLapsOne:'{n} lap worth checking for a missed pass: {list}.',checkItem:'{pilot} lap {lap} ({time}, {ratio}× their median)',moreChecks:'{n} more',openMarshal:'Open in Marshal',play:'Play race',stop:'Stop',marshal:'Marshal',edit:'Edit',download:'Download',delete:'Delete',close:'Close',notes:'Notes',resultsLegend:'Spread is the standard deviation of a pilot’s laps: smaller is more consistent. Gate 1 time is included in Time.',previousNote:'Earlier bests match pilot name/callsign and recorded track.',fastestLegend:'Outlined: fastest lap of the race. Bold: each pilot’s best. Dashed amber: review this lap.',shadeLegend:'In comparison view, darker cells are slower relative to that pilot’s own best.',flowTitle:'Gap to the leader',flowNote:'Time behind the fastest recorded elapsed time at the same lap number. Gate 1 is included. Each lap compares only pilots who reached it; this is not live race position.',flowTable:'Show gap values',consistencyTitle:'Every lap, per pilot',consistencyNote:'Each dot is a completed lap. The larger outlined dot marks a best lap; the vertical tick marks the median. Dashed amber circles mark laps for review. Spread is sample standard deviation, not a guaranteed range.',consistencyTable:'Show lap statistics',empty:'No lap data available.',needsData:'Not enough lap data.'};
  function t(key,values={}){
    // Singular forms are optional per language; languages without them use the general string.
    if(values.n===1&&!key.endsWith('One')){const one=t(key+'One',values);if(one!==key+'One')return one;}
    const full='history.redesign.'+key;
    let value=typeof i18n!=='undefined'?i18n.t(full,values):full;
    if(value===full)value=messages[key]||key;
    return String(value).replace(/\{(\w+)\}/g,(_,name)=>values[name]??'{'+name+'}');
  }
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=value=>value===null||value===undefined?'—':(value/1000).toFixed(2)+'s';
  const delta=value=>(value>=0?'+':'−')+fmt(Math.abs(value));
  const date=timestamp=>new Date(timestamp*1000);
  const dayName=timestamp=>date(timestamp).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const clock=timestamp=>date(timestamp).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  const swatch=pilot=>`<span class="rh-swatch" style="background:${pilot.color}" aria-hidden="true"></span>`;
  let page,list,details,detailHost,tabs,panel,legacy,meta=new Map(),selected='results',lapView='time',lastTrigger=null;
  function button(label,action,attributes='') {return `<button type="button" data-rh-action="${action}" ${attributes}>${esc(label)}</button>`;}
  function tile({race,index}) {
    const info=meta.get(race.timestamp),st=A.standings(race),first=st[0],best=A.fastest(st),nChecks=A.sum(st.map(p=>A.checks(p).length));
    const name=race.name||t('race',{n:info.number});
    return `<article class="race-item rh-race" data-race-index="${index}"><button type="button" class="rh-tile" aria-expanded="false" aria-controls="raceDetails" data-rh-race="${race.timestamp}">
      <span class="rh-tile-top"><strong>${esc(name)}</strong><time datetime="${date(race.timestamp).toISOString()}">${esc(clock(race.timestamp))}</time></span>
      <span class="rh-who">${swatch(first)}<span>${esc(first.valid.length?first.name:t('noLaps'))}</span></span>
      <span class="rh-meta">${esc(t('pilots',{n:st.length}))} · ${esc(t('laps',{n:historyRaceLaps(race)}))} · ${esc(t('fastest'))} ${fmt(best?.best)}</span>
      ${race.trackName?`<span class="rh-meta">${esc(race.trackName)}</span>`:''}${race.tag?`<span class="rh-meta">${esc(race.tag)}</span>`:''}
      ${race.importedAt?`<span class="rh-meta">${esc(i18n.t('history.imported_on',{date:date(race.importedAt).toLocaleDateString()}))}</span>`:''}
      ${nChecks?`<span class="rh-review">${esc(t('review',{n:nChecks}))}</span>`:''}</button></article>`;
  }
  function render() {
    if(!list)return;
    const filters=readHistoryFilters(),rows=filterHistoryRows(raceHistoryData,filters),sort=filters.sort||'race-desc';
    const grouping=A.group(rows,raceHistoryData,sort);meta=grouping.metadata;
    const status=$('historyFilterStatus');status.textContent=i18n.t('history.matching',{n:rows.length,total:raceHistoryData.length});
    const open=details.style.display!=='none'&&currentDetailRace?currentDetailRace.timestamp:null;
    page.append(details); // Keep the original details, timeline and canvases alive.
    let html='';
    if(grouping.grouped){
      for(const day of grouping.days){
        const pilots=day.rows.flatMap(row=>A.pilots(row.race)),best=A.fastest(pilots);
        const names=new Set(pilots.map(p=>(p.callsign||p.name).trim().toLowerCase()));
        html+=`<section class="rh-day"><div class="rh-day-head"><h3>${esc(dayName(day.rows[0].race.timestamp))}</h3><p>${esc(t('races',{n:day.rows.length}))} · ${esc(t('pilots',{n:names.size}))} · ${esc(t('laps',{n:A.sum(day.rows.map(row=>historyRaceLaps(row.race)))}))}${best?' · '+esc(t('fastest'))+' '+fmt(best.best):''}</p>${button(t('downloadDay'),'day',`data-day="${day.key}"`)}</div>`;
        for(const session of day.sessions){
          const complete=raceHistoryData.filter(r=>meta.get(r.timestamp)?.day===day.key&&meta.get(r.timestamp)?.session===session.number).sort((a,b)=>a.timestamp-b.timestamp);
          html+=`<h4 class="rh-session">${esc(t('session',{n:session.number}))} · ${esc(clock(complete[0].timestamp))}–${esc(clock(complete.at(-1).timestamp))}</h4><div class="rh-tiles">${session.rows.map(tile).join('')}</div>`;
        }
        html+='</section>';
      }
    }else html=`<div class="rh-tiles rh-sorted">${rows.map(tile).join('')}</div>`;
    if(!rows.length)html=`<p class="no-data">${esc(i18n.t(raceHistoryData.length?'history.no_matches':'history.no_data'))}</p>`;
    list.innerHTML=html;setupRaceHistoryEventHandlers();
    const index=open===null?-1:raceHistoryData.findIndex(r=>r.timestamp===open);
    const host=index<0?null:list.querySelector(`.race-item[data-race-index="${index}"]`);
    if(host){currentDetailRace=raceHistoryData[index];attach(host);paint();}
    else if(open!==null)closeRaceDetails();
  }
  function attach(host) {
    host.after(details);host.classList.add('is-expanded');details.style.display='block';
    list.querySelectorAll('.rh-tile').forEach(node=>node.setAttribute('aria-expanded',String(node.closest('.race-item')===host)));
  }
  function key(label,value,sub='') {return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd><small>${esc(sub)}</small></div>`;}
  const strong=value=>`<b>${esc(value)}</b>`;
  // Translated sentence with escaped values; named values are emphasised as in the approved design.
  function rich(name,values,bold=[]) {
    const marked=Object.fromEntries(Object.keys(values).map(k=>[k,'\u0001'+k+'\u0002']));
    return esc(t(name,marked)).replace(/\u0001(\w+)\u0002/g,(_,k)=>bold.includes(k)?strong(values[k]):esc(values[k]));
  }
  function playing() {const stop=$('stopPlaybackBtn');return !!stop&&!!stop.style.display&&stop.style.display!=='none';}
  function actions() {
    const play=playing();
    return button(t(play?'stop':'play'),'play',`aria-pressed="${play}"`)+button(t('marshal'),'marshal')+button(t('edit'),'edit')+button(t('download'),'download');
  }
  function paint() {
    const race=currentDetailRace;if(!race)return;
    const st=A.standings(race),multi=st.length>1,best=A.fastest(st),three=A.bestThree(st),lead=st[0],info=meta.get(race.timestamp)||{number:'—',session:'—'};
    $('raceDetailsTitle').textContent=(race.name||t('race',{n:info.number}))+' · '+t('session',{n:info.session});
    $('raceDetailsTitle').tabIndex=-1;
    const channel=race.band?`${race.band}${race.channel||''} ${race.frequency||''} MHz`.trim():'';
    $('historyDetailMeta').textContent=[dayName(race.timestamp)+', '+clock(race.timestamp),multi?t('pilots',{n:st.length}):channel,race.trackName,race.tag,race.importedAt?i18n.t('history.imported_on',{date:date(race.importedAt).toLocaleDateString()}):''].filter(Boolean).join(' · ');
    const notes=$('historyDetailNotes');notes.hidden=!race.notes;notes.innerHTML=race.notes?`<span>${esc(t('notes'))}</span> ${esc(race.notes)}`:'';
    $('historyDetailActions').innerHTML=actions();
    const all=st.flatMap(p=>p.valid);
    $('historyKeyResults').innerHTML=
      key(multi?t('winner'):t('pilot'),lead.valid.length?lead.name:t('noLaps'),lead.valid.length?t('lapsIn',{laps:t('laps',{n:lead.valid.length}),time:fmt(lead.total)}):'')+
      key(t('fastest'),fmt(best?.best),best?(multi?t('bestLapNumber',{pilot:best.name,lap:best.bestLap}):t('lapNumber',{lap:best.bestLap})):'')+
      key(t('bestThree'),three?fmt(three.total):'–',three?(multi?t('threeRange',{pilot:three.pilot.name,from:three.from,to:three.from+2}):t('threeRangeSolo',{from:three.from,to:three.from+2})):t('threeNeeded'))+
      key(t('median'),fmt(A.median(all)),multi?t('allPilots'):t('laps',{n:all.length}));
    // Written summary: facts only, each one useful to act on.
    const lines=[];
    if(multi&&lead.valid.length){
      const second=st[1];
      if(second.position===1)lines.push(rich('tied',{pilot:lead.name,second:second.name},['pilot','second']));
      else if(lead.valid.length>second.valid.length)lines.push(rich('wonByLaps',{pilot:lead.name,laps:t('laps',{n:lead.valid.length-second.valid.length}),second:second.name},['pilot']));
      else lines.push(rich('wonBy',{pilot:lead.name,gap:fmt(second.total-lead.total),second:second.name},['pilot']));
      const start=st.filter(p=>p.gate1!==null).sort((a,b)=>a.gate1-b.gate1);
      if(start.length>1&&start[0].gate1<start[1].gate1)lines.push(rich(start[0]===lead?'gateFirstLed':'gateFirst',{pilot:start[0].name,time:fmt(start[0].gate1)},['pilot']));
      const steady=st.filter(p=>p.valid.length>=3&&p.sd!==null).sort((a,b)=>a.sd/a.average-b.sd/b.average)[0];
      if(steady)lines.push(rich('steady',{pilot:steady.name,sd:fmt(steady.sd),average:fmt(steady.average)},['pilot']));
    }else if(lead.valid.length>=4){const half=Math.floor(lead.valid.length/2);lines.push(rich('soloHalves',{first:fmt(A.sum(lead.valid.slice(0,half))/half),second:fmt(A.sum(lead.valid.slice(half))/(lead.valid.length-half))}));}
    const bests=st.map(p=>({p,previous:A.previousBest(p,race,raceHistoryData)})).filter(x=>x.p.best!==null&&x.previous!==null&&x.p.best<x.previous);
    if(bests.length)lines.push(esc(t('personalBest',{n:bests.length,list:'\u0001'})).replace('\u0001',bests.map(x=>`${strong(x.p.name)} ${fmt(x.p.best)} (<span class="rh-better">${delta(x.p.best-x.previous)}</span>)`).join(', ')));
    let html=lines.map(line=>'<li>'+line+'</li>').join('');
    const flags=st.flatMap(p=>A.checks(p).map(check=>({p,...check})));
    if(flags.length){
      const list=flags.slice(0,3).map(f=>t('checkItem',{pilot:f.p.name,lap:f.lap,time:fmt(f.value),ratio:f.ratio.toFixed(1)})).concat(flags.length>3?[t('moreChecks',{n:flags.length-3})]:[]).join('; ');
      html+=`<li class="rh-review">${esc(t('checkLaps',{n:flags.length,list}))} <button type="button" class="rh-link" data-rh-action="marshal">${esc(t('openMarshal'))}</button></li>`;
    }
    $('historyFindings').innerHTML=html;$('historyFindings').hidden=!html;
    const choices=multi?[['results',t('results')],['laps',t('lapTable')],['flow',t('flow')],['consistency',t('consistency')]]:[['laps',t('lapTable')],['consistency',t('consistency')]];
    if(!choices.some(([id])=>id===selected))selected=choices[0][0];
    tabs.innerHTML=choices.map(([id,label])=>`<button type="button" role="tab" id="rh-tab-${id}" aria-selected="${id===selected}" aria-controls="historyAnalysisPanel" tabindex="${id===selected?0:-1}" data-rh-tab="${id}">${esc(label)}</button>`).join('');
    panel.setAttribute('aria-labelledby','rh-tab-'+selected);
    panel.innerHTML=selected==='results'?results(st,race):selected==='laps'?laps(st):selected==='flow'?flow(st):consistency(st);
    theme();
  }
  function scrollTable(html,label) {return `<div class="rh-scroll" role="region" aria-label="${esc(label)}" tabindex="0">${html}</div>`;}
  function results(st,race) {
    const lead=st[0],fastest=A.fastest(st);
    const head=[['',''],['pilot','rh-name'],['lapCount','rh-num'],['time','rh-num'],['gap','rh-num'],['best','rh-num'],['average','rh-num rh-hide-phone'],['spread','rh-num rh-hide-phone'],['previous','rh-num']];
    const rows=st.map(p=>{
      const previous=A.previousBest(p,race,raceHistoryData);
      const gap=p.position===1?'':p.valid.length<lead.valid.length?'+'+t('laps',{n:lead.valid.length-p.valid.length}):delta(p.total-lead.total);
      const versus=previous===null||p.best===null?`<span class="rh-sub">${esc(t('first'))}</span>`:p.best<previous?`<span class="rh-better">${esc(delta(p.best-previous)+' '+t('newBest'))}</span>`:`<span class="rh-sub">${esc(delta(p.best-previous))}</span>`;
      return `<tr class="${p.position===1?'rh-first':''}"><td class="rh-pos">${p.position}</td><th scope="row" class="rh-name" title="${esc(p.name)}">${swatch(p)}${esc(p.name)}</th><td class="rh-num">${p.valid.length}</td><td class="rh-num">${fmt(p.total)}</td><td class="rh-num rh-sub">${esc(gap)}</td><td class="rh-num${fastest&&p.index===fastest.index?' rh-cell-best':''}">${fmt(p.best)}</td><td class="rh-num rh-hide-phone">${fmt(p.average)}</td><td class="rh-num rh-hide-phone rh-sub">${p.sd===null?'–':'±'+fmt(p.sd)}</td><td class="rh-num">${versus}</td></tr>`;
    }).join('');
    const headings=head.map(([k,c])=>`<th scope="col" class="${c}"${k==='previous'?` title="${esc(t('previousNote'))}"`:''}>${k?esc(t(k)):'<span class="rh-visually-hidden">#</span>'}</th>`).join('');
    return scrollTable(`<table class="rh-results"><caption>${esc(t('results'))}</caption><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table>`,t('results'))+`<p class="rh-help">${esc(t('resultsLegend'))}</p>`;
  }
  function laps(st) {
    const fastest=A.fastest(st),count=Math.max(0,...st.map(p=>p.laps.length));
    if(!st.some(p=>p.raw.length))return `<p>${esc(t('empty'))}</p>`;
    let rows=`<tr><th scope="row">${esc(t('gate'))}</th>${st.map(p=>`<td>${fmt(p.gate1)}</td>`).join('')}</tr>`;
    for(let i=0;i<count;i++)rows+=`<tr><th scope="row">${i+1}</th>${st.map(p=>{
      const value=p.laps[i];if(value===undefined||value===null)return '<td>—</td>';
      const best=value===p.best,isFastest=fastest&&value===fastest.best,flag=A.checks(p).some(c=>c.lap===i+1);
      const shade=lapView==='delta'&&p.valid.length>1?(value-p.best)/(Math.max(...p.valid)-p.best||1)*.25:0;
      return `<td class="${best?'rh-best ':''}${isFastest?'rh-fastest ':''}${flag?'rh-flag':''}" style="--rh-shade:${shade}" aria-label="${esc(p.name+', '+t('lap')+' '+(i+1)+', '+fmt(value)+(best?', '+t('best'):'')+(flag?', '+t('review',{n:1}):''))}">${lapView==='delta'&&!best?delta(value-p.best):fmt(value)}</td>`;
    }).join('')}</tr>`;
    rows+=`<tr><th scope="row">${esc(t('average'))}</th>${st.map(p=>`<td>${fmt(p.average)}</td>`).join('')}</tr>`;
    return `<div class="rh-segment" role="group" aria-label="${esc(t('lapTable'))}">${['time','delta'].map(mode=>`<button type="button" data-rh-lapview="${mode}" aria-pressed="${lapView===mode}">${esc(t(mode==='time'?'lapTimes':'againstBest'))}</button>`).join('')}</div>`+scrollTable(`<table><caption>${esc(t('lapTable'))}</caption><thead><tr><th scope="col">${esc(t('lap'))}</th>${st.map(p=>`<th scope="col">${swatch(p)}${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,t('lapTable'))+`<p class="rh-help">${esc(t('fastestLegend'))} ${lapView==='delta'?esc(t('shadeLegend')):''}</p>`;
  }
  function flow(st) {
    const data=A.flow(st),n=data.leader.length-1;
    if(n<1)return '<p>'+esc(t('needsData'))+'</p>';
    const max=Math.max(1000,...data.gaps.flat().filter(Number.isFinite))*1.08,W=820,H=280,L=65,R=25,T=18,B=44;
    const x=i=>L+i/n*(W-L-R),y=value=>T+value/max*(H-T-B);
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="rh-flow-title rh-flow-desc"><title id="rh-flow-title">${esc(t('flowTitle'))}</title><desc id="rh-flow-desc">${esc(t('flowNote'))}</desc>`;
    for(let i=0;i<=4;i++){const value=max*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}" class="rh-grid"/><text x="${L-8}" y="${y(value)+4}" text-anchor="end">${i?delta(value):'0s'}</text>`;}
    const step=Math.max(1,Math.ceil(n/12));
    for(let i=0;i<=n;i++)if(i===0||i===n||i%step===0)svg+=`<text x="${x(i)}" y="${H-12}" text-anchor="middle">${esc(i?t('lap')+' '+i:t('gate'))}</text>`;
    st.forEach((p,k)=>{
      // Keep absent/invalid laps out of the path; no extrapolated positions.
      const valid=data.gaps[k].map((gap,i)=>gap===null?null:[i,gap]);let points=[];
      for(const point of [...valid,null]){if(point)points.push(`${x(point[0])},${y(point[1])}`);else if(points.length){svg+=`<polyline points="${points.join(' ')}" fill="none" stroke="${p.color}" stroke-width="2.5" stroke-dasharray="${k%3===1?'7 3':k%3===2?'2 3':'none'}"/>`;points=[];}}
      valid.filter(Boolean).forEach(([i,gap])=>{svg+=`<circle cx="${x(i)}" cy="${y(gap)}" r="3" fill="${p.color}"><title>${esc(p.name+', '+(i?t('lap')+' '+i:t('gate'))+': '+delta(gap))}</title></circle>`;});
    });svg+='</svg>';
    const rows=Array.from({length:n+1},(_,i)=>`<tr><th scope="row">${esc(i?t('lap')+' '+i:t('gate'))}</th>${st.map((p,k)=>`<td>${data.gaps[k][i]===undefined||data.gaps[k][i]===null?'—':delta(data.gaps[k][i])}</td>`).join('')}</tr>`).join('');
    return `<h4>${esc(t('flowTitle'))}</h4><div class="rh-chart">${svg}</div>${legend(st)}<p class="rh-help">${esc(t('flowNote'))}</p><details><summary>${esc(t('flowTable'))}</summary>${scrollTable(`<table><thead><tr><th>${esc(t('lap'))}</th>${st.map(p=>`<th scope="col">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,t('flowTable'))}</details>`;
  }
  function legend(st){return '<ul class="rh-legend">'+st.map((p,k)=>`<li>${swatch(p)}${esc(p.name)} <span aria-hidden="true">${k%3===1?'┄':k%3===2?'···':'—'}</span></li>`).join('')+'</ul>';}
  function consistency(st) {
    const all=st.flatMap(p=>p.valid);if(!all.length)return '<p>'+esc(t('needsData'))+'</p>';
    const lo=Math.min(...all),hi=Math.max(...all),W=820,L=180,R=32,T=22,H=T+st.length*42+36;
    const x=value=>L+(value-lo)/(hi-lo||1)*(W-L-R);
    let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="rh-consistency-title rh-consistency-desc"><title id="rh-consistency-title">${esc(t('consistencyTitle'))}</title><desc id="rh-consistency-desc">${esc(t('consistencyNote'))}</desc>`;
    for(let i=0;i<=5;i++){const value=lo+(hi-lo)*i/5;svg+=`<line x1="${x(value)}" x2="${x(value)}" y1="${T-8}" y2="${H-28}" class="rh-grid"/><text x="${x(value)}" y="${H-8}" text-anchor="middle">${fmt(value)}</text>`;}
    st.forEach((p,k)=>{const y=T+k*42+15;svg+=`<text x="${L-12}" y="${y+4}" text-anchor="end">${esc(p.name.length>22?p.name.slice(0,21)+'…':p.name)}</text>`;if(!p.valid.length)return;
      svg+=`<line x1="${x(Math.min(...p.valid))}" x2="${x(Math.max(...p.valid))}" y1="${y}" y2="${y}" stroke="${p.color}"/>`;
      p.laps.forEach((value,i)=>{if(value===null||value<=0)return;const flag=A.checks(p).some(c=>c.lap===i+1);svg+=`<circle cx="${x(value)}" cy="${y}" r="${value===p.best?5:3.5}" fill="${flag?'none':p.color}" stroke="${flag?'var(--rh-warning)':value===p.best?'var(--rh-strong)':p.color}" ${flag?'stroke-dasharray="2 2"':''}><title>${esc(p.name+', '+t('lap')+' '+(i+1)+': '+fmt(value))}</title></circle>`;});
      svg+=`<line x1="${x(p.median)}" x2="${x(p.median)}" y1="${y-10}" y2="${y+10}" stroke="var(--rh-strong)" stroke-width="2"/>`;
    });svg+='</svg>';
    const rows=st.map(p=>`<tr><th scope="row">${swatch(p)}${esc(p.name)}</th><td>${p.valid.length}</td><td>${fmt(p.best)}</td><td>${fmt(p.average)}</td><td>${fmt(p.median)}</td><td>${fmt(p.sd)}</td></tr>`).join('');
    return `<h4>${esc(t('consistencyTitle'))}</h4><div class="rh-chart">${svg}</div><p class="rh-help">${esc(t('consistencyNote'))}</p><details><summary>${esc(t('consistencyTable'))}</summary>${scrollTable(`<table><thead><tr>${['pilot','laps','best','average','median','spread'].map(key=>'<th scope="col">'+esc(t(key))+'</th>').join('')}</tr></thead><tbody>${rows}</tbody></table>`,t('consistencyTable'))}</details>`;
  }
  function theme() {
    if(!page)return;
    const css=getComputedStyle(document.documentElement),get=(name,fallback)=>css.getPropertyValue(name).trim()||fallback;
    const background=get('--background-color','#263238'),accent=get('--primary-color','#009688');
    // Several legacy themes leave bg-secondary at its light-theme default.
    // Derive a modest raised surface from this theme's actual page colour.
    const canvas=document.createElement('canvas').getContext('2d');canvas.fillStyle=background;
    const normalized=canvas.fillStyle;
    const rgb=normalized.startsWith('#')?normalized.slice(1).match(/../g).map(v=>parseInt(v,16)):(normalized.match(/[\d.]+/g)||[38,50,56]).slice(0,3).map(Number);
    const linear=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const target=linear[0]*.2126+linear[1]*.7152+linear[2]*.0722<.18?255:0;
    const surface='rgb('+rgb.map(v=>Math.round(v*.92+target*.08)).join(',')+')';
    const accessible=(fg,bg,min=4.5)=>typeof SettingsUI!=='undefined'?SettingsUI.accessible(fg,bg,min):fg;
    const values={background,surface,strong:accessible(accessible(get('--text-color','#eceff1'),surface),background),muted:accessible(accessible(get('--secondary-color','#90a4ae'),surface),background),accent:accessible(accent,background),'accent-fill':accent,warning:accessible('#e6a33d',background),danger:accessible('#dc4545',background)};
    // Dividers are quiet, as in the approved design: text colour at 13% (lines) or 5% (soft lines) over the page.
    values.line=`color-mix(in srgb,${values.strong} 13%,${background})`;values['line-soft']=`color-mix(in srgb,${values.strong} 5%,${background})`;
    Object.entries(values).forEach(([key,value])=>page.style.setProperty('--rh-'+key,value));
  }
  function downloadDay(key) {
    // Export the complete recorded day, even when filters hide some of its races.
    const races=raceHistoryData.filter(r=>A.dayKey(r.timestamp)===key);
    const url=URL.createObjectURL(new Blob([JSON.stringify({races})],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='races-'+key+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function initialise() {
    page=$('history');list=$('raceHistoryList');details=$('raceDetails');if(!page||!list||!details||page.dataset.redesigned)return;
    page.dataset.redesigned='true';
    const header=document.createElement('div');header.className='rh-page-head';header.append(page.querySelector(':scope > .history-header')||page.querySelector(':scope > h2'),page.querySelector('.history-controls'));page.prepend(header);
    const refresh=document.createElement('button');refresh.type='button';refresh.id='historyRefresh';refresh.dataset.rhText='refresh';refresh.textContent=t('refresh');
    refresh.addEventListener('click',async()=>{refresh.disabled=true;list.setAttribute('aria-busy','true');try{await loadRaceHistory();}finally{refresh.disabled=false;list.removeAttribute('aria-busy');}});header.querySelector('.history-controls').prepend(refresh);
    const filter=page.querySelector('.history-filter-panel');filter.open=false;
    // Layout follows the approved design: title, actions, key results, summary, tabs.
    const title=$('raceDetailsTitle'),close=details.querySelector('.close-button');
    const head=document.createElement('div');head.className='rh-detail-head';
    detailHost=document.createElement('div');detailHost.className='rh-detail-title';const subtitle=document.createElement('p');subtitle.id='historyDetailMeta';detailHost.append(title,subtitle);
    const actionBar=document.createElement('div');actionBar.id='historyDetailActions';actionBar.className='rh-actions';
    const remove=document.createElement('button');remove.type='button';remove.className='rh-quiet rh-danger';remove.dataset.rhAction='delete';remove.dataset.rhText='delete';remove.textContent=t('delete');
    close.dataset.rhText='close';close.textContent=t('close');close.removeAttribute('data-i18n');close.classList.add('rh-quiet');
    const end=document.createElement('div');end.className='rh-detail-end';end.append(remove,close);
    head.append(detailHost,actionBar,end);details.prepend(head);
    const notes=document.createElement('p');notes.id='historyDetailNotes';notes.className='rh-notes';notes.hidden=true;head.after(notes);
    // Playback keeps the original timeline, webhook choice and timers; it appears once Play race is used.
    const playback=document.createElement('div');playback.className='rh-playback';playback.hidden=true;playback.append(details.querySelector('.race-timeline'));notes.after(playback);
    const keys=document.createElement('dl');keys.id='historyKeyResults';keys.className='rh-keys';playback.after(keys);
    const findings=document.createElement('ul');findings.id='historyFindings';findings.className='rh-findings';keys.after(findings);
    tabs=document.createElement('div');tabs.className='rh-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',i18n.t('history.title'));
    panel=document.createElement('div');panel.id='historyAnalysisPanel';panel.setAttribute('role','tabpanel');panel.tabIndex=0;findings.after(tabs,panel);
    // The original summary, notes and analysis stay in the DOM for the existing code but are not shown.
    legacy=document.createElement('div');legacy.id='historyLegacyAnalysis';legacy.hidden=true;
    legacy.append(...[$('raceDetailsNotes'),details.querySelector('.stats-boxes'),details.querySelector('.analysis-tabs'),$('detailContent')].filter(Boolean));details.append(legacy);
    const syncPlay=()=>{const play=details.querySelector('[data-rh-action="play"]');if(play){const on=playing();play.textContent=t(on?'stop':'play');play.setAttribute('aria-pressed',String(on));}};
    const stopButton=$('stopPlaybackBtn');if(stopButton)new MutationObserver(syncPlay).observe(stopButton,{attributes:true,attributeFilter:['style']});
    const originalView=viewRaceDetails,originalClose=closeRaceDetails;
    renderRaceHistory=render;
    viewRaceDetails=function(index){stopPlayback();playback.hidden=true;lastTrigger=list.querySelector(`.race-item[data-race-index="${index}"] .rh-tile`);originalView(index);const host=list.querySelector(`.race-item[data-race-index="${index}"]`);if(host){attach(host);selected=A.pilots(currentDetailRace).length>1?'results':'laps';paint();$('raceDetailsTitle').focus({preventScroll:true});setTimeout(()=>{if(currentDetailRace&&currentDetailRace.timestamp===raceHistoryData[index]?.timestamp)details.scrollIntoView({block:'start',behavior:'instant'});},65);}};
    closeRaceDetails=function(){stopPlayback();playback.hidden=true;originalClose();list.querySelectorAll('.rh-tile').forEach(n=>n.setAttribute('aria-expanded','false'));lastTrigger?.focus({preventScroll:true});};
    // Edit and Marshal open the existing editor at its race details or its lap chart.
    const editor=(index,section)=>{openRaceEditor(index);const box=$('marshalDetails');if(box)box.open=section==='details';setTimeout(()=>{if(section==='details')$('raceName')?.focus();else $('marshalChartWrap')?.scrollIntoView({block:'nearest'});},0);};
    page.addEventListener('click',event=>{
      const tab=event.target.closest('[data-rh-tab]'),mode=event.target.closest('[data-rh-lapview]'),action=event.target.closest('[data-rh-action]');
      if(tab){selected=tab.dataset.rhTab;paint();$('rh-tab-'+selected).focus({preventScroll:true});}
      if(mode){lapView=mode.dataset.rhLapview;paint();panel.querySelector(`[data-rh-lapview="${lapView}"]`).focus({preventScroll:true});}
      if(!action)return;
      const kind=action.dataset.rhAction;
      if(kind==='day'){downloadDay(action.dataset.day);return;}
      if(!currentDetailRace)return;
      const index=raceHistoryData.findIndex(r=>r.timestamp===currentDetailRace.timestamp);
      if(kind==='play'){if(playing())stopPlayback();else{playback.hidden=false;playbackRace();}syncPlay();}
      if(kind==='marshal')editor(index,'marshal');
      if(kind==='edit')editor(index,'details');
      if(kind==='download')downloadSingleRace(currentDetailRace.timestamp);
      if(kind==='delete')deleteRace(currentDetailRace.timestamp);
    });
    tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...tabs.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;selected=buttons[next].dataset.rhTab;paint();$('rh-tab-'+selected).focus();});
    new MutationObserver(()=>{theme();}).observe(document.documentElement,{attributes:true,attributeFilter:['style','data-theme']});
    new MutationObserver(()=>{page.querySelectorAll('[data-rh-text]').forEach(node=>node.textContent=t(node.dataset.rhText));render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    // Existing language translation remains responsible for legacy controls.
    theme();if(raceHistoryData.length)render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise);else initialise();
  return {initialise,render,paint,theme,messages};
})();
