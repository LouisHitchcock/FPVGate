/* Configuration presentation layer. Move the original controls; keep their IDs,
 * listeners, values and device handlers. No configuration is written on setup. */
const SettingsUI = (() => {
  const $ = id => document.getElementById(id);
  const sections = [
    ['general','race','Race & timing','Race setup'], ['pilot','pilot','Pilot & channel','Race setup'],
    ['audio','audio','Audio & announcer','Race setup'], ['tracks','tracks','Tracks','Race setup'],
    ['system','hardware','Receiver & battery','Device'], ['wifi','connections','Connections','Device'],
    ['elrs','elrs','Radio control (ELRS)','Device'], ['led','lighting','LEDs & gate control','Device'],
    ['ui','ui','User Interface','Interface'], ['osd','overlays','Streaming & overlays','Interface'],
    ['maintenance','maintenance','Firmware & backup','Maintenance'], ['diagnostics','diagnostics','Diagnostics','Maintenance']
  ];
  const aliases = { webhooks:'led', race:'general', hardware:'system', connections:'wifi', lighting:'led', display:'osd' };
  let modal, content, categorySelect, status, previousFocus, active = 'general', timer;
  const proxies = [];
  let saveSequence=0;
  const tr = (key, fallback) => {
    if (typeof i18n === 'undefined') return fallback;
    const value = i18n.t('settings.redesign.' + key);
    return value === 'settings.redesign.' + key ? fallback : value;
  };
  function text(node, key, fallback) {
    node.dataset.i18n = 'settings.redesign.' + key;
    node.textContent = tr(key, fallback);
    return node;
  }
  function element(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }
  function group(title, key) {
    const node = element('section', 'cfg-group');
    const heading = text(element('h3'), key, title);
    heading.id = 'cfg-group-' + key;
    node.setAttribute('aria-labelledby', heading.id);
    node.append(heading);
    return node;
  }
  function block(source, key) {
    const heading = [...source.children].find(n => n.tagName === 'H3' && n.dataset.i18n === key);
    const nodes = [];
    if (!heading) return nodes;
    let next = heading.nextElementSibling;
    while (next && next.tagName !== 'H3') { const node = next; next = next.nextElementSibling; nodes.push(node); }
    heading.remove();
    return nodes;
  }
  function row(id) {
    const control = $(id);
    if (!control) throw new Error('Missing Configuration control: ' + id);
    const node = control.closest('.config-item') || control.closest('.switch').parentElement;
    const fragment = document.createDocumentFragment();
    const next = node.nextElementSibling;
    fragment.append(node);
    if (next && !next.querySelector('input, select, button') && next.tagName !== 'H3' &&
        /margin-left:\s*170px/.test(next.getAttribute('style') || '')) fragment.append(next);
    return fragment;
  }
  function contents(source) {
    [...source.children].filter(n => n.tagName === 'H2').forEach(n => n.remove());
    return [...source.children];
  }
  function add(page, title, key, nodes) {
    const box = group(title, key);
    box.append(...nodes);
    page.append(box);
    return box;
  }
  function enhanceRows(root) {
    root.querySelectorAll('.config-item').forEach(node => node.classList.add('cfg-row'));
    root.querySelectorAll('input[type="checkbox"]').forEach(input => {
      const native = ['otaPreReleaseToggle','elrsForget','serialAutoScroll','raceAnalyticsToggleConsistency','raceAnalyticsToggleLapTimes'].includes(input.id);
      input.classList.toggle('cfg-checkbox', native);
      if (!native) input.setAttribute('role','switch');
      if (!input.id && input.dataset.evPref) input.id = 'cfg-event-' + input.dataset.evPref;
      if ([...(input.labels || [])].some(n=>n.textContent.trim()) || input.getAttribute('aria-label') || input.getAttribute('aria-labelledby')) return;
      const switchLabel = input.closest('.switch');
      const host = switchLabel?.parentElement;
      const copy = host && [...host.children].find(n => n !== switchLabel && !n.contains(input));
      if (copy) {
        if (!copy.id) copy.id = 'cfg-label-' + input.id;
        input.setAttribute('aria-labelledby', copy.id);
      }
    });
    root.querySelectorAll('input,select,textarea').forEach(input => {
      if (!input.id || [...(input.labels || [])].some(n=>n.textContent.trim()) || input.getAttribute('aria-label') || input.getAttribute('aria-labelledby')) return;
      const host = input.closest('.config-item');
      const label = host?.querySelector('label:not(.switch)');
      if (label) label.htmlFor = input.id;
    });
    root.querySelectorAll('.config-item').forEach(node => {
      const help = node.nextElementSibling;
      const input = node.querySelector('input,select');
      if (input && help && /margin-left:\s*170px/.test(help.getAttribute('style') || '')) {
        help.classList.add('cfg-help');
        if (!help.id) help.id = 'cfg-help-' + input.id;
        input.setAttribute('aria-describedby', [...new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).concat(help.id))].join(' '));
      }
    });
  }
  function numeric(id) {
    const input = $(id);
    if (!input) return;
    input.type = 'number'; input.inputMode = 'decimal'; input.classList.add('cfg-number');
    const units={maxLaps:'',minLap:'s',novaStepMax:'',batteryVoltageDivider:':1',lowBatteryAlarmPerCell:'V / cell'};
    if(units[id]){const unit=element('small','cfg-unit');unit.textContent=units[id];input.after(unit);}
    input.addEventListener('input', event => {
      if (input.validity.valid) return;
      if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
      event.stopImmediatePropagation();
    }, true);
  }
  function proxy(id, scale, unit) {
    const original = $(id);
    if (!original) return;
    const input = document.createElement('input');
    input.type = 'number'; input.inputMode = 'decimal'; input.id = id + 'Display';
    input.min = Number(original.min) * scale; input.max = Number(original.max) * scale;
    input.step = Number(original.step || 1) * scale; input.className = 'cfg-number';
    const label = modal.querySelector(`label[for="${id}"]`) || original.closest('.config-item')?.querySelector('label');
    if (label) label.htmlFor = input.id;
    if (original.getAttribute('aria-describedby')) input.setAttribute('aria-describedby', original.getAttribute('aria-describedby'));
    original.hidden = true;
    original.after(input);
    const suffix = element('small','cfg-unit'); suffix.textContent = unit; input.after(suffix);
    const state={original,input,scale,edit:0,pending:false};
    input.addEventListener('input', () => {
      state.edit++;state.pending=true;
      if (!input.checkValidity()) { if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout); return; }
      original.value = String(Number(input.value) / scale);
      original.dispatchEvent(new Event('input',{bubbles:true}));
    });
    proxies.push(state);
  }
  function sync() {
    proxies.forEach(({original,input,scale,pending}) => {
      if (!pending && document.activeElement !== input) input.value = String(Number((Number(original.value) * scale).toFixed(3)));
    });
    const voice = $('settingsVoiceEnabled');
    if (voice && document.activeElement !== voice && typeof audioEnabled !== 'undefined') voice.checked = audioEnabled;
  }
  function setupVoice() {
    const enable = $('EnableAudioButton'), disable = $('DisableAudioButton');
    if (!enable || !disable) return;
    enable.hidden = true; disable.hidden = true;
    const label = element('label','cfg-voice-toggle');
    label.htmlFor = 'settingsVoiceEnabled';
    label.append(text(element('span'),'voicePlayback','Voice playback'));
    const input = document.createElement('input'); input.type='checkbox'; input.id='settingsVoiceEnabled'; input.setAttribute('role','switch');
    input.addEventListener('change',()=>input.checked ? enableAudioLoop() : disableAudioLoop());
    label.append(input); enable.before(label);
  }
  function color(value) {
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.fillStyle = value; const normalized = canvas.fillStyle;
    if (normalized[0] === '#') return normalized.slice(1).match(/../g).map(c=>parseInt(c,16));
    return (normalized.match(/[\d.]+/g)||[0,0,0]).slice(0,3).map(Number);
  }
  function luminance(rgb) {
    const c=rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return c[0]*.2126+c[1]*.7152+c[2]*.0722;
  }
  function ratio(a,b) { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
  function accessible(foreground, background, minimum=4.5) {
    const fg=color(foreground),bg=color(background),target=ratio([0,0,0],bg)>ratio([255,255,255],bg)?[0,0,0]:[255,255,255];
    for(let i=0;i<=100;i++){const rgb=fg.map((v,k)=>Math.round(v+(target[k]-v)*i/100));if(ratio(rgb,bg)>=minimum)return `rgb(${rgb.join(',')})`;}
    return `rgb(${target.join(',')})`;
  }
  function theme() {
    const css=getComputedStyle(document.documentElement), get=(name,fallback)=>css.getPropertyValue(name).trim()||fallback;
    const panel=get('--background-color','#263238'),side=get('--bg-secondary','#37474f'),accent=get('--primary-color','#009688');
    const dark=luminance(color(panel))<.35;
    const strong=dark?'#f1f5f7':'#172329',muted=accessible(get('--secondary-color','#a3b5bf'),panel);
    const action=get('--primary-color-dark',accent),ink=ratio(color(action),[255,255,255])>=4.5?'#fff':'#172329';
    const values={'panel':panel,'side':side,'field':dark?'#17252c':'#f0f3f5','strong':strong,'body':accessible(get('--text-color',strong),panel),'muted':muted,'side-ink':accessible(get('--text-color',strong),side),'side-muted':accessible(get('--secondary-color',muted),side),'accent':accessible(accent,panel),'accent-fill':accent,'action':action,'action-ink':accessible(ink,action),'line':accessible(get('--border-color','#718995'),panel,3),'divider':dark?'#435861':'#cbd5da','button':dark?'#40545e':'#dbe4e9'};
    Object.entries(values).forEach(([key,value])=>modal.style.setProperty('--cfg-'+key,value));
  }
  function notice(message,error=false) {
    status.textContent=message;status.classList.toggle('cfg-error',error);
  }
  function valid() {
    const invalid=[...modal.querySelectorAll('input,select')].find(n=>!n.hidden&&!n.disabled&&n.type!=='file'&&!n.checkValidity());
    if (!invalid) return true;
    const page=invalid.closest('.settings-section'); if(page) switchSettingsSection(null,page.id.replace('settings-',''));
    for(let node=invalid.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
    invalid.reportValidity(); return false;
  }
  function hasOtherDialog() {
    return [...document.querySelectorAll('.modal,[role="dialog"]')].some(n=>n!==modal&&!modal.contains(n)&&!n.contains(modal)&&n.getClientRects().length);
  }
  function focusables() {
    return [...modal.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex="0"]')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length);
  }
  function initialise() {
    modal=$('settingsModal');if(!modal||modal.dataset.redesigned)return;
    const originalControls=[...modal.querySelectorAll('input,select,textarea,button')];
    const source=Object.fromEntries([...modal.querySelectorAll('.settings-section')].map(n=>[n.id.replace('settings-',''),n]));
    const container=modal.querySelector('.settings-modal-container'),sidebar=modal.querySelector('.settings-sidebar');
    const titlebar=modal.querySelector('.settings-sidebar-header');titlebar.className='cfg-titlebar';
    const title=titlebar.querySelector('h2');title.id='configurationTitle';text(title,'title','Configuration');
    const close=titlebar.querySelector('button');close.setAttribute('aria-label',tr('close','Close Configuration'));close.dataset.i18nAriaLabel='settings.redesign.close';
    const footer=modal.querySelector('.settings-footer');
    const save=footer.querySelector('button[onclick="saveConfig()"]');save.classList.add('cfg-primary');save.removeAttribute('onclick');
    save.addEventListener('click',()=>{if(valid())saveConfig().catch(()=>{});});
    const backup=[...footer.children].filter(n=>n!==save);
    const oldContent=modal.querySelector('.settings-content');content=element('div','settings-content');content.id='configurationContent';
    const pages={};sections.forEach(([id,key,label])=>{const page=element('div','settings-section');page.id='settings-'+id;if(id==='general')page.classList.add('active');const heading=text(element('h2'),key,label);heading.tabIndex=-1;page.append(heading);pages[id]=page;content.append(page);});

    const countdown=row('raceCountdownMode'),eventMode=row('eventMode'),volume=row('beepVolume');
    const prefs=$('eventDirectorPreferences');prefs.remove();
    const appearance=block(source.system,'settings.system.appearance');
    const c5=$('c5FwSection');c5.remove();
    const gateFirmware=block(source.system,'settings.firmware.title');
    const wifiActions=source.wifi.querySelector('button[onclick="applyWiFiSettings()"]')?.parentElement;
    const wifiNote=wifiActions?.nextElementSibling;
    if(wifiActions)wifiActions.remove();if(wifiNote)wifiNote.remove();

    add(pages.general,'Race workflow','workflow',[eventMode]);
    add(pages.general,'Race limits','limits',block(source.general,'settings.race_setup.title'));
    add(pages.general,'Race start','start',[countdown]);
    add(pages.pilot,'Pilot & channel','pilot',contents(source.pilot));
    add(pages.audio,'Announcements & voice','announcements',block(source.general,'settings.tts.title'));
    add(pages.audio,'Output','output',[volume]);
    add(pages.tracks,'Track distance','tracks',contents(source.tracks));
    add(pages.system,'Receiver & signal filtering','receiver',block(source.system,'settings.system.receiver_radio'));
    add(pages.system,'Battery monitoring','battery',block(source.system,'settings.system.battery'));
    add(pages.wifi,'Wi-Fi network','wifi',block(source.wifi,'settings.wifi.title')).append(...[wifiActions,wifiNote].filter(Boolean));
    add(pages.wifi,'Linked timers','sync',block(source.wifi,'settings.sync.title'));
    add(pages.elrs,'Radio control (ELRS)','elrs',contents(source.elrs));
    const ledNodes=[...source.led.children];const externalHeading=ledNodes.find(n=>n.tagName==='H3');
    const deviceNodes=[];for(const node of ledNodes){if(node===externalHeading)break;if(node.tagName!=='H2')deviceNodes.push(node);}
    add(pages.led,'Device LEDs','deviceLeds',deviceNodes);
    const endpoints=source.webhooks;endpoints.className='cfg-endpoints';add(pages.led,'External controller endpoints','endpoints',contents(endpoints));
    if(externalHeading)externalHeading.remove();add(pages.led,'Race-event lighting & manual control','externalLeds',contents(source.led));
    add(pages.ui,'Appearance & language','appearance',appearance);
    add(pages.ui,'Race Notes','notes',[row('showRaceNotesButton'),row('openRaceNotesOnRaceEnd')]);
    // Present on boards that include the opt-in History filter switch.
    if($('historyAdvancedFilters'))add(pages.ui,'Race History','history',[row('historyAdvancedFilters')]);
    // The legacy notes and chart headings do not consistently have locale keys.
    const remaining=[...source.ui.children].filter(n=>n.tagName!=='H2'&&n.tagName!=='H3');
    add(pages.ui,'Race controls & charts','raceDisplay',remaining);
    add(pages.ui,'Event Director','eventDisplay',[prefs]);
    add(pages.osd,'Broadcast overlays','overlays',contents(source.osd));
    add(pages.maintenance,'Gate firmware','firmware',gateFirmware);
    add(pages.maintenance,'C5 receiver firmware','c5Firmware',[c5]);
    add(pages.maintenance,'Configuration backup','backup',backup);
    add(pages.diagnostics,'Diagnostics','diagnostics',contents(source.diagnostics));

    const nav=element('nav','settings-nav');nav.setAttribute('aria-label',tr('categories','Configuration categories'));
    let last='';sections.forEach(([id,key,label,navGroup])=>{
      if(navGroup!==last){const title=text(element('p','cfg-nav-group'),'group'+navGroup.replace(/\s/g,''),navGroup);nav.append(title);last=navGroup;}
      const button=text(element('button','settings-nav-item'),key,label);button.type='button';button.dataset.settingsSection=id;
      button.addEventListener('click',event=>switchSettingsSection(event,id));nav.append(button);
    });
    sidebar.replaceChildren(nav);
    const mobile=element('div','cfg-mobile-category'),mobileLabel=text(element('label'),'category','Settings category');mobileLabel.htmlFor='configurationCategory';
    categorySelect=document.createElement('select');categorySelect.id='configurationCategory';// Phone menu groups categories under the same headings as the sidebar.
    let optionGroup=null,groupName='';sections.forEach(([id,key,label,navGroup])=>{if(navGroup!==groupName){groupName=navGroup;const groupKey='group'+navGroup.replace(/\s/g,'');optionGroup=document.createElement('optgroup');optionGroup.dataset.i18nLabel='settings.redesign.'+groupKey;optionGroup.label=tr(groupKey,navGroup);categorySelect.append(optionGroup);}const option=text(document.createElement('option'),key,label);option.value=id;optionGroup.append(option);});
    categorySelect.addEventListener('change',()=>switchSettingsSection(null,categorySelect.value));mobile.append(mobileLabel,categorySelect);
    const body=element('div','cfg-body');body.append(sidebar,mobile,content);
    status=element('p','cfg-save-status');status.id='configurationSaveStatus';status.setAttribute('role','status');
    const note=element('div','cfg-save-copy');note.append(status,text(element('small'),'saveScope','Preferences and device actions may apply immediately. Save Configuration stores device values.'));
    footer.replaceChildren(note,save);container.replaceChildren(titlebar,body,footer);oldContent.remove();
    container.setAttribute('role','dialog');container.setAttribute('aria-modal','true');container.setAttribute('aria-labelledby','configurationTitle');
    modal.dataset.redesigned='true';
    if(!originalControls.every(n=>modal.contains(n)))throw new Error('Configuration restructuring lost an original control');
    setupVoice();enhanceRows(modal);
    ['maxLaps','minLap','novaStepMax','batteryVoltageDivider','lowBatteryAlarmPerCell'].forEach(numeric);
    proxy('maxHeatTime',30,'s');proxy('novaKalmanQ',.01,'');proxy('novaEmaAlpha',.01,'');
    const legacySwitch=switchSettingsSection;
    switchSettingsSection=function(event,id){const resolved=aliases[id]||id;legacySwitch(event,resolved);active=resolved;categorySelect.value=resolved;nav.querySelectorAll('button').forEach(b=>{const on=b.dataset.settingsSection===resolved;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});content.scrollTop=0;const heading=$('settings-'+resolved)?.querySelector('h2');if(event||document.activeElement===categorySelect)heading?.focus({preventScroll:true});sync();};
    const trigger=$('nav-link-config');
    if(trigger){trigger.tabIndex=0;trigger.setAttribute('role','button');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','settingsModal');trigger.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openSettingsModal();}});}
    const legacyOpen=openSettingsModal,legacyClose=closeSettingsModal;
    openSettingsModal=function(){previousFocus=document.activeElement;document.documentElement.classList.add('configuration-open');legacyOpen();theme();sync();switchSettingsSection(null,active);document.querySelectorAll('body > header,body > main,body > footer').forEach(n=>n.inert=true);close.focus();};
    closeSettingsModal=function(){legacyClose();document.documentElement.classList.remove('configuration-open');document.querySelectorAll('body > header,body > main,body > footer').forEach(n=>n.inert=false);previousFocus?.focus?.();};
    const legacySave=saveConfig;
    saveConfig=async function(...args){
      if(modal.classList.contains('active')&&!valid())throw new Error(tr('invalid','Check the highlighted settings.'));
      // A device configUpdated refresh can arrive between an edit and its save.
      // Keep the editor's pending scaled values until that exact save completes.
      const edits=proxies.filter(p=>p.pending&&p.input.checkValidity()).map(p=>({state:p,edit:p.edit,value:p.input.value}));
      const wasRefreshing=_refreshingFromDevice;_refreshingFromDevice=true;
      try{edits.forEach(({state:p,value})=>{p.original.value=String(Number(value)/p.scale);p.original.dispatchEvent(new Event('input',{bubbles:true}));});}
      finally{_refreshingFromDevice=wasRefreshing;}
      const sequence=++saveSequence;
      notice(tr('saving','Saving configuration?'));
      try{
        const result=await legacySave.apply(this,args);
        edits.forEach(({state:p,edit,value})=>{if(p.edit===edit){p.pending=false;p.original.value=String(Number(value)/p.scale);}});
        if(sequence===saveSequence)notice(tr('saved','Configuration saved'));
        return result;
      }catch(error){if(sequence===saveSequence)notice(error.message,true);throw error;}
    };
    modal.addEventListener('keydown',event=>{if(hasOtherDialog())return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeSettingsModal();}else if(event.key==='Tab'){const items=focusables(),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}},true);
    new MutationObserver(()=>enhanceRows(modal)).observe(prefs,{childList:true,subtree:true});
    new MutationObserver(theme).observe(document.documentElement,{attributes:true,attributeFilter:['style','data-theme']});
    timer=setInterval(()=>{if(modal.classList.contains('active'))sync();},300);
    theme();sync();switchSettingsSection(null,'general');
    if(typeof i18n!=='undefined')i18n.translatePage();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise);else initialise();
  return {initialise, sync, theme, accessible, sections};
})();
