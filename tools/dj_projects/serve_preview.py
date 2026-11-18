"""Serve a local reference audition and retain feedback beside its evidence."""
from __future__ import annotations

import argparse
import datetime
import functools
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import math
from pathlib import Path
import os


def validate_feedback(record, case):
    if (not isinstance(record, dict)
            or record.get('schema') != 'harbeat.dj-reference-feedback.v1'
            or record.get('caseId') != case['id']
            or record.get('preference') not in ('original', 'reference', 'same', 'neither', None)
            or record.get('sources') != case['sources']
            or record.get('reference') != case['reference']
            or not isinstance(record.get('notes'), str)
            or len(record['notes']) > 4000):
        raise ValueError('feedback does not belong to this audition')
    timestamp = datetime.datetime.fromisoformat(record['updatedAt'].replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('feedback timestamp needs a timezone')
    duration = case['lead'] + case['duration'] + case['tail']
    coverage = record.get('coverage')
    if not isinstance(coverage, dict) or set(coverage) != {'original', 'reference'}:
        raise ValueError('missing measured listening coverage')
    for row in coverage.values():
        intervals = row.get('intervals')
        if not isinstance(intervals, list) or len(intervals) > 256:
            raise ValueError('invalid listening intervals')
        previous = 0
        total = 0
        for interval in intervals:
            if (not isinstance(interval, list) or len(interval) != 2
                    or any(type(x) not in (int, float) or not math.isfinite(x) for x in interval)
                    or not previous <= interval[0] <= interval[1] <= duration + 1e-6):
                raise ValueError('invalid listening interval')
            previous = interval[1]
            total += interval[1] - interval[0]
        seconds = row.get('seconds')
        fraction = row.get('fraction')
        if (type(seconds) not in (int, float) or not math.isfinite(seconds)
                or abs(seconds - total) > 1e-6
                or type(fraction) not in (int, float) or not math.isfinite(fraction)
                or abs(fraction - min(1, total / duration)) > 1e-6):
            raise ValueError('listening coverage differs from its intervals')
    return timestamp


class AuditionHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if (self.path != '/feedback'
                or self.headers.get('Origin') != self.server.origin
                or self.headers.get('Content-Type') != 'application/json'):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 65536:
                raise ValueError('feedback size exceeds the limit')
            record = json.loads(self.rfile.read(length))
            timestamp = validate_feedback(record, self.server.case)
            target = self.server.feedback
            if target.exists():
                old = json.loads(target.read_text())
                old_time = datetime.datetime.fromisoformat(old['updatedAt'].replace('Z', '+00:00'))
                if timestamp < old_time:
                    raise ValueError('an older feedback write arrived late')
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
            os.replace(temporary, target)
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            self.send_error(400, str(error))
            return
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--feedback', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8790)
    args = parser.parse_args()
    root = args.root.resolve()
    case = json.loads((root / 'reference-case/case.json').read_text())
    if case.get('approved') is not True:
        raise ValueError('only an approved case may be auditioned')
    args.feedback.parent.mkdir(parents=True, exist_ok=True)
    server = HTTPServer(('127.0.0.1', args.port), functools.partial(AuditionHandler, directory=str(root)))
    server.origin = f'http://127.0.0.1:{server.server_port}'
    server.case = case
    server.feedback = args.feedback.resolve()
    print(server.origin, flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
