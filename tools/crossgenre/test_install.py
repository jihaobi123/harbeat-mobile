import unittest
from install_cloud import configure
class InstallerTest(unittest.TestCase):
 def test_configuration_drift_fails_before_publication(self):
  with self.assertRaisesRegex(ValueError,'anchor'):configure('server { }')
  text='server {\n    include /etc/nginx/snippets/harbeat-listen.conf;\n}'
  result=configure(text);self.assertIn('harbeat-crossgenre.conf',result);self.assertEqual(configure(result),result)
