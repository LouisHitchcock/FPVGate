"""Opt-in local TCP connection metadata; never records headers or request bodies."""
import sys, json, time, threading, socket, datetime, os, ctypes, struct
from pathlib import Path
import urllib3.connection
from urllib.parse import urlsplit

def start_connection_trace(root):
    trace = Path(root)
    trace.mkdir(parents=True, exist_ok=False)
    lock = threading.Lock()
    context = threading.local()
    stop = threading.Event()
    original_connect = socket.socket.connect
    original_request = urllib3.connection.HTTPConnection.request

    def write(name, row):
        row = dict(row, utc=datetime.datetime.now(datetime.timezone.utc).isoformat())
        with lock:
            with (trace / name).open('a', encoding='utf-8') as f:
                f.write(json.dumps(row) + '\n')

    def request(self, method, url, *args, **kwargs):
        prior = getattr(context, 'request', None)
        context.request = {'method': method, 'path': urlsplit(url).path}
        try:
            return original_request(self, method, url, *args, **kwargs)
        finally:
            context.request = prior

    def connect(self, peer):
        if not isinstance(peer, tuple) or peer[0] not in ['192.168.0.65', '192.168.7.1'] or peer[1] != 80:
            return original_connect(self, peer)
        start = time.monotonic()
        error = None
        try:
            return original_connect(self, peer)
        except Exception as e:
            error = repr(e)
            raise
        finally:
            try:
                local = self.getsockname()
            except OSError:
                local = None
            write('connects.jsonl', {'pid': os.getpid(), 'thread': threading.current_thread().name, 'peer': peer, 'local': local, 'seconds': time.monotonic() - start, 'error': error, 'request': getattr(context, 'request', None)})

    def tcp_table():
        from ctypes import wintypes
        fn = ctypes.windll.iphlpapi.GetExtendedTcpTable
        size = wintypes.ULONG(0)
        fn(None, ctypes.byref(size), False, 2, 5, 0)
        previous = None
        while not stop.wait(0.1):
            data = ctypes.create_string_buffer(size.value)
            code = fn(data, ctypes.byref(size), False, 2, 5, 0)
            if code:
                write('tcp-errors.jsonl', {'code': code})
                continue
            raw = data.raw
            count = struct.unpack_from('=I', raw)[0]
            rows = []
            counts = {}
            for i in range(count):
                state, local_ip, local_port, remote_ip, remote_port, pid = struct.unpack_from('=6I', raw, 4 + i * 24)
                remote = socket.inet_ntoa(struct.pack('=I', remote_ip))
                port = socket.ntohs(remote_port & 65535)
                if remote not in ['192.168.0.65', '192.168.7.1'] or port != 80:
                    continue
                key = remote + ':' + str(state)
                counts[key] = counts.get(key, 0) + 1
                if state != 11:
                    rows.append({'state': state, 'localPort': socket.ntohs(local_port & 65535), 'peer': remote, 'pid': pid})
            snapshot = {'connections': sorted(rows, key=lambda r: (r['peer'], r['pid'], r['localPort'], r['state'])), 'stateCounts': counts}
            if snapshot != previous:
                write('tcp-states.jsonl', snapshot)
                previous = snapshot
    socket.socket.connect = connect
    urllib3.connection.HTTPConnection.request = request
    thread = None
    if os.name == 'nt':

        def guarded_table():
            try:
                tcp_table()
            except Exception as error:
                write('tcp-errors.jsonl', {'error': repr(error)})
        thread = threading.Thread(target=guarded_table, daemon=True)
        try:
            thread.start()
        except BaseException:
            socket.socket.connect = original_connect
            urllib3.connection.HTTPConnection.request = original_request
            raise

    def close():
        stop.set()
        if thread:
            thread.join(2)
        socket.socket.connect = original_connect
        urllib3.connection.HTTPConnection.request = original_request
    return close
