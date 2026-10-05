import {describe,expect,it} from 'vitest';
import {createQuitCoordinator} from '../src/node/quit-coordinator';

function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function ports(options:{discard?:boolean;flushError?:Error;timeoutMs?:number}={}) {
 const events:string[]=[];let token='';const requested=gate();
 const coordinator=createQuitCoordinator({requestFlush:current=>{token=current;events.push('request');requested.resolve();},flush:async()=>{events.push('flush');if(options.flushError)throw options.flushError;},confirmDiscard:async error=>{events.push(`confirm:${error.message}`);return options.discard??false;},finish:()=>{events.push('finish');},release:current=>{expect(current).toBe(token);events.push('release');},timeoutMs:options.timeoutMs??500});
 return {coordinator,events,requested,token:()=>token};
}

describe('quit waits for a trusted current-token renderer acknowledgement',()=>{
 it('merges concurrent requests and flushes Node only after one matching acknowledgement',async()=>{
  const p=ports();const first=p.coordinator.request();const second=p.coordinator.request();expect(second).toBe(first);await p.requested.promise;expect(p.events).toEqual(['request']);
  expect(p.coordinator.acknowledge('obsolete')).toBe(false);expect(p.coordinator.acknowledge(p.token())).toBe(true);expect(p.coordinator.acknowledge(p.token())).toBe(false);await first;expect(p.events).toEqual(['request','flush','finish']);expect(p.coordinator.acknowledge(p.token())).toBe(false);
 });
 it('cancels on renderer failure, releases the same token and permits a new request',async()=>{
  const p=ports();const first=p.coordinator.request();await p.requested.promise;const old=p.token();expect(p.coordinator.acknowledge(old,'草稿尚未保存')).toBe(true);await first;expect(p.events).toEqual(['request','confirm:草稿尚未保存','release']);
  const again=p.coordinator.request();await Promise.resolve();expect(p.token()).not.toBe(old);expect(p.coordinator.acknowledge(old)).toBe(false);expect(p.coordinator.acknowledge(p.token())).toBe(true);await again;expect(p.events.slice(-2)).toEqual(['flush','finish']);
 });
 it.each([false,true])('handles a real acknowledgement timeout with explicit discard %s',async discard=>{
  const p=ports({discard,timeoutMs:15});await p.coordinator.request();expect(p.events[0]).toBe('request');expect(p.events[1]).toMatch(/confirm:.*超时/);expect(p.events[2]).toBe(discard?'finish':'release');expect(p.events).not.toContain('flush');expect(p.coordinator.acknowledge(p.token())).toBe(false);
 });
 it.each([false,true])('handles Node write failure without rejecting a resolved discard decision %s',async discard=>{
  const p=ports({discard,flushError:Error('rename 失败')});const request=p.coordinator.request();await p.requested.promise;p.coordinator.acknowledge(p.token());await request;expect(p.events).toEqual(['request','flush','confirm:rename 失败',discard?'finish':'release']);
 });
 it('does not create two discard dialogs while the first decision is pending',async()=>{
  const decision=gate();const events:string[]=[];let token='';let confirmations=0;
  const coordinator=createQuitCoordinator({requestFlush:t=>{token=t;},flush:async()=>{},confirmDiscard:async()=>{confirmations++;await decision.promise;return false;},finish:()=>{events.push('finish');},release:()=>{events.push('release');},timeoutMs:500});
  const first=coordinator.request();await Promise.resolve();coordinator.acknowledge(token,'未保存');await Promise.resolve();await Promise.resolve();expect(coordinator.request()).toBe(first);decision.resolve();await first;expect(confirmations).toBe(1);expect(events).toEqual(['release']);
 });
 it('releases the lock if the native discard decision adapter throws',async()=>{
  const events:string[]=[];let token='';const coordinator=createQuitCoordinator({requestFlush:t=>{token=t;},flush:async()=>{throw Error('写入失败');},confirmDiscard:async()=>{throw Error('dialog failed');},finish:()=>{events.push('finish');},release:()=>{events.push('release');},timeoutMs:500});
  const request=coordinator.request();await Promise.resolve();coordinator.acknowledge(token);await expect(request).rejects.toThrow('dialog failed');expect(events).toEqual(['release']);expect(coordinator.acknowledge(token)).toBe(false);
 });
 it.each([false,true])('turns request transport failure into the cancel decision, asynchronous %s',async asynchronous=>{
  const events:string[]=[];const coordinator=createQuitCoordinator({requestFlush:()=>{if(asynchronous)return Promise.reject(Error('renderer unavailable'));throw Error('renderer unavailable');},flush:async()=>{events.push('flush');},confirmDiscard:async error=>{events.push(error.message);return false;},finish:()=>{events.push('finish');},release:()=>{events.push('release');},timeoutMs:500});
  await coordinator.request();expect(events).toEqual(['renderer unavailable','release']);
 });
});
