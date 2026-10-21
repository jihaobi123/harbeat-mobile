"""Check that APK-owned engine operations can cross the Android bridge."""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AndroidBridgeContractTest(unittest.TestCase):
    def test_native_bridge_accepts_metric_engine_commands(self):
        engine = (ROOT / 'vendor/realtime-v3/src/mobile/metric-engine.ts').read_text(encoding='utf-8')
        native = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text(encoding='utf-8')
        allowed = re.search(r'method !in listOf\(([^)]+)\)', native)
        self.assertIsNotNone(allowed, 'Android command gate must stay explicit')
        native_commands = set(re.findall(r'"([A-Za-z]+)"', allowed.group(1)))
        engine_commands = set(re.findall(r"case '([A-Za-z]+)'", engine)) | {'prepare'}
        self.assertTrue(engine_commands, 'Expected the APK-owned engine dispatch')
        self.assertEqual(engine_commands - native_commands, set(),
                         'Engine operations must be allowed by the Android bridge')


if __name__ == '__main__':
    unittest.main()
