import {randomUUID} from 'node:crypto';

export type QuitPorts={
 requestFlush(token:string):void|Promise<void>;
 flush():Promise<void>;
 confirmDiscard(error:Error):Promise<boolean>;
 finish():void|Promise<void>;
 release(token:string):void|Promise<void>;
 timeoutMs?:number;
};
export type QuitCoordinator={request():Promise<void>;acknowledge(token:string,error?:string):boolean};
const asError=(error:unknown):Error=>error instanceof Error?error:Error(String(error));

/** Main verifies IPC trust and generation before forwarding an acknowledgement. */
export function createQuitCoordinator(ports:QuitPorts):QuitCoordinator {
 let inFlight:Promise<void>|undefined;
 let current:{token:string;ack(error?:string):boolean}|undefined;
 const timeoutMs=ports.timeoutMs??15000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('退出等待时间必须大于零。');
 return {
  request() {
   if(inFlight)return inFlight;
   const token=randomUUID();let accepting=true;let settle!:(error?:Error)=>void;
   const acknowledged=new Promise<Error|undefined>(resolve=>{settle=resolve;});
   const stop=()=>{accepting=false;clearTimeout(timer);};
   const accept=(error?:Error):boolean=>{if(!accepting)return false;stop();settle(error);return true;};
   const timer=setTimeout(()=>accept(Error('等待页面确认草稿保存超时。')),timeoutMs);
   current={token,ack:error=>accept(error===undefined?undefined:Error(error||'页面未确认草稿已保存。'))};
   // Scheduling publishes inFlight before a synchronous port can reenter request().
   inFlight=Promise.resolve().then(async()=>{
    let finished=false;
    try {
     try {
      Promise.resolve(ports.requestFlush(token)).catch(error=>{accept(asError(error));});
      const error=await acknowledged;if(error)throw error;
      await ports.flush();
     } catch(error) {
      stop();
      if(!await ports.confirmDiscard(asError(error)))return;
     }
     await ports.finish();finished=true;
    } finally {stop();if(!finished)await ports.release(token);}
   }).finally(()=>{current=undefined;inFlight=undefined;});
   return inFlight;
  },
  acknowledge(token,error) {return current?.token===token?current.ack(error):false;},
 };
}
