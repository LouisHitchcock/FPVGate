import socket, unittest
from unittest.mock import patch
from tools import gate_accept_probe as probe
class ProbeDiagnostics(unittest.TestCase):
 def test_connect_timeout_stays_failure(self):
  with patch.object(probe.socket,'create_connection',side_effect=TimeoutError('connect')):
   with self.assertRaises(TimeoutError) as caught:probe.fresh_once('192.168.7.1')
  self.assertEqual(caught.exception.probeDiagnostics['phase'],'connect')
 def test_complete_body_without_close_stays_failure_but_is_identified(self):
  class Fake:
   reads=0
   def getsockname(self):return ('192.168.7.2',1234)
   def settimeout(self,t):assert t==2.5
   def sendall(self,data):assert b'Connection: close' in data
   def recv(self,n):
    self.reads+=1
    if self.reads==1:return b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}'
    raise socket.timeout('close')
   def close(self):self.closed=True
  fake=Fake()
  with patch.object(probe.socket,'create_connection',return_value=fake):
   with self.assertRaises(socket.timeout) as caught:probe.fresh_once('192.168.7.1')
  detail=caught.exception.probeDiagnostics
  self.assertTrue(fake.closed);self.assertTrue(detail['declaredBodyComplete'])
  self.assertEqual(detail['localPort'],1234);self.assertEqual(detail['httpStatus'],200)
  self.assertEqual(detail['bodyBytes'],2);self.assertNotIn('{}',str(detail))
