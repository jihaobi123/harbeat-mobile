"""Build the checked-in CPU-only reservation planner on macOS/Windows/Linux."""
from pathlib import Path
import shutil
import subprocess


def main():
    root=Path(__file__).resolve().parents[1]
    node=shutil.which('node')
    esbuild=root/'vendor/realtime-v3/node_modules/esbuild/lib/main.js'
    if node is None or not esbuild.is_file():
        raise SystemExit('Install Node.js, then run npm ci in vendor/realtime-v3 first.')
    script="require(process.argv[1]).buildSync({entryPoints:[process.argv[2]],bundle:true,platform:'node',format:'cjs',target:'node12',outfile:process.argv[3],logLevel:'warning'})"
    subprocess.run([node,'--eval',script,str(esbuild),str(root/'tools/activity_set_plan.ts'),str(root/'tools/activity_set_plan.cjs')],cwd=root,check=True)


if __name__=='__main__':main()
