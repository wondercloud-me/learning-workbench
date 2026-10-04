import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {ModelRuntime} from '../src/node/model-runtime';
import {runConversation} from '../src/node/conversation';
it('two local protocols keep shared prefixes, summary isolation and model attribution',async()=>{
  const captured:any[]=[];
  const servers=await Promise.all(['responses','chat'].map(async protocol=>{
    const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);captured.push({protocol,body});const summary=(body.instructions??body.messages?.[0]?.content??'').includes('整理较早');
      res.setHeader('content-type','application/json');res.end(JSON.stringify(protocol==='responses'?{output_text:summary?'summary':'reply',usage:{input_tokens:100,input_tokens_details:{cached_tokens:0},output_tokens:10}}:{choices:[{message:{content:'reply'}}],usage:{prompt_tokens:200,prompt_cache_hit_tokens:150,prompt_cache_miss_tokens:50,completion_tokens:20}}));});
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return server;
  }));
  try{
    const profiles=servers.map((s,i)=>({id:String(i),name:String(i),baseUrl:`http://127.0.0.1:${(s.address() as AddressInfo).port}`,protocol:i?'chat' as const:'responses' as const,models:['m','other']}));
    const runtime=new ModelRuntime();profiles.forEach(p=>runtime.setKey(p,'dummy-key'));
    const history=Array.from({length:30},(_,i)=>({id:String(i),role:'user' as const,content:`original ${i}`}));
    const requests:any[]=[];let context:any={};
    const send=async(index:number,model:string,task:string)=>runConversation({history,system:'fixed',task,context,profileId:profiles[index].id,model},async(system,turns,purpose)=>{const snapshot=runtime.snapshot({profiles,active:{profileId:profiles[index].id,model}});const reply=await snapshot.chatDetailed(system,turns);requests.push({profileId:snapshot.profile.id,model:snapshot.settings.model,purpose,usage:reply.usage});return reply;},async c=>{context=c;});
    await send(0,'m','planning');await send(0,'m','verify');
    expect(captured[0].body.instructions).toBe(captured[1].body.instructions);expect(captured[0].body.input.slice(0,-1)).toEqual(captured[1].body.input.slice(0,-1));
    expect(captured[1].body.input).toHaveLength(31);
    await send(1,'other','side task');expect(requests.at(-1)).toMatchObject({profileId:'1',model:'other',usage:{cachedInputTokens:150}});
    expect(captured.at(-1).body.messages[0]).toEqual({role:'system',content:'fixed'});
    expect(captured.at(-1).body.messages.some((m:any)=>Object.hasOwn(m,'id'))).toBe(false);
  }finally{await Promise.all(servers.map(s=>new Promise<void>(r=>s.close(()=>r()))));}
});
