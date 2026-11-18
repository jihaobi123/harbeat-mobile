import fs from 'node:fs'
import {validateMulti,multiBytes,multiIdentity} from '../vendor/realtime-v3/src/mobile/longmix/multi-contract'
import {jsonFingerprint} from '../vendor/realtime-v3/src/mobile/jetson-contract'
async function main(){for(const file of process.argv.slice(2)){const approval=validateMulti(JSON.parse(fs.readFileSync(file,'utf8')));if(await jsonFingerprint(multiIdentity(approval))!==approval.evidence.arrangementSha256)throw Error('Measured arrangement fingerprint mismatch');if(await jsonFingerprint(approval.base.scene)!==approval.base.sceneSha256)throw Error('AB canonical scene fingerprint mismatch');console.log(JSON.stringify({file,id:approval.id,sourceCount:2+Object.keys(approval.sources).length,retainedMiB:multiBytes(approval)/1024/1024,peak:approval.evidence.peak}))}}
main().catch(e=>{console.error(e);process.exitCode=1})
