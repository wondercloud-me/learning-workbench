import type {LabTask} from '../data/practice-units';
import type {LabRun} from '../core/lab';
/** A fresh worker for each run is also the hard stop for loading and VM failure. */
export function executeLab(code:string,task:LabTask,signal?:AbortSignal):Promise<LabRun> {
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('已取消运行'));return;}
  const worker=new Worker(new URL('./lab.worker.ts',import.meta.url),{type:'module'});
  const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();};
  const abort=()=>{cleanup();reject(new Error('已取消运行'));};
  const timeout=setTimeout(()=>{cleanup();resolve({code,taskId:task.id,checks:[],logs:[],error:'执行或加载超过 8 秒，请重试；代码已保留。'});},8000);
  signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=(event:MessageEvent<LabRun>)=>{cleanup();resolve(event.data);};
  worker.onerror=(event)=>{cleanup();resolve({code,taskId:task.id,checks:[],logs:[],error:`执行器未能启动：${event.message||'请重试'}。代码已保留。`});};
  worker.postMessage({code,task});
 });
}
