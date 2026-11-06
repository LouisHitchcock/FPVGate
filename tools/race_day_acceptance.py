"""Focused gate/RH acceptance with fixed calibration and injected crossings.
Never deletes baseline race IDs. All case evidence is kept independently of devices.
"""
import argparse,base64,concurrent.futures,copy,ctypes,datetime,hashlib,json,os,pathlib,random,re,sqlite3,subprocess,sys,threading,time,traceback
import requests,socketio,secrets,shutil
from race_day_contracts import RaceJournal, deterministic_timing, live_counts, saved_counts_complete
from race_day_stop import watch_stop_file
ROOT=pathlib.Path.cwd()/'.dev/race-day-acceptance'
REPO=pathlib.Path(__file__).resolve().parents[1]
CODE=REPO.parent
sys.path.insert(0,str(REPO/'tools'))
from race_history_response import saved_race
FREQ=[5658,5695,5732,5769,5806,5843,5880,5917]
LOCK=threading.RLock()
STOP=threading.Event()
RESULTS=[]
FAIL_FAST=True
PHASE={}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(path,data):
 temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(data,indent=2,default=str),encoding='utf-8');replace_evidence(temp,path)
def replace_evidence(temp,path,attempts=50,delay=.1):
 # Windows refuses the rename while a scanner or indexer briefly holds the target.
 # This retries a local evidence write only; a crossing is never sent again.
 for attempt in range(attempts):
  try:os.replace(temp,path);return
  except PermissionError:
   if attempt==attempts-1:raise
   time.sleep(delay)
