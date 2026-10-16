"""Publish a small, read-only cover catalog from verified NAS artwork associations.

Run on Jetson with Pillow installed. Only the designated output directory is
written; source audio, reports and the original artwork manifest stay unchanged.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile

from PIL import Image, ImageOps

HASH = re.compile(r"^[a-f0-9]{64}$")
TRACK = re.compile(r"^(track-[a-f0-9]{20}|[a-f0-9]{32}|mt2_[a-z0-9_]{1,64})$")


def atomic_write(path, content):
    fd, name = tempfile.mkstemp(prefix='.artwork-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def export(artwork_root, report_index, output):
    artwork_root = Path(artwork_root).resolve(strict=True)
    output = Path(output).resolve()
    if output == artwork_root or output.is_relative_to(artwork_root):
        raise ValueError('output must be separate from original artwork')
    manifest = json.loads((artwork_root / 'artwork-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schema') != 'harbeat.artwork-associations.v1':
        raise ValueError('unknown artwork manifest')
    reports = json.loads(Path(report_index).read_text(encoding='utf-8'))
    rows = list(reports.values()) if isinstance(reports, dict) else reports
    associations = {}
    for track in manifest['tracks']:
        if track.get('cover_status') != 'ready':
            continue
        for key in ['original_audio_sha256', 'audio_sha256']:
            sha = track.get(key, '')
            if HASH.fullmatch(sha):
                associations.setdefault(sha, []).append(track)
    bindings = {}
    for row in rows:
        audio = row.get('audio', {})
        track_id, audio_sha = audio.get('catalog_track_id', ''), audio.get('sha256', '')
        if (not TRACK.fullmatch(track_id) or not HASH.fullmatch(audio_sha) or
                audio.get('binding') not in ('published_manifest_reference', 'library_record_reference')):
            continue
        candidates = associations.get(audio_sha, [])
        hashes = {t.get('cover', {}).get('image_sha256') for t in candidates}
        if len(hashes) == 1 and candidates:
            bindings[(track_id, audio_sha)] = candidates[0]
    matched_count = len({track_id for track_id, _ in bindings})
    # Also publish hash-only associations for imports not yet in the catalog.
    # A later report must match the full audio hash; titles are never a join key.
    for audio_sha, candidates in associations.items():
        hashes = {t.get('cover', {}).get('image_sha256') for t in candidates}
        if len(hashes) == 1:
            bindings[('', audio_sha)] = candidates[0]
    output.mkdir(parents=True, exist_ok=True)
    images = {}
    tracks = []
    for (track_id, audio_sha), track in sorted(bindings.items()):
        cover = track['cover']
        source_sha = cover.get('image_sha256', '')
        if not HASH.fullmatch(source_sha):
            raise ValueError('invalid image hash')
        if source_sha not in images:
            source = (artwork_root / cover['image_path']).resolve(strict=True)
            if not source.is_relative_to(artwork_root / 'images'):
                raise ValueError('cover path escapes image directory')
            raw = source.read_bytes()
            if len(raw) > 20 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != source_sha:
                raise ValueError('cover checksum or size mismatch')
            with Image.open(io.BytesIO(raw)) as picture:
                picture = ImageOps.exif_transpose(picture).convert('RGB')
                picture.thumbnail((640, 640), getattr(Image, 'Resampling', Image).LANCZOS)
                encoded = io.BytesIO()
                picture.save(encoded, 'JPEG', quality=86, optimize=True)
                thumb = encoded.getvalue()
            image_sha = hashlib.sha256(thumb).hexdigest()
            target = output / (image_sha + '.jpg')
            if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != image_sha:
                atomic_write(target, thumb)
            images[source_sha] = image_sha
        tracks.append({'catalog_track_id': track_id or None, 'audio_sha256': audio_sha,
                       'cover_sha256': images[source_sha],
                       'artist': track.get('artist') or '',
                       'album': track.get('album') or ''})
    result = {'schema': 'harbeat.mobile-artwork.v1',
              'generated_at': datetime.now(timezone.utc).isoformat(),
              'tracks': tracks}
    atomic_write(output / 'catalog.json', json.dumps(result, ensure_ascii=False,
                 separators=(',', ':')).encode('utf-8'))
    return {'matched_tracks': matched_count,
            'bindings': len(tracks), 'unique_images': len(images),
            'uploaded_tracks': len(manifest['tracks'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artwork-root', required=True)
    parser.add_argument('--report-index', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(export(args.artwork_root, args.report_index, args.output)))
