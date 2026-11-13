// Mobile pass for Configuration and Race History on an emulated touch phone (pointer: coarse).
// Checks every Configuration category and History view for horizontal overflow, small tap
// targets, tiny text and inputs that make iOS zoom. MOBILE_REPORT=1 lists findings without failing.
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(process.env.FPVGATE_UI_DATA||path.join(__dirname,'../../data')),out=path.resolve(process.env.FPVGATE_UI_EVIDENCE||path.join(__dirname,'../../.dev/mobile-evidence'));fs.mkdirSync(out,{recursive:true});
const report=process.env.MOBILE_REPORT==='1';
const start=new Date('2026-11-12T15:02:00').getTime()/1000;
const races=Array.from({length:14},(_,i)=>({timestamp:start-86400-i*120,name:'Practice '+i,pilotName:i%2?'Bea':'Alex',lapTimes:[1000,10000+i*100,11000,12000,30000],trackId:1,trackName:'North course',notes:'',importedAt:i%3?0:start+3600,syncMode:0}));
races.unshift({timestamp:start,name:'Final heat',trackId:1,trackName:'North course',notes:'Wet track, gusty',lapTimes:[1000,10000,11000,10000,45000],syncMode:3,pilots:[{name:'Alex',callsign:'ACE',color:33023,lapTimes:[1000,10000,11000,10000,45000]},{name:'Bea',callsign:'BEE',color:16739179,lapTimes:[500,11000,12000,10000]},{name:'Charlotte the very long named pilot',color:5635925,lapTimes:[800,10500,10800,10900,11000]}]});
const config={freq:5658,bandIndex:4,channelIndex:0,minLap:100,maxLaps:5,maxHeatTime30s:0,receiverRadio:2,raceSyncMode:3,eventMode:1,anType:2,anRate:10,name:'Test pilot',pilotCallsign:'Test',pilotPhonetic:'Test',pilotColor:33023,theme:'oceanic',selectedVoice:'default',lapFormat:'timeonly',ssid:'Test network',pwd:'',ledBrightness:80,ledPreset:2,ledSpeed:5,batteryType:0,batteryCells:4,batteryVoltageDivider:2,lowBatteryAlarmPerCell:3.5,batteryAlarmEnabled:1,tracksEnabled:1,selectedTrackId:1,speakerEnabled:0,hasI2SAudio:0,novaFilterKalman:1,novaFilterMedian:0,novaFilterMA:0,novaFilterEMA:0,novaFilterStepLimiter:1,novaKalmanQ:200,novaEmaAlpha:15,novaStepMax:20,c5Gain:30,webhooksEnabled:1,c5Pilots:Array.from({length:8},(_,id)=>({id,frequency:5658+id*37,enterRssi:72,exitRssi:68,name:'Pilot '+(id+1),phonetic:'',color:33023,race:1}))};
async function fixture(page,errors){
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};});
 await page.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.hostname!=='fpvgate.test')return route.abort();
  if(req.method()!=='GET')return route.fulfill({json:{status:'OK'}});
  if(u.pathname==='/config')return route.fulfill({json:config});
  if(u.pathname.toLowerCase().includes('version'))return route.fulfill({body:'1.9.0-alpha-6',contentType:'text/plain'});
  if(u.pathname==='/races'){const before=Number(u.searchParams.get('before'))||Infinity,all=races.filter(r=>r.timestamp<before).sort((a,b)=>b.timestamp-a.timestamp),slice=all.slice(0,50);return route.fulfill({json:{races:slice,hasMore:all.length>slice.length,nextBefore:slice.at(-1)?.timestamp,total:races.length}});}
  if(u.pathname==='/tracks')return route.fulfill({json:{tracks:[{trackId:1,name:'North course',distance:120,tags:'practice',notes:''}]}});
  if(u.pathname==='/webhooks')return route.fulfill({json:{webhooks:['192.0.2.10']}});
  if(u.pathname==='/api/event')return route.fulfill({json:{version:3,name:'Test event',nextId:1,pilots:[],groups:[],formats:[],schedule:{blocks:[],pos:0},active:{},races:[],gateRevision:0}});
  if(u.pathname==='/api/c5/race')return route.fulfill({json:{gateManaged:true,running:false,busy:false,timestamp:0,savedTimestamp:0,pilots:[]}});
  if(u.pathname==='/api/system/info')return route.fulfill({json:{version:'1.9.0-alpha-6',board:'FPVGateC5MKAIO',filesystem:{offset:4259840,size:4063232},app:{size:2097152,used:1500000},heapFree:80000}});
  const file=path.join(root,u.pathname==='/'?'index.html':u.pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});
  return route.fulfill({json:{status:'OK',running:false,hostname:'fpvgate',enabled:false,checks:[],c5:{online:true,firmware:3,version:'test'}}});});
}
// Runs in the page: problems inside one visible region.
function audit(selector){
 const region=document.querySelector(selector),problems=[],vw=innerWidth;
 const visible=n=>{if(!n.getClientRects().length)return false;const s=getComputedStyle(n);return s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0;};
 const label=n=>(n.id?'#'+n.id:'')+(n.dataset?.rhAction?'['+n.dataset.rhAction+']':'')+' '+n.tagName.toLowerCase()+' "'+(n.textContent||n.value||n.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,40)+'"';
 // Scroll containers are allowed to hold wide content (tables, charts).
 const scrolls=n=>{for(let p=n.parentElement;p&&p!==region.parentElement;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll)/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1&&p!==region)return true;}return false;};
 if(document.documentElement.scrollWidth>vw+1)problems.push('page scrolls sideways: '+document.documentElement.scrollWidth+'>'+vw);
 for(const n of region.querySelectorAll('*')){
  if(!visible(n))continue;const r=n.getBoundingClientRect();
  if(r.width>0&&(r.right>vw+1||r.left<-1)&&!scrolls(n))problems.push('off-screen '+Math.round(r.left)+'..'+Math.round(r.right)+': '+label(n));
 }
 for(const n of region.querySelectorAll('button,a[href],input,select,textarea,summary,[role=tab]')){
  if(!visible(n)||n.closest('[inert]'))continue;const r=n.getBoundingClientRect(),type=(n.type||'').toLowerCase();
  if(scrolls(n)&&(r.right<0||r.left>vw))continue;
  const inline=n.classList.contains('rh-link');
  // A checkbox/radio is fine when its row or label is the tap area.
  const host=['checkbox','radio'].includes(type)?(n.closest('label,.cfg-row,.config-item')||n):n,h=host.getBoundingClientRect().height;
  if(type!=='hidden'&&type!=='range'&&!inline&&h<40)problems.push('tap target '+Math.round(h)+'px: '+label(n));
  if(['input','select','textarea'].includes(n.tagName.toLowerCase())&&!['checkbox','radio','range','color','file','button','submit'].includes(type)&&parseFloat(getComputedStyle(n).fontSize)<16)problems.push('iOS zooms on focus (font '+getComputedStyle(n).fontSize+'): '+label(n));
 }
 const walker=document.createTreeWalker(region,NodeFilter.SHOW_TEXT);let small=new Set();
 while(walker.nextNode()){const t=walker.currentNode;if(!t.textContent.trim())continue;const el=t.parentElement;if(!visible(el)||el.closest('svg'))continue;const size=parseFloat(getComputedStyle(el).fontSize);if(size<11)small.add(size+'px: '+label(el));}
 problems.push(...[...small].map(s=>'small text '+s));
 return [...new Set(problems)];
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const findings={};let cases=0;
 try{
  // Element screenshots drop touch emulation in headless Chromium, so audits and screenshots use separate passes.
  for(const [width,shots] of [[320,false],[360,false],[390,false],[430,false],[390,true],[320,true]]){
   const context=await browser.newContext({viewport:{width,height:780},isMobile:true,hasTouch:true,deviceScaleFactor:2});const page=await context.newPage(),errors=[];await fixture(page,errors);
   await page.goto('http://fpvgate.test/',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof configLoaded!=='undefined'&&configLoaded&&document.querySelector('#settingsModal[data-redesigned]')&&document.querySelector('#history[data-redesigned]'),null,{timeout:20000});
   assert(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),'Touch emulation');
   const record=async(name,selector)=>{if(shots)return;assert(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),'Touch emulation lost before '+name);cases++;const list=await page.evaluate(audit,selector);if(name.startsWith('config/')){const save=await page.locator('#settingsModal .settings-footer .cfg-primary').boundingBox();if(!save||save.y+save.height>781)list.push('Save Configuration not on screen');}if(list.length)findings[width+' '+name]=list;};
   // Configuration: every category, through the phone category menu.
   await page.locator('#nav-link-config').tap();await page.waitForSelector('#settingsModal.active');
   assert(await page.locator('#configurationCategory').isVisible(),'Phone category menu');
   const categories=await page.locator('#configurationCategory option').evaluateAll(ns=>ns.map(n=>n.value));
   assert.deepEqual(await page.locator('#configurationCategory optgroup').evaluateAll(ns=>ns.map(n=>n.label)),['Race setup','Device','Interface','Maintenance'],'Phone menu groups categories');
   for(const id of categories){
    await page.selectOption('#configurationCategory',id);
    await record('config/'+id,'#settingsModal .settings-modal-container');
    if(shots&&width===390&&['general','ui','system','maintenance'].includes(id))await page.screenshot({path:path.join(out,`config-${id}-${width}.png`)});
   }
   await page.locator('#settingsModal .cfg-titlebar button').tap();await page.waitForFunction(()=>!document.getElementById('settingsModal').classList.contains('active'));
   // History: list, then every detail tab of a multi-pilot race.
   await page.locator('#nav-link-history').tap();await page.waitForFunction(n=>raceHistoryData.length===n,races.length);
   await record('history/list','#history');
   if(shots&&width===390)await page.screenshot({path:path.join(out,`history-list-${width}.png`)});
   await page.locator(`[data-rh-race="${start}"]`).tap();await page.waitForSelector('#raceDetails .rh-tabs');
   // Opening a race scrolls its detail into view.
   await page.waitForTimeout(200);const top=await page.locator('#raceDetails').boundingBox();if(!shots&&(top.y<-4||top.y>200))findings[width+' history/scroll']=['detail opened off-screen at y='+Math.round(top.y)];
   for(const tab of ['results','laps','flow','consistency']){
    await page.locator(`[data-rh-tab="${tab}"]`).tap();
    await record('history/'+tab,'#history');
    if(tab==='results'&&!shots){const best=await page.locator('#historyAnalysisPanel thead th').filter({hasText:/^Best$/}).boundingBox();if(!best||best.x+best.width>width+1)findings[width+' history/results-columns']=['Best column not on screen without scrolling'];}
    if(shots)await page.locator('#raceDetails').screenshot({path:path.join(out,`history-${tab}-${width}.png`)});
   }
   // Opening the detail scrolls it into view.
   await page.locator('#historyDetailActions [data-rh-action="play"]').tap();await record('history/playback','#history');
   if(shots&&width===390)await page.locator('#raceDetails').screenshot({path:path.join(out,`history-playback-${width}.png`)});
   await page.locator('#historyDetailActions [data-rh-action="play"]').tap();
   await page.locator('#historyDetailActions [data-rh-action="edit"]').tap();await page.waitForFunction(()=>document.getElementById('marshalModal').style.display==='flex');
   await record('history/editor','#marshalModal');
   if(shots&&width===390)await page.screenshot({path:path.join(out,`editor-${width}.png`)});
   await page.evaluate(()=>closeMarshalModal());
   if(errors.length)findings[width+' errors']=errors;
   await context.close();
  }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(out,'mobile-result.json'),JSON.stringify({cases,widths:[320,360,390,430],findings},null,2));
 const count=Object.values(findings).flat().length;
 if(report){for(const [k,v] of Object.entries(findings))console.log('== '+k+'\n  '+v.join('\n  '));console.log(cases+' views, '+count+' findings');return;}
 assert.equal(count,0,'Mobile findings:\n'+JSON.stringify(findings,null,1));
 console.log(cases+' mobile views at 320/360/390/430px passed: no overflow, tap targets ≥40px, text ≥11px, no iOS zoom fields.');
})().catch(e=>{console.error(e);process.exitCode=1;});
