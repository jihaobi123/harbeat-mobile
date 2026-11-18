"""Check that APK-owned engine operations can cross the Android bridge."""
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class AndroidBridgeContractTest(unittest.TestCase):
    def test_network_routes_are_bound_to_the_configured_origin(self):
        native = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text(encoding='utf-8')
        self.assertNotIn('8.136.120.255', native)
        self.assertIn('args["publicOrigin"]', native)
        self.assertIn('setRequestProperty("Origin", publicOrigin)', native)
        self.assertIn('connection.instanceFollowRedirects = false', native)

    def test_native_plan_slot_pressure_is_retryable_not_a_musical_rejection(self):
        native = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text(encoding='utf-8')
        branch = re.search(r'if \(!metricSlot.tryAcquire\(\)\) \{(.*?)\n            \}', native, re.S)
        self.assertIsNotNone(branch, 'Capacity must be distinguished from invalid arguments')
        self.assertIn('.put("httpStatus", 429)', branch.group(1))
        self.assertIn('.put("retryAfterMs", 10000)', branch.group(1))

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