def record(board,case,status,**detail):
 row={'utc':now(),'board':board,'case':case,'status':status,'stimulus':'HTTP injected crossings unless explicitly stated',**detail}
 with LOCK:
  RESULTS.append(row)
  if FAIL_FAST and status in ('FAIL','ERROR'):STOP.set()
  with (ROOT/'results.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(row,default=str)+'\n')
  atomic(ROOT/'summary.json',{'updatedUTC':now(),'terminal':STOP.is_set(),'counts':{s:sum(x['status']==s for x in RESULTS) for s in ['PASS','FAIL','ERROR','BLOCKED']},'lastResults':RESULTS[-30:]})
 print(board,case,status,str(detail)[:250],flush=True)
def wait(fn,seconds=30,interval=.2):
 end=time.monotonic()+seconds;last=None
 while time.monotonic()<end:
  try:
   last=fn()
   if last:return last
  except (requests.RequestException,ValueError):pass
  time.sleep(interval)
 raise TimeoutError(str(last))
class Gate:
 def __init__(self,label,base):
  self.label=label;self.base=base;self.out=ROOT/label;self.out.mkdir(exist_ok=True)
  self.baseline=json.loads((self.out/'baseline/config.json').read_text(encoding='utf-8'))
  self.history=json.loads((self.out/'baseline/history.json').read_text(encoding='utf-8'))
  self.old_ids={r['timestamp'] for r in self.history['races']};self.journal=RaceJournal(self.out/'race-journal.json',self.old_ids);self.created=set();self.rh=None;self.phase='preflight';self.session=requests.Session()
 def request(self,path,body=None,form=None,expected=(200,202),method=None):
  method=method or ('POST' if body is not None or form is not None else 'GET')
  for i in range(80 if method=='GET' else 1):
   r=self.session.request(method,self.base+path,json=body,data=form,timeout=30)
   if r.status_code!=503 or method!='GET':break
   time.sleep(.15)
  if r.status_code not in expected:raise RuntimeError((path,r.status_code,r.text[:250]))
  return r
 def call(self,path,body=None,form=None,**kw):
  response=self.request(path,body,form,**kw)
  try:return response.json()
  except ValueError:
   stem=self.out/f'invalid-response-{time.time_ns()}';stem.with_suffix('.bin').write_bytes(response.content);atomic(stem.with_suffix('.json'),{'path':path,'status':response.status_code,'headers':dict(response.headers)});raise
 def state(self):
  self.last_state=self.call('/api/c5/race');return self.last_state
 def stopped(self):return wait(lambda:(lambda s:s if not s['running'] and not s['busy'] else None)(self.state()),60)
 def claim_current(self):
  state=self.state();assert state['running'],state;self.journal.claim_running(state['timestamp']);atomic(self.out/'active-race.json',{'timestamp':state['timestamp'],'phase':self.phase,'utc':now()})
 def configure(self,n,reason='maxLaps',lap_format=0):
  self.phase='configuration';slots=[dict(p,frequency=FREQ[i],race=int(i<n),enterRssi=250,exitRssi=240) for i,p in enumerate(self.baseline['c5Pilots'])]
  self.call('/config',{'eventMode':0,'maxLaps':3 if reason=='maxLaps' else 0,'maxHeatTime30s':1 if reason=='heatTime' else 0,'minLap':1,'lapFormat':lap_format,'c5Pilots':slots})
  time.sleep(1)
  c=self.call('/config');assert c['c5Pilots']==slots,c['c5Pilots'];self.phase='idle'
 def details(self,stamp):return saved_race(self.call('/races/downloadOne?timestamp='+str(stamp)),stamp)
 def save_owned(self,state,n,rounds,path):
  assert not state['saveFailed'] and state['savedTimestamp'],state
  stamp=state['savedTimestamp'];assert self.journal.owns(stamp),'Saved ID is not in running-race journal; preserve'
  self.created.add(stamp);atomic(self.out/'owned-races.json',sorted(self.created));race=self.details(stamp)
  assert len(race['pilots'])==n,(len(race['pilots']),n)
  assert {p['slot'] for p in race['pilots']}==set(range(n)),race
  assert all(len(p['lapTimes'])==rounds for p in race['pilots']),[(p['slot'],len(p['lapTimes'])) for p in race['pilots']]
  assert all(p['lapTimes']==state['pilots'][p['slot']]['laps'] for p in race['pilots'])
  atomic(path,{'controller':state,'saved':race})
  self.call('/timer/stop',{});self.call('/timer/stop',{});time.sleep(.25)
  assert self.state()['savedTimestamp']==stamp,'Duplicate Stop changed saved race'
  return stamp,race
 def clean_race(self,stamp):
  assert stamp in self.created and stamp not in self.old_ids
  self.call('/races/delete',form={'timestamp':stamp});self.created.remove(stamp);atomic(self.out/'owned-races.json',sorted(self.created))
  assert all(r['timestamp']!=stamp for r in self.call('/races')['races'])
 def local_heat(self,index,n,reason,interval):
  self.configure(n,reason,index%3);self.phase='local-race';self.call('/timer/start',{});wait(lambda:self.state()['running']);self.claim_current()
  started=time.monotonic()
  rounds=2 if reason=='heatTime' else 4
  for crossing in range(rounds):
   if crossing:time.sleep(interval)
   for slot in range(n):self.call('/api/c5/addLap?pilot='+str(slot),{})
   wait(lambda:all(len(p['laps'])==crossing+1 for p in self.state()['pilots'][:n]),20)
  if reason=='manual':self.call('/timer/stop',{})
  state=self.stopped();assert state['stopReason']==reason,state
  path=self.out/f'local-{index:04d}.json';stamp,race=self.save_owned(state,n,rounds,path)
  self.phase='marshal';self.call('/races/update',form={'timestamp':stamp,'name':f'QA ACCEPTANCE {index}','tag':'qa-acceptance:'+ROOT.name,'notes':'injected crossings; real device save'})
  edited=[dict(lapTimes=[1000,5000+i*100,6000+i*100,7000+i*100]) for i in range(n)]
  self.call('/races/updateLaps',{'timestamp':stamp,'pilots':edited});updated=self.details(stamp)
  assert [p['lapTimes'] for p in updated['pilots']]==[p['lapTimes'] for p in edited]
  assert all(p['fastestLap']==min(p['lapTimes'][1:]) for p in updated['pilots'])
  valid=sorted(updated['lapTimes'][1:]);assert updated['fastestLap']==valid[0] and updated['medianLap']==valid[1] and updated['best3LapsTotal']==sum(valid)
  assert updated['notes']=='injected crossings; real device save'
  r=self.request('/races/updateLaps',{'timestamp':stamp,'pilots':[{'lapTimes':[0]} for _ in range(n)]},expected=(400,));assert self.details(stamp)['lapTimes']==updated['lapTimes']
  exported=self.call('/races/download');assert sum(r['timestamp']==stamp for r in exported['races'])==1
  raw=self.request('/api/marshal/rssi?timestamp='+str(stamp)).content
  spec=__import__('importlib.util',fromlist=['spec_from_file_location']);sp=spec.spec_from_file_location('reliability',REPO/'tools/reliability_check.py');m=spec.module_from_spec(sp);sp.loader.exec_module(m);declared,actual=m.rssi_sample_counts(raw);assert declared==actual and actual>0
  self.out.joinpath(f'local-{index:04d}-rssi.bin').write_bytes(raw)
  self.clean_race(stamp);self.phase='idle'
  record(self.label,'gate-race-save-marshal-export-delete','PASS',heat=index,pilots=n,reason=reason,seconds=round(time.monotonic()-started,2),rssiSamples=actual,format=index%3,evidence=str(path.relative_to(ROOT)))
 def track(self,index):
  self.phase='tracks';before=self.call('/tracks');items=before.get('tracks',[]);tid=max([int(t['trackId']) for t in items]+[100000])+1
  track={'trackId':tid,'name':f'QA ACCEPTANCE {index}','tags':'qa-night','distance':123.5,'notes':'owned test track'}
  created=self.call('/tracks/create',track);assert created['status']=='OK',created
  try:
   self.call('/tracks/select',form={'trackId':tid});assert self.call('/config')['selectedTrackId']==tid
   track['distance']=234.5;self.call('/tracks/update',track);actual=next(t for t in self.call('/tracks')['tracks'] if t['trackId']==tid);assert abs(actual['distance']-234.5)<.01
  finally:
   self.call('/tracks/select',form={'trackId':self.baseline['selectedTrackId']});self.call('/tracks/delete',form={'trackId':tid})
  assert self.call('/tracks')==before
  self.phase='idle';record(self.label,'track-create-select-update-delete','PASS')
 def event(self,index):
  self.phase='event';original=self.call('/config');prior=self.call('/api/event')
  text=(REPO/'tests/native/event-director.cpp').read_text(encoding='utf-8');fixture=json.loads(re.search(r'R"JSON\((.*?)\)JSON"',text,re.S).group(1));fixture['name']='QA ACCEPTANCE EVENT';fixture['schedule']['requireReview']=True
  for p in fixture['pilots']:p.update(enter=250,exit=240)
  def upload(doc):
   for attempt in range(20):
    current=self.call('/api/event');doc['gateRevision']=current.get('gateRevision',0);time.sleep(.25)
    r=self.request('/api/event',doc,expected=(200,409))
    if r.status_code==200:return
    if 'busy' not in r.text.lower():raise RuntimeError(r.text)
    time.sleep(.25)
   raise RuntimeError('Event stayed busy')
  try:
   upload(fixture);self.call('/config',{'eventMode':1});self.call('/timer/start',{});wait(lambda:self.state()['running']);self.claim_current()
   self.call('/api/c5/addLap?pilot=0',{});time.sleep(2.2);self.call('/api/c5/addLap?pilot=0',{});saved=self.stopped()
   stamp=saved['savedTimestamp'];assert stamp and stamp not in self.old_ids;self.created.add(stamp)
   event=self.call('/api/event');assert len(event['races'])==1 and event['schedule']['pos']==1 and event['schedule']['reviewRaceId']
   self.call('/timer/start',{});time.sleep(.5);blocked=self.stopped();assert not blocked['running'] and 'Confirm' in blocked['error']
   event['schedule']['reviewRaceId']=None;event['active']={'groupId':11,'seats':[2,3,None,None,None,None,None,None],'step':1};upload(event)
   assert not self.state()['running'];self.call('/timer/start',{});wait(lambda:self.state()['running']);self.claim_current();self.call('/timer/stop',{});self.stopped()
   atomic(self.out/f'event-{index:04d}.json',{'saved':saved,'reviewBlocked':blocked,'after':self.call('/api/event')})
  finally:
   self.call('/timer/stop',{});self.stopped();upload(prior)
   keys=['eventMode','maxLaps','minLap','maxHeatTime30s','raceCountdownMode','c5Pilots','lapFormat'];self.call('/config',{k:original[k] for k in keys})
   restored=self.call('/api/event');prior['gateRevision']=restored.get('gateRevision',0);assert restored==prior
  if stamp in self.created:self.clean_race(stamp)
  self.phase='idle';record(self.label,'event-result-review-next-heat-restore','PASS',heat=index)
 def restore(self):
  self.session=requests.Session();self.phase='restoring';self.call('/timer/stop',{});self.stopped()
  try:
   current=self.call('/races')['races']
   for row in current:
    stamp=row['timestamp']
    if stamp not in self.old_ids:
     atomic(self.out/f'cleanup-preserved-{stamp}.json',self.call('/races/downloadOne?timestamp='+str(stamp)))
     assert self.journal.owns(stamp),'Unclassified result preserved; configuration still restored separately'
     self.created.add(stamp)
   for stamp in list(self.created):self.clean_race(stamp)
   after={r['timestamp']:r for r in self.call('/races')['races']}
   assert after=={r['timestamp']:r for r in self.history['races']},'Baseline history contents differ; preserve evidence, do not reimport metadata as repair'
  finally:
   skip={'batteryVoltage','hasI2SAudio','bandIndex','channelIndex'};payload={k:v for k,v in self.baseline.items() if k not in skip};self.call('/config',payload)
   after=self.call('/config');assert all(after.get(k)==v for k,v in payload.items()),[k for k,v in payload.items() if after.get(k)!=v]
   record(self.label,'baseline-configuration-restoration','PASS')
   original=json.loads((self.out/'baseline/event.json').read_text(encoding='utf-8'))
   for attempt in range(40):
    event=self.call('/api/event');original['gateRevision']=event.get('gateRevision',0)
    if original==event:break
    reply=self.request('/api/event',original,expected=(200,409))
    if reply.status_code==200:break
    time.sleep(.25)
   restored=self.call('/api/event');original['gateRevision']=restored.get('gateRevision',0);assert restored==original,'Event not restored'
  self.phase='idle';record(self.label,'baseline-settings-history-restoration','PASS')

class RH:
 def __init__(self,gate):
  self.gate=gate;self.label=gate.label;self.data=ROOT/('rh-'+gate.label);self.port=5061 if gate.label=='aio' else 5062;self.process=None;self.sio=None;self.status={};self.beats={};self.live={};self.full=False;self.saving=False
 def read(self,sql,args=()):
  with sqlite3.connect(self.data/'database.db') as db:
   db.row_factory=sqlite3.Row;return [dict(x) for x in db.execute(sql,args)]
 def start(self,full=False):
  self.stop();config=json.loads((self.data/'config.json').read_text());config['FPVGate'].update(address=self.gate.base.split('://')[1],node_count=8,mirror_race='1',full_rssi='1' if full else '0');config['GENERAL']['MOCK_NODES']=0;deterministic_timing(config);atomic(self.data/'config.json',config);self.full=full
  out=(ROOT/f'rh-{self.label}-active-console.log').open('a');err=(ROOT/f'rh-{self.label}-active-error.log').open('a')
  self.process=subprocess.Popen([sys.executable,'-u',str(REPO/'tools/run_rh_bench.py'),str(self.data),str(RH_SERVER)],cwd=REPO,stdout=out,stderr=err,creationflags=0x08000000 if os.name=='nt' else 0);atomic(ROOT/f'rh-{self.label}-process.json',{'pid':self.process.pid,'port':self.port,'scale':4 if full else 1});out.close();err.close()
  wait(lambda:requests.get(f'http://127.0.0.1:{self.port}',timeout=2).status_code==200,45)
  self.sio=socketio.Client(reconnection=True);self.sio.on('race_status',lambda d:self.status.update(d));self.sio.on('heartbeat',lambda d:self.beats.update(d));self.sio.on('current_laps',lambda d:self.live.update(d))
  auth=base64.b64encode((config['SECRETS']['ADMIN_USERNAME']+':'+config['SECRETS']['ADMIN_PASSWORD']).encode()).decode();self.sio.connect(f'http://127.0.0.1:{self.port}',headers={'Authorization':'Basic '+auth},transports=['websocket'],wait_timeout=15)
  self.emit('load_data',{'load_types':['race_status','node_data']});wait(lambda:len(self.beats.get('current_rssi',[]))==8,30)
  for _ in range(max(0,8-len(self.read('select id from pilot')))):self.emit('add_pilot')
  wait(lambda:len(self.read('select id from pilot'))>=8)
  pilots=self.read('select id from pilot order by id limit 8');before=self.read('select coalesce(max(id),0) as n from heat')[0]['n'];self.emit('add_heat',{});wait(lambda:self.read('select max(id) as n from heat')[0]['n']>before);self.heat=self.read('select max(id) as n from heat')[0]['n']
  wait(lambda:len(self.read('select id from heat_node where heat_id=?',(self.heat,)))==8,30);slots=self.read('select id,node_index from heat_node where heat_id=?',(self.heat,))
  for s in slots:self.emit('alter_heat',{'heat':self.heat,'slot_id':s['id'],'pilot':pilots[s['node_index']]['id']})
  wait(lambda:all(r['pilot_id']==pilots[r['node_index']]['id'] for r in self.read('select node_index,pilot_id from heat_node where heat_id=?',(self.heat,))),30);self.emit('set_current_heat',{'heat':self.heat});self.emit('alter_race_format',{'format_id':1,'format_name':'QA ACCEPTANCE UNLIMITED','unlimited_time':1,'staging_fixed_tones':0,'start_delay_min_ms':1000,'start_delay_max_ms':0,'start_behavior':0,'win_condition':0,'number_laps_win':0});self.emit('set_race_format',{'race_format':1});self.emit('set_min_lap',{'min_lap':0})
  time.sleep(1);record(self.label,'rh-production-plugin-startup-eight-nodes','PASS',scale=4 if full else 1)
 def emit(self,event,data=None):self.sio.emit(event,data);time.sleep(.12)
 def stop(self):
  if self.saving and self.process and self.process.poll() is None:
   try:wait(lambda:self.status.get('race_status')==0,30)
   except TimeoutError:record(self.label,'rh-save-incomplete-at-stop','ERROR',status=self.status)
   self.saving=False
  if self.sio:
   try:self.sio.disconnect()
   except Exception:pass
   self.sio=None
  if self.process and self.process.poll() is None:
   self.process.terminate()
   try:self.process.wait(10)
   except subprocess.TimeoutExpired:self.process.kill()
  self.process=None
 def heat_run(self,index,n,interval):
  g=self.gate;g.configure(n,'manual',index%3);g.phase='rh-profile'
  for node,f in enumerate(FREQ):self.emit('set_frequency',{'node':node,'band':'R','channel':node+1,'frequency':f if node<n else 0})
  time.sleep(1);self.emit('set_current_heat',{'heat':self.heat});self.status.clear();self.live.clear();self.emit('load_data',{'load_types':['race_status']});wait(lambda:'race_status' in self.status)
  assert self.status['race_status']==0,self.status
  for node in range(8):
   self.emit('set_enter_at_level',{'node':node,'enter_at_level':250*(4 if self.full else 1)})
   self.emit('set_exit_at_level',{'node':node,'exit_at_level':240*(4 if self.full else 1)})
  def invariant():
   slots=g.call('/config')['c5Pilots']
   return all(p['frequency']==(FREQ[i] if i<n else 0) and p['enterRssi']==250 and p['exitRssi']==240 for i,p in enumerate(slots))
  wait(invariant,20)
  before=self.read('select coalesce(max(id),0) as id from saved_race_meta')[0]['id'];self.emit('stage_race');wait(lambda:self.status.get('race_status')==1,20);wait(lambda:g.state()['running'],20);g.claim_current();g.phase='rh-race';sent=[];passes_before=g.call('/api/system/info').get('rhPasses')
  for crossing in range(4):
   if crossing:time.sleep(max(1.2,interval))
   for slot in range(n):
    item={'slot':slot,'crossing':crossing,'host':time.perf_counter(),'status':'INTENT'};sent.append(item);atomic(g.out/f'rh-{index:04d}-input-journal.json',sent);g.call('/api/c5/addLap?pilot='+str(slot),{});item['localAccepted']=True;atomic(g.out/f'rh-{index:04d}-input-journal.json',sent);g.call('/api/rh/testPass?node='+str(slot),{});item['rhAccepted']=True;atomic(g.out/f'rh-{index:04d}-input-journal.json',sent)
  atomic(g.out/f'rh-{index:04d}-inputs.json',{'attempted':sent,'expectedPilots':n,'gate':g.state()})
  def delivered():
   self.sio.emit('load_data',{'load_types':['current_laps']})
   counts=live_counts(self.live)
   if counts is not None and any(v>4 for v in counts[:n]):raise AssertionError(('duplicate live passes',counts))
   return counts is not None and counts[:n]==[4]*n and not any(counts[n:])
  try:wait(delivered,20)
  finally:atomic(g.out/f'rh-{index:04d}-live.json',{'current':self.live,'gate':g.state(),'fixedProfile':g.call('/config')['c5Pilots'],'rhPassesBefore':passes_before,'rhPassesAfter':g.call('/api/system/info').get('rhPasses')})
  assert invariant(),'Threshold/frequency changed during deterministic race'
  self.emit('stop_race');wait(lambda:self.status.get('race_status')==2,20);state=g.stopped();stamp,race=g.save_owned(state,n,4,g.out/f'rh-gate-{index:04d}.json')
  self.saving=True;self.emit('save_laps');wait(lambda:self.read('select coalesce(max(id),0) as id from saved_race_meta')[0]['id']>before,30);rid=self.read('select max(id) as id from saved_race_meta')[0]['id']
  wait(lambda:self.status.get('race_status')==0 and len(self.read('select id from saved_pilot_race where race_id=?',(rid,)))==n and saved_counts_complete(self.read('select node_index,deleted from saved_race_lap where race_id=?',(rid,)),n,4),30)
  self.saving=False;pilots=self.read('select * from saved_pilot_race where race_id=?',(rid,));laps=self.read('select * from saved_race_lap where race_id=? order by node_index,lap_time_stamp',(rid,))
  for slot in range(n):assert sum(r['node_index']==slot and not r['deleted'] for r in laps)==4,(slot,laps)
  assert not any(r['node_index']>=n and not r['deleted'] for r in laps)
  assert self.read('select count(*) as n from saved_race_meta where id>?',(before,))[0]['n']==1
  atomic(g.out/f'rh-{index:04d}.json',{'stimulus':'injected through production gate endpoints; RF detector bypassed','race':self.read('select * from saved_race_meta where id=?',(rid,)),'pilots':pilots,'laps':laps,'injected':sent})
  g.clean_race(stamp);g.phase='idle';record(self.label,'rh-stage-mirror-pass-stream-save-database','PASS',heat=index,pilots=n,rhRaceId=rid,scale=4 if self.full else 1,passes=len(laps))
def stress(g):
 paths=['/','/script.js','/style.css','/c5-multipilot.js','/event.js','/version']
 while not STOP.wait(35):
  phase=g.phase
  if phase in ['preflight','restoring','event','configuration','rh-profile']:continue
  failures=[]
  def load(path):
   try:
    with requests.get(g.base+path,timeout=25,stream=True) as r:
     data=r.raw.read(decode_content=False);assert r.status_code==200 and (r.headers.get('Content-Length') is None or len(data)==int(r.headers['Content-Length']));return None
   except Exception as e:return (path,repr(e))
  with concurrent.futures.ThreadPoolExecutor(4) as pool:failures=[x for x in pool.map(load,paths*2) if x]
  record(g.label,'concurrent-startup-assets-during-race','FAIL' if failures else 'PASS',phase=phase,requests=12,failures=failures)
def wait_for_lanes(threads,limit=900):
 # A lane restores its gate in its own finally, so the process must not end before it does.
 # Poll liveness against a monotonic deadline: after Ctrl-C on Windows a timed join can
 # return early, which let the process exit mid-heat without restoring the AIO.
 end=time.monotonic()+limit
 while time.monotonic()<end and any(t.is_alive() for t in threads):
  try:
   for t in threads:
    if t.is_alive():t.join(.5)
   time.sleep(.05)
  except KeyboardInterrupt:STOP.set()
 return [t.name for t in threads if t.is_alive()]
def lane(g,args):
 rh=RH(g);g.rh=rh;index=0;started=time.monotonic();deadline=None
 try:
  info=g.call('/api/system/info');receiver=g.call('/api/c5/update');assert info['version']=='1.9.0-rc.5' and receiver['c5']['version']=='1.2.5',(info,receiver)
  atomic(g.out/'source-identity.json',{'gate':info,'receiver':receiver});rh.start();threading.Thread(target=stress,args=(g,),daemon=True).start();end=time.monotonic()+args.seconds;deadline=end
  while time.monotonic()<end and not STOP.is_set():
   index+=1;n=[1,2,4,8][(index-1)%4];reason=['maxLaps','manual','heatTime'][(index-1)%3]
   try:
    g.local_heat(index,n,reason,args.lap_interval)
    if STOP.is_set():break
    rh.heat_run(index,n,args.lap_interval)
    if STOP.is_set():break
    if index%4==0:g.track(index);g.event(index)
    if index%8==0:
     existing=rh.read('select count(*) as n from saved_race_meta')[0]['n'];rh.start(not rh.full);assert rh.read('select count(*) as n from saved_race_meta')[0]['n']==existing;record(g.label,'rh-restart-saved-results-and-scale','PASS')
   except Exception as e:
    record(g.label,'cycle','FAIL',heat=index,error=repr(e),traceback=traceback.format_exc());
    if not args.continue_on_failure:STOP.set()
    atomic(g.out/f'failure-{index:04d}.json',{'phase':g.phase,'gateLastState':getattr(g,'last_state',None),'rhStatus':rh.status,'rhLive':rh.live,'utc':now()})
    rh.stop()
    recovered=False
    for attempt in range(8):
     try:
      g.restore();
      if not STOP.is_set():rh.start(rh.full)
      record(g.label,'recovery','PASS',attempt=attempt+1);recovered=True;break
     except Exception as error:
      record(g.label,'recovery','ERROR',attempt=attempt+1,error=repr(error))
      if STOP.wait(5) or time.monotonic()>=end:break
    if not recovered:raise RuntimeError('Recovery exhausted; lane stopped with evidence preserved')
   if STOP.wait(args.between_heats):break
 except Exception as e:record(g.label,'lane','ERROR',error=repr(e),traceback=traceback.format_exc())
 finally:
  rh.stop()
  try:g.restore()
  except Exception as e:record(g.label,'baseline-restoration','ERROR',error=repr(e),traceback=traceback.format_exc())
  completed=deadline is not None and time.monotonic()>=deadline
  failed=any(r['board']==g.label and r['status'] in ['FAIL','ERROR'] for r in RESULTS)
  exercised=any(r['board']==g.label and r['case']=='rh-stage-mirror-pass-stream-save-database' and r['status']=='PASS' for r in RESULTS)
  record(g.label,'lane-terminal','PASS' if completed and exercised and not failed else 'FAIL',completedDuration=completed,elapsedSeconds=round(time.monotonic()-started,2),lastHeat=index)
def main():
 global ROOT,RH_SERVER,FAIL_FAST
 p=argparse.ArgumentParser();p.add_argument('--seconds',type=float,default=300);p.add_argument('--lap-interval',type=float,default=8);p.add_argument('--between-heats',type=float,default=30);p.add_argument('--boards',nargs='+',default=['aio','eth']);p.add_argument('--allow-littlefs',action='store_true');p.add_argument('--continue-on-failure',action='store_true');p.add_argument('--out',type=pathlib.Path,required=True);p.add_argument('--config-template',type=pathlib.Path,required=True);p.add_argument('--rh-source',type=pathlib.Path,default=CODE/'rotorHazard/RotorHazard-4.5.1');a=p.parse_args()
 assert a.seconds>0 and a.lap_interval>=1,'Positive duration and lap interval >=1s required'
 FAIL_FAST=not a.continue_on_failure
 ROOT=a.out.resolve();RH_SERVER=a.rh_source.resolve()/'src/server'
 assert not ROOT.exists(),'Use a fresh evidence directory'
 assert (RH_SERVER/'server.py').exists(),'RH source missing'
 ROOT.mkdir(parents=True)
 source=ROOT/'source';source.mkdir()
 for name in ['race_day_acceptance.py','race_day_contracts.py','race_history_response.py','race_day_stop.py','run_rh_bench.py']:shutil.copy2(REPO/'tools'/name,source/name)
 for label,base in [('aio','http://192.168.7.1'),('eth','http://192.168.0.65')]:
  if label not in a.boards:continue
  out=ROOT/label/'baseline';out.mkdir(parents=True)
  status=requests.get(base+'/status',timeout=10);status.raise_for_status();storage=status.text.split('Chip:',1)[0];(out/'storage.txt').write_text(storage,encoding='utf-8');assert a.allow_littlefs or re.search(r'Type:\s*SD\b',storage),'SD data unavailable; stop instead of accepting a fallback baseline'
  for name,path in [('config','/config'),('history','/races'),('event','/api/event'),('tracks','/tracks'),('system','/api/system/info')]:
   response=requests.get(base+path,timeout=20);response.raise_for_status();atomic(out/(name+'.json'),response.json())
  data=ROOT/('rh-'+label);data.mkdir();cfg=json.loads(a.config_template.read_text(encoding='utf-8'));cfg['GENERAL']['HTTP_PORT']=5061 if label=='aio' else 5062;cfg['GENERAL']['SERIAL_PORTS']=[];cfg['SECRETS']['ADMIN_USERNAME']='race-day';cfg['SECRETS']['ADMIN_PASSWORD']=secrets.token_urlsafe(24);deterministic_timing(cfg);atomic(data/'config.json',cfg);shutil.copytree(CODE/'fpvgate-rh-plugin-release/custom_plugins/fpvgate',data/'plugins/fpvgate',ignore=shutil.ignore_patterns('__pycache__'))
 atomic(ROOT/'manifest.json',{'createdUTC':now(),'pid':os.getpid(),'rhSource':str(a.rh_source),'durationSeconds':a.seconds,'fixedCalibration':True,'stimulus':'HTTP injected; rig must be off for initial acceptance','harnessSHA256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'gateCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'firmwareHashes':{b:hashlib.sha256((REPO/'.pio/build'/b/'firmware.bin').read_bytes()).hexdigest() for b in ['FPVGateC5MKAIO','WaveshareS3ETH']}})
 if os.name=='nt':ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
 gates={n:Gate(n,b) for n,b in [('aio','http://192.168.7.1'),('eth','http://192.168.0.65')] if n in a.boards}
 for feature in ['RF crossing timing accuracy/independent transmitters','native C5 USB/RH full saved-race timing accuracy','ELRS physical switch/loss/binding','physical power-cut/full-media failures','LED/buzzer/speech physical observation','physical USB browser flash']:
  record('coverage',feature,'BLOCKED',reason='Focused injected acceptance; this run does not exercise the listed hardware feature')
 stop_file=ROOT.parent/(ROOT.name+'.stop.json')
 threading.Thread(target=watch_stop_file,args=(stop_file,STOP,lambda reason:record('qualification','external-stop','FAIL',reason=reason)),daemon=True).start()
 threads=[threading.Thread(target=lane,args=(gates[n],a),name=n) for n in a.boards]
 for t in threads:t.start()
 try:
  for t in threads:
   while t.is_alive():t.join(1)
 except KeyboardInterrupt:STOP.set();record('run','interrupted','ERROR')
 finally:
  STOP.set()
  for name in wait_for_lanes(threads):
   # Still busy after the limit: say so, and do not leave its RH server running.
   record(name,'lane-not-terminated','ERROR',note='lane did not finish; gate restoration did not run')
   try:
    if gates[name].rh:gates[name].rh.stop()
   except Exception as e:record(name,'rh-stop-after-stuck-lane','ERROR',error=repr(e))
  record('run','terminal','FAIL' if any(r['status'] in ['FAIL','ERROR'] for r in RESULTS) else 'PASS',note='Automated lane result only; blocked features remain unqualified')
  if os.name=='nt':ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
 return 1 if any(r['status'] in ['FAIL','ERROR'] for r in RESULTS) else 0
if __name__=='__main__':sys.exit(main())
