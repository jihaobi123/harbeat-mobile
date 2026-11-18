# -*- coding: utf-8 -*-
"""Create a local listening board from measured, product-graph comparison audio."""
import argparse
import html
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    root = parser.parse_args().root
    data = json.loads((root / 'real-corpus.json').read_text())
    assert data['complete'] and len(data['pairs']) >= 20
    methods = [m for p in data['pairs'] for m in p['methods']]
    labels = {'structural': '段落接歌 · 下一首原速', 'echo': '旧歌回声收尾 · 下一首原速', 'legacy': '原有渐进方案 · 进入段变速'}
    rows = []
    for pair in data['pairs']:
        a, b = pair['a'], pair['b']
        cells = []
        for method in pair['methods']:
            cells.append('<div><b>' + labels[method['family']] + '</b><p>峰值 ' + format(method['peakDbfs'], '.2f') + ' dBFS；交接位于片段 ' + format(method['contextHandoff'], '.2f') + ' 秒</p><audio controls preload="none" src="' + method['file'] + '"></audio></div>')
        if not pair['legacyAvailable']:
            reasons = '；'.join(sorted({v['reason'] for v in pair['legacyExclusions'] if v['code'] != 'current_track'}))
            cells.append('<div><b>原有渐进方案</b><p>本次原规则未找到可执行方案：' + html.escape(reasons) + '</p></div>')
        rows.append('<section><h2>' + pair['id'] + ' · ' + html.escape(a['title']) + ' → ' + html.escape(b['title']) + '</h2><p>' + html.escape(a['style']) + ' ' + str(a['bpm']) + ' BPM → ' + html.escape(b['style']) + ' ' + str(b['bpm']) + ' BPM</p><div class="grid">' + ''.join(cells) + '</div></section>')
    text = '''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HarBeat 跨风格混音对比试听</title><style>body{max-width:1180px;margin:30px auto;padding:0 20px;background:#f6f6ef;color:#1c2c24;font:16px/1.6 system-ui}h1{font-size:30px}h2{font-size:20px}section{margin:24px 0;padding:20px;background:#fff;border:1px solid #d2dacd;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}audio{width:100%}p{color:#586a58}</style><h1>HarBeat 跨风格混音对比试听</h1><p>20 组歌曲，33 个片段。段落与回声方案使用手机中的同一音频调度函数。7 个原有渐进片段保留原选点、EQ 和淡入淡出；其变速进入段由原生 FFmpeg 按手机 Worker 相同的参数生成，FFmpeg 构建版本不同。所有片段均为限幅器前的数值验证，未做听感评分。</p><p>先听交接前后的鼓点、人声句子、音量与能量变化。每种方法可能选择不同接点，应比较衔接效果。音频保存在本机，未上传试听片段到公网。</p>''' + ''.join(rows) + '</html>'
    (root / '试听对比.html').write_text(text)
    summary = dict(pairs=len(data['pairs']), renders=len(methods), clipFree=all(m['clipFree'] for m in methods), maxPeak=max(m['peak'] for m in methods), subjectiveListening='unscored')
    (root / 'technical-summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
