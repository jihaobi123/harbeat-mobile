"""Stage verified Toucan original segments for the private Android Set."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stage(pilot, lab, media):
    source = next(row for row in read(pilot / 'sets.json') if row['id'] == 'toucan-2014')
    originals = read(pilot / 'toucan-2014/originals.json')
    assert len(source['tracks']) == len(originals) == 19
    details = {}
    for row in read(lab / 'library.json')['tracks']:
        track = read(lab / 'details' / (row['id'] + '.json'))['track']
        details[track['provenance']['originalSha256']] = track
    tracks = []
    media.mkdir(parents=True, exist_ok=True)
    for slot, (entry, original) in enumerate(zip(source['tracks'], originals), 1):
        original_path = pilot / 'toucan-2014/originals' / f'{slot:02}.mp3'
        sha = digest(original_path)
        assert slot == entry['slot'] == original['slot'] and sha == original['sha256'] == entry['sha256']
        playback = entry['playback']
        track = details.get(sha) or {**playback, 'id': 'track-' + sha[:20]}
        assert track['provenance']['originalSha256'] == sha
        assert abs(track['duration'] - playback['duration']) < 1 / 44100
        for source_segment, segment in zip(playback['audioSegments'], track['audioSegments']):
            asset = segment['asset']
            original_asset = source_segment['asset']
            original_file = pilot / original_asset['url'].lstrip('/')
            assert asset['sha256'] == original_asset['sha256'] == digest(original_file)
            assert asset['bytes'] == original_file.stat().st_size
            assert segment['start'] == source_segment['start'] and segment['end'] == source_segment['end']
            destination = media / (asset['sha256'] + '.flac')
            if not destination.exists():
                os.link(original_file, destination)
            assert digest(destination) == asset['sha256']
            asset['url'] = '/listen/media/' + destination.name
        assert len(playback['audioSegments']) == len(track['audioSegments'])
        track['native'] = track['audioSegments'][0]['asset']
        track['originalUrl'] = original['download']
        tracks.append(track)
    record = {
        'schema': 'harbeat.ordered-dj-set.v1',
        'id': source['id'],
        'title': 'Toucan 2014',
        'sourceUrl': source['source'],
        'license': source['license'],
        'tracks': tracks,
    }
    (lab / 'toucan-set.json').write_text(json.dumps(record, ensure_ascii=False, separators=(',', ':')))
    print(len(tracks), 'originals,', len(list(media.glob('*.flac'))), 'verified segments')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('pilot', 'lab', 'media'):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    stage(args.pilot, args.lab, args.media)
