import {defineConfig} from 'vite'
import fs from 'node:fs'
export default defineConfig({base:'./',publicDir:false,plugins:[{name:'metric-clock',closeBundle(){fs.copyFileSync('public/v3-clock.js','dist-metric-mobile/v3-clock.js')}}],build:{outDir:'dist-metric-mobile',rollupOptions:{input:'metric-engine.html'}}})
