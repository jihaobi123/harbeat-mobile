import {describe,it,expect} from 'vitest'
import {validateScene,chooseExit,sceneBytes} from './contract'
import {fixture} from './fixture'
describe('isolated scene contract',()=>{
 it('accepts bounded source-bound two-source approval',()=>expect(validateScene(fixture()).duration).toBe(40))
 it.each(['producer','scope','approved'])('rejects unapproved authority %s',key=>{const p=fixture();p[key]=false;expect(()=>validateScene(p)).toThrow()})
 it('rejects third source and repeated source identity',()=>{const p=fixture();p.sources.c=p.sources.a;expect(()=>validateScene(p)).toThrow();delete p.sources.c;p.sources.b=p.sources.a;expect(()=>validateScene(p)).toThrow()})
 it('rejects oversized speed, invalid source fingerprint and coverage',()=>{for(const mutate of [(p:any)=>p.rate=1.2,(p:any)=>p.sources.a.masterSha256='bad',(p:any)=>p.clips.bEnd=20]){const p=fixture();mutate(p);expect(()=>validateScene(p)).toThrow()}})
 it('rejects a singing source exit and incomplete entry',()=>{for(const key of ['aVocalSilent','bEntryComplete']){const p=fixture();p.evidence[key]=false;expect(()=>validateScene(p)).toThrow()}})
 it('rejects simultaneous full low frequency and out of range curves',()=>{const p=fixture();p.layers.find((l:any)=>l.side==='b'&&l.role==='bass').points=[[0,1],[40,1]];expect(()=>validateScene(p)).toThrow()})
 it('rejects false exit coordinates and missing exit',()=>{const p=fixture();p.exits[0].bPosition=0;expect(()=>validateScene(p)).toThrow();p.exits=[];expect(()=>validateScene(p)).toThrow()})
 it('chooses nearest exit whose full fade remains in the future',()=>{const p=validateScene(fixture());expect(chooseExit(p,5)?.at).toBe(20);expect(chooseExit(p,18)?.at).toBe(30);expect(chooseExit(p,39)).toBeNull()})
 it('computes buffer budget including retained source, guide and body',()=>{expect(sceneBytes(fixture(),'long')).toBeGreaterThan(50*1024*1024);expect(sceneBytes(fixture(),'long')).toBeLessThan(96*1024*1024)})
 it('does not permit A vocals to loop',()=>{const p=fixture();p.layers.push({side:'a',role:'vocals',loop:true,points:[[0,1],[40,0]]});expect(()=>validateScene(p)).toThrow()})
})
