import {defineConfig} from 'vite'
import {resolve} from 'node:path'
export default defineConfig({base:'./',build:{outDir:'dist-drum-prelude',emptyOutDir:true,rollupOptions:{input:{audition:resolve(__dirname,'drum-prelude-audition.html'),check:resolve(__dirname,'drum-prelude-check.html')}}}})
