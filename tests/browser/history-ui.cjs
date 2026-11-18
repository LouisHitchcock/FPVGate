const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(process.env.FPVGATE_UI_DATA||path.join(__dirname,'../../data')),out=path.resolve(process.env.FPVGATE_UI_EVIDENCE||path.join(__dirname,'../../.dev/history-evidence'));fs.mkdirSync(out,{recursive:true});
const start=new Date('2026-11-12T15:02:00').getTime()/1000;
const races=Array.from({length:60},(_,i)=>({timestamp:start-86400-Math.floor(i/12)*86400-(i%12)*120,name:'Practice '+i,pilotName:i%2?'Bea':'Alex',lapTimes:[1000,10000+i*100,11000,12000],fastestLap:10000,medianLap:11000,best3LapsTotal:33000,trackId:1,trackName:'North course',notes:i%2?'Wet track':'Dry track',importedAt:i%3?0:start+3600,syncMode:0}));
const target={timestamp:start,name:'Final heat',trackId:1,trackName:'North course',notes:'A real note',lapTimes:[1000,10000,11000,10000,45000],fastestLap:10000,medianLap:10500,best3LapsTotal:31000,syncMode:3,pilots:[{name:'Alex',callsign:'ACE',color:33023,lapTimes:[1000,10000,11000,10000,45000]},{name:'Bea',callsign:'BEE',color:16739179,lapTimes:[500,11000,12000,10000]}]};
races.unshift(target);races.unshift({...target,timestamp:start-60,name:'Eight pilot race',pilots:Array.from({length:8},(_,i)=>({name:'Pilot '+(i+1)+' with a very long name & callsign',color:33023+i*1500000,lapTimes:[1000+i*10,10000+i*500,11000+i*500,12000+i*500]}))});
const config={freq:5658,bandIndex:4,channelIndex:0,minLap:100,maxLaps:5,maxHeatTime30s:0,receiverRadio:2,raceSyncMode:3,eventMode:0,anType:2,anRate:10,name:'Test pilot',pilotCallsign:'Test',pilotPhonetic:'Test',pilotColor:33023,theme:'oceanic',selectedVoice:'default',lapFormat:'timeonly',ssid:'Test network',pwd:'',ledBrightness:80,ledPreset:2,ledSpeed:5,batteryType:0,batteryCells:4,batteryVoltageDivider:2,lowBatteryAlarmPerCell:3.5,batteryAlarmEnabled:1,tracksEnabled:1,selectedTrackId:1,speakerEnabled:0,hasI2SAudio:0,novaFilterKalman:1,novaFilterMedian:0,novaFilterMA:0,novaFilterEMA:0,novaFilterStepLimiter:1,novaKalmanQ:200,novaEmaAlpha:15,novaStepMax:20,c5Gain:30,c5Pilots:Array.from({length:8},(_,id)=>({id,frequency:5658+id*37,enterRssi:72,exitRssi:68,name:'Pilot '+(id+1),phonetic:'',color:33023,race:1}))};
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());await page.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};document.addEventListener('DOMContentLoaded',()=>{window.__originalConfigControls=[...document.querySelectorAll('#settingsModal input,#settingsModal select,#settingsModal textarea,#settingsModal button')];});});await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.hostname!=='fpvgate.test')return route.abort();if(req.method()==='POST'){let body;try{body=req.postDataJSON();}catch{body=req.postData();}writes.push({path:u.pathname,body});if(u.pathname==='/config'&&body&&typeof body==='object')Object.assign(config,body);return route.fulfill({json:{status:'OK'}});}if(u.pathname==='/config')return route.fulfill({json:config});if(u.pathname.toLowerCase().includes('version'))return route.fulfill({body:'1.9.0-alpha-6',contentType:'text/plain'});if(u.pathname==='/races'){const before=Number(u.searchParams.get('before'))||Infinity,all=races.filter(r=>r.timestamp<before).sort((a,b)=>b.timestamp-a.timestamp),slice=all.slice(0,50);return route.fulfill({json:{races:slice,hasMore:all.length>slice.length,nextBefore:slice.at(-1)?.timestamp,total:races.length}});}if(u.pathname==='/tracks')return route.fulfill({json:{tracks:[{trackId:1,name:'Test track',distance:120,tags:'practice',notes:''}]}});if(u.pathname==='/webhooks')return route.fulfill({json:{webhooks:['192.0.2.10']}});if(u.pathname==='/api/event')return route.fulfill({json:{version:3,name:'Test event',nextId:1,pilots:[],groups:[],formats:[],schedule:{blocks:[],pos:0},active:{},races:[],gateRevision:0}});if(u.pathname==='/api/c5/race')return route.fulfill({json:{gateManaged:true,running:false,busy:false,timestamp:0,savedTimestamp:0,pilots:[]}});if(u.pathname==='/api/system/info')return route.fulfill({json:{version:'1.9.0-alpha-6',board:'FPVGateC5MKAIO',filesystem:{offset:4259840,size:4063232},app:{size:2097152,used:1500000},heapFree:80000}});let file=path.join(root,u.pathname==='/'?'index.html':u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});return route.fulfill({json:{status:'OK',running:false,hostname:'fpvgate',enabled:false,checks:[],c5:{online:true,firmware:3,version:'test'}}});});

