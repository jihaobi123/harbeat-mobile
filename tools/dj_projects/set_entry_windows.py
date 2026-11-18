"""Pick a bounded set of entry candidates from a DJ Set track's measured bars."""

from collections.abc import Mapping
import math


def measured_set_entries(track: Mapping) -> list[dict]:
    """Offer two- and four-bar options over the first 90 seconds.

    Each slot uses the most even complete observed beat sequence in its time
    range. These are candidates for the ordinary planner, which still measures
    alignment against the actual outgoing track and checks vocal overlap.
    """
    bars = track["alignment"]["bars"]
    existing = {(window["start"], window["end"]) for window in track["windows"]}
    candidates = []
    for length in (2, 4):
        slots = {}
        for index in range(len(bars) - length + 1):
            span = bars[index : index + length]
            start, end = span[0]["start"], span[-1]["end"]
            if start >= 90 or end + 16 > track["duration"] or (start, end) in existing:
                continue
            if any(not bar["valid"] or len(bar["beats"]) != 4 for bar in span):
                continue
            if any(abs(a["end"] - b["start"]) > .001 for a, b in zip(span, span[1:])):
                continue
            beats = [beat for bar in span for beat in bar["beats"]]
            if not all(math.isfinite(beat) for beat in (*beats, end)) or end <= start:
                continue
            spacing = (end - start) / len(beats)
            jitter = max(abs(beat - start - step * spacing) for step, beat in enumerate(beats))
            band = int(start // 24)
            rank = (jitter, start)
            current = slots.get(band)
            if current is None or rank < current[0]:
                slots[band] = (rank, index, end)
        for (_, start), index, end in slots.values():
            weighted = [
                (max(0, min(end + 16, frame["end"]) - max(end, frame["start"])), frame["value"])
                for frame in track["energy"]
            ]
            coverage = sum(duration for duration, _ in weighted)
            candidates.append(dict(
                id=f"set-grid-{index}-{length}", start=start, end=end, bars=length,
                role="measured-beat-entry", energy=sum(d * v for d, v in weighted) / coverage if coverage else 0,
                variants={},
            ))
    return sorted(candidates, key=lambda window: (window["start"], window["bars"]))
