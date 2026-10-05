import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {emptyState} from '../src/core/state';
import {beginLab,setLabCode} from '../src/core/lab';
import {readBackup} from '../src/core/backup';
import {openDesktopStore} from '../src/node/desktop-store';
import {createDesktopDocumentController,type DesktopDocumentPort} from '../src/renderer/desktop-document';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('migrates a legacy file, saves real renderer drafts and reopens the identical versioned document',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'workbench-desktop-document-'));roots.push(root);
  const file=path.join(root,'document-v1.json'),legacyFile=path.join(root,'state.json'),backupFile=path.join(root,'backup.json');
  const legacy=JSON.stringify(emptyState(),null,2);await writeFile(legacyFile,legacy);
  const store=await openDesktopStore({file,legacyFile,appVersion:'test'});
  const controller=createDesktopDocumentController({load:()=>store.load(),save:input=>store.save(input),
    exportBackup:generation=>store.export(generation,async backup=>{await writeFile(backupFile,JSON.stringify(backup));return true;}),
    importBackup:generation=>store.restore(generation,async()=>readBackup(JSON.parse(await readFile(backupFile,'utf8'))))});
  await controller.start();
  const code='function greeting(name) { return "你好，" + name; }';
  const explanation='  助手隔离验收草稿：参数送入函数，return 把拼接结果返回。\n\n';
  const updatedAt='2026-10-05T00:00:00.000Z';
  await controller.change(document=>({...document,state:{...document.state,lab:setLabCode(beginLab(document.state.lab,'functions','practice',updatedAt),'functions','practice',code)},
    drafts:{...document.drafts,lab:{'functions:practice':{explanation,lastRun:null,updatedAt}},messages:{'side:fixture':'未发送的助手验收侧聊草稿'},references:{'https://www.runoob.com/':{url:'https://www.runoob.com/',text:'助手提供的验收材料',providedAt:updatedAt}}}}));
  expect(controller.snapshot().status).toBe('saved');
  await controller.prepareQuit('integration-quit');controller.cancelQuit('integration-quit');
  const expected=controller.snapshot().document;
  const reopened=await openDesktopStore({file,legacyFile,appVersion:'test'});
  expect(reopened.snapshot().document).toEqual(expected);
  expect(reopened.snapshot().document.drafts.lab['functions:practice'].explanation).toBe(explanation);
  expect(await readFile(legacyFile,'utf8')).toBe(legacy);
  expect(await controller.exportBackup()).toBe(true);
  const exported=JSON.parse(await readFile(backupFile,'utf8'));
  expect(exported.format).toBe('growth-workbench');expect(exported.schemaVersion).toBe(1);
  expect(readBackup(exported)).toEqual(expected);
  await controller.change(document=>({...document,state:{...document.state,reading:{url:'https://www.runoob.com/js/js-tutorial.html',title:'临时更改'}}}));
  expect(await controller.importBackup()).toBe(true);
  expect(controller.snapshot().document).toEqual(expected);
  expect(controller.snapshot().generation).toBe(1);
  expect(controller.snapshot().document.state.lab.attempts).toEqual([]);
  controller.close();
});

it.each([false,true])('loads after an old renderer write settles, with write failure %s',async fail=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'workbench-desktop-reload-'));roots.push(root);
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const writing=new Promise<void>(resolve=>{entered=resolve;});
  let writes=0;
  const store=await openDesktopStore({file:path.join(root,'document-v1.json'),legacyFile:path.join(root,'state.json'),appVersion:'test',
    write:async(file,text)=>{if(writes++===0){entered();await gate;if(fail)throw Error('delayed rename failed');}await writeFile(file,text);}});
  const port:DesktopDocumentPort={load:()=>store.load(),save:input=>store.save(input),exportBackup:async()=>false,importBackup:async()=>null};
  const old=createDesktopDocumentController(port);
  await old.start();
  const saving=old.change(document=>({...document,drafts:{...document.drafts,messages:{fixture:'old renderer input'}}})).catch(()=>{});
  await writing;old.close();
  const fresh=createDesktopDocumentController({...port,load:()=>store.load()});
  const loading=fresh.start().then(()=>null,error=>error);
  await Promise.resolve();expect(fresh.snapshot().loaded).toBe(false);
  release();await saving;
  if(fail){expect((await loading).message).toBe('delayed rename failed');expect(fresh.snapshot().loaded).toBe(false);expect(fresh.snapshot().error).toBe('delayed rename failed');}
  else {
    expect(await loading).toBeNull();expect(fresh.snapshot().mutationRevision).toBe(1);
    expect(fresh.snapshot().document.drafts.messages.fixture).toBe('old renderer input');
    await fresh.change(document=>({...document,drafts:{...document.drafts,messages:{fixture:'fresh renderer input'}}}));
    expect(fresh.snapshot().status).toBe('saved');expect(store.snapshot().mutationRevision).toBe(2);
    expect(readBackup(JSON.parse(await readFile(path.join(root,'document-v1.json'),'utf8'))).drafts.messages.fixture).toBe('fresh renderer input');
  }
  fresh.close();
});
