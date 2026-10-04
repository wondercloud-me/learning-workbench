import {describe,it,expect} from 'vitest';
import {emptyLab,beginLab,setLabCode,revealLabHint,saveLabAttempt,labSummary,normalizeLab,declareLabHelp} from '../src/core/lab';
import {practiceUnits} from '../src/data/practice-units';
import {emptyState,validateState} from '../src/core/state';
const day='2026-10-05T10:00:00.000Z',tomorrow='2026-10-06T10:00:00.000Z';
const unit=practiceUnits[0];
const success=(code:string,taskId:string)=>({code,taskId,logs:[],error:'',checks:unit.task.cases.map(c=>({label:c.label,passed:true,expected:c.expected,actual:c.expected}))});
describe('taught practice and actual evidence',()=>{
 it('shows no assessment before explicit study and cannot open delayed task early',()=>{
  const lab=emptyLab();expect(()=>setLabCode(lab,unit.id,'practice','code')).toThrow('先学习');
  expect(()=>beginLab(lab,unit.id,'transfer',day)).toThrow('先完成');
  expect(beginLab(lab,unit.id,'practice',day).sessions[`${unit.id}:practice`].learnedAt).toBe(day);
 });
 it('records exact code, run and explanation, preserving hint use across reload',()=>{
  let lab=setLabCode(beginLab(emptyLab(),unit.id,'practice',day),unit.id,'practice','my code');
  expect(()=>saveLabAttempt(lab,unit.id,'practice',success('other code',unit.task.id),'自己的解释',day)).toThrow('代码已变化');
  expect(()=>saveLabAttempt(lab,unit.id,'practice',success('my code',unit.task.id),'',day)).toThrow('解释');
  lab=revealLabHint(lab,unit.id,'practice');lab=normalizeLab(JSON.parse(JSON.stringify(lab)));
  const saved=saveLabAttempt(lab,unit.id,'practice',success('my code',unit.task.id),'我用参数拼接了欢迎文本。',day);
  expect(saved.attempts[0].helpLevel).toBe('hinted');expect(saved.attempts[0].code).toBe('my code');
  expect(lab.attempts).toHaveLength(0);expect(labSummary(saved,unit.id,tomorrow).independentRepeated).toBe(false);
 });
 it('distinguishes failed execution and test correctness from repeated independent performance',()=>{
  let lab=setLabCode(beginLab(emptyLab(),unit.id,'practice',day),unit.id,'practice','code');
  const failed={...success('code',unit.task.id),error:'SyntaxError'};
  const saved=saveLabAttempt(lab,unit.id,'practice',failed,'这次语法出错了。',day);
  expect(saved.attempts[0].passed).toBe(false);expect(()=>beginLab(saved,unit.id,'transfer',tomorrow)).toThrow('先完成');
  lab=saveLabAttempt(lab,unit.id,'practice',success('code',unit.task.id),'我用输入参数构造返回值。',day);
  expect(labSummary(lab,unit.id,day).independentRepeated).toBe(false);
  expect(()=>beginLab(lab,unit.id,'transfer',day)).toThrow('另一天');
  lab=setLabCode(beginLab(lab,unit.id,'transfer',tomorrow),unit.id,'transfer','changed code');
  const transfer={...success('changed code',unit.transfer.id),checks:unit.transfer.cases.map(c=>({label:c.label,passed:true,actual:c.expected,expected:c.expected}))};
  lab=saveLabAttempt(lab,unit.id,'transfer',transfer,'我先清理空格，然后处理空名字。',tomorrow);
  expect(labSummary(lab,unit.id,tomorrow).independentRepeated).toBe(true);
 });
 it('keeps declared outside assistance and never grades contradictory restored output as success',()=>{
  let lab=setLabCode(beginLab(emptyLab(),unit.id,'practice',day),unit.id,'practice','code');
  lab=declareLabHelp(lab,unit.id,'practice','explained');lab=declareLabHelp(lab,unit.id,'practice','independent');
  const saved=saveLabAttempt(lab,unit.id,'practice',success('code',unit.task.id),'我参考了完整解释再实现。',day);
  expect(saved.attempts[0].helpLevel).toBe('explained');
  const contradictory=structuredClone(saved);contradictory.attempts[0].checks[0].actual='wrong';
  expect(normalizeLab(contradictory).attempts[0].passed).toBe(false);
 });
 it('restores only declared practice record fields, retaining learner text',()=>{
  const lab=setLabCode(beginLab(emptyLab(),unit.id,'practice',day),unit.id,'practice','code');
  const saved=saveLabAttempt(lab,unit.id,'practice',success('code',unit.task.id),'我用自己的参数拼接返回值。',day);
  (saved.attempts[0] as any).apiKey='must-not-export';
  const restored=normalizeLab(saved);
  expect((restored.attempts[0] as any).apiKey).toBeUndefined();expect(restored.attempts[0].explanation).toBe('我用自己的参数拼接返回值。');
 });
 it('restores old backups with an empty lab and rejects invalid records as evidence',()=>{
  expect(validateState({...emptyState(),lab:undefined}).lab).toEqual(emptyLab());
  expect(normalizeLab({sessions:{},attempts:[{unitId:unit.id,passed:true,helpLevel:'independent',createdAt:'invalid'}]}).attempts).toEqual([]);
 });
 it('rejects malformed check fields and unbounded JSON before restored evidence reaches React',()=>{
  const lab=setLabCode(beginLab(emptyLab(),unit.id,'practice',day),unit.id,'practice','code');
  const saved=saveLabAttempt(lab,unit.id,'practice',success('code',unit.task.id),'我用参数生成返回值。',day);
  for(const patch of [{label:{}},{error:{}},{passed:'yes'},{actual:Infinity},{input:{}},{actual:{a:undefined}},{actual:new Array(1000000)}]){
   const broken=structuredClone(saved);Object.assign(broken.attempts[0].checks[0],patch);
   expect(normalizeLab(broken).attempts).toEqual([]);
  }
  const excessive=structuredClone(saved);excessive.attempts[0].logs=Array(51).fill('');
  expect(normalizeLab(excessive).attempts).toEqual([]);
  expect(normalizeLab(saved).attempts).toHaveLength(1);
 });
});
