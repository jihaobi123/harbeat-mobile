"""Rank complete D phrases before WSOLA; this module grants no approval."""
from four_role import original_vocal_gap


def merge_vocal_intervals(intervals):
    merged = []
    for lo, hi in intervals:
        if merged and lo - merged[-1][1] < .35:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return merged


def phrase_window(merged, start, source_limit, duration, tail_cap):
    if any(lo < start + .1 and hi > start - .1 for lo, hi in merged):
        return None, 'active-vocal-entry'
    phrase = next(((lo, hi) for lo, hi in merged if start < lo < source_limit), None)
    if phrase is None or phrase[0] - start > 1.5:
        return None, 'no-nearby-complete-vocal'
    lo, hi = phrase
    if hi - lo < 2 or hi + .22 > source_limit:
        return None, 'phrase-too-short-or-exceeds-exit'
    next_onset = next((x for x, _ in merged if x > hi), duration)
    end = min(next_onset - .12, source_limit, hi + tail_cap)
    if end - hi < .22 - 1e-9 or end + 1 >= duration:
        return None, 'tail-or-source-coverage'
    return (lo, hi, end), None


def rank_vocal_windows(intervals, starts, *, rate, bpm, left, right, exit_fade,
                       duration, bed_intervals, bed_source_start, rms_db):
    """Raw boundary energy is a ranking hint; final −45 dB uses stretched PCM.

    Try whole-beat output offsets and enough natural decay to reach silence.
    The new window still contains exactly one full phrase, clears the original
    B gap and earliest exit, and never includes the next phrase.
    """
    merged = merge_vocal_intervals(intervals)
    beat = 60 / bpm
    windows = {}
    for start in starts:
        for delay in range(9):
            output = left + delay * beat
            limit = start + (exit_fade - output - .15) * rate
            for cap in (.32, .5, .65, .8, .95, 1.1, 1.25):
                phrase, _ = phrase_window(merged, start, limit, duration, cap)
                if phrase is None:
                    continue
                lo, hi, end = phrase
                output_end = output + (end - start) / rate
                if not original_vocal_gap(bed_intervals, bed_source_start, output, output_end):
                    continue
                head = rms_db(start, start + .08 * rate)
                tail = rms_db(end - .15 * rate, end)
                sung_start = output + (lo - start) / rate
                sung_end = output + (hi - start) / rate
                overlap = max(0., min(right, sung_end) - max(left, sung_start))
                windows[(start, end, delay)] = dict(
                    start=start, end=end, delayBeats=delay, outputStart=output,
                    phraseStart=lo, phraseEnd=hi, rawBoundaryDb=max(head, tail),
                    rawHeadDb=head, rawTailDb=tail, singingOverlapSeconds=overlap)
    ordered = sorted(windows.values(), key=lambda row: (
        row['singingOverlapSeconds'] < 1, row['rawBoundaryDb'],
        -row['singingOverlapSeconds'], row['delayBeats'], row['end']-row['phraseEnd'], row['start']))
    distinct, alternatives, seen = [], [], set()
    for row in ordered:
        phrase = row['phraseStart']
        (alternatives if phrase in seen else distinct).append(row)
        seen.add(phrase)
    return distinct + alternatives
