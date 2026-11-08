"""Repeated UART startup tests. Stops and preserves the first fault without resets."""
import argparse,datetime,hashlib,json,os,subprocess,sys,threading,time,socket
from pathlib import Path
import requests,serial,serial.tools.list_ports
BASE='http://192.168.7.1'
ROOT=Path(__file__).resolve().parents[1]
C5=ROOT.parent/'FPVGateC5MK-release-1.2.6'
VERSION='1.2.6-d6d7'
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',required=True,type=Path);ap.add_argument('--cycles',type=int,default=5);ap.add_argument('--use-staged-image',action='store_true');ap.add_argument('--s3-only',action='store_true');ap.add_argument('--no-scope',action='store_true',help='Exclude scope capture for software-only restart checks');a=ap.parse_args()
 out=a.out.resolve();out.mkdir(parents=True,exist_ok=False);(out/'source.py').write_text(Path(__file__).read_text())
 stop=threading.Event();finished=threading.Event();lock=threading.RLock();latest={};ports={};threads=[]
 state={'status':'PREFLIGHT','utc':now(),'phase':'preflight','cycle':0,'completed':[],'firstFailure':None,'usbCommandsSent':0}
 def save():
  with lock:
   temp=out/'state.tmp';temp.write_text(json.dumps(state,indent=2));os.replace(temp,out/'state.json')
 def phase(name,cycle=0):
  state.update(phase=name,cycle=cycle);save();print(now(),name,cycle,flush=True)
 def fail(reason):
  with lock:
   if not state['firstFailure']:state.update(firstFailure={'utc':now(),'phase':state['phase'],'cycle':state['cycle'],'reason':reason});save()
  stop.set()
  try:
   if not a.no_scope:
    with socket.create_connection(('192.168.0.20',5555),timeout=1) as scope:scope.sendall(b':STOP\n')
  except OSError:pass
 def check():
  if stop.is_set():raise RuntimeError(state['firstFailure']['reason'])
 def request(path,body=None,method=None,**kw):
  check();r=requests.request(method or ('POST' if body is not None else 'GET'),BASE+path,json=body,timeout=kw.pop('timeout',8),**kw);r.raise_for_status();return r
 def get(path):return request(path).json()
 def dump(name,value):(out/name).write_text(json.dumps(value,indent=2))
 def passive(label,port):
  while not finished.is_set():
   p=None
   try:
    p=serial.Serial(port=None,baudrate=115200,timeout=.2);p.dtr=False;p.rts=False;p.port=port;p.open();ports[label]=p
    with (out/'serial-notes.jsonl').open('a') as notes:notes.write(json.dumps({'utc':now(),'label':label,'event':'connected','cycle':state['cycle']})+'\n')
    with (out/(label+'-serial.bin')).open('ab') as f:
     while not finished.is_set() and p.is_open:
      b=p.read(4096)
      if b:f.write(b);f.flush()
   except Exception as e:
    with (out/'serial-notes.jsonl').open('a') as notes:notes.write(json.dumps({'utc':now(),'label':label,'error':repr(e),'cycle':state['cycle']})+'\n')
   finally:
    if p:p.close()
   finished.wait(1)
 def events():
  counters=None
  while not finished.is_set() and not stop.is_set():
   try:
    with requests.get(BASE+'/events',headers={'Accept':'text/event-stream'},stream=True,timeout=(3,3)) as r,(out/'receiver.jsonl').open('a') as f:
     r.raise_for_status();kind=''
     for line in r.iter_lines(chunk_size=128,decode_unicode=True):
      if finished.is_set() or stop.is_set():return
      if line.startswith('event:'):kind=line[6:].strip()
      elif line.startswith('data:') and kind=='c5Rssi':
       d=json.loads(line[5:]);d.update(utc=now(),monotonic=time.monotonic(),phase=state['phase'],cycle=state['cycle']);latest.clear();latest.update(d);f.write(json.dumps(d)+'\n');f.flush()
       values={k:d.get(k,0) for k in ['seqGaps','badRecords','queueDrops','uartFifoOverflows','uartBufferFull','uartFrameErrors']}
       if counters and state['phase'] not in ['s3-reboot','s3-app-reboot']:
        for k,v in values.items():
         if v>counters.get(k,0):fail('C5 '+k+' increased: '+str(counters[k])+' -> '+str(v))
       counters=values
   except Exception as e:
    if state['phase'] not in ['s3-reboot','s3-app-reboot'] and not finished.is_set():fail('SSE connection failed: '+repr(e));return
    time.sleep(.2)
 def wait_for(fn,seconds,label):
  start=time.monotonic()
  while time.monotonic()-start<seconds:
   check();v=fn()
   if v:return v
   time.sleep(.15)
  raise TimeoutError(label)
 def challenge(original):
  for gain in [29 if original!=29 else 30,original]:
   check();sent=time.monotonic();request('/config',{'c5Gain':gain})
   wait_for(lambda:latest.get('monotonic',0)>sent and latest.get('on') and latest.get('gain')==gain,6,'No fresh C5 gain acknowledgment '+str(gain))
   # Require receiver to remain online and streaming after settings persistence.
   prior=latest.get('records',0);time.sleep(2);check();assert latest.get('on') and latest.get('records',0)>prior,'Receiver stopped after gain acknowledgment'
 def verify():
  v=get('/api/c5/update');assert v['c5']['board']=='xiaoc5' and v['c5']['version']==VERSION and v['c5']['online'],v
  assert v['link']['writeFailures']==0,v;challenge(original_gain)
 def capture_fault():
  if a.no_scope:return
  try:
   with socket.create_connection(('192.168.0.20',5555),timeout=3) as s:
    s.settimeout(5);s.sendall(b':STOP\n:DISP:DATA? ON,OFF,PNG\n')
    def read(n):
     b=b''
     while len(b)<n:b+=s.recv(n-len(b))
     return b
    def block(cmd):
     s.sendall((cmd+'\n').encode());assert read(1)==b'#';n=int(read(1));b=read(int(read(n)));read(1);return b
    # The screenshot query was already issued above.
    assert read(1)==b'#';n=int(read(1));(out/'first-fault-scope.png').write_bytes(read(int(read(n))));read(1)
    for ch in [1,2]:
     s.sendall((':WAV:SOUR CHAN%d\n:WAV:MODE RAW\n:WAV:FORM BYTE\n:WAV:PRE?\n'%ch).encode());line=b''
     while not line.endswith(b'\n'):line+=read(1)
     pre=[float(x) for x in line.decode().strip().split(',')];dump('first-fault-ch%d-preamble.json'%ch,pre)
     with (out/('first-fault-ch%d-raw.bin'%ch)).open('wb') as f:
      for start in range(1,int(pre[2])+1,250000):
       s.sendall((':WAV:STAR %d\n:WAV:STOP %d\n'%(start,min(int(pre[2]),start+249999))).encode());f.write(block(':WAV:DATA?'))
    s.sendall(b':WAV:MODE NORM\n')
  except Exception as e:state['scopeCaptureError']=repr(e)
 try:
  if not a.s3_only:assert {p.device:p.serial_number for p in serial.tools.list_ports.comports()}.get('COM24')=='10:BD:A3:CA:38:3C','COM24 identity changed'
  info=get('/api/system/info');assert info['board']=='FPVGateC5MKAIO',info
  baseline={name:get(path) for name,path in [('config','/config'),('history','/races'),('event','/api/event'),('tracks','/tracks')]};dump('baseline.json',baseline);dump('system-before.json',info)
  race=get('/api/c5/race');assert not race['running'] and not race['busy'],race
  original_gain=baseline['config']['c5Gain'];image=C5/'.dev/builds/C5MK-1.2.6-d6d7-xiaoc5/xiaoc5-d6d7-firmware.bin';raw=image.read_bytes();assert hashlib.sha256(raw).hexdigest()=='3d58c4f27f06593f5cc94bf3a4b4cef66b6d3b33ad90cabf1661a940ae443589'
  state.update(status='RUNNING',c5AppSHA256=hashlib.sha256(raw).hexdigest(),baselineGain=original_gain);save()
  if not a.no_scope:
   with socket.create_connection(('192.168.0.20',5555),timeout=3) as s:s.sendall(b':STOP\n:TIM:SCAL 0.001\n:TIM:OFFS 0\n:TRIG:MODE EDGE\n:TRIG:EDG:SOUR CHAN1\n:TRIG:EDG:SLOP NEG\n:TRIG:EDG:LEV 1.65\n:TRIG:SWE NORM\n:RUN\n')
  serial_targets=[('s3','COM23')] + ([] if a.s3_only else [('c5','COM24')])
  for label,port in serial_targets:
   t=threading.Thread(target=passive,args=(label,port),daemon=True);t.start();threads.append(t)
  t=threading.Thread(target=events,daemon=True);t.start();threads.append(t)
  wait_for(lambda:latest.get('on') and latest.get('ready'),8,'No baseline C5 stream');verify();dump('baseline-receiver.json',latest.copy())
  # Stage the exact same C5 application; no alternate image or filesystem.
  if a.s3_only:
   state['scope']='S3 software restart and C5 UART recovery only; C5 OTA/staging/native USB excluded';save()
  elif a.use_staged_image:
   staged=get('/api/c5/update')['image'];assert staged=={'version':VERSION,'board':'xiaoc5','size':len(raw)},staged
   state['scope']='Startup-only isolation using exact image staged in run-02; staging UART loss remains an open failure';save()
  else:
   phase('c5-image-staging');r=request('/api/c5/firmware',method='POST',data=raw,headers={'Content-Type':'application/octet-stream'},timeout=40);dump('staged-image.json',r.json());check();time.sleep(2);check()
  for cycle in range(1,1 if a.s3_only else a.cycles+1):
   phase('c5-uart-ota',cycle);r=request('/api/c5/update',{},method='POST');dump('c5-ota-%02d-start.json'%cycle,r.json())
   early={'checked':False}
   def completed_update():
    v=get('/api/c5/update');(out/'update-latest.json').write_text(json.dumps(v,indent=2))
    if v['state']=='failed':raise RuntimeError('C5 OTA failed: '+str(v))
    if v['state']=='restarting' and v['c5']['online'] and v['c5']['version']==VERSION and not early['checked']:
     phase('c5-trial-verify',cycle);verify();early['checked']=True;state['earlyTrialAcknowledged']=cycle;save();phase('c5-uart-ota',cycle)
    return v if v['state']=='done' else None
   v=wait_for(completed_update,180,'C5 OTA completion timeout');phase('c5-ota-verify',cycle);verify();state['completed'].append({'kind':'c5-uart-ota','cycle':cycle,'utc':now()});save()
  for cycle in range(1,a.cycles+1):
   phase('s3-reboot',cycle);before=get('/api/c5/update')['link']['commandsSent'];requests.post(BASE+'/api/system/reboot',timeout=8).raise_for_status();time.sleep(2)
   def back():
    try:
     v=requests.get(BASE+'/api/c5/update',timeout=2);v.raise_for_status();d=v.json()
     return d if d['link']['commandsSent']<before and d['c5']['online'] else None
    except requests.RequestException:return None
   wait_for(back,150,'S3 did not restart and regain C5')
   # Remain in reboot phase until a new SSE packet has arrived. An in-flight
   # connection timeout must not race the change to normal verification.
   api_ready=time.monotonic()
   wait_for(lambda:latest.get('monotonic',0)>api_ready and latest.get('on') and latest.get('ready'),10,'SSE did not reconnect after S3 boot')
   phase('s3-verify',cycle);verify();state['completed'].append({'kind':'s3-software-restart','cycle':cycle,'utc':now()});save()
  phase('restore');verify()
  after={name:get(path) for name,path in [('config','/config'),('history','/races'),('event','/api/event'),('tracks','/tracks')]};dump('after.json',after)
  for name in ['history','event','tracks']:assert after[name]==baseline[name],name+' changed'
  assert all(after['config'].get(k)==v for k,v in baseline['config'].items() if k!='batteryVoltage'),'Config differs'
  state.update(status='COMPLETED',finishedUTC=now(),baselineRestored=True);save()
 except BaseException as e:
  fail(repr(e));capture_fault();state.update(status='FAILED',finishedUTC=now(),preservedFailureState=True,wedgedConfirmed=False,settingsMayDiffer=state['phase']!='preflight');save();print('STOPPED:',repr(e),flush=True)
  # Preserve the fault: no reboot, USB console query or automatic setting write.
  try:
   r=requests.get(BASE+'/api/log/recent',timeout=5);(out/'first-fault-log-response.bin').write_bytes(r.content)
  except Exception:pass
 finally:
  finished.set()
  for p in ports.values():
   try:p.close()
   except Exception:pass
 return 0 if state['status']=='COMPLETED' else 1
if __name__=='__main__':sys.exit(main())
