"""Retry two-gate acceptance inside one fixed wall-time window; retain every failure."""
import argparse,ctypes,datetime,json,os,subprocess,sys,time,threading,hashlib
from pathlib import Path
import requests
from race_day_retry_policy import RetryBudget,classify_attempt,event_baseline_matches,write_json_atomic as atomic
ROOT=Path(__file__).resolve().parents[1]
BOARDS={'eth':'http://192.168.0.65','aio':'http://192.168.7.1'}
def now():return datetime.datetime.now(datetime.timezone.utc)
def stamp():return now().isoformat()
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def main():
 p=argparse.ArgumentParser();p.add_argument('--initial-run',required=True,type=Path);p.add_argument('--out',required=True,type=Path);p.add_argument('--seconds',type=int,default=10800);p.add_argument('--config-template',required=True,type=Path);p.add_argument('--aio-image',type=Path);p.add_argument('--eth-image',type=Path);a=p.parse_args()
 initial=a.initial_run.resolve();previous=read(initial/'controller.json');out=a.out.resolve();out.mkdir(parents=True,exist_ok=False)
 budget=RetryBudget.create(datetime.datetime.fromisoformat(previous['startedUTC']),a.seconds,now(),time.monotonic())
 baseline={b:{k:read(initial/'baseline'/b/(k+'.json')) for k in ['config','history','event','tracks']} for b in BOARDS}
 images={b:{'path':str(getattr(a,b+'_image').resolve()),'bytes':getattr(a,b+'_image').stat().st_size,'sha256':hashlib.sha256(getattr(a,b+'_image').read_bytes()).hexdigest()} for b in BOARDS if getattr(a,b+'_image') is not None}
 state={'status':'STARTING','startedUTC':previous['startedUTC'],'supervisorStartedUTC':stamp(),'deadlineUTC':budget.deadline_utc.isoformat(),'totalWindowSeconds':a.seconds,'pid':os.getpid(),'scope':'Ethernet + AIO mixed races; retries restart test processes, not board power or firmware','attempts':([{'directory':str(initial),'classification':'FAILED','firstFailure':previous.get('firstFailure'),'baselineRestored':True}] if previous.get('firstFailure') else []),'currentAttempt':None,'remainingSeconds':budget.attempt_seconds(time.monotonic()),'failureLimitsUnchanged':True}
 state['installedImageProvenance']=images
 progress=[time.monotonic()];heartbeat_stop=threading.Event()
 def heartbeat():
  while not heartbeat_stop.wait(2):
   try:print('@@FPVGATE_HEARTBEAT '+json.dumps({'progressAgeSeconds':time.monotonic()-progress[0],'status':state['status']}),flush=True)
   except (OSError,ValueError):return
 threading.Thread(target=heartbeat,daemon=True).start()
 def save():progress[0]=time.monotonic();state['remainingSeconds']=budget.attempt_seconds(time.monotonic());atomic(out/'supervisor.json',state)
 def event(kind,**detail):
  with (out/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps({'utc':stamp(),'kind':kind,**detail})+'\n')
  print(stamp(),kind,json.dumps(detail),flush=True)
 def get(base,path):
  # Readiness/baseline checks can wait out the API's explicit busy response.
  for _ in range(20):
   if budget.remaining(time.monotonic())<=0:raise TimeoutError('Window ended during readiness')
   progress[0]=time.monotonic()
   r=requests.get(base+path,timeout=5)
   if r.status_code!=503:break
   time.sleep(.15)
  r.raise_for_status();return r.json()
 def ready():
  result={}
  for b,base in BOARDS.items():
   sysinfo=get(base,'/api/system/info');rx=get(base,'/api/c5/update');race=get(base,'/api/c5/race');storage=get(base,'/api/log/status')
   assert sysinfo['board']==('WaveshareS3ETH' if b=='eth' else 'FPVGateC5MKAIO'),b+' board mismatch'
   if b in images:assert sysinfo['app']['used']==images[b]['bytes'],b+' installed application differs from expected image'
   assert rx['c5']['online'] and rx['c5']['version']==('1.2.5' if b=='eth' else '1.2.6-d6d7'),b+' receiver not ready'
   assert not race['running'] and not race['busy'],b+' race still active'
   assert storage['sdAvailable'],b+' SD unavailable'
   values={k:get(base,path) for k,path in [('config','/config'),('history','/races'),('event','/api/event'),('tracks','/tracks')]}
   assert all(values['config'].get(k)==v for k,v in baseline[b]['config'].items() if k!='batteryVoltage'),b+' configuration not restored'
   for k in ['history','tracks']:assert values[k]==baseline[b][k],b+' baseline '+k+' differs'
   assert event_baseline_matches(values['event'],baseline[b]['event']),b+' baseline Event content/revision differs'
   result[b]={'system':sysinfo,'receiver':rx,'storage':storage,'baselineMatched':True,'eventRevision':values['event'].get('gateRevision',0)}
  return result
 ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
 active=None;attempt=None;scheduled=False
 try:
  (out/'source.py').write_text(Path(__file__).read_text());(out/'retry-policy.py').write_text((ROOT/'tools/race_day_retry_policy.py').read_text());save();event('window-opened',deadlineUTC=state['deadlineUTC'],originalFailure=previous.get('firstFailure'))
  index=1 if previous.get('firstFailure') else 0
  while budget.attempt_seconds(time.monotonic())>0:
   state.update(status='CHECKING_READINESS',currentAttempt=None);save()
   try:health=ready()
   except Exception as e:
    event('readiness-wait',reason=repr(e));state.update(status='WAITING_FOR_READY_BASELINES',lastReadinessError=repr(e));save();time.sleep(min(5,budget.remaining(time.monotonic())));continue
   remaining=budget.attempt_seconds(time.monotonic())
   if remaining<=0:break
   index+=1;attempt=out/('attempt-%03d'%index);scheduled=False;deadline_signalled=False
   atomic(out/('attempt-%03d-before.json'%index),{'utc':stamp(),'remainingSeconds':remaining,'boards':health})
   command=[sys.executable,'-u','tools/full_race_day.py','--out',str(attempt),'--boards','eth','aio','--seconds',str(remaining),'--rehearsal','0','--skip-native-usb','--aio-version','1.2.6-d6d7','--eth-version','1.2.5','--config-template',str(a.config_template.resolve())]
   for b,image in images.items():command += ['--'+b+'-image',image['path']]
   with (out/('attempt-%03d-console.log'%index)).open('ab') as stdout,(out/('attempt-%03d-error.log'%index)).open('ab') as stderr:
    active=subprocess.Popen(command,cwd=ROOT,stdout=stdout,stderr=stderr,stdin=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
   state.update(status='RUNNING',currentAttempt={'index':index,'directory':str(attempt),'pid':active.pid,'startedUTC':stamp()});save();event('attempt-started',index=index,directory=str(attempt),secondsBudget=remaining,pid=active.pid)
   last_phase=None;last_tick=time.monotonic()
   while active.poll() is None:
    controller={}
    try:controller=read(attempt/'controller.json')
    except (OSError,ValueError):pass
    if controller.get('firstFailure') and last_phase!='FAULT':
     event('attempt-first-failure',index=index,failure=controller['firstFailure']);last_phase='FAULT';state['status']='FAULT_CLEANUP';state['currentAttempt']['firstFailure']=controller['firstFailure'];save()
    if budget.remaining(time.monotonic())<=0 and not deadline_signalled:
     deadline_signalled=True
     # Preserve an earlier fault; the deadline stop must not replace it.
     scheduled=not bool(controller.get('firstFailure'))
     if controller.get('processes'):
      stop_path=attempt/'soak-gates.stop.json'
      if not stop_path.exists():atomic(stop_path,{'kind':'WINDOW_DEADLINE','utc':stamp(),'reason':'Original three-hour test window ended; stop new work and restore baselines'})
     else:
      # Controller is still in read-only preflight; retain a stop file for its lane.
      atomic(attempt/'soak-gates.stop.json',{'kind':'WINDOW_DEADLINE','utc':stamp(),'reason':'Original three-hour test window ended during preflight'})
     state['status']='DEADLINE_CLEANUP';save();event('window-deadline-stop',index=index,priorFault=controller.get('firstFailure'))
    if time.monotonic()-last_tick>=5:save();last_tick=time.monotonic()
    time.sleep(.5)
   controller=read(attempt/'controller.json') if (attempt/'controller.json').exists() else {'status':'ERROR','error':'Controller exited without state'}
   classification=classify_attempt(controller,scheduled)
   summary=read(attempt/'soak-gates/summary.json') if (attempt/'soak-gates/summary.json').exists() else {}
   rows=[]
   if (attempt/'soak-gates/results.jsonl').exists():
    rows=[json.loads(x) for x in (attempt/'soak-gates/results.jsonl').read_text(encoding='utf-8').splitlines()]
   restoration=[x for x in rows if 'restoration' in x.get('case','')]
   entry={'index':index,'directory':str(attempt),'classification':classification,'exitCode':active.returncode,'firstFailure':controller.get('firstFailure'),'finishedUTC':stamp(),'counts':summary.get('counts',{}),'restoration':restoration,'restorationIncomplete':controller.get('restorationIncomplete',False)}
   atomic(out/('attempt-%03d-result.json'%index),entry);state['attempts'].append(entry);state['currentAttempt']=None;save();event('attempt-finished',index=index,classification=classification,firstFailure=entry['firstFailure'],counts=entry['counts']);active=None
   if entry['restorationIncomplete']:
    state.update(status='BLOCKED_UNFINISHED_CLEANUP',finishedUTC=stamp());save();event('retries-blocked',reason='Controller reported unfinished cleanup; will not start overlapping tests');return 1
   if budget.remaining(time.monotonic())>0:
    state['status']='RETRY_COOLDOWN';save();time.sleep(min(3,budget.remaining(time.monotonic())))
  state.update(status='WINDOW_COMPLETE_WITH_FAILURES' if any(x['classification']=='FAILED' for x in state['attempts']) else 'WINDOW_COMPLETE',finishedUTC=stamp(),currentAttempt=None,continuousThreeHourPass=False);save();event('window-finished',attempts=len(state['attempts']),status=state['status'])
 except BaseException as e:
  if active and active.poll() is None and attempt:
   atomic(attempt/'soak-gates.stop.json',{'kind':'SUPERVISOR_ERROR','utc':stamp(),'reason':repr(e)});active.wait()
  state.update(status='ERROR',error=repr(e),finishedUTC=stamp());save();raise
 finally:
  heartbeat_stop.set();ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
 return 0
if __name__=='__main__':sys.exit(main())
