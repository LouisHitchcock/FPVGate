"""State and ownership contracts for the physical race-day acceptance harness."""
import json
import os
from pathlib import Path


def deterministic_timing(config):
    config.setdefault('TIMING', {}).update(
        calibrationMode=0, startThreshLowerAmount=0, startThreshLowerDuration=0)


def live_counts(payload):
    slots = payload.get('current', {}).get('node_index', [])
    if len(slots) != 8:
        return None
    return [sum(not lap.get('deleted', False) for lap in slot.get('laps', []))
            for slot in slots]


def saved_counts_complete(rows, active_slots, crossings):
    counts = [0] * 8
    for row in rows:
        if not row.get('deleted', False):
            slot = row['node_index']
            if not 0 <= slot < 8:
                return False
            counts[slot] += 1
    return counts == [crossings] * active_slots + [0] * (8 - active_slots)


class RaceJournal:
    """Persist ownership while the race is running, before a save can lose its reply."""
    def __init__(self, path, baseline_ids):
        self.path = Path(path)
        self.baseline_ids = set(baseline_ids)
        self.ids = set(json.loads(self.path.read_text()) if self.path.exists() else [])
        if self.ids & self.baseline_ids:
            raise ValueError('Journal must not claim baseline races')

    def claim_running(self, timestamp):
        if type(timestamp) is not int or timestamp <= 0 or timestamp in self.baseline_ids:
            raise ValueError('Running race has no safe independent identity')
        self.ids.add(timestamp)
        temp = self.path.with_suffix('.tmp')
        with temp.open('w', encoding='utf-8') as stream:
            stream.write(json.dumps(sorted(self.ids)))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, self.path)

    def owns(self, timestamp):
        return timestamp in self.ids and timestamp not in self.baseline_ids
