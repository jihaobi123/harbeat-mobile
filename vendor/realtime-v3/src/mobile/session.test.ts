import {describe,it,expect,vi} from 'vitest'
import {MobileSession} from './session'
function fixture(){
 const p:any={initialize:vi.fn(async()=>{}),start:vi.fn(async()=>{}),stop:vi.fn(),dispose:vi.fn(),cancel:vi.fn(),log:vi.fn(),active:{},busy:false,paused:false,ctx:{state:'running',suspend:vi.fn(async()=>{})},export:()=>({schema:'harbeat.v3_live_session.v2'}),togglePause:vi.fn(async()=>{})}
 const host={requestFocus:vi.fn(()=>true),saveSession:vi.fn(),exportLog:vi.fn(),close:vi.fn()}
 const s=new MobileSession([],vi.fn(),new URL('https://appassets.androidplatform.net/assets/realtime/'),host,()=>p)
 return {p,host,s}
}
describe('mobile lifecycle',()=>{
 it('suspends the shared audio clock and does not automatically resume on foreground',async()=>{const {s,p,host}=fixture();await s.start('a');await s.pauseForHost();expect(p.ctx.suspend).toHaveBeenCalled();expect(p.paused).toBe(true);expect(host.saveSession).toHaveBeenCalled();s.enterForeground();expect(p.togglePause).not.toHaveBeenCalled();await s.togglePause();expect(p.togglePause).toHaveBeenCalledTimes(1)})
 it('cannot start after an initialization resolves in the background',async()=>{const {s,p}=fixture();let ready!:()=>void;p.initialize.mockImplementation(()=>new Promise<void>(r=>ready=r));const start=s.start('a');await s.pauseForHost();ready();await start;expect(p.start).not.toHaveBeenCalled()})
 it('invalidates an in-flight first-track decode when backgrounded',async()=>{const {s,p}=fixture();await s.start('a');p.active=null;p.busy=true;await s.pauseForHost();expect(p.stop).toHaveBeenCalled();expect(p.ctx.suspend).toHaveBeenCalled()})
 it('cancels preparation while preserving an active deck for manual resume',async()=>{const {s,p}=fixture();await s.start('a');p.busy=true;await s.pauseForHost();expect(p.cancel).toHaveBeenCalled();expect(p.stop).not.toHaveBeenCalled();expect(p.paused).toBe(true)})
 it('does not play or resume without native audio focus',async()=>{const {s,p,host}=fixture();host.requestFocus.mockReturnValue(false);await expect(s.start('a')).rejects.toThrow();expect(p.initialize).not.toHaveBeenCalled();host.requestFocus.mockReturnValue(true);await s.start('a');await s.pauseForHost();host.requestFocus.mockReturnValue(false);await expect(s.togglePause()).rejects.toThrow();expect(p.togglePause).not.toHaveBeenCalled()})
 it('lets a user resume after a transient focus interruption once focus is granted',async()=>{const {s,p}=fixture();await s.start('a');await s.pauseForHost();await s.togglePause();expect(p.togglePause).toHaveBeenCalled();expect(s.foreground).toBe(true)})
})
