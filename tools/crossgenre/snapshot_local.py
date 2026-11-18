"""Read trusted published catalog files locally, without repeated HTTP relay reads."""
import argparse
import json
from pathlib import Path


def collect(root,prefix):
    result=[];root=root.resolve()
    for row in json.loads((root/'library.json').read_bytes())['tracks']:
        if row['playStatus']!='ready' or row['mixStatus']!='ready':continue
        relative=row['detailUrl']
        if relative.startswith(prefix):relative=relative[len(prefix):]
        path=(root/relative).resolve()
        if root not in path.parents:raise ValueError('unsafe detail path')
        t=json.loads(path.read_bytes())['track']
        if t['id']!=row['id']:raise ValueError('detail identity mismatch')
        t['windows']=[{**w,'variants':{}} for w in t['windows']]
        t['alignment']={k:v for k,v in t.get('alignment',{}).items() if k in ['schema','status','source','bars','exits','phrases']}
        t['styleLabels']=row['styleLabels'];t['collection']=row['collection'];t['detailUrl']=row['detailUrl']
        result.append(t)
    return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--primary',type=Path);p.add_argument('--extra',type=Path);p.add_argument('--merge',type=Path);p.add_argument('--output',type=Path)
    args=p.parse_args();rows={}
    if args.merge:
        for t in json.loads(args.merge.read_bytes())['tracks']:rows[t['id']]=t
    for root,prefix in [(args.primary,'/listen/'),(args.extra,'/analysis-lab-static/mobile-library-v1/')]:
        if root:
            for t in collect(root,prefix):
                if root==args.primary:rows[t['id']]=t
                else:rows.setdefault(t['id'],t)
    raw=json.dumps(dict(schema='harbeat.crossgenre-catalog-snapshot.v1',tracks=list(rows.values())),ensure_ascii=False,separators=(',',':'))
    if args.output:args.output.write_text(raw)
    else:print(raw)


if __name__=='__main__':main()
