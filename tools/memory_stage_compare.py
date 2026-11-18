"""Controlled per-board heap profile; same phases for ordinary/explicit PSRAM staging."""
import argparse, concurrent.futures, copy, datetime, hashlib, json, re, statistics, time
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[1]
BOARDS={'aio':'http://192.168.7.1','eth':'http://192.168.0.65'}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def main():
 p=argparse.ArgumentParser();p.add_argument('--board',choices=BOARDS,required=True);p.add_argument('--label',required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--external',type=int,choices=[0,1],required=True);p.add_argument('--image',type=Path,required=True);p.add_argument('--idle-only',action='store_true');a=p.parse_args()
 out=a.out.resolve();out.mkdir(parents=True,exist_ok=False);base=BOARDS[a.board];session=requests.Session()
 state={'status':'RUNNING','startedUTC':now(),'board':a.board,'label':a.label,'expectedExternal':bool(a.external),'imageSHA256':hashlib.sha256(a.image.read_bytes()).hexdigest(),'phases':[],'firstFailure':None,'idleOnly':a.idle_only}
 def save():(out/'result.json').write_text(json.dumps(state,indent=2))
 def call(path,body=None):
  r=session.request('GET' if body is None else 'POST',base+path,json=body,timeout=8)
  if not r.ok:
   state['lastHttpError']={'utc':now(),'method':'GET' if body is None else 'POST','path':path,'status':r.status_code,'response':r.text[:1024]};save()
  r.raise_for_status();return r.json()
 def baseline():return {k:call(v) for k,v in [('config','/config'),('history','/races'),('event','/api/event'),('tracks','/tracks')]}
 def info():return call('/api/system/info')
 def summary(name,rows,elapsed,extra=None):
  row={'phase':name,'elapsedSeconds':elapsed,'samples':rows,'medianFree':statistics.median(r['heapFree'] for r in rows),'minimumFreeSample':min(r['heapFree'] for r in rows),'sampledLow2ms':min(r['heapLow'] for r in rows),'medianLargest':statistics.median(r['heapLargest'] for r in rows)}
  if extra:row.update(extra)
  state['phases'].append(row);save()
 def upload(doc):
  value=copy.deepcopy(doc);value['gateRevision']=revision[0]
  reply=call('/api/event',value);revision[0]=reply['revision'];return reply
 before=None;changed=False;revision=[None];save()
 try:
  end=time.monotonic()+180
  while call('/api/usbnet/status')['uptimeS']<120:
   if time.monotonic()>end:raise TimeoutError('Boot-age readiness deadline')
   time.sleep(2)
  race=call('/api/c5/race');assert not race['running'] and not race['busy']
  rx=call('/api/c5/update');assert rx['link']['sampleQueueExternal']==bool(a.external),rx
  assert rx['link']['sampleQueueBytes']==8192,rx
  before=baseline();revision[0]=before['event'].get('gateRevision',0);(out/'baseline.json').write_text(json.dumps(before,indent=2));state['receiverBefore']=rx;state['usbBefore']=call('/api/usbnet/status')
  # One pooled monitoring session, no race controller, serial logger or other probes.
  time.sleep(10);info();call('/api/system/info?resetHeapLow');start=time.monotonic();rows=[]
  for _ in range(20):rows.append(info());time.sleep(.5)
  summary('idle',rows,time.monotonic()-start)
  if a.idle_only:
   state['status']='COMPLETED';return 0
  fixture=json.loads(re.search(r'R"JSON\((.*?)\)JSON"',(ROOT/'tests/native/event-director.cpp').read_text(),re.S).group(1));fixture['name']='CONTROLLED MEMORY PROFILE'
  # Exercise the Event Budget parser using the exact same fixture on both boards.
  time.sleep(5);call('/api/system/info?resetHeapLow');start=time.monotonic();rows=[];latencies=[]
  changed=True
  for _ in range(3):
   t=time.monotonic();upload(fixture);latencies.append(time.monotonic()-t);rows.append(info());time.sleep(1)
  summary('event-parse',rows,time.monotonic()-start,{'uploadSeconds':latencies})
  time.sleep(3);upload(before['event']);changed=False
  time.sleep(5);call('/api/system/info?resetHeapLow');start=time.monotonic();rows=[];latencies=[]
  paths=['/','/script.js','/style.css','/c5-multipilot.js','/event.js','/version']
  def fetch(path):
   t=time.monotonic();r=requests.get(base+path,timeout=8);r.raise_for_status();return {'path':path,'bytes':len(r.content),'seconds':time.monotonic()-t,'sha256':hashlib.sha256(r.content).hexdigest()}
  for _ in range(3):
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    jobs=[pool.submit(fetch,path) for path in paths]
    while not all(job.done() for job in jobs):rows.append(info());time.sleep(.1)
    latencies.append([job.result() for job in jobs])
   rows.append(info());time.sleep(2)
  summary('startup-assets',rows,time.monotonic()-start,{'bursts':latencies})
  state['usbAfter']=call('/api/usbnet/status');state['receiverAfter']=call('/api/c5/update');state['status']='COMPLETED'
 except BaseException as error:
  state.update(status='FAILED',firstFailure={'utc':now(),'error':repr(error)});save();raise
 finally:
  try:
   if before is not None:
    if changed:upload(before['event'])
    time.sleep(1);after=baseline();(out/'after.json').write_text(json.dumps(after,indent=2))
    for k in ['history','tracks']:assert after[k]==before[k],k+' changed'
    assert all(after['config'].get(k)==v for k,v in before['config'].items() if k!='batteryVoltage'),'Config changed'
    expected=copy.deepcopy(before['event']);expected['gateRevision']=after['event'].get('gateRevision',0);assert after['event']==expected,'Event content changed'
    state['baselineRestored']=True
  except BaseException as error:state.update(status='FAILED',restorationError=repr(error));raise
  finally:state['finishedUTC']=now();save();session.close()
 print(a.board,a.label,[(r['phase'],r['medianFree'],r['sampledLow2ms']) for r in state['phases']],flush=True)
 return 0 if state['status']=='COMPLETED' else 1
if __name__=='__main__':raise SystemExit(main())
