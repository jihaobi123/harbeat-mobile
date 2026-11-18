"""Acceptance rules for an isolated, one-role-at-a-time audition."""
import itertools
import json
import math


def target_rate(target_bpm, source_bpm):
    """Playback rate is target/source, never a hidden reference tempo."""
    if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0
           for v in (target_bpm, source_bpm)):
        raise ValueError('target and source BPM must be finite positive numbers')
    rate = target_bpm / source_bpm
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError('invalid target playback rate')
    return rate


def source_grid_error(track, start, output_duration, rate, target_bpm):
    """Measured source beats must land on the scene's explicit output clock."""
    expected_rate = target_rate(target_bpm, track['bpm'])
    if (any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, output_duration, rate))
            or start < 0 or output_duration <= 0 or rate <= 0
            or not math.isclose(rate, expected_rate, rel_tol=1e-10, abs_tol=1e-12)):
        raise ValueError('source rate does not match requested output target grid')
    beat = 60 / target_bpm
    expected = [i * beat for i in range(round(output_duration / beat) + 1)]
    beats = [v for row in track['alignment']['bars'] for v in row['beats']]
    relevant = [(v-start)/rate for v in beats if type(v) in (int,float) and math.isfinite(v)
                and start-.065 <= v <= start+output_duration*rate+.065]
    if not relevant:
        raise ValueError('missing measured beat grid')
    return max(min(abs(v-e) for e in expected) for v in relevant) * 1000


class ScanBudget:
    """Bound expensive source/window preparation and final compatibility checks.

    Window limits apply per track; track/check limits apply per scan stage.
    Truncated counts are refused budget requests, not hidden audio failures.
    """
    DEFAULTS = dict(max_c_tracks=4, max_c_windows=2, max_d_tracks=4,
                    max_d_windows=2, max_c_checks=8, max_d_checks=8)

    def __init__(self, **limits):
        if set(limits)-set(self.DEFAULTS):
            raise ValueError('unknown four-role scan budget')
        self.limits = {**self.DEFAULTS, **limits}
        if any(type(v) is not int or not 1 <= v <= 256 for v in self.limits.values()):
            raise ValueError('scan budgets must be integers between 1 and 256')
        self.consumed = {side+kind:0 for side in 'cd' for kind in ('Tracks','Windows','Checks')}
        self.truncated = dict(self.consumed)
        self.windows = {}

    def take(self, side, kind, track_id=None):
        if side not in ('c','d') or kind not in ('track','window','check'):
            raise ValueError('unknown candidate budget stage')
        if kind == 'window' and not track_id:
            raise ValueError('window budget requires a track identity')
        suffix = {'track':'Tracks','window':'Windows','check':'Checks'}[kind]
        key = side+suffix; limit = self.limits['max_'+side+'_'+suffix.lower()]
        window_key = side+':'+str(track_id)
        count = self.windows.get(window_key,0) if kind=='window' else self.consumed[key]
        if count >= limit:
            self.truncated[key] += 1
            return False
        self.consumed[key] += 1
        if kind=='window': self.windows[window_key] = count+1
        return True

    def snapshot(self):
        return dict(limits=dict(self.limits),consumed=dict(self.consumed),
                    truncated=dict(self.truncated),windowsByTrack=dict(self.windows))


def replace_accompaniment(layers, extra, cross):
    """C replaces B.other only; the complete B vocal timeline is retained."""
    import copy
    import numpy as np
    if extra.get('source') != 'c' or extra.get('role') != 'other' or extra.get('key') != 'c.other':
        raise ValueError('C replacement may only change accompaniment')
    result = copy.deepcopy(layers)
    targets = [l for l in result if l['source'] == 'b' and l['role'] == 'other']
    if len(targets) != 1:
        raise ValueError('one original B accompaniment layer required')
    layer = targets[0]
    knots = sorted(set([t for t,_ in layer['points']] + [t for t,_ in cross]))
    layer['points'] = [[t, float(np.interp(t,*zip(*layer['points'])) *
                                (1-np.interp(t,*zip(*cross))))] for t in knots]
    result.append(copy.deepcopy(extra))
    return result


