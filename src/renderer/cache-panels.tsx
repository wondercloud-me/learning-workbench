import React from 'react';
import type { AppState } from '../core/state';
import { aggregateUsage, type UsageRecord } from '../core/usage';
import { contextDecision, compactableHistory, type ContextTurn } from '../core/context-cache';
import { Icon } from './shell';
const number=(n:number|null|undefined)=>n==null?'未提供':n.toLocaleString('zh-CN');
const rate=(n:number|null)=>n===null?'未提供':`${(n*100).toFixed(1)}%`;
const purpose={chat:'学习对话',side:'辅助对话',summary:'对话整理',test:'连接检查',agent:'项目 Agent'};
function Readings({records}:{records:UsageRecord[]}){
  const totals=aggregateUsage(records);const last=records.at(-1);const latest=aggregateUsage(last?[last]:[]);
  return <><div className="usage-grid"><span>输入 token<strong>{number(totals.inputTokens)}</strong></span><span>缓存读取<strong>{number(totals.cachedInputTokens)}</strong></span><span>缓存写入<strong>{number(totals.cacheWriteTokens)}</strong></span><span>输出 token<strong>{number(totals.outputTokens)}</strong></span><span>累计缓存读取比例<strong>{rate(totals.cacheRate)}</strong></span></div><small>{totals.requests} 次请求 · {totals.pairedRequests} 次提供可计算缓存比例的字段；缺失字段不按零计。</small>{last&&<p className="usage-last">最近：{purpose[last.purpose]} · 输入 {number(last.usage?.inputTokens)} · 缓存 {number(last.usage?.cachedInputTokens)} · 输出 {number(last.usage?.outputTokens)} · 比例 {rate(latest.cacheRate)}</p>}</>;
}
export function UsagePanel({state}:{state:AppState}){
  const groups=new Map<string,UsageRecord[]>();for(const r of state.usageRecords){const key=JSON.stringify([r.profileId,r.model]);groups.set(key,[...(groups.get(key)??[]),r]);}
  return <section className="panel-card cache-usage"><h2><Icon name="graph"/> 模型用量</h2><p>服务商实际返回的 token 记录。缓存读取已包含在输入中；当前不估算金额。</p>{!groups.size?<small>发送对话或测试连接后显示。服务商没有返回的字段显示“未提供”。</small>:[...groups].map(([key,records])=><div className="usage-group" key={key}><h3>{state.settings.modelLibrary.profiles.find(p=>p.id===records[0].profileId)?.name??records[0].profileId} / {records[0].model}</h3><Readings records={records}/></div>)}</section>;
}
export function ContextPanel({state,id,history,busy,onCompact}:{state:AppState;id:string;history:ContextTurn[];busy:boolean;onCompact:()=>void}){
  const context=state.contexts[id];const selected=state.settings.modelLibrary.active;const profile=state.settings.modelLibrary.profiles.find(p=>p.id===selected?.profileId);
  let manual=false;let pressure=false;let error='';
  try{const decision=selected?contextDecision(history,context?.checkpoint,profile?.contextWindows?.[selected.model],context?.lastInput,selected.profileId,selected.model):'none';manual=decision==='manual';pressure=decision==='pressure';}catch(e){error=String(e);}
  if(!context?.checkpoint&&!manual&&!pressure&&!error)return null;
  return <div className="context-status">{pressure&&<small>整理后近期内容仍接近窗口，已暂停自动重复整理。可以手动整理或切换更大窗口的模型。</small>}{error&&<small>{error}</small>}{manual&&<small>对话较长，当前缺少可信窗口或输入用量。可以手动整理较早对话。</small>}{context?.checkpoint&&<details><summary><Icon name="history"/> 查看较早对话摘要</summary><p className="context-summary">{context.checkpoint.summary}</p><small>原聊天与能力证据仍保留。摘要固定使用，达到阈值才再次整理。</small></details>}<button disabled={busy||!selected||!compactableHistory(history,context?.checkpoint).length} onClick={onCompact}><Icon name="fold"/> 整理较早对话</button><small>使用当前模型发送一次摘要请求，计入用量。</small></div>;
}
