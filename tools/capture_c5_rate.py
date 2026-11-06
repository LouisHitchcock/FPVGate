"""Read-only C5 SSE capture with host timestamps; does not measure RF accuracy."""
import argparse
import json
import time
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url')
    parser.add_argument('--seconds', type=float, default=30)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.seconds <= 0:
        parser.error('--seconds must be positive')
    request = urllib.request.Request(args.url.rstrip('/') + '/events',
                                     headers={'Accept': 'text/event-stream'})
    rows = []
    start = time.monotonic()
    event = ''
    with args.output.open('w', encoding='utf-8') as output:
        with urllib.request.urlopen(request, timeout=10) as response:
            for raw in response:
                now = time.monotonic()
                line = raw.decode('utf-8').strip()
                if line.startswith('event:'):
                    event = line[6:].strip()
                elif line.startswith('data:') and event == 'c5Rssi':
                    row = {'elapsed': now-start, 'telemetry': json.loads(line[5:])}
                    output.write(json.dumps(row) + '\n')
                    output.flush()
                    rows.append(row)
                elif not line:
                    event = ''
                if now-start >= args.seconds:
                    break
    if len(rows) < 2:
        raise SystemExit('FAIL: fewer than two C5 telemetry events')
    first, last = rows[0], rows[-1]
    dt = last['elapsed'] - first['elapsed']
    a, b = first['telemetry'], last['telemetry']
    if dt <= 0 or b['samples'] < a['samples'] or b['records'] < a['records']:
        raise SystemExit('FAIL: non-increasing time or reset counters')
    if any(row['telemetry']['freq'] != a['freq'] for row in rows):
        raise SystemExit('FAIL: frequency configuration changed during capture')
    slots = sum(bool(freq) for freq in a['freq'])
    summary = {'events': len(rows), 'elapsedSeconds': dt, 'enabledSlots': slots,
               'samplesPerSecond': (b['samples']-a['samples'])/dt,
               'recordsPerSecond': (b['records']-a['records'])/dt,
               'counterDeltas': {key: b[key]-a[key] for key in
                                 ('seqGaps', 'queueDrops', 'badRecords')},
               'allOnline': all(row['telemetry']['on'] for row in rows)}
    summary['samplesPerSlotPerSecond'] = summary['samplesPerSecond']/slots if slots else None
    args.output.with_suffix('.summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary, indent=2))
    if not summary['allOnline'] or any(summary['counterDeltas'].values()):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
