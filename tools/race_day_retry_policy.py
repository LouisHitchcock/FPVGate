"""Fixed retry-window policy, independent of hardware and wall-clock changes."""
from dataclasses import dataclass
from datetime import timedelta

@dataclass(frozen=True)
class RetryBudget:
    deadline_utc: object
    deadline_monotonic: float

    @classmethod
    def create(cls, started_utc, seconds, now_utc, monotonic_now):
        if seconds <= 0:
            raise ValueError('Positive total window required')
        deadline = started_utc + timedelta(seconds=seconds)
        return cls(deadline, monotonic_now + max(0, (deadline-now_utc).total_seconds()))

    def remaining(self, monotonic_now):
        return max(0, self.deadline_monotonic-monotonic_now)

    def attempt_seconds(self, monotonic_now):
        return int(self.remaining(monotonic_now))


def classify_attempt(controller, scheduled_stop=False):
    # A genuine fault detected before the deadline keeps precedence.
    if controller.get('firstFailure'):
        reason = controller['firstFailure'].get('reason', '')
        if not scheduled_stop or reason != 'gates: lane failed; see summary and console':
            return 'FAILED'
    if scheduled_stop:
        return 'WINDOW_ENDED'
    return 'COMPLETED' if controller.get('status') == 'COMPLETED' else 'FAILED'


def write_json_atomic(path, data, attempts=50, retry_delay=.1):
    """Keep the last complete status file when Windows briefly denies rename."""
    import json
    import os
    import time
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, indent=2), encoding='utf-8')
    for attempt in range(attempts):
        try:
            os.replace(temp, path)
            return
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(retry_delay)


def read_json_retry(path, attempts=50, retry_delay=.1):
    """Retry a Windows sharing violation while reading completed evidence."""
    import json
    import time
    for attempt in range(attempts):
        try:
            return json.loads(path.read_text(encoding='utf-8-sig'))
        except PermissionError:
            if attempt == attempts - 1:
                raise
            time.sleep(retry_delay)
