import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {emptyState,validateState,type AppState} from '../core/state';

export async function loadStateFile(file:string):Promise<{state:AppState;recoveryFile?:string}> {
 let raw:Buffer;
 try {raw=await readFile(file);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:emptyState()};throw error;}
 try {return {state:validateState(JSON.parse(raw.toString('utf8')))};}
 catch {
  // A failed preservation must fail startup; never let autosave erase the only copy.
  const recoveryFile=`${file}.recovery-${Date.now()}-${randomUUID()}`;
  await writeFile(recoveryFile,raw,{flag:'wx',mode:0o600});
  return {state:emptyState(),recoveryFile};
 }
}
