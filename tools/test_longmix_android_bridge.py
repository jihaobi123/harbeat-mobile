"""Isolated lab installation, routes and stable fallback contracts."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LongmixAndroidBridgeTest(unittest.TestCase):
    def test_multi_source_route_and_command_are_explicitly_lab_only(self):
        native=(ROOT/'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text()
        route=re.search(r'if \(isLongmixLab && path.matches\(Regex\("(/listen/multi-layering[^"\n]+)"\)\)\) return continuousMetadata\(path, (2 \* 1024 \* 1024)\)',native)
        self.assertIsNotNone(route)
        pattern=route.group(1).replace('\\\\','\\')
        for name in ('index.json','a'*64+'.json'):self.assertIsNotNone(re.fullmatch(pattern,'/listen/multi-layering/v1/'+name))
        for name in ('../index.json','index.json/extra','anything.json','a'*64+'.wav'):self.assertIsNone(re.fullmatch(pattern,'/listen/multi-layering/v1/'+name))
        self.assertIn('method == "multiLayering" && !isLongmixLab',native)
        allowed=re.search(r'method !in listOf\(([^\n]+)\)',native)
        self.assertIn('"multiLayering"',allowed.group(1))
    def test_role_replacement_metadata_is_strict_lab_only(self):
        native=(ROOT/'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text()
        line=next((line for line in native.splitlines()if 'path.matches(Regex("/listen/role-replacement/v1/'in line), '')
        self.assertTrue(line)
        self.assertIn('if (isLongmixLab && ',line)
        self.assertIn('return continuousMetadata(path, 2 * 1024 * 1024)',line)
        for name in ['index.json','a'*64+'.json']:
            self.assertIsNotNone(re.fullmatch(r'/listen/role-replacement/v1/(index\.json|[a-f0-9]{64}\.json)','/listen/role-replacement/v1/'+name))
        for name in ['../index.json','index.json/extra','anything.json','a'*64+'.wav']:
            self.assertIsNone(re.fullmatch(r'/listen/role-replacement/v1/(index\.json|[a-f0-9]{64}\.json)','/listen/role-replacement/v1/'+name))

    def test_lab_identity_is_opt_in_and_precedes_qa(self):
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        self.assertIn('gradleProperty("harbeatLongmixLab").orNull == "true"', gradle)
        self.assertRegex(gradle, r'if \(isLongmixLabBuild\) applicationIdSuffix = "\.longmixlab"\s+else if \(isQaBuild\) applicationIdSuffix = "\.nativeqa"')
        self.assertIn('if (isLongmixLabBuild) "HarBeat 长混试验"', gradle)

    def test_stable_launch_uses_only_explicit_installed_component(self):
        activity = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/MainActivity.kt').read_text()
        self.assertIn('"openStableMix"', activity)
        self.assertIn('ComponentName("com.example.harbeat.nativeqa", "com.example.harbeat.MainActivity")', activity)
        self.assertIn('ActivityNotFoundException', activity)
        self.assertNotIn('ACTION_DELETE', activity)

    def test_longmix_json_logs_are_accepted_by_native_export(self):
        native = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text()
        self.assertIn('"harbeat.longmix-lab-session.v1"', native)

    def test_longmix_metadata_is_strict_and_bounded(self):
        native = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text()
        route = re.search(r'if \(path.matches\(Regex\("(/listen/longmix[^"\n]+)"\)\)\) return continuousMetadata\(path, (2 \* 1024 \* 1024)\)', native)
        self.assertIsNotNone(route, 'Only index and content-addressed scene metadata may be proxied')
        pattern = route.group(1).replace('\\\\', '\\')
        for path in ['/listen/longmix-lab/v1/index.json', '/listen/longmix-lab/v1/' + 'a' * 64 + '.json']:
            self.assertIsNotNone(re.fullmatch(pattern, path))
        for path in ['/listen/longmix-lab/v1/anything.json', '/listen/longmix-lab/v1/index.json/extra', '/listen/longmix-lab/v1/../index.json']:
            self.assertIsNone(re.fullmatch(pattern, path))
        self.assertIn('"longmix" -> "longmix.html"', native)
        self.assertIn('"loadScene"', native)
        self.assertIn('"exit"', native)

    def test_automatic_longmix_metadata_is_strict_and_bounded_in_normal_playback(self):
        native = (ROOT / 'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text()
        route = re.search(r'if \(path.matches\(Regex\("(/listen/longmix-live[^"\n]+)"\)\)\) return continuousMetadata\(path, (2 \* 1024 \* 1024)\)', native)
        self.assertIsNotNone(route, 'Only verified index and content-addressed A/B metadata can be proxied')
        pattern = route.group(1).replace('\\\\', '\\')
        for path in ['/listen/longmix-live/v1/index.json', '/listen/longmix-live/v1/' + 'a' * 64 + '.json']:
            self.assertIsNotNone(re.fullmatch(pattern, path))
        for path in ['/listen/longmix-live/v1/file.json', '/listen/longmix-live/v1/' + 'a' * 64 + '.wav', '/listen/longmix-live/v1/../index.json', '/listen/longmix-live/v1/index.json/extra']:
            self.assertIsNone(re.fullmatch(pattern, path))
        self.assertIn('context.packageName == "com.example.harbeat.longmixlab"', native)
        self.assertIn('args["outcome"] != "takeover-b"', native)
        self.assertIn('method == "multiLayering" && !isLongmixLab', native)
        self.assertIn('"liveLayering"', native)

    def test_return_metadata_is_lab_only_and_cannot_proxy_arbitrary_files(self):
        native=(ROOT/'android/app/src/main/kotlin/com/example/harbeat/RealtimeMixEngine.kt').read_text()
        route=re.search(r'if \(isLongmixLab && path.matches\(Regex\("(/listen/longmix-return[^"\n]+)"\)\)\) return continuousMetadata\(path, (2 \* 1024 \* 1024)\)',native)
        self.assertIsNotNone(route)
        pattern=route.group(1).replace('\\\\','\\')
        for name in ('index.json','a'*64+'.json'):self.assertIsNotNone(re.fullmatch(pattern,'/listen/longmix-return/v1/'+name))
        for name in ('../index.json','index.json/extra','anything.json','a'*64+'.wav'):self.assertIsNone(re.fullmatch(pattern,'/listen/longmix-return/v1/'+name))


if __name__ == '__main__':
    unittest.main()
