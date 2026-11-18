import type {StemIndex} from './stem-mix/preparation'

/** Publication metadata only. Source identity, musical eligibility and decoded
 * PCM are still checked by the existing preparation and execution gates. */
export function sourcePublication(id:string,index:StemIndex|null|undefined){
 if(!index)return {state:'unknown',label:'分轨状态待查询',reason:'分轨发布目录暂不可用，不能判断素材是否已发布'}
 const row=index.tracks.find(t=>t.trackId===id)
 if(!row)return {state:'not-published',label:'分轨分析未发布',reason:'当前曲目没有对应的分轨执行档案；不代表 Jetson 上没有其他分析结果'}
 if(!row.assetsReady)return {state:'profile-only',label:'分轨分析已发布 · 音频待发布',reason:'已有声部分析档案，完整分轨音频尚未发布到播放端'}
 return {state:'published',label:'分轨音频已发布 · 接点待核验',reason:'发布目录已有完整分轨；实际使用仍须通过同源身份、曲对、接点和本机缓冲校验'}
}
