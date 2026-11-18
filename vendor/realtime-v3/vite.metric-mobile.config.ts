import {defineConfig} from 'vite'
import fs from 'node:fs'
export default defineConfig({base:'./',publicDir:false,plugins:[{name:'metric-clock',closeBundle(){for(const name of ['v3-clock.js','v3-device-clock.js','device-atempo-worker.js'])fs.copyFileSync('public/'+name,'dist-metric-mobile/'+name);for(const name of ['device-tempo','transition-materials','drum-first'])fs.cpSync('public/'+name,'dist-metric-mobile/'+name,{recursive:true})}}],build:{outDir:'dist-metric-mobile',rollupOptions:{input:['metric-engine.html','longmix.html']}}})