await page.goto('http://fpvgate.test/',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>typeof configLoaded!=='undefined'&&configLoaded&&document.querySelector('#history[data-redesigned]'));
await page.click('#nav-link-history');await page.waitForFunction(()=>raceHistoryData.length===62);
assert.equal(await page.locator('#history .rh-tile').count(),62,'All paginated records must appear');
const targetTile=await page.locator(`[data-rh-race="${target.timestamp}"]`).innerText(),singleTile=await page.locator(`[data-rh-race="${races[2].timestamp}"]`).innerText();
assert(targetTile.includes('1 lap to review')&&singleTile.includes('1 pilot ·'),'Singular counts: '+targetTile+' / '+singleTile);
const clearColours=await page.locator('#history .history-controls .danger-button').evaluate(n=>{const c=getComputedStyle(n);return [c.color,c.backgroundColor];});assert.notEqual(clearColours[0],clearColours[1]);assert.equal(clearColours[0],'rgb(255, 255, 255)','Clear All text must stay readable on its red button');
const sortBox=await page.locator('#historyQuickSort').boundingBox(),titleBox=await page.locator('#history .rh-page-head h2').boundingBox();
assert(sortBox.width<400&&Math.abs((sortBox.y+sortBox.height/2)-(titleBox.y+titleBox.height/2))<20,'Title sort should sit beside the title on desktop: '+JSON.stringify({sortBox,titleBox}));
const original=await page.evaluate(()=>JSON.stringify(raceHistoryData));
await page.locator(`[data-rh-race="${target.timestamp}"]`).click();
assert.equal(await page.locator('#historyKeyResults dd').first().textContent(),'Alex');
assert.equal(await page.locator('#historyKeyResults dd').nth(1).textContent(),'10.00s');
assert.equal(await page.locator('#historyKeyResults dd').nth(2).textContent(),'31.00s');
assert(await page.locator('#historyFindings').textContent().then(s=>s.includes('45.00s')),'Long lap review missing');
assert.equal(await page.locator('#historyAnalysisPanel tbody tr').count(),2);
await page.locator('[data-rh-tab="laps"]').click();assert.equal(await page.locator('#historyAnalysisPanel tbody tr').count(),6);
assert((await page.locator('#historyAnalysisPanel tbody tr').first().textContent()).includes('1.00s'),'Gate 1 missing');
await page.locator('[data-rh-lapview="delta"]').click();assert((await page.locator('#historyAnalysisPanel').textContent()).includes('+1.00s'));
await page.locator('[data-rh-tab="flow"]').click();assert.equal(await page.locator('#historyAnalysisPanel svg[role="img"]').count(),1);assert(!(await page.locator('#historyAnalysisPanel').innerHTML()).includes('NaN'));
await page.locator('#historyAnalysisPanel details').evaluate(n=>n.open=true);assert.equal(await page.locator('#historyAnalysisPanel tbody tr').count(),5);
await page.locator('[data-rh-tab="consistency"]').click();assert.equal(await page.locator('#historyAnalysisPanel svg').count(),1);
// Detail follows the approved mock-up: four tabs, the original analysis stays populated but hidden.
assert.deepEqual(await page.locator('#history .rh-tabs [data-rh-tab]').evaluateAll(ns=>ns.map(n=>n.dataset.rhTab)),['results','laps','flow','consistency']);
assert(!(await page.locator('#historyLegacyAnalysis').isVisible()),'Original analysis should not be shown');assert(await page.locator('#detailContent').textContent().then(s=>s.includes('Alex')),'Original analysis still populated');
assert.equal(await page.locator('#historyKeyResults dt').first().textContent(),'Winner');
assert.equal(await page.locator('#raceDetailsTitle').textContent(),'Final heat · Session 1');
assert((await page.locator('#historyDetailNotes').textContent()).includes('A real note'),'Race notes shown');
const summary=await page.locator('#historyFindings').innerText();assert(summary.includes('Alex won by')&&summary.includes('reached Gate 1 first'),'Summary lines: '+summary);
assert(await page.locator('#historyFindings [data-rh-action="marshal"]').count()===1,'Review line links to Marshal');
assert.deepEqual(await page.locator('#historyDetailActions [data-rh-action]').evaluateAll(ns=>ns.map(n=>n.textContent)),['Play race','Marshal','Edit','Download']);
assert.deepEqual(await page.locator('#raceDetails .rh-detail-end button').evaluateAll(ns=>ns.map(n=>n.textContent)),['Delete','Close']);
await page.locator('[data-rh-tab="results"]').click();
assert.deepEqual(await page.locator('#historyAnalysisPanel thead th').evaluateAll(ns=>ns.map(n=>n.textContent)),['#','Pilot','Laps','Time','Gap','Best','Average','Spread','vs previous best']);
assert((await page.locator('#historyAnalysisPanel').innerText()).includes('Gate 1 time is included in Time'));
const headTop=async sel=>(await page.locator(sel).boundingBox()).y;
assert(Math.abs(await headTop('#historyDetailActions [data-rh-action="play"]')-await headTop('#raceDetails .close-button'))<6,'Desktop actions share the title row');
// Play race reveals the original timeline and toggles to Stop.
await page.locator('#historyDetailActions [data-rh-action="play"]').click();assert(await page.locator('#raceDetails .rh-playback').isVisible());
assert.equal(await page.locator('#historyDetailActions [data-rh-action="play"]').textContent(),'Stop');
await page.locator('#historyDetailActions [data-rh-action="play"]').click();assert.equal(await page.locator('#historyDetailActions [data-rh-action="play"]').textContent(),'Play race');
// Edit opens the editor on race details; Marshal opens it on the lap chart.
await page.locator('#historyDetailActions [data-rh-action="edit"]').click();await page.waitForFunction(()=>document.getElementById('marshalModal').style.display==='flex');
assert(await page.evaluate(()=>document.getElementById('marshalDetails').open),'Edit opens race details');await page.waitForFunction(()=>document.activeElement&&document.activeElement.id==='raceName');await page.evaluate(()=>closeMarshalModal());
await page.locator('#historyDetailActions [data-rh-action="marshal"]').click();await page.waitForFunction(()=>document.getElementById('marshalModal').style.display==='flex');
assert(!(await page.evaluate(()=>document.getElementById('marshalDetails').open)),'Marshal opens the lap chart');await page.evaluate(()=>closeMarshalModal());
// Delete asks first; dismissing keeps the race.
await page.locator('#raceDetails .rh-detail-end [data-rh-action="delete"]').click();assert.equal(await page.evaluate(()=>raceHistoryData.length),62,'Cancelled delete kept the race');
await page.setViewportSize({width:390,height:844});
assert(Math.abs(await headTop('#raceDetailsTitle')-await headTop('#raceDetails .close-button'))<8&&(await page.locator('#raceDetails .close-button').boundingBox()).x>(await page.locator('#raceDetailsTitle').boundingBox()).x+100,'Phone: close beside title');
assert(await headTop('#historyDetailActions [data-rh-action="play"]')>await headTop('#historyDetailMeta'),'Phone: actions below title');
assert.equal(await page.locator('#historyAnalysisPanel thead th.rh-hide-phone').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).length),0,'Phone hides average and spread');
await page.setViewportSize({width:1440,height:1000});
const order=()=>page.locator('#history .rh-race').evaluateAll(ns=>ns.map(n=>Number(n.dataset.raceIndex)));
const expectedOrder=()=>page.evaluate(()=>filterHistoryRows(raceHistoryData,readHistoryFilters()).map(row=>row.index));
const headText=await page.locator('#history .rh-page-head').innerText();assert(headText.includes('Race History')&&!/\bnull\b/.test(headText),'History title missing from header: '+headText);
// Default: only the title sort is shown; the filter panel is opt-in from Configuration.
assert(await page.locator('#historyQuickSort').isVisible(),'Title sort hidden');assert(!(await page.locator('#historyFilterPanel').isVisible()),'Filter panel shown by default');
await page.selectOption('#historyQuickSort','laps-desc');assert.deepEqual(await order(),await expectedOrder());assert.equal(await page.inputValue('#historySort'),'laps-desc','Sort menus out of step');assert(await page.locator('#raceDetails').isVisible(),'Open detail lost during sorting');
await page.selectOption('#historyQuickSort','pilots-desc');let actual=await order();assert.deepEqual(actual,await expectedOrder());assert.equal(await page.evaluate(i=>raceHistoryData[i].pilots.length,actual[0]),8,'Number of pilots sort');
await page.selectOption('#historyQuickSort','race-desc');
const switchAdvanced=async on=>{await page.click('#nav-link-config');await page.locator('#settingsModal [data-settings-section="ui"]').first().click();const toggle=page.locator('#settingsModal label.switch:has(#historyAdvancedFilters)');assert(await toggle.isVisible(),'Advanced Filters switch not visible in Configuration');assert.equal(await page.locator('#historyAdvancedFilters').evaluate(n=>n.closest('.cfg-group').querySelector('h3').textContent),'Race History','Advanced Filters switch misplaced');if(await page.isChecked('#historyAdvancedFilters')!==on)await toggle.click();await page.keyboard.press('Escape');await page.waitForFunction(()=>getComputedStyle(document.getElementById('settingsModal')).display==='none');};
await switchAdvanced(true);
const filter=page.locator('#historyFilterPanel');assert(await filter.isVisible(),'Advanced filters did not appear');assert(!(await page.locator('#historyQuickSort').isVisible()),'Title sort still shown with panel');await filter.evaluate(n=>n.open=true);
await page.selectOption('#historySort','laps-desc');assert.deepEqual(await order(),await expectedOrder());assert.equal(await page.inputValue('#historyQuickSort'),'laps-desc');assert(await page.locator('#raceDetails').isVisible(),'Open detail lost during sorting');
await page.fill('#historyPilot','BEE');assert.equal(await page.locator('#history .rh-tile').count(),1);assert(await page.locator('#raceDetails').isVisible());
await page.fill('#historySearch','does not exist');assert.equal(await page.locator('#history .rh-tile').count(),0);assert(!(await page.locator('#raceDetails').isVisible()));
await page.fill('#historySearch','');await page.fill('#historyPilot','BEE');
await switchAdvanced(false);assert(!(await filter.isVisible()));assert.equal(await page.locator('#history .rh-tile').count(),62,'Hidden filter still hiding races');
await page.evaluate(()=>clearHistoryFilters());
await page.locator(`[data-rh-race="${target.timestamp-60}"]`).click();
let cases=0;
for(const width of [320,390,580,768,1280,1440]){
 await page.setViewportSize({width,height:900});
 for(const tab of ['results','laps','flow','consistency']){
  await page.locator(`[data-rh-tab="${tab}"]`).click();
  const dimensions=await page.locator('#history').evaluate(n=>({scroll:n.scrollWidth,width:n.clientWidth,body:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert(dimensions.scroll<=dimensions.width+1,'History overflow '+width+'/'+tab+' '+JSON.stringify(dimensions));assert(dimensions.body<=dimensions.viewport+1,'Page overflow '+width+'/'+tab+' '+JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getClientRects().length&&n.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(n=>({id:n.id,cls:n.className,w:n.getBoundingClientRect().width})))));cases++;
 }
}
await page.setViewportSize({width:1440,height:1000});await page.locator('[data-rh-tab="results"]').click();await page.screenshot({path:path.join(out,'history-desktop.png')});
await page.locator('[data-rh-tab="laps"]').click();await page.screenshot({path:path.join(out,'history-laps-desktop.png')});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'history-laps-phone.png')});
await page.locator('#raceDetails .close-button').click();assert.equal(await page.evaluate(()=>document.activeElement.dataset.rhRace),String(target.timestamp-60));
await page.keyboard.press('Enter');assert(await page.locator('#raceDetails').isVisible(),'Native keyboard race opening failed');
await page.locator('[data-rh-tab="results"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.dataset.rhTab),'laps');
const exportPromise=page.waitForEvent('download');await page.locator('[data-rh-action="day"]').first().click();const exported=await exportPromise;const file=await exported.path();const exportedData=JSON.parse(fs.readFileSync(file));assert.equal(exportedData.races.length,2,'Download day did not include every race');
await page.locator('#historyDetailActions [data-rh-action="edit"]').click();await page.waitForFunction(()=>document.getElementById('marshalModal').style.display==='flex');await page.evaluate(()=>closeMarshalModal());
assert.equal(await page.evaluate(()=>JSON.stringify(raceHistoryData)),original,'Review changed stored race data');
const themes=await page.locator('#themeSelect option').evaluateAll(ns=>ns.map(n=>n.value));
for(const theme of themes){await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);await page.waitForTimeout(20);const bad=await page.locator('#history').evaluate(page=>{const css=getComputedStyle(page),rgb=c=>{const ctx=document.createElement('canvas').getContext('2d');ctx.fillStyle=c;return ctx.fillStyle.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)},lum=c=>{const v=rgb(c);return v[0]*.2126+v[1]*.7152+v[2]*.0722};return [['strong','background'],['muted','background'],['accent','background'],['warning','background'],['danger','background'],['strong','surface']].filter(([a,b])=>{const x=lum(css.getPropertyValue('--rh-'+a).trim()),y=lum(css.getPropertyValue('--rh-'+b).trim());return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)<4.49;});});assert.deepEqual(bad,[],'Theme contrast '+theme+' '+JSON.stringify(bad));}
await page.evaluate(()=>document.documentElement.setAttribute('data-theme','oceanic'));
for(const language of ['fr','de','es','zh-CN','en']){await page.evaluate(language=>i18n.setLanguage(language),language);await page.waitForTimeout(30);const label=await page.locator('#raceDetails .close-button').textContent();const expected=await page.evaluate(()=>i18n.t('history.redesign.close'));assert.equal(label,expected,'History language change '+language);}
await page.evaluate(()=>closeRaceDetails());await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'history-overview-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'history-overview-phone.png')});
assert.deepEqual(errors,[]);
fs.writeFileSync(path.join(out,'history-browser-result.json'),JSON.stringify({layoutCases:cases,themesChecked:themes.length,languagesChecked:5,paginationRecords:62,allRecordsVisible:true,gate1AndMetrics:true,allPilotsPreserved:true,sortAndFilter:true,titleSortDefault:true,pilotCountSort:true,advancedFiltersSwitch:true,hiddenFiltersIgnored:true,keyboardNavigation:true,dayExport:true,editorOpens:true,originalRaceDataUnchanged:true,errors},null,2));
console.log(`${cases} layout/tab cases; 62 paginated races; metrics, filters, keyboard, day export and editor passed.`);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
