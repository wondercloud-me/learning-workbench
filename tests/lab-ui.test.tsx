// @vitest-environment jsdom
import React, {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {beginLab, emptyLab, revealLabHint, saveLabAttempt, setLabCode, type LabRun, type LabState} from '../src/core/lab';
import {LabPanel, type LabPanelProps} from '../src/renderer/lab-panel';
import {emptyBrowserDocument, validateBrowserDocument, type LabDraft} from '../src/core/browser-state';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{host: HTMLDivElement; root: Root}> = [];
afterEach(async () => {
  for (const {host, root} of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  vi.useRealTimers();
});

const greetingCode = 'function greeting(name) { return "你好，" + name; }';
const passedGreeting = (code: string): LabRun => ({
  code, taskId: 'greeting', error: '', logs: ['用户自己的日志'],
  checks: [
    {label: '普通名字', passed: true, expected: '你好，小林', actual: '你好，小林'},
    {label: '名字来自输入', passed: true, expected: '你好，Ada', actual: '你好，Ada'},
    {label: '不要写死名字', passed: true, expected: '你好，同学', actual: '你好，同学'},
  ],
});
async function mount(execute: LabPanelProps['execute'], initial = emptyLab(), options: {drafts?: Record<string, {explanation: string; lastRun: LabRun | null; updatedAt: string}>; save?: (next: LabState) => Promise<void>; desktop?: boolean; projectDrafts?: (next: Record<string, LabDraft>, lab: LabState) => Record<string, LabDraft>} = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({host, root});
  let value = initial;
  let drafts = options.drafts || {};
  let publishDrafts!: (next: typeof drafts) => void;
  let publishState!: (next: LabState) => void;
  function Harness() {
    const [state, setState] = useState(initial);
    const [draftState, setDraftState] = useState(drafts);
    publishDrafts = next => {drafts = next; setDraftState(next);};
    publishState = next => {value = next; setState(next);};
    return <LabPanel value={state} execute={execute} drafts={options.desktop ? undefined : draftState} onDraftChange={options.desktop ? undefined : (key, next) => {const updated = {...drafts, [key]: next}; drafts = options.projectDrafts ? options.projectDrafts(updated, value) : updated; setDraftState(drafts);}} onChange={next => {const addedAttempt = next.attempts.length > value.attempts.length || !!options.save && next.attempts !== value.attempts; value = next; setState(next); if (addedAttempt && options.save) return options.save(next);}}/>;
  }
  await act(async () => root.render(<Harness/>));
  const button = (label: string) => {
    const found = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
    if (!found) throw new Error(`找不到按钮：${label}`);
    return found;
  };
  const click = async (label: string) => {await act(async () => button(label).click());};
  const input = async (label: string, text: string) => {
    const field = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
    if (!field) throw new Error(`找不到输入框：${label}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {setter.call(field, text); field.dispatchEvent(new Event('input', {bubbles: true}));});
  };
  return {host, root, button, click, input, value: () => value, drafts: () => drafts, replaceState: async (next: LabState) => {await act(async () => publishState(next));}, replaceDrafts: async (next: typeof drafts) => {await act(async () => publishDrafts(next));}};
}

const reviewNow='2026-10-05T10:00:00.000Z',reviewPrior='2026-10-03T10:00:00.000Z';
function reviewClock(){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(reviewNow));}
const pricesCode='function totalPrices(prices) { let sum = 0; for (const price of prices) sum += price; return sum; }';
const passedPrices=(code:string):LabRun=>({code,taskId:'total-prices',error:'',logs:[],checks:[
 {label:'多件商品',passed:true,expected:35,actual:35},{label:'空购物车',passed:true,expected:0,actual:0},{label:'免费商品',passed:true,expected:7,actual:7},
]});
function pricesPrior(lab=emptyLab(),at=reviewPrior){
 const studied=setLabCode(beginLab(lab,'lists','practice',at),'lists','practice',pricesCode);
 return saveLabAttempt(studied,'lists','practice',passedPrices(pricesCode),'循环逐项拿到价格，把每个价格累加到总价再返回。',at);
}
function retainedClick(button:HTMLElement){const key=Object.keys(button).find(k=>k.startsWith('__reactProps$'))!;return (button as any)[key].onClick as ()=>void;}

it('offers all eligible units and selecting a review preserves the explicit study gate without executing or writing evidence',async()=>{
 reviewClock();let lab=pricesPrior();lab.attempts[0].helpLevel='hinted';
 const routeCode='function route(path) { return path === "/health" ? {status:200,body:"ok"} : {status:404,body:"not found"}; }';
 lab=setLabCode(beginLab(lab,'routing','practice',reviewPrior),'routing','practice',routeCode);
 lab=saveLabAttempt(lab,'routing','practice',{code:routeCode,taskId:'health-route',error:'',logs:[],checks:[
  {label:'健康检查',passed:true,expected:{status:200,body:'ok'},actual:{status:200,body:'ok'}},
  {label:'未知路径',passed:true,expected:{status:404,body:'not found'},actual:{status:404,body:'not found'}},
  {label:'根路径也未配置',passed:true,expected:{status:404,body:'not found'},actual:{status:404,body:'not found'}},
 ]},'读取路径后返回相应状态码和正文，未知路径使用默认响应。',reviewPrior);
 let executions=0;const ui=await mount(async code=>{executions++;return passedGreeting(code);},lab);const before=structuredClone(ui.value());
 expect([...ui.host.querySelectorAll('.lab-review-actions button')].map(b=>b.textContent?.trim())).toEqual(['查看循环的隔日变式','查看路由的隔日变式']);
 await ui.click('查看循环的隔日变式');expect(ui.host.querySelector('.lab-units [aria-pressed="true"]')!.textContent).toContain('循环');
 expect(ui.button('隔日变式').getAttribute('aria-pressed')).toBe('true');expect(ui.host.querySelector('[aria-label="你的代码"]')).toBeNull();
 expect(ui.host.textContent).not.toContain('排除超额');expect(ui.host.textContent).not.toContain('只累加不超过 limit');
 expect(executions).toBe(0);expect(ui.value()).toEqual(before);expect(ui.value().sessions['lists:transfer']).toBeUndefined();
});

it('omits empty review UI for same-day, failed, unrun or already-passed-transfer work',async()=>{
 reviewClock();const sameDay=pricesPrior(emptyLab(),reviewNow);
 const failed=beginLab(emptyLab(),'lists','practice',reviewPrior);
 const failedSaved=saveLabAttempt(setLabCode(failed,'lists','practice',pricesCode),'lists','practice',{...passedPrices(pricesCode),error:'SyntaxError'},'这次运行失败，观察到语法错误所以继续修改。',reviewPrior);
 let completed=pricesPrior();completed=beginLab(completed,'lists','transfer','2026-10-04T10:00:00.000Z');
 const code='function totalPrices(prices, limit) { let sum=0; for(const price of prices) if(price<=limit)sum+=price; return sum; }';
 completed=setLabCode(completed,'lists','transfer',code);
 completed=saveLabAttempt(completed,'lists','transfer',{code,taskId:'total-filter',error:'',logs:[],checks:[
  {label:'排除超额',passed:true,expected:15,actual:15},{label:'含边界',passed:true,expected:10,actual:10},
  {label:'没有匹配商品',passed:true,expected:0,actual:0},{label:'空数组',passed:true,expected:0,actual:0},
 ]},'先检查价格是否不超过限制，只累加满足条件的价格。','2026-10-04T10:00:00.000Z');
 const ui=await mount(async code=>passedGreeting(code),sameDay);
 for(const state of [sameDay,failedSaved,beginLab(emptyLab(),'lists','practice',reviewPrior),completed]){
  await ui.replaceState(state);expect(ui.host.querySelector('.lab-review-actions')).toBeNull();
 }
});

it('disables review navigation during saving and excludes pending or failed candidates until the commit succeeds',async()=>{
 reviewClock();let reject!:(cause:Error)=>void,resolve!:()=>void;
 const ui=await mount(async code=>passedGreeting(code),pricesPrior(),{save:()=>new Promise<void>((done,fail)=>{resolve=done;reject=fail;})});
 const held=retainedClick(ui.button('查看循环的隔日变式'));
 await ui.click('我学过了，开始动手');await ui.input('你的代码',greetingCode);await ui.input('用自己的话解释','把传入名字与前缀拼接，返回新的欢迎字符串。');await ui.click('运行代码');await ui.click('保存此次产出');
 expect(ui.button('查看循环的隔日变式').disabled).toBe(true);await act(async()=>held());expect(ui.button('基础任务').getAttribute('aria-pressed')).toBe('true');
 const candidateId=ui.value().attempts.at(-1)!.id;
 vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));await ui.replaceState({...ui.value()});
 expect(ui.host.querySelector('.lab-review-actions')!.textContent).not.toContain('查看函数');
 await act(async()=>reject(Error('injected save failure')));expect(ui.button('查看循环的隔日变式').disabled).toBe(false);
 expect(ui.host.querySelector('.lab-review-actions')!.textContent).not.toContain('查看函数');
 await ui.click('保存此次产出');expect(ui.value().attempts).toHaveLength(2);expect(ui.value().attempts.at(-1)!.id).toBe(candidateId);
 await act(async()=>resolve());vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));await ui.replaceState({...ui.value()});
 expect(ui.button('查看函数的隔日变式')).toBeTruthy();expect(ui.value().attempts).toHaveLength(2);
});

it('review navigation aborts old execution and restores existing transfer code explanation help and historical-run restrictions',async()=>{
 reviewClock();let lab=beginLab(pricesPrior(),'lists','transfer','2026-10-04T10:00:00.000Z');
 lab=setLabCode(lab,'lists','transfer','function totalPrices(prices, limit) { return 0; }');lab=revealLabHint(lab,'lists','transfer');
 lab=beginLab(lab,'functions','practice',reviewPrior);lab=setLabCode(lab,'functions','practice',greetingCode);
 const historical:LabRun={code:lab.sessions['lists:transfer'].code,taskId:'total-filter',error:'',logs:['原变式运行日志'],checks:[]};
 let signal:AbortSignal|undefined,finish!:(value:LabRun)=>void;const ui=await mount((_code,_task,abort)=>{signal=abort;return new Promise(done=>{finish=done;});},lab,{drafts:{
  'lists:transfer':{explanation:'这份变式的解释和代码已经开始，但尚未保存通过产出。',lastRun:historical,updatedAt:reviewPrior},
 }});
 await ui.click('运行代码');const before=structuredClone(ui.value());await ui.click('查看循环的隔日变式');expect(signal?.aborted).toBe(true);
 expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="你的代码"]')!.value).toBe(historical.code);
 expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toContain('这份变式的解释');
 expect(ui.host.querySelector('[aria-label="上次运行结果"]')!.textContent).toContain('原变式运行日志');expect(ui.host.textContent).toContain('看过提示');expect(ui.button('保存此次产出').disabled).toBe(true);
 await act(async()=>finish(passedGreeting(greetingCode)));expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();expect(ui.value()).toEqual(before);
});

it('rejects retained review handlers for hidden inert detached collapsed restored or no-longer-due views',async()=>{
 reviewClock();const initial=pricesPrior();const ui=await mount(async code=>passedGreeting(code),initial);const held=retainedClick(ui.button('查看循环的隔日变式'));
 const unchanged=()=>expect(ui.host.querySelector('.lab-units [aria-pressed="true"]')!.textContent).toContain('函数');
 ui.host.hidden=true;await act(async()=>held());unchanged();ui.host.hidden=false;
 ui.host.setAttribute('inert','');await act(async()=>held());unchanged();ui.host.removeAttribute('inert');
 ui.host.remove();await act(async()=>held());unchanged();document.body.append(ui.host);
 const wrapper=document.createElement('details');document.body.append(wrapper);wrapper.append(ui.host);await act(async()=>held());unchanged();document.body.append(ui.host);wrapper.remove();
 vi.setSystemTime(new Date(reviewPrior));await act(async()=>held());unchanged();vi.setSystemTime(new Date(reviewNow));
 await ui.replaceState(structuredClone(initial));await act(async()=>held());unchanged();
 const restored=retainedClick(ui.button('查看循环的隔日变式'));await ui.replaceDrafts({'lists:transfer':{explanation:'恢复得到的变式草稿，尚未开始当前任务。',lastRun:null,updatedAt:reviewNow}});
 await act(async()=>restored());unchanged();await ui.click('查看循环的隔日变式');expect(ui.host.querySelector('.lab-units [aria-pressed="true"]')!.textContent).toContain('循环');
 expect(ui.value()).toEqual(initial);
});

it('keeps the task and checks hidden until the learner explicitly confirms studying', async () => {
  const ui = await mount(async code => passedGreeting(code));
  expect(ui.host.textContent).toContain('参数是送进去的材料');
  expect(ui.host.textContent).toContain('console.log(makeLabel("小林"))');
  expect(ui.host.textContent).toContain('学习者：小林');
  expect(ui.host.textContent).toContain('忘记 return');
  expect(ui.host.textContent).toContain('登录页、欢迎页');
  expect(ui.host.querySelector('[aria-label="你的代码"]')).toBeNull();
  expect(ui.host.textContent).not.toContain('普通名字');
  expect(ui.host.textContent).not.toContain('写 greeting(name)');
  await ui.click('我学过了，开始动手');
  expect(ui.host.querySelector('[aria-label="你的代码"]')).not.toBeNull();
  expect(ui.host.textContent).toContain('写 greeting(name)');
  expect(ui.value().sessions['functions:practice'].learnedAt).toMatch(/^\d{4}-/);
});

it('shows failed checks with expected and actual output while preserving editable code', async () => {
  const ui = await mount(async code => ({
    code, taskId: 'greeting', error: '', logs: ['运行到了函数'],
    checks: [{label: '普通名字', passed: false, expected: '你好，小林', actual: '你好，Ada'}],
  }));
  await ui.click('我学过了，开始动手');
  const wrongCode = 'function greeting(name) { return "你好，Ada"; }';
  await ui.input('你的代码', wrongCode);
  await ui.click('运行代码');
  const report = ui.host.querySelector('[aria-label="本次运行结果"]')!;
  expect(report.textContent).toContain('未通过');
  expect(report.textContent).toContain('你好，小林');
  expect(report.textContent).toContain('你好，Ada');
  expect(report.textContent).toContain('输入');
  expect(report.textContent).toContain('"小林"');
  expect(report.textContent).toContain('运行到了函数');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="你的代码"]')!.value).toBe(wrongCode);
  expect(ui.value().attempts).toHaveLength(0);
});

it('saves the exact successful code only after the learner writes a personal explanation', async () => {
  const ui = await mount(async code => passedGreeting(code));
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  expect(ui.button('保存此次产出').disabled).toBe(true);
  await ui.input('用自己的话解释', '能运行');
  expect(ui.button('保存此次产出').disabled).toBe(true);
  const explanation = 'name 接收传进来的名字，return 把拼接的欢迎文字返回。';
  await ui.input('用自己的话解释', explanation);
  expect(ui.button('保存此次产出').disabled).toBe(false);
  await ui.click('保存此次产出');
  expect(ui.value().attempts).toHaveLength(1);
  expect(ui.value().attempts[0]).toMatchObject({code: greetingCode, explanation, passed: true, helpLevel: 'independent'});
  expect(ui.host.querySelector('[aria-label="尝试记录"]')!.textContent).toContain(explanation);
  expect(ui.host.querySelector('[aria-label="尝试记录"]')!.textContent).toContain(greetingCode);
  expect(ui.host.textContent).toContain('用例通过不代表稳定掌握');
});

it('records assistance after a requested hint and does not present it as an independent attempt', async () => {
  const ui = await mount(async code => passedGreeting(code));
  await ui.click('我学过了，开始动手');
  expect(ui.host.textContent).not.toContain('检查函数有没有把结果 return 出来');
  await ui.click('查看下一层提示');
  expect(ui.host.textContent).toContain('检查函数有没有把结果 return 出来');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.input('用自己的话解释', '根据提示，把欢迎前缀与参数相加后返回给调用者。');
  await ui.click('保存此次产出');
  expect(ui.value().attempts[0].helpLevel).toBe('hinted');
  expect(ui.host.querySelector('[aria-label="尝试记录"]')!.textContent).toContain('看过提示');
});

it('preserves a declaration of external AI explanations and prevents reducing its assistance level', async () => {
  const ui = await mount(async code => passedGreeting(code));
  await ui.click('我学过了，开始动手');
  const assistance = ui.host.querySelector<HTMLSelectElement>('select[aria-label="其他帮助 / AI"]');
  expect(assistance).not.toBeNull();
  await act(async () => {assistance!.value = 'explained'; assistance!.dispatchEvent(new Event('change', {bubbles: true}));});
  expect(assistance!.querySelector<HTMLOptionElement>('option[value="independent"]')!.disabled).toBe(true);
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.input('用自己的话解释', '先看过 AI 的完整讲解，再自己写出参数和前缀的拼接。');
  await ui.click('保存此次产出');
  expect(ui.value().attempts[0].helpLevel).toBe('explained');
  expect(ui.host.querySelector('[aria-label="尝试记录"]')!.textContent).toContain('看过讲解');
});

it('invalidates an old successful result when code changes before saving', async () => {
  const ui = await mount(async code => passedGreeting(code));
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.input('用自己的话解释', '把函数接收的名字连接到固定前缀，再返回新字符串。');
  expect(ui.button('保存此次产出').disabled).toBe(false);
  await ui.input('你的代码', 'function greeting(name) { return "wrong"; }');
  expect(ui.button('保存此次产出').disabled).toBe(true);
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
  await ui.click('保存此次产出');
  expect(ui.value().attempts).toHaveLength(0);
});

it('ignores a delayed result after switching away and back to the original unit', async () => {
  let resolve!: (run: LabRun) => void;
  const ui = await mount(() => new Promise<LabRun>(done => {resolve = done;}));
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.click('循环：逐个处理列表');
  await ui.click('我学过了，开始动手');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="你的代码"]')!.value).toContain('totalPrices');
  await ui.click('函数：把输入变成结果');
  await act(async () => resolve(passedGreeting(greetingCode)));
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
  expect(ui.button('保存此次产出').disabled).toBe(true);
  expect(ui.value().attempts).toHaveLength(0);
});

it('displays a same-day transfer error and never reveals its task before admission', async () => {
  const ui = await mount(async code => passedGreeting(code));
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.input('用自己的话解释', 'return 把收到的名字与前缀拼接，然后交回给调用方。');
  await ui.click('保存此次产出');
  await ui.click('隔日变式');
  expect(ui.host.textContent).not.toContain('带空格输入');
  expect(ui.host.querySelector('[aria-label="你的代码"]')).toBeNull();
  await ui.click('开始隔日变式');
  expect(ui.host.querySelector('[role="alert"]')!.textContent).toContain('换到另一天');
  expect(ui.value().sessions['functions:transfer']).toBeUndefined();
});

it('aborts execution when the panel is removed', async () => {
  let signal: AbortSignal | undefined;
  const ui = await mount((_code, _task, runningSignal) => {signal = runningSignal; return new Promise(() => {});});
  await ui.click('我学过了，开始动手');
  await ui.click('运行代码');
  await act(async () => ui.root.unmount());
  expect(signal?.aborted).toBe(true);
});


it('awaitsDurableSaveBeforeShowingSavedAndKeepsInputOnFailure', async () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  let submissions = 0;
  const ui = await mount(async code => passedGreeting(code), emptyLab(), {save: () => {
    submissions++;
    return new Promise<void>((done, fail) => {resolve = done; reject = fail;});
  }});
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  const explanation = 'name 接收名字，与欢迎前缀拼接再返回给调用者。';
  await ui.input('用自己的话解释', explanation);
  const saveButton = ui.button('保存此次产出');
  await act(async () => {saveButton.click(); saveButton.click();});
  expect(submissions).toBe(1);
  expect(ui.host.textContent).not.toContain('已保存此次产出');
  expect(ui.host.querySelector('[aria-label="尝试记录"]')!.textContent).toContain('还没有保存产出');
  expect(ui.host.querySelector('[role="status"]')?.textContent || '').not.toContain('已保存');
  await act(async () => reject(new Error('存储空间不足，尚未保存')));
  expect(ui.host.querySelector('[role="alert"]')!.textContent).toContain('尚未保存');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="你的代码"]')!.value).toBe(greetingCode);
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toBe(explanation);
  expect(ui.button('保存此次产出').disabled).toBe(false);
  const firstAttemptId = ui.value().attempts[0].id;
  await ui.click('保存此次产出');
  expect(submissions).toBe(2);
  expect(ui.value().attempts).toHaveLength(1);
  expect(ui.value().attempts[0].id).toBe(firstAttemptId);
  await act(async () => resolve());
  expect(ui.button('已保存此次产出').disabled).toBe(true);
  expect(ui.host.querySelector('[role="status"]')!.textContent).toContain('已保存');
});

it('restoresExplanationAndHistoricalRunButRequiresFreshExecution', async () => {
  let initial = beginLab(emptyLab(), 'functions', 'practice', '2026-10-04T03:00:00.000Z');
  initial.sessions['functions:practice'].code = greetingCode;
  const explanation = '输入名字后，函数把名字与欢迎前缀连接并返回。';
  const ui = await mount(async code => passedGreeting(code), initial, {drafts: {
    'functions:practice': {explanation, lastRun: passedGreeting(greetingCode), updatedAt: '2026-10-04T03:00:00.000Z'},
  }});
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toBe(explanation);
  expect(ui.host.querySelector('[aria-label="上次运行结果"]')!.textContent).toContain('用户自己的日志');
  expect(ui.host.textContent).toContain('重新运行');
  expect(ui.button('保存此次产出').disabled).toBe(true);
  await ui.click('运行代码');
  expect(ui.button('保存此次产出').disabled).toBe(false);
  await ui.input('用自己的话解释', '新的解释：收到输入后返回前缀与名字的拼接。');
  expect(ui.drafts()['functions:practice'].lastRun?.code).toBe(greetingCode);
  await ui.click('循环：逐个处理列表');
  await ui.click('函数：把输入变成结果');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toContain('新的解释');
  expect(ui.host.querySelector('[aria-label="上次运行结果"]')).not.toBeNull();
  expect(ui.button('保存此次产出').disabled).toBe(true);
  expect(ui.value().attempts).toHaveLength(0);
});

it('stops the running worker and ignores its delayed result', async () => {
  let signal: AbortSignal | undefined;
  let resolve!: (run: LabRun) => void;
  const ui = await mount((_code, _task, activeSignal) => {
    signal = activeSignal;
    return new Promise<LabRun>(done => {resolve = done;});
  });
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.click('停止运行');
  expect(signal?.aborted).toBe(true);
  expect(ui.button('运行代码').disabled).toBe(false);
  await act(async () => resolve(passedGreeting(greetingCode)));
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
  expect(ui.button('保存此次产出').disabled).toBe(true);
});

it('compositionDoesNotSendOrRun', async () => {
  let executions = 0;
  const ui = await mount(async code => {executions++; return passedGreeting(code);});
  await ui.click('我学过了，开始动手');
  const code = ui.host.querySelector<HTMLTextAreaElement>('[aria-label="你的代码"]')!;
  await act(async () => {
    code.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
    code.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true}));
  });
  await ui.click('运行代码');
  expect(executions).toBe(0);
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
  expect(ui.value().attempts).toHaveLength(0);
  await act(async () => code.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})));
  await ui.click('运行代码');
  expect(executions).toBe(1);
});

it('doesNotMountElectronOrMonaco', async () => {
  expect((window as any).workbench).toBeUndefined();
  const ui = await mount(async code => passedGreeting(code));
  expect(ui.host.textContent).toContain('最小例子');
  await ui.click('我学过了，开始动手');
  expect(ui.host.querySelector('textarea[aria-label="你的代码"]')).not.toBeNull();
  expect(ui.host.querySelector('.monaco-editor')).toBeNull();
  expect(ui.value().attempts).toHaveLength(0);
});

it('rejects oversized explanation input without truncating the existing draft', async () => {
  const ui = await mount(async code => passedGreeting(code));
  await ui.click('我学过了，开始动手');
  const explanation = '函数把收到的名字与欢迎前缀拼接，再返回新的字符串。';
  await ui.input('用自己的话解释', explanation);
  await ui.input('用自己的话解释', '字'.repeat(20001));
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toBe(explanation);
  expect(ui.drafts()['functions:practice'].explanation).toBe(explanation);
  expect(ui.host.querySelector('[role="alert"]')!.textContent).toContain('20000');
});


it('retains the desktop void callback contract without browser draft props', async () => {
  const ui = await mount(async code => passedGreeting(code), emptyLab(), {desktop: true});
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  await ui.input('用自己的话解释', '用参数接收名字，然后把名字与欢迎前缀连接并返回。');
  await ui.click('保存此次产出');
  expect(ui.value().attempts).toHaveLength(1);
  expect(ui.button('已保存此次产出').disabled).toBe(true);
});

it('cancels a stale execution when an external draft restore replaces the current task view', async () => {
  let signal: AbortSignal | undefined;
  let resolve!: (run: LabRun) => void;
  const ui = await mount((_code, _task, activeSignal) => {
    signal = activeSignal;
    return new Promise<LabRun>(done => {resolve = done;});
  });
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.click('运行代码');
  const restored = passedGreeting(greetingCode);
  restored.logs = ['恢复备份里的历史日志'];
  await ui.replaceDrafts({'functions:practice': {
    explanation: '这是从备份恢复的解释，运行需要重新执行。',
    lastRun: restored, updatedAt: '2026-10-04T03:00:00.000Z',
  }});
  expect(signal?.aborted).toBe(true);
  expect(ui.button('运行代码').disabled).toBe(false);
  await act(async () => resolve(passedGreeting(greetingCode)));
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
  expect(ui.host.querySelector('[aria-label="上次运行结果"]')!.textContent).toContain('恢复备份里的历史日志');
  expect(ui.button('保存此次产出').disabled).toBe(true);
  await ui.input('你的代码', 'function greeting(name) { return "新的代码"; }');
  expect(ui.host.querySelector('[aria-label="上次运行结果"]')).toBeNull();
  expect(ui.drafts()['functions:practice'].lastRun).toBeNull();
});

it('restores explanation drafts independently for practice and transfer modes', async () => {
  let initial = beginLab(emptyLab(), 'functions', 'practice', '2026-10-03T03:00:00.000Z');
  initial.sessions['functions:practice'].code = greetingCode;
  initial.attempts = [{...passedGreeting(greetingCode), id: 'prior-pass', unitId: 'functions', mode: 'practice', helpLevel: 'independent', explanation: '把输入名字拼到欢迎前缀后，再返回给调用者。', passed: true, createdAt: '2026-10-03T03:00:00.000Z'}];
  initial = beginLab(initial, 'functions', 'transfer', '2026-10-04T03:00:00.000Z');
  const ui = await mount(async code => passedGreeting(code), initial, {drafts: {
    'functions:practice': {explanation: '基础任务的解释保存在基础任务。', lastRun: null, updatedAt: '2026-10-04T03:00:00.000Z'},
    'functions:transfer': {explanation: '隔日变式的解释独立保存在变式。', lastRun: null, updatedAt: '2026-10-04T03:00:00.000Z'},
  }});
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toContain('基础任务');
  await ui.click('隔日变式');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toContain('隔日变式');
  await ui.input('用自己的话解释', '编辑变式的解释，基础任务的草稿仍独立保存。');
  await ui.click('基础任务');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toBe('基础任务的解释保存在基础任务。');
  await ui.click('隔日变式');
  expect(ui.host.querySelector<HTMLTextAreaElement>('[aria-label="用自己的话解释"]')!.value).toContain('编辑变式');
});


it.each([false, true])('keeps a fresh run saveable after strict draft projection changes key order (optional undefined: %s)', async optionalUndefined => {
  const ui = await mount(async code => {
    const fresh = passedGreeting(code);
    // Mirrors the Worker check field order, which differs from strict projection.
    fresh.checks = fresh.checks.map((check, index) => ({
      input: [["小林", "Ada", "同学"][index]], expected: check.expected,
      actual: check.actual, label: check.label, passed: check.passed,
      ...(optionalUndefined ? {error: undefined} : {}),
    }));
    return fresh;
  }, emptyLab(), {projectDrafts: (next, lab) => {
    const document = emptyBrowserDocument();
    document.state.lab = lab;
    document.drafts.lab = next;
    return validateBrowserDocument(document).drafts.lab;
  }});
  await ui.click('我学过了，开始动手');
  await ui.input('你的代码', greetingCode);
  await ui.input('用自己的话解释', '收到名字参数后，把名字与欢迎前缀拼接并返回。');
  await ui.click('运行代码');
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).not.toBeNull();
  expect(ui.host.querySelector('[aria-label="上次运行结果"]')).toBeNull();
  expect(ui.button('保存此次产出').disabled).toBe(false);
  await ui.click('保存此次产出');
  expect(ui.value().attempts).toHaveLength(1);
  expect(ui.value().attempts[0].passed).toBe(true);
  expect(ui.button('已保存此次产出').disabled).toBe(true);
  // A genuinely different restored draft must still revoke fresh save eligibility.
  await ui.replaceDrafts({'functions:practice': {
    ...ui.drafts()['functions:practice'], explanation: '另一次恢复得到的解释，需要重新运行当前代码。',
    updatedAt: '2026-10-04T03:00:00.000Z',
  }});
  expect(ui.host.querySelector('[aria-label="本次运行结果"]')).toBeNull();
  expect(ui.host.querySelector('[aria-label="上次运行结果"]')).not.toBeNull();
  expect(ui.button('保存此次产出').disabled).toBe(true);
});
