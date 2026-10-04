import { tokenCount, type ModelUsage } from './providers';
export type UsagePurpose = 'chat'|'side'|'summary'|'agent'|'test';
export interface UsageRecord { id: string; createdAt: string; profileId: string; model: string; purpose: UsagePurpose; usage: ModelUsage | null }
export function usageRecord(profileId:string, model:string, purpose:UsagePurpose, usage:ModelUsage|null, createdAt:string, id:string): UsageRecord {
  return {id,createdAt,profileId,model,purpose,usage};
}
export function normalizeRecords(value: unknown): UsageRecord[] {
  if(!Array.isArray(value))return [];
  const ids=new Set<string>();const result:UsageRecord[]=[];
  for(const r of value){
    if(!r || typeof r!=='object' || !['id','createdAt','profileId','model'].every(k=>typeof r[k]==='string') || !['chat','side','summary','agent','test'].includes(r.purpose) || ids.has(r.id))continue;
    const u=r.usage;
    const usage=u && typeof u==='object'?{inputTokens:tokenCount(u.inputTokens),cachedInputTokens:tokenCount(u.cachedInputTokens),uncachedInputTokens:tokenCount(u.uncachedInputTokens),cacheWriteTokens:tokenCount(u.cacheWriteTokens),outputTokens:tokenCount(u.outputTokens)}:null;
    if(usage?.inputTokens!==null && usage?.cachedInputTokens!==null && usage && usage.cachedInputTokens>usage.inputTokens!)usage.cachedInputTokens=null;
    result.push(usageRecord(r.profileId,r.model,r.purpose,usage,r.createdAt,r.id));ids.add(r.id);
  }
  return result;
}
export function aggregateUsage(records:UsageRecord[]) {
  const sum=(field:keyof ModelUsage)=>{const values=records.map(r=>r.usage?.[field]).filter((n):n is number=>typeof n==='number');return values.length?values.reduce((a,b)=>a+b,0):null;};
  const pairs=records.filter(r=>r.usage?.inputTokens!=null && r.usage.cachedInputTokens!=null);
  const input=pairs.reduce((n,r)=>n+r.usage!.inputTokens!,0);
  return {inputTokens:sum('inputTokens'),cachedInputTokens:sum('cachedInputTokens'),cacheWriteTokens:sum('cacheWriteTokens'),outputTokens:sum('outputTokens'),cacheRate:input>0?pairs.reduce((n,r)=>n+r.usage!.cachedInputTokens!,0)/input:null,pairedRequests:pairs.length,requests:records.length};
}
