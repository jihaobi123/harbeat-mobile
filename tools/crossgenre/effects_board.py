"""Build the new-effects listening board from verified rendered receipts."""
import hashlib
import json
import os
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[2]


def build(output, previous):
    output, previous = Path(output), Path(previous)
    data = json.loads((output / 'new-effects.json').read_text(encoding='utf-8'))
    if not data.get('complete') or len(data['pairs']) != 8:
        raise ValueError('The eight-pair render receipt must be complete')
    for pair in data['pairs']:
        for family, name in [('structural', '段落短切（对照）'), ('echo', '回声收尾（对照）')]:
            source = previous / (pair['id'] + '-' + family + '.wav')
            destination = output / source.name
            if source.is_file():
                if not destination.exists():
                    os.link(source, destination)
                pair['methods'].insert(0, dict(method=family, name=name, file=source.name,
                                              scope='existing-phone-method', subjectiveListening='unscored'))
        for method in pair['methods']:
            method['sha256'] = hashlib.sha256((output / method['file']).read_bytes()).hexdigest()
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    (output / 'listening-manifest.json').write_text(raw, encoding='utf-8')
    template = (ROOT / 'vendor/realtime-v3/qa/effects-board.html').read_text(encoding='utf-8')
    html = template.replace('__MANIFEST__', raw.replace('</', '<\\/')).replace(
        '__FINGERPRINT__', hashlib.sha256(raw.encode()).hexdigest())
    (output / 'index.html').write_text(html, encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output')
    parser.add_argument('previous')
    args = parser.parse_args()
    build(args.output, args.previous)
