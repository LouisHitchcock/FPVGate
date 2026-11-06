"""Read-only hardware regression for overlapping history GET routes.

Requires at least three saved races. Never starts races or edits/deletes data.
"""
import argparse
import json
import time
from pathlib import Path

import requests

from race_history_response import saved_race


def check(base):
    session = requests.Session()

    def get(path, **kwargs):
        for attempt in range(10):
            response = session.get(base.rstrip('/') + path, timeout=15, **kwargs)
            if response.status_code != 503:
                return response
            time.sleep(.25)
        response.raise_for_status()

    response = get('/races')
    response.raise_for_status()
    records = response.json()['races']
    ids = [r['timestamp'] for r in records]
    if len(set(ids)) < 3:
        raise ValueError('At least three distinct saved races are required')
    checks = []
    for index in sorted({0, len(ids) // 2, len(ids) - 1}):
        timestamp = ids[index]
        response = get('/races/downloadOne', params={'timestamp': timestamp})
        response.raise_for_status()
        race = saved_race(response.json(), timestamp)
        assert 'attachment;' in response.headers.get('Content-Disposition', '')
        assert f'race_{timestamp}.json' in response.headers['Content-Disposition']
        assert race['lapTimes'] == records[index]['lapTimes']
        checks.append({'route': 'downloadOne', 'timestamp': timestamp, 'status': 'PASS'})
    missing = next(i for i in range(4294967295, 0, -1) if i not in ids)
    assert get('/races/downloadOne', params={'timestamp': missing}).status_code == 404
    assert get('/races/downloadOne').status_code == 400
    assert get('/races/not-a-route').status_code == 404
    response = get('/races/download')
    response.raise_for_status()
    assert 'races.json' in response.headers.get('Content-Disposition', '')
    assert {r['timestamp'] for r in response.json()['races']} == set(ids)
    assert {r['timestamp'] for r in get('/races').json()['races']} == set(ids)
    return {'status': 'PASS', 'base': base, 'historyCount': len(ids),
            'checks': checks, 'missingID404': True, 'missingParameter400': True,
            'unknownChild404': True, 'downloadAttachment': True,
            'historyIDsUnchanged': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = check(args.base)
    if args.output:
        args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
