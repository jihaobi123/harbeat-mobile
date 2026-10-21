import {defineConfig} from 'vite'
import fs from 'node:fs'
export default defineConfig({base:'./',publicDir:false,plugins:[{name:'metric-clock',closeBundle(){for(const name of ['v3-clock.js','v3-device-clock.js'])fs.copyFileSync('public/'+name,'dist-metric-mobile/'+name)}}],build:{outDir:'dist-metric-mobile',rollupOptions:{input:'metric-engine.html'}}})
