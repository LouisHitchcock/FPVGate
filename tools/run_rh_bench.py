"""Run an isolated RH source tree with a dedicated data directory on Windows."""
import argparse
import os
from pathlib import Path
import runpy
import sys
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('data', type=Path)
parser.add_argument('server', type=Path)
args = parser.parse_args()
data, server = args.data.resolve(), args.server.resolve()
if sys.platform == 'win32' and time.get_clock_info('monotonic').resolution > .001:
    time.monotonic = time.perf_counter
os.chdir(server)
sys.path.insert(0, str(server))
sys.argv = ['server.py', '--data', str(data)]
runpy.run_path(str(server / 'server.py'), run_name='__main__')
