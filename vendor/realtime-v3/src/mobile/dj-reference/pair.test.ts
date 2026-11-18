import {describe, expect, it, vi} from 'vitest';
import {ListenTransport} from '../listen-transport';
import {pairPlan, validatePair} from './pair';
import {toucanCueList} from './set';
import type {Track} from '../../listen-upstream/realtime/planner';

const h = 'a'.repeat(64);
const provenance = {originalSha256:h, masterSha256:h, reportSha256:h, vocalSha256:h, runId:'run'};
const a:Track = {id:'a', title:'A', bpm:140, style:'House', styleScore:1, duration:360, native:{url:'/listen/media/a.flac', sha256:h,duration:360,bytes:1}, provenance, bars:[], sections:[], vocals:[], energy:[], windows:[]};
const b = {...a, id:'b'};
const evidence = {approved:true, sourceAligned:true, vocalSafe:true, compatibilityPass:true, peak:.81, melodyClash:.15, beatErrorMs:29, riseDb:1,
  reconstruction:{a:{errorRatio:.15,levelDeltaDb:0},b:{errorRatio:.15,levelDeltaDb:0}}};
const record = {schema:'harbeat.dj-pair-reference.v1', id:h, producer:'jetson', outputGain:.76, approved:true,
  sources:{a:{...provenance,trackId:'a',sourceStart:300},b:{...provenance,trackId:'b',sourceStart:100}},
  reference:{url:'https://example.test/set',coordinateProofSha256:h}, duration:12, rate:1,
  a:[[0,1],[1,.6],[12,0]], b:[[0,0],[1,.6],[12,1]], evidence};

describe('normal playback directed reference', () => {
  it('binds both complete source analyses and preserves the B body offset', () => {
    const p = validatePair(record);
    expect(pairPlan(p,a,b,280,40,true)?.window.end).toBe(112);
    expect(pairPlan(p,b,a,280,40,true)).toBeNull();
    expect(pairPlan(p,a,{...b,provenance:{...provenance,reportSha256:'b'.repeat(64)}},280,40,true)).toBeNull();
  });
  it('leaves a missed cue or insufficient time to the existing competition', () => {
    const p = validatePair(record);
    expect(pairPlan(p,a,b,300,40,true)).toBeNull();
    expect(pairPlan(p,a,b,280,18,false)).toBeNull();
    expect(pairPlan(p,{...a,duration:750},b,280,500,true)).toBeNull();
    expect(pairPlan(p,a,{...b,duration:114},280,40,true)).toBeNull();
  });
  it('rejects missing or unsafe evidence and invalid curves', () => {
    for (const key of ['peak','melodyClash','beatErrorMs','riseDb']) {
      expect(() => validatePair({...record,evidence:{...evidence,[key]:100}})).toThrow();
    }
    expect(() => validatePair({...record,evidence:{...evidence,vocalSafe:false}})).toThrow();
    expect(() => validatePair({...record,a:[[0,1],[1,.2],[2,.4],[12,0]]})).toThrow();
  });
});

it('offers an audition only for a verified Set successor and a usable entrance',()=>{
  const p=validatePair(record);
  expect(toucanCueList([a,b],[p])).toEqual([{slot:1,from:a.title,to:b.title,position:290}]);
  expect(toucanCueList([b,a],[p])).toEqual([]);
  expect(toucanCueList([a,b],[p],true)).toEqual([]);
});

