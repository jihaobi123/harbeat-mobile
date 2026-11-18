import pytest

from tools.dj_projects.approve_toucan_pair import adaptation_curves


def test_adaptation_keeps_measured_curves_until_the_last_bar():
    original = {
        'a': [[0, 1], [4, .8], [8, .6], [12, .4], [20, 0]],
        'b': [[0, 0], [4, .3], [8, .6], [12, .75], [20, 1]],
    }
    result = adaptation_curves(original, duration=10, beat=0.5)
    assert result['reference']['a'] == [[0, 1], [4, .8], [8, .6], [10, 0]]
    assert result['reference']['b'] == [[0, 0], [4, .3], [8, .6], [10, 1]]
    assert result['original']['a'] == [[0, 1], [4, 0], [10, 0]]


def test_adaptation_rejects_unobserved_or_out_of_budget_time():
    original = {'a': [[0, 1], [24, 0]], 'b': [[0, 0], [24, 1]]}
    for duration in (3.9, 24, 33):
        with pytest.raises(ValueError):
            adaptation_curves(original, duration=duration, beat=0.5)


def test_headroom_preserves_endpoints_and_never_reverses_the_faders():
    measured = {'a': [[0, 1], [7, .9], [20, 0]], 'b': [[0, 0], [7, .4], [20, 1]]}
    plain = adaptation_curves(measured, duration=8, beat=.5)
    shaped = adaptation_curves(measured, duration=8, beat=.5, headroom_db=1.5)
    assert shaped['original'] == plain['original']
    for side, start, end in [('a', 1, 0), ('b', 0, 1)]:
        curve = shaped['reference'][side]
        assert curve[0] == [0, start] and curve[-1] == [8, end]
        assert all((v[1] - u[1]) * (end - start) >= 0 for u, v in zip(curve, curve[1:]))
    assert shaped['reference']['a'][1][1] < .9


def test_later_entry_reuses_the_observed_middle_of_the_transition():
    measured = {'a': [[0, 1], [4, .8], [8, .6], [12, .4], [16, 0]],
                'b': [[0, 0], [4, .3], [8, .6], [12, .8], [16, 1]]}
    shifted = adaptation_curves(measured, duration=4, beat=.5, offset=6)
    assert shifted['reference']['a'] == [[0,1],[2,.6],[4,0]]
    assert shifted['reference']['b'] == [[0,0],[2,.6],[4,1]]
    with pytest.raises(ValueError):
        adaptation_curves(measured, duration=4, beat=.5, offset=13)


def test_vocal_padding_uses_original_time_for_local_and_full_reports():
    from tools.dj_projects.approve_toucan_pair import vocal_window_safe

    report = {
        'analysisStart': 54,
        'vocals': [{'start_ms': 5724, 'end_ms': 6212}],
        'fullVocalActivity': {'intervals': [{'start_ms': 66200, 'end_ms': 66300}]},
    }
    assert not vocal_window_safe(report, 60.253, 62)
    assert vocal_window_safe(report, 62.127, 65.9)
    assert not vocal_window_safe(report, 62.127, 65.901)
