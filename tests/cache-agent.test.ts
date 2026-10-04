import {it,expect} from 'vitest';
import {runProjectAgent} from '../src/node/project-agent';
it('keeps full tool output in log but bounds model history and stays append-only',async()=>{
  const calls:any[]=[];const logs:string[][]=[];const original='中'.repeat(30000);
  const result=await runProjectAgent(['a.txt'],'read',async(_s,h)=>{calls.push(structuredClone(h));return JSON.stringify(calls.length===1?{action:'read',path:'a.txt'}:{action:'done',summary:'ok'});},{read:async()=>original,write:async()=>{},run:async()=>({code:0,output:''})},log=>logs.push(log));
  expect(result.join('')).toContain(original);expect(calls[1].at(-1).content).toContain('已省略');expect(new TextEncoder().encode(calls[1].at(-1).content).length).toBeLessThanOrEqual(32800);
  expect(calls[1].slice(0,1)).toEqual(calls[0]);expect(logs[0].join('')).toContain(original);
});
it('stops after eight model steps and exposes progress before a later error',async()=>{
  let count=0;const logs:any[]=[];
  const tools={read:async()=>'',write:async()=>{},run:async()=>({code:0,output:'full'})};
  const result=await runProjectAgent([],'x',async()=>{count++;return '{"action":"run","command":"echo x"}';},tools,log=>logs.push(log));
  expect(count).toBe(8);expect(result.at(-1)).toContain('8');expect(logs).toHaveLength(9);
  let n=0;await expect(runProjectAgent([],'x',async()=>{if(n++)throw Error('offline');return '{"action":"run","command":"echo x"}';},tools,log=>logs.push(log))).rejects.toThrow('offline');
  expect(logs.at(-1).join('')).toContain('full');
});
