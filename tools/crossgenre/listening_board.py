# -*- coding: utf-8 -*-
"""Build a standalone, source-bound blind listening/feedback board."""
import argparse,hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
def main():
    p=argparse.ArgumentParser();p.add_argument('root',type=pathlib.Path);r=p.parse_args().root.resolve();data=json.load(open(r/'real-corpus.json'))
    assert data['complete'] and 20<=len(data['pairs'])<=30
    for pair in data['pairs']:
        pair['unavailable']=[]
        available={m['family'] for m in pair['methods']}
        if 'legacy' not in available:
            reasons=sorted(set(x['reason'] for x in pair['legacyExclusions'] if x['code']!='current_track'))
            pair['unavailable'].append({'family':'legacy','reason':'; '.join(reasons)})
        if 'echo' not in available:pair['unavailable'].append({'family':'echo','reason':'No source-bound echo cue passed vocal, capture and headroom gates.'})
        for method in pair['methods']:
            file=(r/method['file']).resolve();assert file.parent==r
            raw=file.read_bytes();sha=hashlib.sha256(raw).hexdigest();name=file.stem+'-'+sha[:12]+'.wav';dest=r/name
            if dest.exists():assert dest.read_bytes()==raw
            else:dest.write_bytes(raw)
            method.update(sha256=sha,immutableFile=name,bytes=len(raw))
    encoded=json.dumps(data,ensure_ascii=False,separators=(',',':'));data['fingerprint']=hashlib.sha256(encoded.encode()).hexdigest()
    (r/'listening-manifest.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
    script=r/'board.js';subprocess.run([str(ROOT/'vendor/realtime-v3/node_modules/.bin/esbuild'),str(ROOT/'vendor/realtime-v3/src/mobile/audition/board.ts'),'--bundle','--format=iife','--outfile='+str(script)],check=True)
    text='''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HarBeat 24组跨风格盲听</title><style>body{max-width:1200px;margin:32px auto;padding:0 20px;background:#f6f6ef;color:#1c2c24;font:16px/1.6 system-ui}h1{font-size:30px}h2{font-size:20px}section{margin:24px 0;padding:20px;background:white;border:1px solid #d2dacd;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}audio,textarea{width:100%;box-sizing:border-box}label{display:block;margin:8px 0}button,select{font:inherit;padding:6px 10px;margin:4px}textarea{min-height:80px}p{color:#586a58}</style><h1>24 组跨风格混音盲听</h1><p>每类六组：近速度且鼓重音不同、大速度跨度、人声密集、半／双拍比例候选。比较原有渐进方案、段落短切与回声收尾；不合格版本显示原因。各方法可选择不同接点，音频是限幅前的产品调度图输出，听感尚未评分。</p><p>先听 A/B/C 再揭晓方法。评分 1 为差，5 为好；未评分保持未知。记录实际听过的区间和源文件身份，保存在本机。</p><label>你的 DJ 经验 <select id="dj-experience"><option value="unspecified">未填写</option><option value="listener">音乐／舞蹈爱好者</option><option value="learning">正在学习 DJ</option><option value="practicing-dj">有实际 DJ 演出经验</option></select></label><button id="export">导出本轮与历史记录</button><button id="new-round">归档并开始新一轮</button><p id="save-status"></p><main id="pairs"></main><script>window.HARBEAT_AUDITION='''+json.dumps(data,ensure_ascii=False,separators=(',',':')).replace('</','<\/')+';</script><script>'+script.read_text().replace('</','<\/')+'</script></html>'
    (r/'index.html').write_text(text);(r/'24-pair-audition.html').write_text(text)
    summary={'pairs':len(data['pairs']),'renders':sum(len(p['methods']) for p in data['pairs']),'cohorts':{c:sum(p['cohort']==c for p in data['pairs']) for c in ['near-groove','large-gap','dense-vocals','half-double']},'clipFree':all(m['clipFree'] for p in data['pairs'] for m in p['methods']),'subjectiveListening':'unscored','fingerprint':data['fingerprint']}
    (r/'technical-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
if __name__=='__main__':main()
