// @vitest-environment jsdom
import React, {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it} from 'vitest';
import {emptyLab, type LabRun, type LabState} from '../src/core/lab';
import {LabPanel, type LabPanelProps} from '../src/renderer/lab-panel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{host: HTMLDivElement; root: Root}> = [];
afterEach(async () => {
  for (const {host, root} of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
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
async function mount(execute: LabPanelProps['execute'], initial = emptyLab()) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({host, root});
  let value = initial;
  function Harness() {
    const [state, setState] = useState(initial);
    return <LabPanel value={state} execute={execute} onChange={next => {value = next; setState(next);}}/>;
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
  return {host, root, button, click, input, value: () => value};
}

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
