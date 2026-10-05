import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadStateFile,loadDesktopDocument} from '../src/node/state-storage';
import {emptyState} from '../src/core/state';
import {createBackup} from '../src/core/backup';
import {emptyBrowserDocument} from '../src/core/browser-state';
const folders:string[]=[];
async function file(){const folder=await mkdtemp(path.join(os.tmpdir(),'workbench-state-test-'));folders.push(folder);return path.join(folder,'state.json');}
afterEach(async()=>{await Promise.all(folders.splice(0).map(folder=>rm(folder,{recursive:true,force:true})));});
describe('state recovery preserves the source before starting fresh',()=>{
 it('starts empty only when the file does not exist and loads valid records',async()=>{
  const target=await file();expect((await loadStateFile(target)).state).toEqual(emptyState());
  const saved=emptyState();saved.checkins.push({date:'2026-10-05',columnId:'x',note:'原始学习记录'});
  await writeFile(target,JSON.stringify(saved));const loaded=await loadStateFile(target);
  expect(loaded.state.checkins).toEqual(saved.checkins);expect(loaded.recoveryFile).toBeUndefined();
 });
 it.each(['{"columns":',JSON.stringify({...emptyState(),columns:[{id:'broken'}]})])('preserves invalid bytes and reports a recovery file',async raw=>{
  const target=await file();await writeFile(target,raw);
  const loaded=await loadStateFile(target);expect(loaded.state).toEqual(emptyState());expect(loaded.recoveryFile).toBeTruthy();
  expect(await readFile(loaded.recoveryFile!,'utf8')).toBe(raw);expect(await readFile(target,'utf8')).toBe(raw);
 });
 it('does not hide I/O errors as an empty learning history',async()=>{
  const target=await file();await expect(loadStateFile(path.dirname(target))).rejects.toThrow();
 });
});

describe('canonical desktop document startup',()=>{
 async function files(){const legacyFile=await file();return {legacyFile,file:path.join(path.dirname(legacyFile),'document-v1.json')};}
 it('uses legacy state only when canonical is absent and leaves its bytes intact',async()=>{
  const paths=await files();const state=emptyState();state.checkins=[{date:'2026-10-05',columnId:'x',note:'旧产出原文'}];
  const raw=JSON.stringify(state);await writeFile(paths.legacyFile,raw);
  const loaded=await loadDesktopDocument(paths);
  expect(loaded.document.state.checkins[0].note).toBe('旧产出原文');expect(loaded.document.drafts).toEqual({lab:{},messages:{},references:{}});
  expect(await readFile(paths.legacyFile,'utf8')).toBe(raw);expect(await readdir(path.dirname(paths.file))).toEqual(['state.json']);
 });
 it('prefers strict canonical v1 including all drafts over an older legacy file',async()=>{
  const paths=await files();await writeFile(paths.legacyFile,JSON.stringify(emptyState()));
  const document=emptyBrowserDocument();document.drafts={lab:{'functions:practice':{explanation:'这是用户自己写下的解释。',lastRun:null,updatedAt:'2026-10-05T00:00:00.000Z'}},messages:{column:'未发送的文字'},references:{column:{url:'https://example.com/',text:'摘录原文',providedAt:'2026-10-05T00:00:00.000Z'}}};
  await writeFile(paths.file,JSON.stringify(createBackup(document,'0.10.0','2026-10-05T00:00:00.000Z')));
  expect((await loadDesktopDocument(paths)).document).toEqual(document);
 });
 it('rejects future canonical versions without recovery, fallback or writes',async()=>{
  const paths=await files();await writeFile(paths.legacyFile,JSON.stringify(emptyState()));
  const raw=JSON.stringify({...createBackup(emptyBrowserDocument(),'9.0.0','2026-10-05T00:00:00.000Z'),schemaVersion:2});await writeFile(paths.file,raw);
  await expect(loadDesktopDocument(paths)).rejects.toThrow(/未来|升级/);
  expect(await readFile(paths.file,'utf8')).toBe(raw);expect((await readdir(path.dirname(paths.file))).sort()).toEqual(['document-v1.json','state.json']);
 });
 it('preserves corrupt canonical bytes before starting empty instead of loading legacy',async()=>{
  const paths=await files();const legacy=emptyState();legacy.checkins=[{date:'2026-10-05',columnId:'x',note:'不应回退'}];await writeFile(paths.legacyFile,JSON.stringify(legacy));
  const raw='{"format":"growth-workbench",';await writeFile(paths.file,raw);
  const loaded=await loadDesktopDocument(paths);expect(loaded.document).toEqual(emptyBrowserDocument());expect(loaded.recoveryFile).toBeTruthy();
  expect(await readFile(loaded.recoveryFile!,'utf8')).toBe(raw);expect(await readFile(paths.file,'utf8')).toBe(raw);
 });
 it('fails startup when the real filesystem cannot preserve corrupt bytes',async()=>{
  const paths=await files();paths.file=path.join(path.dirname(paths.file),'x'.repeat(240));const raw='broken';await writeFile(paths.file,raw);
  await expect(loadDesktopDocument(paths)).rejects.toMatchObject({code:'ENAMETOOLONG'});expect(await readFile(paths.file,'utf8')).toBe(raw);
 });
 it('propagates canonical read I/O errors without falling back',async()=>{
  const paths=await files();paths.file=path.dirname(paths.file);await expect(loadDesktopDocument(paths)).rejects.toThrow();
 });
});
