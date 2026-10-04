import type { ChatTurn } from '../core/providers';
import { boundToolOutput } from '../core/context-cache';
interface AgentTools {read(path:string):Promise<string>;write(path:string,content:string):Promise<void>;run(command:string):Promise<{code:number;output:string}>}
export async function runProjectAgent(files:string[],goal:string,request:(system:string,history:ChatTurn[])=>Promise<string>,tools:AgentTools,onLog:(log:string[])=>void):Promise<string[]> {
  const history:ChatTurn[]=[{role:'user',content:`项目文件：${files.slice(0,250).join(', ')}\n用户目标：${goal}`}];
  const log:string[]=[];
  const instruction='你是项目 Agent，只操作 Docker 副本。一次只返回一个 JSON 对象，不用 Markdown。动作格式：{"action":"read","path":"相对路径"}、{"action":"write","path":"相对路径","content":"完整文件内容"}、{"action":"run","command":"命令"}、{"action":"done","summary":"总结"}。先读再改，必要时运行验证。最多 8 步。不得访问副本外文件或请求密钥。操作结果可能标记已省略，不能据此认为读到了完整文件。';
  for(let i=0;i<8;i++){
    const reply=await request(instruction,history.map(t=>({...t})));
    let action:any;try{action=JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw Error(`Agent 返回格式错误：${reply.slice(0,300)}`);}
    if(action.action==='done'){log.push(`完成：${action.summary??''}`);onLog([...log]);return log;}
    let output='';
    if(action.action==='read')output=await tools.read(action.path);
    else if(action.action==='write'){await tools.write(action.path,String(action.content));output=`已写入 ${action.path}`;}
    else if(action.action==='run'){const r=await tools.run(String(action.command));output=`退出码 ${r.code}\n${r.output}`;}
    else throw Error('Agent 动作不受支持');
    log.push(`${action.action}: ${action.path||action.command||''}\n${output}`);onLog([...log]);
    history.push({role:'assistant',content:reply},{role:'user',content:`操作结果：${boundToolOutput(output)}`});
  }
  log.push('已到 8 步上限，请检查工作副本和输出后决定是否继续。');onLog([...log]);return log;
}
