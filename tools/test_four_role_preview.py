import json,pathlib,subprocess,tempfile,unittest

class PreviewClockTests(unittest.TestCase):
    def test_source_entry_uses_producer_pcm_frame(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='four-role-entry-') as d:
            module=pathlib.Path(d)/'runtime.cjs'
            subprocess.run([str(root/'vendor/realtime-v3/node_modules/.bin/esbuild'),str(root/'tools/four-role-preview/runtime.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(module)],check=True,capture_output=True)
            program="""const assert=require('assert/strict'),r=require(process.argv[1]);
            const entry=12*60/107.1,pcmEntry=Math.round(entry*44100)/44100,calls=[];
            const ctx={sampleRate:44100,createBufferSource:()=>({connect(){},disconnect(){},start(...args){calls.push(args)},stop(){}}),createGain:()=>({connect(){},disconnect(){},gain:{setValueAtTime(){},linearRampToValueAtTime(){}}})};
            const scene={base:{scene:{sourceGains:{b:1},outputGain:.475,exits:[{fadeStart:20,at:24}]}},stages:[{layers:[{key:'c.other',source:'c',loop:false,outputStart:entry,gain:.25,points:[[0,0],[entry,0],[entry+1,1],[20,0],[24,0]]}]}]};
            const pcm=new Map([['c.other',{duration:5}]]);
            r.schedule(ctx,{},scene,0,pcm,2,0,0);
            assert.equal(calls[0][0],2+pcmEntry);
            r.schedule(ctx,{},scene,0,pcm,2,entry+1,0);
            assert.equal(calls[1][1],entry+1-pcmEntry);
            """
            subprocess.run(['node','-e',program,str(module)],check=True,capture_output=True)

    def test_dynamic_duration_and_seek_version_clock(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='four-role-clock-') as d:
            module=pathlib.Path(d)/'runtime.cjs'
            subprocess.run([str(root/'vendor/realtime-v3/node_modules/.bin/esbuild'),str(root/'tools/four-role-preview/runtime.ts'),'--bundle','--platform=node','--format=cjs','--outfile='+str(module)],check=True,capture_output=True)
            program="""const assert=require('assert/strict'),r=require(process.argv[1]);
            for(const [bpm,duration] of [[90,42.666667],[98,39.183673],[110,34.909091]]){
              const scene={bpm,duration,base:{scene:{bpm,duration,exits:[{at:duration/2},{at:duration*.75},{at:duration}]}}};
              assert.equal(r.sceneDuration(scene),duration);
              assert.equal(r.playbackPosition(60,40,duration),20);
              assert.equal(r.playbackPosition(100,40,duration),duration);
              assert.equal(r.playbackPosition(39,40,duration),0);
              assert.equal(r.formatClock(duration),bpm===90?'0:42':bpm===110?'0:34':'0:39');
            }
            assert.throws(()=>r.sceneDuration({duration:39.183673,bpm:90,base:{scene:{duration:42.666667,bpm:90,exits:[]}}}));
            """
            subprocess.run(['node','-e',program,str(module)],check=True,capture_output=True)

if __name__=='__main__':unittest.main()
