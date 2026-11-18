"""Capture public catalog metadata, without downloading source audio."""
import argparse
import concurrent.futures
import json
import ssl
import urllib.parse
import urllib.request
from pathlib import Path


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    origin='https://8.136.120.255';ctx=ssl._create_unverified_context()
    def read(url):
        with urllib.request.urlopen(url,context=ctx,timeout=30) as response:return json.load(response)
    sources=[origin+'/listen/library.json',origin+'/analysis-lab-static/mobile-library-v1/library.json'];entries={}
    for source in sources:
        for row in read(source)['tracks']:
            if row['playStatus']=='ready' and row['mixStatus']=='ready' and row['id'] not in entries:
                entries[row['id']]={**row,'resolvedDetailUrl':urllib.parse.urljoin(source,row['detailUrl'])}
    def load(row):
        track=read(row['resolvedDetailUrl'])['track']
        if track['id']!=row['id']:raise ValueError('detail identity mismatch')
        return {**track,'styleLabels':row['styleLabels'],'collection':row['collection']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:tracks=list(pool.map(load,entries.values()))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(dict(schema='harbeat.crossgenre-catalog-snapshot.v1',tracks=tracks),ensure_ascii=False,separators=(',',':')))
    print(json.dumps(dict(tracks=len(tracks),bytes=args.output.stat().st_size)))


if __name__=='__main__':main()
