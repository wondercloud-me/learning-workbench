import {beforeEach, describe, expect, it, vi} from 'vitest';
const bridge = vi.hoisted(() => ({calls: {} as Record<string, any>, listeners: new Map<string, (...args:any[])=>void>(), invoke: vi.fn()}));
vi.mock('electron', () => ({
  contextBridge: {exposeInMainWorld: (_name:string, calls:Record<string,any>) => { bridge.calls = calls; }},
  ipcRenderer: {invoke: bridge.invoke, on: (name:string, listener:(...args:any[])=>void) => bridge.listeners.set(name,listener), removeListener: (name:string, listener:(...args:any[])=>void) => {if(bridge.listeners.get(name)===listener)bridge.listeners.delete(name);}}
}));
import '../src/electron/preload';
const settle = async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
describe('desktop preload quit handshake',()=>{
  beforeEach(()=>{bridge.invoke.mockReset();bridge.listeners.clear();});
  it('acknowledges the requested token and generation only after renderer persistence finishes',async()=>{
    let finish!:(generation:number)=>void;
    bridge.calls.onQuitRequest((_token:string)=>new Promise<number>(resolve=>finish=resolve));
    bridge.listeners.get('app:quit-request')!({},'quit-7');
    await settle();expect(bridge.invoke.mock.calls).toEqual([]);
    finish(3);await settle();
    expect(bridge.invoke.mock.calls).toEqual([['app:quit-ready',{token:'quit-7',generation:3}]]);
  });
  it('reports failed persistence without sending a success acknowledgement',async()=>{
    bridge.calls.onQuitRequest(async()=>{throw new Error('disk full');});
    bridge.listeners.get('app:quit-request')!({},'quit-8');await settle();
    expect(bridge.invoke.mock.calls).toEqual([['app:quit-ready',{token:'quit-8',error:'disk full'}]]);
  });
  it('releases only the token named by the main process cancellation',()=>{
    const released:string[]=[];
    const stop=bridge.calls.onQuitCancelled((token:string)=>released.push(token));
    bridge.listeners.get('app:quit-cancelled')!({},'quit-9');
    expect(released).toEqual(['quit-9']);stop();
    expect(bridge.listeners.has('app:quit-cancelled')).toBe(false);
  });
});
