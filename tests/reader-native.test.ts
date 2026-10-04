import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
vi.mock('electron',async()=>{
 const {EventEmitter}=await import('node:events');
 class View {
  webContents=Object.assign(new EventEmitter(),{session:{setPermissionCheckHandler:vi.fn(),setPermissionRequestHandler:vi.fn(),on:vi.fn()},setWindowOpenHandler:vi.fn(),navigationHistory:{canGoBack:()=>false,canGoForward:()=>false},loadURL:vi.fn(async()=>{}),getURL:()=> 'https://www.runoob.com/python3/python3-function.html',getTitle:()=> 'error page',executeJavaScript:vi.fn(),isDestroyed:()=>false,close:vi.fn()});
  setVisible=vi.fn();setBounds=vi.fn();
 }
 return {WebContentsView:View,Menu:{},dialog:{},shell:{}};
});
import {TutorialReader} from '../src/electron/reader';
import type {BrowserWindow} from 'electron';
import type {TutorialStore} from '../src/node/tutorials';
describe('native reader error-page lifecycle',()=>{
 it('keeps the cached fallback after Chromium finishes rendering a failed navigation',async()=>{
  const send=vi.fn(),add=vi.fn();
  const host=Object.assign(new EventEmitter(),{isDestroyed:()=>false,getContentSize:()=>[1000,800],webContents:{send},contentView:{addChildView:add}});
  const store={cachedLesson:vi.fn(async()=>({title:'cached function'})),capture:vi.fn()};
  const reader=new TutorialReader(host as unknown as BrowserWindow,store as unknown as TutorialStore);
  const view=add.mock.calls[0][0],url='https://www.runoob.com/python3/python3-function.html';
  reader.viewport({x:200,y:100,width:800,height:700},true);await reader.navigate(url);
  view.webContents.emit('did-start-navigation',{},url,false,true);
  view.webContents.emit('did-fail-load',{},-130,'ERR_PROXY_CONNECTION_FAILED',url,true);
  // Electron also finishes loading the internal error document. It is not a successful tutorial.
  view.webContents.emit('did-finish-load');await Promise.resolve();await Promise.resolve();
  const updates=send.mock.calls.filter(c=>c[0]==='reader:update').map(c=>c[1]);
  expect(updates.at(-1).error).toContain('ERR_PROXY_CONNECTION_FAILED');
  expect(updates.at(-1).cached).toBe(true);
  reader.viewport({x:200,y:100,width:800,height:700},true);
  expect(view.setVisible).toHaveBeenLastCalledWith(false);
  expect(store.capture).not.toHaveBeenCalled();
 });
});
