import {newQuickJSWASMModuleFromVariant,newVariant} from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import wasmUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import {runLabCode} from '../core/lab-runner';
import type {LabTask} from '../data/practice-units';
self.onmessage=async(event:MessageEvent<{code:string;task:LabTask}>)=>{
 try{const module=await newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC,{wasmLocation:wasmUrl}));self.postMessage(await runLabCode(event.data.code,event.data.task,1000,module));}
 catch(error){self.postMessage({code:event.data.code,taskId:event.data.task.id,checks:[],logs:[],error:error instanceof Error?error.message:String(error)});}
};
