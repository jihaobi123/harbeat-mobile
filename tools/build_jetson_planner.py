"""Bundle the exact shared source DSP/decision definitions for Node on Jetson."""
from pathlib import Path
import subprocess
import shutil
import hashlib
ROOT=Path(__file__).resolve().parents[1]
def main():
    node=shutil.which('node');esbuild=ROOT/'vendor/realtime-v3/node_modules/esbuild/lib/main.js'
    if not node or not esbuild.is_file():raise SystemExit('Install Node and run npm ci in vendor/realtime-v3')
    script="require(process.argv[1]).buildSync({entryPoints:[process.argv[2]],bundle:true,platform:'node',format:'esm',target:'node22',outfile:process.argv[3]})"
    # .cjs is the fixed deployment filename; wrap ESM's async entry as CJS.
    source=ROOT/'tools/jetson_plan.ts';text=source.read_text();imports=[];body=[]
    for line in text.splitlines():
        (imports if line.startswith('import ') else body).append(line)
    temp=ROOT/'tools/.jetson_plan_entry.ts';temp.write_text('\n'.join(imports)+'\n;(async()=>{\n'+'\n'.join(body)+'\n})().catch(e=>{process.stderr.write(String(e)+"\\n");process.exitCode=1})\n')
    try:
        script="require(process.argv[1]).buildSync({entryPoints:[process.argv[2]],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:process.argv[3],logLevel:'warning'})"
        out=ROOT/'tools/jetson-plan.cjs';subprocess.run([node,'--eval',script,str(esbuild),str(temp),str(out)],cwd=ROOT,check=True)
        print('Jetson planner SHA-256:',hashlib.sha256(out.read_bytes()).hexdigest())
    finally:temp.unlink(missing_ok=True)
if __name__=='__main__':main()
