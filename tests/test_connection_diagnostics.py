import json, socket, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from tools import connection_diagnostics as trace
class ConnectionDiagnostics(unittest.TestCase):
 def test_trace_preserves_failures_redacts_query_and_restores_hooks(self):
  class FakeSocket:
   def connect(self, peer): raise TimeoutError('test timeout')
   def getsockname(self): return ('192.168.0.21',12345)
  def request(self,method,url,*args,**kwargs):
   FakeSocket().connect(('192.168.0.65',80))
  with tempfile.TemporaryDirectory() as tmp:
   with patch.object(socket,'socket',FakeSocket), patch.object(trace.urllib3.connection.HTTPConnection,'request',request):
    old=FakeSocket.connect
    close=trace.start_connection_trace(Path(tmp)/'trace')
    try:
     with self.assertRaises(TimeoutError):
      trace.urllib3.connection.HTTPConnection.request(None,'GET','/api/system/info?token=SECRET',headers={'Authorization':'SECRET'},body='SECRET')
    finally: close()
    self.assertIs(FakeSocket.connect,old)
    self.assertIs(trace.urllib3.connection.HTTPConnection.request,request)
   raw=(Path(tmp)/'trace/connects.jsonl').read_text()
   self.assertNotIn('SECRET',raw)
   row=json.loads(raw);self.assertEqual(row['request'],{'method':'GET','path':'/api/system/info'})
   self.assertIn('TimeoutError',row['error'])
 def test_thread_start_failure_restores_hooks(self):
  original=socket.socket.connect;request=trace.urllib3.connection.HTTPConnection.request
  with tempfile.TemporaryDirectory() as tmp, patch.object(trace.threading.Thread,'start',side_effect=RuntimeError('start failed')):
   with self.assertRaises(RuntimeError):trace.start_connection_trace(Path(tmp)/'trace')
  self.assertIs(socket.socket.connect,original)
  self.assertIs(trace.urllib3.connection.HTTPConnection.request,request)