it('passes an unavailable prepared reference to the ordinary planner', async () => {
  const competition = {prepare:vi.fn(async () => 'b'),request:vi.fn(async () => {})};
  const host = {
    cancelPreparation:vi.fn(),preparePair:vi.fn().mockResolvedValueOnce('b').mockResolvedValueOnce(null),
    competition,pairSession:{arm:vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)},
    gate:{locked:false}, creativeRequestRevision:0, playing:true, notify:vi.fn(),
  };
  const select = ListenTransport.prototype.prepareNext.bind(host as unknown as ListenTransport);
  await select('b');
  expect(competition.prepare).not.toHaveBeenCalled();
  await select('b');
  expect(competition.prepare).toHaveBeenCalledWith(['b'], false, 30);
  const request = ListenTransport.prototype.request.bind(host as unknown as ListenTransport);
  await request({kind:'next',targetId:'b'},18);
  expect(competition.request).not.toHaveBeenCalled();
  await request({kind:'next',targetId:'b'},18);
  expect(competition.request).toHaveBeenCalledWith('b',18,false);
});

it('passes the reference through to its target continuation check in the Android continuous set', async () => {
  const {preparePair} = ListenTransport.prototype as unknown as {
    preparePair(ids:string[], automatic:boolean, budget:number):Promise<string|null>;
  };
  const prepare = vi.fn(async () => 'b');
  const host = {current:a,position:280,sessionContinuity:{enabled:true},
    loopExtensionStatus:{enabled:false},pairSession:{prepare}};
  expect(await preparePair.call(host,['b'],true,0)).toBe('b');
  expect(prepare).toHaveBeenCalledWith(['b'],true,79.9,undefined);
});

it('does not load reference audio when the automatic target lacks continuation evidence', async () => {
  const {PairSession} = await import('./pair-session');
  const log = vi.fn(), continuation = vi.fn(() => false);
  const host = {active:{track:a},tracks:[a,b],position:280,log};
  const session = new PairSession(host as unknown as ListenTransport,[validatePair(record)],continuation);
  expect(await session.prepare(['b'],true,80)).toBeNull();
  expect(continuation).toHaveBeenCalledWith(b,112);
  expect(log).toHaveBeenCalledWith('dj_pair_reference_fallback',expect.objectContaining({to:'b'}));
});

it('keeps the cue and names the HarBeat technique independently from DJ automation', () => {
  const gradual = validatePair({...record,technique:'cue-gradual'});
  const eq = validatePair({...record,technique:'cue-low-eq',eq:{releaseSec:.8}});
  expect(pairPlan(gradual,a,b,280,40,true)).toMatchObject({
    start:300,window:{start:100,end:112,role:'cue-gradual'},
  });
  expect(pairPlan(eq,a,b,280,40,true)).toMatchObject({
    start:300,window:{start:100,end:112,role:'cue-low-eq'},
  });
  expect(() => validatePair({...record,technique:'cue-low-eq'})).toThrow();
  expect(() => validatePair({...record,technique:'cue-low-eq',eq:{releaseSec:20}})).toThrow();
  expect(() => validatePair({...record,technique:'cue-stem-unreviewed'})).toThrow();
});

it('warms a learned reference only for the ordinary automatic winner and keeps the winner when the reference cannot load', async () => {
  const reference=validatePair(record);
  const competition={prepare:vi.fn(async ()=>'c'),automaticStart:299,upcoming:null};
  const preparePair=vi.fn(async (_ids:string[], _automatic:boolean, _budget:number, _accept:(r:typeof reference)=>boolean)=>null);
  const nearbyLearnedPair=vi.fn((id:string)=>id==='b'?reference:undefined);
  const host={cancelPreparation:vi.fn(),learnedPairs:new Map([['b',[reference]]]),preparePair,competition,nearbyLearnedPair};
  const prepare=ListenTransport.prototype.prepareAutomatic.bind(host as unknown as ListenTransport);
  expect(await prepare(['b','c'])).toBe('c');
  expect(preparePair).toHaveBeenCalledTimes(1);
  expect(preparePair.mock.calls[0][3](reference)).toBe(false);
  competition.prepare.mockResolvedValueOnce('b');
  expect(await prepare(['b','c'])).toBe('b');
  expect(preparePair).toHaveBeenLastCalledWith(['b'],true,0,expect.any(Function));
  expect(preparePair.mock.calls.at(-1)![3](reference)).toBe(true);
});
