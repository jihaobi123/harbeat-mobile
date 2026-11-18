import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {canonicalJson} from '../vendor/realtime-v3/src/mobile/jetson-contract'
import {validateRole,verifyRoleHashes,roleIdentity,roleMeasurements} from '../vendor/realtime-v3/src/mobile/longmix/role-contract'

/** Stdio adapter uses the actual phone contract and ECMAScript JSON spelling. */
async function main(){
 const request=JSON.parse(fs.readFileSync(0,'utf8')),hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex'),digest=async(bytes:ArrayBuffer)=>createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
 if(request.action==='canonical'){const canonical=canonicalJson(request.value);process.stdout.write(JSON.stringify({canonical,sha256:hash(request.value)}));return}
 const value=validateRole(request.value)
 if(request.action==='seal'){
  // Never rewrite or repair an immutable base supplied by a measured audition.
  if(hash(value.base.scene)!==value.base.sceneSha256)throw Error('immutable base scene hash mismatch')
  value.evidence.arrangementSha256=hash(roleIdentity(value))
  value.evidence.measurementsSha256=hash(roleMeasurements(value))
  const {id,...body}=value;value.id=hash(body)
 }else if(request.action!=='check')throw Error('unknown role contract action')
 await verifyRoleHashes(value,digest)
 if(request.action==='check'){process.stdout.write(JSON.stringify({valid:true,id:value.id,mode:value.mode}));return}
 process.stdout.write(JSON.stringify({value,canonical:canonicalJson(value),sha256:hash(value),measurementCanonical:canonicalJson(roleMeasurements(value))}))
}
main().catch(error=>{process.stderr.write(String(error?.message??error)+'\n');process.exitCode=1})
