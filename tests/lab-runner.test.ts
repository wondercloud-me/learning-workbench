import {describe,it,expect} from 'vitest';
import {runLabCode} from '../src/core/lab-runner';
import {practiceUnits} from '../src/data/practice-units';
const task=practiceUnits[0].task;
describe('real isolated JavaScript practice runner',()=>{
 it('checks actual function returns and preserves the exact code snapshot',async()=>{
  const code='function greeting(name) { return "你好，" + name; }';const good=await runLabCode(code,task);
  expect(good.code).toBe(code);expect(good.error).toBe('');expect(good.checks[0].input).toEqual(['小林']);expect(good.checks.every(c=>c.passed)).toBe(true);
  const bad=await runLabCode('function greeting() { return "你好，小林"; }',task);
  expect(bad.checks[1].passed).toBe(false);expect(bad.checks[1].actual).toBe('你好，小林');expect(bad.checks[1].expected).toBe('你好，Ada');
 });
 it('reports syntax errors, unknown entry and caps output',async()=>{
  expect((await runLabCode('function {',task)).error).toContain('SyntaxError');
  expect((await runLabCode('const other = 1;',task)).error).toContain('greeting');
  const run=await runLabCode('console.log("x".repeat(30000));function greeting(name){return "你好，"+name}',task);
  expect(run.logs.join('').length).toBeLessThanOrEqual(4000);
 });
 it('interrupts infinite work and can run again afterward',async()=>{
  const result=await runLabCode('function greeting() { while (true) {} }',task,50);
  expect(result.error||result.checks[0]?.error).toMatch(/interrupt|预算|超时/i);
  expect((await runLabCode('function greeting(n){return "你好，"+n}',task)).checks.every(c=>c.passed)).toBe(true);
 });
 it('does not expose host APIs or share mutated globals with later runs',async()=>{
  const isolated=await runLabCode('console.log(typeof fetch,typeof process,typeof window,typeof require);function greeting(n){return "你好，"+n}',task);
  expect(isolated.logs[0]).toBe('undefined undefined undefined undefined');
  await runLabCode('globalThis.marker="leaked";function greeting(n){return "你好，"+n}',task);
  const next=await runLabCode('console.log(typeof marker);function greeting(n){return "你好，"+n}',task);expect(next.logs[0]).toBe('undefined');
 });
 it('does not allow code to rewrite the grader expectations or falsify object results',async()=>{
  const routing=practiceUnits[2].task;
  const run=await runLabCode('JSON.stringify=()=>\'{"status":200,"body":"ok"}\';function route(){return {status:999,body:"wrong"}}',routing);
  expect(run.checks.every(c=>!c.passed)).toBe(true);
 });
 it('bounds sparse arrays, recursive output and even empty log lines before renderer transfer',async()=>{
  const sparse=await runLabCode('function greeting(){const a=[];a[1000000]=1;return a}',task);
  expect(sparse.checks.every(c=>c.error&&c.actual===undefined)).toBe(true);
  const tree=await runLabCode('function greeting(){let x={v:"x".repeat(3000)};for(let i=0;i<5;i++)x={a:x,b:x,c:x,d:x};return x}',task);
  expect(tree.checks.every(c=>c.error&&c.actual===undefined)).toBe(true);
  const logs=await runLabCode('for(let i=0;i<20000;i++)console.log("");function greeting(n){return "你好，"+n}',task);
  expect(logs.logs.length).toBeLessThanOrEqual(50);
  expect(JSON.stringify([sparse,tree,logs]).length).toBeLessThan(20000);
 });
});
