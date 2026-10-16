import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from export_nas_artwork import export


class ArtworkExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.art = self.root / 'art'
        (self.art / 'images').mkdir(parents=True)
        self.out = self.root / 'public'
        image = io.BytesIO()
        Image.new('RGB', (1200, 900), 'teal').save(image, 'JPEG')
        self.raw = image.getvalue()
        self.sha = hashlib.sha256(self.raw).hexdigest()
        (self.art / 'images' / f'{self.sha}.jpg').write_bytes(self.raw)
        self.track = {
            'cover_status': 'ready', 'original_audio_sha256': 'a' * 64,
            'audio_sha256': 'b' * 64, 'artist': '音乐人', 'album': '专辑',
            'source_audio': '/mnt/nas/private.mp3',
            'cover': {'image_sha256': self.sha,
                      'image_path': f'images/{self.sha}.jpg'},
        }
        self.index = self.root / 'reports.json'
        self.index.write_text(json.dumps({'report': {'audio': {
            'catalog_track_id': 'track-' + 'a' * 20, 'sha256': 'a' * 64,
            'binding': 'published_manifest_reference'}}}), encoding='utf-8')
        self.save_manifest()

    def save_manifest(self):
        (self.art / 'artwork-manifest.json').write_text(json.dumps({
            'schema': 'harbeat.artwork-associations.v1',
            'tracks': [self.track]}, ensure_ascii=False), encoding='utf-8')

    def test_old_and_new_hashes_share_verified_resized_cover(self):
        result = export(self.art, self.index, self.out)
        self.assertEqual(result['matched_tracks'], 1)
        data = json.loads((self.out / 'catalog.json').read_text(encoding='utf-8'))
        self.assertEqual(len(data['tracks']), 3)
        self.assertNotIn('/mnt/nas', json.dumps(data))
        self.assertEqual({t['audio_sha256'] for t in data['tracks']},
                         {'a' * 64, 'b' * 64})
        image_sha = data['tracks'][0]['cover_sha256']
        image_path = self.out / f'{image_sha}.jpg'
        self.assertEqual(hashlib.sha256(image_path.read_bytes()).hexdigest(), image_sha)
        with Image.open(image_path) as picture:
            self.assertEqual(picture.size, (640, 480))
        image_path.write_bytes(b'corrupt')
        export(self.art, self.index, self.out)
        self.assertEqual(hashlib.sha256(image_path.read_bytes()).hexdigest(), image_sha)
        self.assertEqual((self.art / 'images' / f'{self.sha}.jpg').read_bytes(), self.raw)

    def test_wrong_checksum_never_publishes_catalog(self):
        (self.art / 'images' / f'{self.sha}.jpg').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            export(self.art, self.index, self.out)
        self.assertFalse((self.out / 'catalog.json').exists())

    def test_path_outside_image_directory_is_rejected(self):
        (self.root / 'private.jpg').write_bytes(self.raw)
        self.track['cover']['image_path'] = '../private.jpg'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'escapes'):
            export(self.art, self.index, self.out)
        self.assertFalse((self.out / 'catalog.json').exists())


if __name__ == '__main__':
    unittest.main()
