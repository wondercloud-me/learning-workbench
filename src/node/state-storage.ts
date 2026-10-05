import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {emptyState,validateState,type AppState} from '../core/state';
import {readBackup} from '../core/backup';
import {emptyBrowserDocument,type BrowserDocument} from '../core/browser-state';

class FutureDocumentError extends Error {}
function rejectFuture(value:unknown) {
 if(value && typeof value==='object' && 'schemaVersion' in value && typeof value.schemaVersion==='number' && value.schemaVersion>1)throw new FutureDocumentError('不支持未来版本的学习文档，请升级应用后再打开。');
}
async function preserve(file:string,raw:Buffer):Promise<string> {
 const recoveryFile=`${file}.recovery-${Date.now()}-${randomUUID()}`;
 await writeFile(recoveryFile,raw,{flag:'wx',mode:0o600});
 return recoveryFile;
}

export async function loadStateFile(file:string):Promise<{state:AppState;recoveryFile?:string}> {
 let raw:Buffer;
 try {raw=await readFile(file);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:emptyState()};throw error;}
 try {const value:unknown=JSON.parse(raw.toString('utf8'));rejectFuture(value);return {state:validateState(value)};}
 catch(error) {
  if(error instanceof FutureDocumentError)throw error;
  // A failed preservation must fail startup; never let autosave erase the only copy.
  const recoveryFile=await preserve(file,raw);
  return {state:emptyState(),recoveryFile};
 }
}

/** Canonical files never fall back to legacy after a parse or validation error. */
export async function loadDesktopDocument({file,legacyFile}:{file:string;legacyFile:string}):Promise<{document:BrowserDocument;recoveryFile?:string}> {
 let raw:Buffer;let source=file;
 try {raw=await readFile(file);}
 catch(error) {
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  source=legacyFile;
  try {raw=await readFile(legacyFile);}
  catch(legacyError){if((legacyError as NodeJS.ErrnoException).code==='ENOENT')return {document:emptyBrowserDocument()};throw legacyError;}
 }
 try {
  const value:unknown=JSON.parse(raw.toString('utf8'));rejectFuture(value);
  if(source===file && (!value || typeof value!=='object' || !('format' in value) || !('schemaVersion' in value)))throw Error('当前学习文档缺少 v1 格式声明。');
  return {document:readBackup(value)};
 } catch(error) {
  if(error instanceof FutureDocumentError)throw error;
  const recoveryFile=await preserve(source,raw);
  return {document:emptyBrowserDocument(),recoveryFile};
 }
}
