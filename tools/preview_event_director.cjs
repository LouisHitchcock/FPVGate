// Local-only UI sandbox. Runs the real Event scripts against an in-memory
// gate, never a physical timer. Restarting discards the demo event.
// node tools/preview_event_director.cjs [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'data');
const port = Number(process.argv[2] || 8099);
let event = { version: 3, gateRevision: 1, name: 'Sunday Club Race', nextId: 30,
  pilots: ['Alex','Jamie','Sam','Taylor','Morgan','Chris','Lee','Pat'].map((name, i) => ({ id: i + 1, name, freq: [5658,5732,5806,5917][i % 4], enter: 120, exit: 100, color: ['#ff6b6b','#f7b32b','#06d6a0','#4cc9f0'][i % 4] })),
  groups: [{ id: 10, name: 'Group A', pilotIds: [1,2,3,4], formatId: 20 }, { id: 11, name: 'Group B', pilotIds: [5,6,7,8], formatId: 20 }],
  formats: [{ id: 20, name: '3 laps', win: 'first_to', maxLaps: 3, timeLimitS: 120, minLapS: 3, countdown: 1 }],
  active: { groupId: 10, seats: [1,2,3,4], step: 0 }, schedule: { blocks: [{ id: 21, kind: 'rotate', groupIds: [10,11], times: 3 }], pos: 0, auto: true, requireReview: true, autoChannels: true }, races: [] };
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FPVGate Event Director preview</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/calib-styles.css"><style>
body{--background-color:#13191e;--bg-secondary:#1d272f;--text-color:#e7edf1;--secondary-color:#aab8c2;--border-color:#34434e;--primary-color:#48d4bd;background:var(--background-color);color:var(--text-color);font-family:system-ui;margin:0;padding:24px}main{width:100%;min-width:0;max-width:1160px;margin:auto}.demo{border-bottom:1px solid var(--border-color);padding-bottom:16px;margin-bottom:20px}.demo small{color:var(--secondary-color)}#eventDirectorPreferences{padding:18px}summary{cursor:pointer}button,select,input{font:inherit}input,select{background:var(--bg-secondary);color:var(--text-color);border:1px solid var(--border-color);border-radius:6px;padding:8px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}.ev-panel{margin:0}.ev-title{font-size:24px;width:100%}
</style></head><body><main><div class="demo"><b>FPVGate · Event Director preview</b><p><small>Demo event in memory. No physical gate is connected.</small></p><details><summary>UI/UX → Event Director preferences</summary><div id="eventDirectorPreferences"></div></details></div>
<div id="eventPanel"></div><div id="eventRaceBanner" hidden></div><button id="nextHeatButton" hidden></button>
<script>var raceRunning=false,c5EventManaged=true;var bandDefinitions=[{value:'R',label:'Raceband',system:'analog',index:0}];var freqLookup=[[5658,5695,5732,5769,5806,5843,5880,5917]];
function c5ReceiverSelected(){return true}var C5UI={getProfilesForSave:()=>[],applyHeat:()=>[]};function updateMaxLaps(){}function updateMinLap(){}function updateMaxHeatTime(){}function renderUnifiedRaceView(){}
</script><script src="/event-director-ui.js"></script><script src="/event.js"></script><script>RaceEvent.setEnabled(true);</script></main></body></html>`;
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (status, type, body) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/api/event') {
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 524288) return send(413,'application/json','{}'); }
      try {
        const incoming = JSON.parse(body);
        if (incoming.gateRevision !== event.gateRevision) return send(409,'application/json',JSON.stringify({error:'Event changed; reload from gate'}));
        event = { ...incoming, gateRevision: event.gateRevision + 1 };
      } catch (_) { return send(400,'application/json','{}'); }
      return send(200,'application/json',JSON.stringify({ revision: event.gateRevision }));
    }
    return send(200, 'application/json', JSON.stringify(event));
  }
  if (url.pathname === '/') return send(200,'text/html',page);
  const files = { '/event-director-ui.js': 'text/javascript', '/event.js': 'text/javascript', '/style.css': 'text/css', '/calib-styles.css': 'text/css' };
  if (files[url.pathname]) return send(200,files[url.pathname],fs.readFileSync(path.join(root,url.pathname.slice(1))));
  send(404,'text/plain','Not available in this UI preview.');
}).listen(port, '127.0.0.1', () => console.log(`Event Director preview: http://127.0.0.1:${port}`));