def original_vocal_gap(intervals, source_start, output_start, output_end):
    """D needs a gap over its actual replacement plus unchanged 80 ms guards."""
    guard=.08
    if (any(type(v) not in (int,float) or not math.isfinite(v)
            for v in (source_start,output_start,output_end,guard))
            or source_start < 0 or output_start < 0 or output_end <= output_start or guard < 0):
        raise ValueError('invalid original vocal replacement window')
    if not isinstance(intervals,list):
        raise ValueError('missing original vocal evidence')
    for row in intervals:
        if (not isinstance(row,(list,tuple)) or len(row)!=2 or
                any(type(v) not in (int,float) or not math.isfinite(v) for v in row) or
                row[0]<0 or row[1]<=row[0]):
            raise ValueError('invalid original vocal evidence')
    return not any(lo < source_start+output_end+guard and
                   hi > source_start+output_start-guard for lo,hi in intervals)


def vocal_schedule(left,length,delay_beats,bpm,exit_fade,duration):
    if not all(type(x)in(int,float)and math.isfinite(x)for x in [left,length,delay_beats,bpm,exit_fade,duration])or not 60<=bpm<=120 or delay_beats!=int(delay_beats)or not 0<=delay_beats<=8 or length<=.23:
        raise ValueError('invalid independent vocal timeline')
    start=left+delay_beats*60/bpm;end=start+length
    if start<=.08 or end>exit_fade-.15 or end+.08>=duration:
        raise ValueError('complete vocal does not fit approved exit space')
    return dict(start=start,end=end,
                voicePoints=[[0,0],[start,0],[start+.08,1],[end-.15,1],[end,0],[duration,0]],
                bedPoints=[[0,1],[start-.08,1],[start,0],[end,0],[end+.08,1],[duration,1]])


def coactivity_seconds(intervals, sample_rate=44100):
    # Sum exact PCM frame counts, not differences of rounded seconds.
    return sum(round(row['end']*sample_rate)-round(row['start']*sample_rate) for row in intervals)/sample_rate


def projected_rms(dot, energy, samples):
    if not all(math.isfinite(x) for x in (dot,energy,samples)) or energy<0 or samples<=0:
        raise ValueError('invalid projection statistics')
    if energy==0:
        if dot!=0:raise ValueError('nonzero projection onto zero reference')
        return 0.
    return abs(dot)/math.sqrt(energy*samples)


def validate_steps(steps):
    roles = {'drums', 'bass', 'other', 'vocals'}
    if len(steps) not in (2,3) or any(set(x) != roles for x in steps):
        raise ValueError('two or three complete role maps required')
    changes = []
    for previous, current in zip(steps, steps[1:]):
        changed = [r for r in sorted(roles) if json.dumps(previous[r], sort_keys=True) != json.dumps(current[r], sort_keys=True)]
        if len(changed) != 1:
            raise ValueError('each step must change exactly one role')
        changes += changed
    if changes != ['other', 'vocals'][:len(steps)-1]:
        raise ValueError('replace accompaniment first, then vocals')
    return changes


def approve(evidence, source_count):
    e = evidence
    finite = lambda x: type(x) in (int, float) and math.isfinite(x)
    limits = dict(peak=.95, reconstruction=.25, beatErrorMs=50,
                  loopSeamDb=-20, vocalMaxDb=-45, lowEnergyRatio=1.1, onsetGrowth=1.35)
    if source_count not in (3, 4) or any(not finite(e.get(k)) or e[k] > v for k, v in limits.items()):
        return False
    if source_count==4 and (not finite(e.get('simultaneousFourRoleSeconds')) or e['simultaneousFourRoleSeconds']<1):
        return False
    if any(e.get(k) is not True for k in ['sourceVerified', 'vocalBoundariesClear', 'originalVocalPreserved']):
        return False
    if not finite(e.get('bpm')) or not 60 <= e['bpm'] <= 120:
        return False
    expected = {'/'.join(p) for p in itertools.combinations('ABCD'[:source_count], 2)}
    pairs = e.get('pairwise', {})
    if set(pairs) != expected:
        return False
    for p in pairs.values():
        if (p.get('pass_') is not True or not finite(p.get('pitchedRisk')) or
                not 0 <= p['pitchedRisk'] <= .35 or not finite(p.get('incompatiblePitchedSeconds')) or
                not 0 <= p['incompatiblePitchedSeconds'] <= 30/e['bpm']+.02):
            return False
    return len(e.get('exitPeaks', [])) == 3 and all(finite(x) and 0 <= x <= .95 for x in e['exitPeaks'])


def reviewable(evidence, source_count):
    # Research eligibility is NOT approval. Preserve the failed original
    # measurement, and ensure that this scalar is the only unresolved gate.
    value=evidence.get('vocalMaxDb')
    if type(value) not in (int,float) or not math.isfinite(value) or value<=-45:
        return False
    return not approve(evidence,source_count) and approve({**evidence,'vocalMaxDb':-45},source_count)
