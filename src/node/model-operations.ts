/** A restore cannot replace conversations while a request is still writing its results. */
export class ModelOperations {
  private active=0;
  private restoring=false;
  async run<T>(operation:()=>Promise<T>):Promise<T> {
    if(this.restoring)throw Error('正在恢复备份，请等恢复完成后再调用模型。');
    this.active++;
    try{return await operation();}finally{this.active--;}
  }
  async restore<T>(operation:()=>Promise<T>):Promise<T> {
    if(this.active || this.restoring)throw Error('请等当前模型或项目 Agent 操作完成后再恢复备份。');
    this.restoring=true;
    try{return await operation();}finally{this.restoring=false;}
  }
}
