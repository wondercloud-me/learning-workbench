import {it,expect} from 'vitest';
import {createLessonColumn,lessonMaterial,lessonReady} from '../src/core/course-learning';
import {beginVerification,markTaught,completeStep,skipStep,createColumn} from '../src/core/learning';
import {cleanBackup,emptyState,validateState} from '../src/core/state';
import {learningInstruction} from '../src/core/prompts';
import type {LessonDocument} from '../src/core/curriculum';
const course={id:'python',title:'Python3',description:'',url:'https://www.runoob.com/python3/python3-tutorial.html'};
const doc:LessonDocument={url:'https://www.runoob.com/python3/python3-loop.html',title:'循环',version:'v1',fetchedAt:'now',sections:[{id:'while',title:'while',blocks:[{kind:'code',text:'while True: pass'}]},{id:'for',title:'for',blocks:[{kind:'paragraph',text:'ONLY NEXT SECTION'}]}]};
it('uses exact ordered material, never generates a plan or assesses before teaching',()=>{
 const c=createLessonColumn(course,doc,'now','c');expect(c.phase).toBe('study');expect(c.plan?.steps.map(s=>s.id)).toEqual(['while','for']);expect(lessonReady(c)).toBe(false);expect(()=>beginVerification(c)).toThrow();expect(lessonReady(markTaught(c))).toBe(true);
 expect(lessonMaterial(c,doc)).toContain('while True');expect(lessonMaterial(c,doc)).not.toContain('ONLY NEXT SECTION');
 expect(learningInstruction(c)).toContain('课程目录');expect(learningInstruction(c)).not.toContain('共拟');
 expect(()=>lessonMaterial(c,{...doc,version:'v2'})).toThrow(/变化/);
 expect(()=>lessonMaterial({...c,currentStepIndex:1,source:{...c.source!,sectionIds:['while','unknown']}},doc)).toThrow();
});
it('retains source bindings and evidence through backup without caching material there',()=>{
 const c=createLessonColumn(course,doc,'now','c'),s=emptyState();s.columns=[c];const restored=validateState(cleanBackup(s));expect(restored.columns[0].source).toEqual(c.source);expect(JSON.stringify(restored)).not.toContain('while True');
 expect(validateState({...s,columns:[createColumn('old','goal','now','old')]}).columns[0].phase).toBe('planning');
});
it('keeps progress and evidence gates, next section opens directly for teaching and skips stay pending',()=>{
 const c=createLessonColumn(course,doc,'now','c');expect(skipStep(c).phase).toBe('study');expect(skipStep(c).plan?.steps[0].status).toBe('待验证');
 expect(()=>completeStep({...c,phase:'remediate'})).toThrow();
 const ready={...c,phase:'remediate' as const,evidence:[{id:'e',stepId:'while',answer:'mine',teachback:'mine',helpLevel:'independent' as const,level:'初步理解' as const,confirmed:true,createdAt:'now'}]};
 expect(completeStep(ready).phase).toBe('study');expect(completeStep(ready).currentStepIndex).toBe(1);
});

it('preserves latest columns, checkins and preferences when a delayed chapter finishes',async()=>{
 const {mergeLessonState}=await import('../src/core/course-learning');
 let state=emptyState();let resolve!:(doc:LessonDocument)=>void;
 const pending=new Promise<LessonDocument>(r=>resolve=r).then(material=>{state=mergeLessonState(state,course,material,'now','new');});
 state={...state,columns:[createColumn('project','goal','now','project')],checkins:[{date:'today',columnId:'project',note:'mine'}],settings:{...state.settings,preferences:{...state.settings.preferences,name:'latest'}}};
 resolve(doc);await pending;
 expect(state.columns.map(c=>c.id)).toEqual(['project','new']);expect(state.checkins).toHaveLength(1);expect(state.settings.preferences.name).toBe('latest');
 expect(mergeLessonState(state,course,doc,'later','duplicate').columns).toHaveLength(2);
});
it('supplies validated last-section review context after completing or skipping the chapter',async()=>{
 const {lessonRequest}=await import('../src/core/course-learning');
 const c=createLessonColumn(course,doc,'now','c');const done=skipStep(skipStep(c));
 expect(done.phase).toBe('complete');expect(lessonRequest(done)).toEqual({url:doc.url,version:'v1',sectionId:'for'});
 expect(lessonMaterial(done,doc)).toContain('ONLY NEXT SECTION');
});
it('requires explicit labels separating source content from AI additions in all source requests',()=>{
 const instruction=lessonMaterial(createLessonColumn(course,doc,'now','c'),doc);
 expect(instruction).toContain('教材内容');expect(instruction).toContain('AI 补充示例');expect(instruction).toContain('AI 补充说明');
});
