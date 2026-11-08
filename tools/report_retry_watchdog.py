"""Per-attempt diagnostics and Outline checkpoints for a watched retry window."""
import argparse,collections,datetime,importlib.util,json,time
from pathlib import Path
from race_day_retry_policy import write_json_atomic

def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def rows(path):return [json.loads(x) for x in path.read_text(encoding='utf-8').splitlines()] if path.exists() else []
def diagnostic(entry):
 path=Path(entry['directory']);target=path/'RETRY_DIAGNOSTICS.json'
 if target.exists():return
 result={'classification':entry['classification'],'firstFailure':entry.get('firstFailure'),'restoration':[{k:r.get(k) for k in ['board','case','status']} for r in entry.get('restoration',[])],'boards':{}}
 for board in ['eth','aio']:
  receiver=rows(path/('soak-'+board+'-receiver.jsonl'));health=[x for x in rows(path/('soak-'+board+'-health.jsonl')) if 'system' in x];value={}
  keys=['seqGaps','badRecords','queueDrops','uartFifoOverflows','uartBufferFull','uartFrameErrors']
  if receiver:
   value.update(firstUTC=receiver[0]['utc'],lastUTC=receiver[-1]['utc'],firstCounters={k:receiver[0].get(k) for k in keys},lastCounters={k:receiver[-1].get(k) for k in keys})
   error=next((i for i,r in enumerate(receiver) if any(r.get(k,0)>receiver[0].get(k,0) for k in keys)),None)
   if error is not None:value['errorWindow']=receiver[max(0,error-2):error+3]
  if health:value.update(bootBefore=health[0]['storage']['boot'],bootAfter=health[-1]['storage']['boot'],minimumHeap=min(x['system']['heapLow'] for x in health),receiver=health[-1]['receiver'])
  result['boards'][board]=value
 write_json_atomic(target,result)

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args();root=a.root.resolve()
 spec=importlib.util.spec_from_file_location('outline_cli','C:/Users/Louis/.agents/skills/outline/scripts/outline_cli.py');api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
 last_key=None;last_post=0
 while True:
  try:
   watch=read(root/'watchdog.json');attempts=[];current=[]
   for generation in sorted(root.glob('generation-*')):
    if not generation.is_dir() or not (generation/'supervisor.json').exists():continue
    worker=read(generation/'supervisor.json')
    for attempt in worker.get('attempts',[]):
     diagnostic(attempt);attempts.append({'generation':generation.name,'index':attempt.get('index'),'directory':attempt['directory'],'classification':attempt['classification'],'firstFailure':attempt.get('firstFailure'),'restoration':[{k:r.get(k) for k in ['board','case','status']} for r in attempt.get('restoration',[])]})
    if worker.get('currentAttempt'):current.append({'generation':generation.name,'workerStatus':worker['status'],**worker['currentAttempt']})
   counts=dict(collections.Counter(x['classification'] for x in attempts));summary={'updatedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'watchdogStatus':watch['status'],'deadlineUTC':watch['deadlineUTC'],'remainingSeconds':watch['remainingSeconds'],'supervisorRestarts':watch['restarts'],'finishedAttempts':len(attempts),'counts':counts,'current':current,'attempts':attempts,'continuousThreeHourPass':False}
   write_json_atomic(root/'diagnostic-index.json',summary)
   terminal=watch['status'] in ['WINDOW_ENDED','RECOVERY_BLOCKED'];key=(watch['restarts'],len(attempts),terminal)
   if key!=last_key and (last_key is None or terminal or key[0]!=last_key[0] or time.monotonic()-last_post>=60):
    text='\n\n## New watched three-hour run — '+summary['updatedUTC']+'\n\nUser authorized a fresh three-hour window: **20:19:05–23:19:05 UTC / UK, 7 November 2026**. Ethernet + AIO, existing firmware and strict limits; standalone USB/RF excluded. Independent watchdog logs/restarts failed supervisors, waits for orphan cleanup, preserves generations and never renews the deadline. Each gate-test fault stops its attempt, preserves evidence and restores baselines before retry. Windows keep-awake held.\n\n'
    text+='Watchdog: **'+watch['status']+'**; supervisor recoveries: '+str(watch['restarts'])+'; finished attempts: '+str(len(attempts))+'; outcomes: `'+json.dumps(counts)+'`. Current: `'+json.dumps(current)+'`. Latest outcome: `'+json.dumps(attempts[-1] if attempts else None)+'`.\n\n'
    text+='Evidence root `.dev/three-hour-20261107/watchdog-window-02/`: watchdog.json, independent events/alerts and generation console logs; diagnostic-index.json; each generation has its own supervisor journal and per-attempt UART/health/network/serial/RH/source/fault/restoration records plus RETRY_DIAGNOSTICS.json. Prior 111-attempt incomplete run stays separate. No continuous three-hour pass claimed.\n'
    (root/'latest-outline-checkpoint.md').write_text(text)
    try:
     for doc in ['4aa2901d-cb1e-44f8-9324-4a730dfadf13','21e54a75-ebd4-4d47-9fa9-7c3ca272c6c9']:
      api.call('documents.info',{'id':doc});api.call('documents.update',{'id':doc,'text':text,'append':True})
    except Exception as error:print('Outline checkpoint error:',type(error).__name__,flush=True)
    last_key=key;last_post=time.monotonic()
   if terminal:break
  except Exception as error:print('Reporter retry:',type(error).__name__,flush=True)
  time.sleep(5)
if __name__=='__main__':main()
