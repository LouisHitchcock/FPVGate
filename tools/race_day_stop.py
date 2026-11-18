"""Shared graceful stop signal for an acceptance harness and its monitors."""
from pathlib import Path


def watch_stop_file(path, stop, on_failure, interval=0.1):
    path = Path(path)
    while not stop.is_set():
        if path.exists():
            try:
                reason = path.read_text(encoding='utf-8')
            except OSError:
                reason = 'External qualification failure; see stop file'
            on_failure(reason)
            stop.set()
            return
        stop.wait(interval)
