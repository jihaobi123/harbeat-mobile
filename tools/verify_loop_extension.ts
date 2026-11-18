import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {validateLoopIndex,validateLoop,verifyLoopTrack,loopBytes} from '../vendor/realtime-v3/src/mobile/longmix/loop-contract'
import {assessContinuation} from '../vendor/realtime-v3/src/mobile/set-continuity'
const [root,metadata]=process.argv.slice(2),rows=validateLoopIndex(JSON.parse(fs.readFileSync(path.join(root,'index.json'),'utf8'))),results=[]
for(const r of rows){const raw=fs.readFileSync(path.join(root,r.sha256+'.json'));if(crypto.createHash('sha256').update(raw).digest('hex')!==r.sha256)throw Error('immutable metadata hash mismatch');const p=validateLoop(JSON.parse(raw.toString())),detail=JSON.parse(fs.readFileSync(path.join(metadata,r.trackId+'-detail.json'),'utf8')),track=detail.track??detail;verifyLoopTrack(p,track);results.push({title:p.title,entry:p.startFrame/44100,sourceBound:true,loopFrames:p.lengthFrames,cycles16Seconds:16*p.lengthFrames/44100,retainedLoopBytes:loopBytes(p,16),postLoopAvailability:assessContinuation(track,(p.startFrame+p.lengthFrames)/44100)})}
const b=JSON.parse(fs.readFileSync(path.join(metadata,'track-8728534e623361f35870-detail.json'),'utf8')).track;const before=assessContinuation(b,255.2),earlier=assessContinuation(b,152.343673);if(before.allowed||!earlier.allowed)throw Error('real continued-set regression differs');console.log(JSON.stringify({results,continuedSetRegression:{oldEntrance:{position:255.2,...before},earlierEntrance:{position:152.343673,...earlier}}},null,2))
