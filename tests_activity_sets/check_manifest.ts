/** Operational check: stdin contains {manifest, tracks: Record<id, current Track>}.
 * Fetch authenticated metadata outside this process; never pass bearer tokens. */
import {readFileSync} from 'node:fs'
import {ActivitySession} from '../vendor/realtime-v3/src/mobile/activity-session'
const {manifest,tracks}=JSON.parse(readFileSync(0,'utf8'))
ActivitySession.open(manifest,'预约功能验收',async id=>tracks[id]).then(session=>{
 process.stdout.write(JSON.stringify({accepted:true,packId:session.packId,trackCount:session.ids.size,prepared:session.candidateCount,renderedResults:session.results.length,assetCount:session.assets().length,initialTrackId:session.initialTrackId}))
}).catch(error=>{process.stderr.write((error as Error).message+'\n');process.exitCode=1})
