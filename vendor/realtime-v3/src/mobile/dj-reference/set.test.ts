import {expect,it,vi} from 'vitest';
import {OrderedDjSet} from './set';

const tracks = ['a','b','c'].map(id => ({id,title:id,duration:100})) as any[];
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
function setup() {
  const host:any = {
    current:tracks[0], position:0, playing:true, pending:null,
    readySetPair:vi.fn(async()=>null), armSetPair:vi.fn(()=>false),
    queueSetContinuation:vi.fn(async()=>{}), log:vi.fn(),
  };
  return {host,set:new OrderedDjSet(tracks,host,vi.fn(),vi.fn())};
}

it('commits the fixed successor and completes only after the final original ends',async()=>{
  const {host,set}=setup();
  set.tick();
  await flush();
  expect(host.readySetPair).toHaveBeenCalledWith('b');
  host.position=92;set.tick();await flush();
  expect(host.queueSetContinuation).toHaveBeenCalledWith(tracks[1],expect.any(AbortSignal));
  host.current=tracks[1];host.position=0;set.tick();await flush();
  expect(host.readySetPair).toHaveBeenLastCalledWith('c');
  host.current=tracks[2];host.position=0;set.tick();
  expect(set.snapshot()).toMatchObject({slot:3,total:3,state:'playing'});
  host.current=null;set.tick();
  expect(set.snapshot()).toMatchObject({slot:3,total:3,state:'complete'});
  expect(host.readySetPair).toHaveBeenCalledTimes(2);
});

it('arms an approved pair at its cue and uses the same successor if arming fails',async()=>{
  const {host,set}=setup();
  host.readySetPair.mockResolvedValue({start:70});
  set.tick();await flush();host.position=63;set.tick();await flush();
  expect(host.armSetPair).toHaveBeenCalledWith('b');
  expect(host.queueSetContinuation).not.toHaveBeenCalled();
  host.position=92;set.tick();await flush();
  expect(host.queueSetContinuation).toHaveBeenCalledWith(tracks[1],expect.any(AbortSignal));
});

it('never skips an unavailable source or accepts an unrelated takeover',async()=>{
  const {host,set}=setup();
  set.tick();await flush();
  host.current=tracks[2];set.tick();
  expect(set.snapshot()).toMatchObject({slot:1,total:3,state:'blocked'});
  expect(host.queueSetContinuation).not.toHaveBeenCalled();
});

it('starts an audition at a later slot and still takes the immediate Set successor',async()=>{
  const {host}=setup();
  host.current=tracks[1];
  const set=new OrderedDjSet(tracks,host,vi.fn(),vi.fn(),1);
  set.tick();await flush();
  expect(set.snapshot()).toMatchObject({slot:2,total:3,state:'playing'});
  expect(host.readySetPair).toHaveBeenCalledWith('c');
});
