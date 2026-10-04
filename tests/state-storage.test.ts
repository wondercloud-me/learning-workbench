import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadStateFile} from '../src/node/state-storage';
import {emptyState} from '../src/core/state';
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
