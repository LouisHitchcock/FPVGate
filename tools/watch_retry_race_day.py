"""Launch retry supervisors under an independent watchdog, preserving one deadline."""
import argparse,ctypes,datetime,json,os,re,subprocess,sys,time,shutil
from pathlib import Path
from race_day_retry_policy import RetryBudget,write_json_atomic
from race_day_watchdog import supervise
ROOT=Path(__file__).resolve().parents[1]

def matching_test_processes(generation, processes):
    target=str(generation.resolve()).replace('/','\\').lower()
    matches=[]
    for row in processes:
        command=(row.get('CommandLine') or '').replace('/','\\').lower()
        if not any(name in command for name in ['full_race_day.py','race_day_acceptance.py','gate_accept_probe.py']):continue
        # Match the whole --out argument or a descendant, not a sibling prefix.
        if re.search(r'--out\s+"?'+re.escape(target)+r'(?:\\[^"\s]*)?"?(?:\s|$)',command):matches.append(row)
    return matches

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--initial-run',required=True,type=Path);parser.add_argument('--out',required=True,type=Path);parser.add_argument('--seconds',type=int,default=10800);parser.add_argument('--config-template',required=True,type=Path);parser.add_argument('--start-now',action='store_true',help='Explicitly create a fresh window; never used for automatic recovery');args=parser.parse_args()
    initial=args.initial_run.resolve();original=json.loads((initial/'controller.json').read_text());start=datetime.datetime.fromisoformat(original['startedUTC']);budget=RetryBudget.create(start,args.seconds,datetime.datetime.now(datetime.timezone.utc),time.monotonic())
    if args.start_now:
        anchor=Path(str(args.out.resolve())+'-anchor');anchor.mkdir(parents=True,exist_ok=False)
        shutil.copytree(initial/'baseline',anchor/'baseline')
        original={'status':'ANCHOR','startedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceBaseline':str(initial),'firstFailure':None}
        write_json_atomic(anchor/'controller.json',original);initial=anchor
        budget=RetryBudget.create(datetime.datetime.fromisoformat(original['startedUTC']),args.seconds,datetime.datetime.now(datetime.timezone.utc),time.monotonic())
    def command(generation):return [sys.executable,'-u','tools/retry_race_day.py','--initial-run',str(initial),'--out',str(generation),'--seconds',str(args.seconds),'--config-template',str(args.config_template.resolve())]
    quiet_since={}
    def cleanup(generation,reason):
        if not generation.exists():return True
        query="Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python(w)?\\.exe$' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',query],capture_output=True,text=True,timeout=15,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
        processes=json.loads(result.stdout) if result.stdout.strip() else [];processes=[processes] if isinstance(processes,dict) else processes
        live=matching_test_processes(generation,processes)
        for path in generation.glob('attempt-*'):
            if not path.is_dir() or not matching_test_processes(path,processes):continue
            stop=path/'soak-gates.stop.json'
            if not stop.exists():write_json_atomic(stop,{'kind':reason,'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reason':'Watchdog requested safe cleanup; preserve first failure and baseline'})
        write_json_atomic(generation/'orphan-cleanup.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reason':reason,'liveProcesses':live})
        if live:quiet_since.pop(str(generation),None);return False
        quiet_since.setdefault(str(generation),time.monotonic())
        return time.monotonic()-quiet_since[str(generation)]>=1
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
    try:return 0 if supervise(command,cleanup,args.out.resolve(),budget.deadline_monotonic,deadline_utc=budget.deadline_utc.isoformat())['status']=='WINDOW_ENDED' else 1
    finally:ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
if __name__=='__main__':sys.exit(main())
