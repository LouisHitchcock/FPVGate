"""Independent process watchdog. Its journal does not depend on worker status writes."""
import json,os,queue,subprocess,threading,time
from pathlib import Path
from race_day_retry_policy import write_json_atomic
HEARTBEAT='@@FPVGATE_HEARTBEAT '
TERMINAL={'WINDOW_COMPLETE','WINDOW_COMPLETE_WITH_FAILURES'}

def supervise(make_command, cleanup, root, deadline_monotonic, heartbeat_timeout=120,
              retry_delay=1, cleanup_grace=180, deadline_utc=None):
    root=Path(root);root.mkdir(parents=True,exist_ok=False);(root/'alerts').mkdir()
    state={'status':'STARTING','generations':[],'restarts':0,'deadlineMonotonic':deadline_monotonic,'deadlineUTC':deadline_utc,'pid':os.getpid()}
    status_error=False
    def event(kind,**detail):
        row={'timeUTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'kind':kind,**detail}
        line=json.dumps(row)
        try:
            with (root/'events.jsonl').open('a',encoding='utf-8') as f:f.write(line+'\n');f.flush()
        except OSError:
            # New paths avoid a locked shared status or journal file.
            try:(root/'alerts'/('journal-fallback-'+str(time.time_ns())+'.json')).write_text(line,encoding='utf-8')
            except OSError:pass
        if kind in {'WORKER_STALLED','RECOVERY_BLOCKED','STATUS_WRITE_ERROR','CLEANUP_ERROR','WORKER_START_ERROR'} or (kind=='WORKER_EXIT' and not detail.get('expected')):
            try:(root/'alerts'/(kind+'-'+str(time.time_ns())+'.json')).write_text(line,encoding='utf-8')
            except OSError:pass
        try:print(line,flush=True)
        except OSError:pass
    def save():
        nonlocal status_error
        state['remainingSeconds']=max(0,deadline_monotonic-time.monotonic());state['updatedUTC']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        try:write_json_atomic(root/'watchdog.json',state,attempts=4,retry_delay=.05);status_error=False
        except OSError as error:
            if not status_error:event('STATUS_WRITE_ERROR',error=repr(error))
            status_error=True  # Monitoring and process recovery continue.
    def recover(generation,reason):
        end=max(deadline_monotonic,time.monotonic())+cleanup_grace
        last_report=0
        while True:
            try:ready=cleanup(generation,reason)
            except Exception as error:event('CLEANUP_ERROR',error=repr(error));ready=False
            if ready:return True
            state['status']='WAITING_FOR_ORPHAN_CLEANUP';save()
            if time.monotonic()-last_report>=5:
                event('RECOVERY_BLOCKED',generation=str(generation),reason='Waiting for old test processes and cleanup');last_report=time.monotonic()
            if time.monotonic()>=end:return False
            time.sleep(min(.5,max(0,end-time.monotonic())))
    save();event('WATCHDOG_STARTED',remainingSeconds=state['remainingSeconds'])
    generation_index=0
    while time.monotonic()<deadline_monotonic:
        generation_index+=1;generation=root/('generation-%03d'%generation_index)
        command=make_command(generation);entry={'index':generation_index,'directory':str(generation),'startedMonotonic':time.monotonic()}
        state['generations'].append(entry);state['status']='RUNNING';save()
        lines=queue.Queue()
        with (root/('generation-%03d-console.log'%generation_index)).open('a',encoding='utf-8') as log:
            try:
                process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                    text=True,encoding='utf-8',errors='replace',stdin=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            except OSError as error:
                entry['spawnError']=repr(error);state['restarts']+=1
                event('WORKER_START_ERROR',generation=generation_index,error=repr(error));save()
                time.sleep(min(retry_delay,max(0,deadline_monotonic-time.monotonic())))
                continue
            entry['pid']=process.pid;event('WORKER_STARTED',generation=generation_index,pid=process.pid)
            def reader():
                for line in process.stdout:lines.put(line)
            thread=threading.Thread(target=reader,daemon=True);thread.start()
            last_heartbeat=time.monotonic();last_progress=last_heartbeat;deadline_sent=False;forced_reason=None;last_status=time.monotonic()
            def drain():
                nonlocal last_heartbeat,last_progress
                while True:
                    try:line=lines.get_nowait()
                    except queue.Empty:break
                    try:log.write(line);log.flush()
                    except OSError as error:event('STATUS_WRITE_ERROR',file='worker console',error=repr(error))
                    if line.startswith(HEARTBEAT):
                        try:
                            payload=json.loads(line[len(HEARTBEAT):]);last_heartbeat=time.monotonic()
                            last_progress=last_heartbeat-max(0,float(payload.get('progressAgeSeconds',0)))
                        except (ValueError,TypeError):pass
            while process.poll() is None:
                drain();current=time.monotonic()
                if current>=deadline_monotonic and not deadline_sent:
                    deadline_sent=True;state['status']='DEADLINE_CLEANUP';event('DEADLINE_STOP',generation=generation_index)
                    try:cleanup(generation,'WINDOW_DEADLINE')
                    except Exception as error:event('CLEANUP_ERROR',error=repr(error))
                if current>=deadline_monotonic+cleanup_grace:
                    forced_reason='Cleanup exceeded deadline grace';process.terminate();break
                if current<deadline_monotonic and (current-last_heartbeat>heartbeat_timeout or current-last_progress>heartbeat_timeout):
                    forced_reason='Worker heartbeat/progress stalled';event('WORKER_STALLED',generation=generation_index);process.terminate();break
                if current-last_status>=1:save();last_status=current
                time.sleep(.1)
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            thread.join(2);drain();process.stdout.close()
        entry.update(exitCode=process.returncode,finishedMonotonic=time.monotonic(),forcedReason=forced_reason)
        worker_state={}
        try:worker_state=json.loads((generation/'supervisor.json').read_text(encoding='utf-8-sig'))
        except (OSError,ValueError):pass
        entry['workerStatus']=worker_state.get('status');entry['workerError']=worker_state.get('error')
        # Even a zero exit or terminal label is unexpected before the fixed deadline.
        expected=time.monotonic()>=deadline_monotonic and process.returncode==0 and worker_state.get('status') in TERMINAL
        event('WORKER_EXIT',generation=generation_index,expected=expected,exitCode=process.returncode,status=entry['workerStatus'],error=entry['workerError'],forcedReason=forced_reason)
        state['status']='RECOVERING';save()
        if not recover(generation,'WINDOW_DEADLINE' if time.monotonic()>=deadline_monotonic else 'SUPERVISOR_RECOVERY'):
            state['status']='RECOVERY_BLOCKED';save();return state
        if time.monotonic()>=deadline_monotonic:break
        state['restarts']+=1;event('RESTARTING_SUPERVISOR',nextGeneration=generation_index+1,remainingSeconds=deadline_monotonic-time.monotonic());save()
        time.sleep(min(retry_delay,max(0,deadline_monotonic-time.monotonic())))
    state['status']='WINDOW_ENDED';state['finishedUTC']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());save();event('WATCHDOG_FINISHED',restarts=state['restarts']);return state
