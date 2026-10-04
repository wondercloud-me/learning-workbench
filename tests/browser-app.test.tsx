// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import {IDBFactory} from 'fake-indexeddb';
import {emptyBrowserDocument, type BrowserDocument, type BrowserSnapshot} from '../src/core/browser-state';
import {createBrowserController, type BrowserController} from '../src/browser/controller';
import {openBrowserRepository, type BrowserRepository} from '../src/browser/repository';
import {BrowserApp} from '../src/browser/app';
import {createBackup, readBackup} from '../src/core/backup';
import {beginLab, setLabCode} from '../src/core/lab';
import type {PwaReadiness} from '../src/browser/pwa';

const pwaCapture = vi.hoisted(() => ({readiness: null as PwaReadiness | null}));
vi.mock('../src/renderer/lab-client', () => ({executeLab: async () => {throw new Error('本输入回归不执行代码');}}));
vi.mock('../src/browser/pwa', () => ({registerBrowserPwa: async (_base: string, readiness: PwaReadiness) => {pwaCapture.readiness = readiness; return ({
  status: () => ({phase: 'not-ready', install: 'unsupported', message: '测试离线状态'}),
  subscribe: () => () => {}, install: async () => 'unsupported', requestUpdate: async () => false, dispose: () => {},
});}}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{host: HTMLDivElement; root: Root}> = [];
const realControllers: BrowserController[] = [];
const realRepositories: BrowserRepository[] = [];
afterEach(async () => {for (const {host, root} of mounted.splice(0)) {await act(async () => root.unmount()); host.remove();} realControllers.splice(0).forEach(c => c.close()); realRepositories.splice(0).forEach(r => r.close());});

function memoryController(initial = emptyBrowserDocument()) {
  let document = initial;
  let revision = 0;
  const listeners = new Set<() => void>();
  const snapshot = (): BrowserSnapshot => ({schemaVersion: 1, revision, updatedAt: '2026-10-05T00:00:00.000Z', document});
  const controller = {
    snapshot, pendingDocument: () => document,
    subscribe: (listener: () => void) => {listeners.add(listener); return () => listeners.delete(listener);},
    change: async (mutator: (latest: BrowserDocument) => BrowserDocument) => {document = mutator(document); revision++; listeners.forEach(fn => fn()); return snapshot();},
    flush: async () => {}, replace: async (next: BrowserDocument) => {document = next; revision++; listeners.forEach(fn => fn()); return snapshot();},
    isBusy: () => false, hasPending: () => false, storageStatus: () => 'saved' as const,
    recoveries: async () => [], reloadLatest: async () => snapshot(), close: () => {},
    acquireUpdateLock: () => () => {},
    withOperation: async <T,>(_kind: string, operation: () => Promise<T>) => operation(),
  } as BrowserController;
  return controller;
}
async function mount(initial?: BrowserDocument, providedController?: BrowserController) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); mounted.push({host, root});
  const controller = providedController ?? memoryController(initial);
  await act(async () => root.render(<BrowserApp controller={controller}/>));
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === label);
    if (!button) throw new Error(`找不到按钮：${label}`);
    await act(async () => button.click());
  };
  return {host, controller, click};
}

it('starts without Electron or Monaco and intro adds no learning evidence', async () => {
  expect((window as any).workbench).toBeUndefined();
  const ui = await mount();
  expect(ui.host.textContent).toContain('先看一个例子');
  await ui.click('开始学习');
  expect(ui.host.textContent).toContain('参数是送进去的材料');
  expect(ui.host.querySelector('[aria-label="你的代码"]')).toBeNull();
  expect(ui.controller.pendingDocument().state.lab.attempts).toEqual([]);
  expect(ui.controller.pendingDocument().state.columns).toEqual([]);
  expect(ui.controller.pendingDocument().state.checkins).toEqual([]);
  expect(ui.host.querySelector('.monaco-editor')).toBeNull();
});

it('keeps real source links and user references separate from verified lessons', async () => {
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  const ui = await mount(initial);
  await ui.click('资料');
  expect(ui.host.textContent).toContain('菜鸟教程');
  const external = [...ui.host.querySelectorAll<HTMLAnchorElement>('a')].filter(a => a.hostname === 'www.runoob.com');
  expect(external.length).toBeGreaterThan(0);
  expect(external.every(a => a.target === '_blank' && a.rel.includes('noopener'))).toBe(true);
  expect(ui.host.querySelector('iframe')).toBeNull();
  expect(ui.controller.pendingDocument().state.columns).toEqual([]);
});

it('keeps acknowledged update readiness clean when a course link is dispatched, then resumes after release', async () => {
  const repository = await openBrowserRepository(new IDBFactory()); realRepositories.push(repository);
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  await repository.commit(initial, 0);
  const controller = await createBrowserController(repository); realControllers.push(controller);
  const ui = await mount(undefined, controller); await ui.click('资料');
  const reference = ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="选取的片段"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reference, '已经保存的原文片段');
    reference.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await ui.click('保存参考片段');
  await act(async () => {await controller.flush();});
  const readiness = pwaCapture.readiness!;
  const before = controller.snapshot();
  const url = ui.host.querySelector<HTMLInputElement>('input[aria-label="原文地址"]')!;
  const course = ui.host.querySelector<HTMLAnchorElement>('.browser-courses a')!;
  let release: (() => void) | undefined;
  try {
    await act(async () => {release = readiness.acquireUpdateLock();});
    // The same clean check supplies PREPARE and COMMIT acknowledgements while retaining the lock.
    await readiness.flush(); await readiness.flush();
    expect(readiness.isBusy()).toBe(false); expect(readiness.hasPending()).toBe(false);
    const heldClick = new MouseEvent('click', {bubbles: true, cancelable: true});
    // jsdom's .click() wrongly suppresses anchors in disabled fieldsets; dispatch the actual React path.
    await act(async () => {course.dispatchEvent(heldClick);});
    expect(readiness.hasPending()).toBe(false);
    expect(url.value).toBe(initial.state.reading.url);
    expect(reference.value).toBe('已经保存的原文片段');
    expect(controller.pendingDocument()).toEqual(before.document);
    expect(controller.snapshot()).toEqual(before);
    expect(ui.host.querySelector('[role="alert"]')).toBeNull();
    expect(heldClick.defaultPrevented).toBe(true);
    expect(ui.host.querySelector('.browser-interactive')!.hasAttribute('inert')).toBe(true);
    expect(ui.host.querySelector('.browser-interactive')!.getAttribute('aria-disabled')).toBe('true');
    expect(course.getAttribute('aria-disabled')).toBe('true'); expect(course.tabIndex).toBe(-1);
    const savedLink = ui.host.querySelector<HTMLAnchorElement>('details a')!;
    const heldSavedClick = new MouseEvent('click', {bubbles: true, cancelable: true});
    await act(async () => {savedLink.dispatchEvent(heldSavedClick);});
    expect(heldSavedClick.defaultPrevented).toBe(true);
    expect(savedLink.getAttribute('aria-disabled')).toBe('true'); expect(savedLink.tabIndex).toBe(-1);
    await act(async () => {release!();}); release = undefined;
    expect(ui.host.querySelector('.browser-interactive')!.hasAttribute('inert')).toBe(false);
    expect(ui.host.querySelector('.browser-interactive')!.getAttribute('aria-disabled')).toBeNull();
    expect(course.getAttribute('aria-disabled')).toBeNull(); expect(course.tabIndex).toBe(0);
    expect(savedLink.getAttribute('aria-disabled')).toBeNull(); expect(savedLink.tabIndex).toBe(0);
    const resumedClick = new MouseEvent('click', {bubbles: true, cancelable: true});
    await act(async () => {course.dispatchEvent(resumedClick); await controller.flush();});
    expect(resumedClick.defaultPrevented).toBe(false);
    expect(course.target).toBe('_blank'); expect(course.rel).toContain('noopener');
    expect(url.value).toBe('https://www.runoob.com/python3/python3-tutorial.html');
    expect(controller.pendingDocument().state.reading).toEqual({url: 'https://www.runoob.com/python3/python3-tutorial.html', title: 'Python'});
    expect(readiness.hasPending()).toBe(true);
    expect(controller.pendingDocument().drafts.references).toEqual(before.document.drafts.references);
  } finally {if (release) await act(async () => release!());}
});

it('shows an unsaved status globally and has an export path', async () => {
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  const controller = memoryController(initial);
  controller.storageStatus = () => 'unsaved'; controller.hasPending = () => true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); mounted.push({host, root});
  await act(async () => root.render(<BrowserApp controller={controller}/>));
  expect(host.querySelector('[role="status"]')!.textContent).toContain('尚未保存');
  const settings = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === '设置')!;
  await act(async () => settings.click());
  expect(host.textContent).toContain('导出待存备份');
});

it('labels phone project and system limits and preserves imported records', async () => {
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  initial.state.checkins = [{date: '2026-10-04', columnId: 'old', note: '原始备份记录'}];
  const ui = await mount(initial);
  await ui.click('记录');
  expect(ui.host.textContent).toContain('原始备份记录');
  await ui.click('设置');
  expect(ui.host.textContent).toContain('Docker');
  expect(ui.host.textContent).toContain('桌面');
  expect(ui.host.textContent).not.toContain('已连接模型');
});

async function chooseFile(host: HTMLElement, contents: unknown, size?: number) {
  const file = new File(['fixture'], 'learning-backup.json', {type: 'application/json'});
  Object.defineProperty(file, 'text', {value: async () => JSON.stringify(contents)});
  if (size !== undefined) Object.defineProperty(file, 'size', {value: size});
  const input = host.querySelector<HTMLInputElement>('input[aria-label="选择备份文件"]')!;
  Object.defineProperty(input, 'files', {configurable: true, value: [file]});
  await act(async () => {input.dispatchEvent(new Event('change', {bubbles: true}));});
}

it('rejects future and oversized import files without replacing current learning', async () => {
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  initial.state.checkins = [{date: '2026-10-04', columnId: 'old', note: '不能丢掉的原记录'}];
  const ui = await mount(initial); await ui.click('设置');
  await chooseFile(ui.host, {format: 'growth-workbench', schemaVersion: 2});
  expect(ui.host.textContent).toContain('未来版本');
  expect(ui.controller.pendingDocument()).toEqual(initial);
  await chooseFile(ui.host, {}, 50 * 1024 * 1024 + 1);
  expect(ui.host.textContent).toContain('超过 50 MiB');
  expect(ui.controller.pendingDocument()).toEqual(initial);
  expect(ui.host.textContent).not.toContain('确认恢复备份');
});

it('previews import and cancellation never writes it into current document', async () => {
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  const incoming = emptyBrowserDocument(); incoming.state.checkins = [{date: '2026-10-04', columnId: 'fixture', note: '导入文件的记录'}];
  const ui = await mount(initial); await ui.click('设置');
  await chooseFile(ui.host, createBackup(incoming, '0.9.0', '2026-10-05T00:00:00.000Z'));
  expect(ui.host.textContent).toContain('导入预览');
  expect(ui.controller.pendingDocument()).toEqual(initial);
  await ui.click('取消导入');
  expect(ui.host.textContent).not.toContain('确认恢复备份');
  expect(ui.controller.pendingDocument()).toEqual(initial);
});

it('replaces a validated import only after explicit confirmation', async () => {
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  const incoming = emptyBrowserDocument(); incoming.state.onboarding.introSeen = true;
  incoming.state.checkins = [{date: '2026-10-04', columnId: 'fixture', note: '导入文件的记录'}];
  const ui = await mount(initial); await ui.click('设置');
  await chooseFile(ui.host, createBackup(incoming, '0.9.0', '2026-10-05T00:00:00.000Z'));
  await ui.click('确认恢复备份');
  expect(ui.controller.pendingDocument()).toEqual(incoming);
  await ui.click('记录'); expect(ui.host.textContent).toContain('导入文件的记录');
});

it.each(['conflict', 'versionchange'] as const)('keeps exact typed code through navigation and pending export after %s with real storage', async failure => {
  const factory = new IDBFactory(); const now = '2026-10-05T10:00:00.000Z';
  const repository = await openBrowserRepository(factory, () => now); realRepositories.push(repository);
  const initial = emptyBrowserDocument(); initial.state.onboarding.introSeen = true;
  initial.state.lab = setLabCode(beginLab(initial.state.lab, 'functions', 'practice', now), 'functions', 'practice', 'function greeting(name) { return name; }');
  await repository.commit(initial, 0);
  const controller = await createBrowserController(repository); realControllers.push(controller);
  const ui = await mount(undefined, controller);
  if (failure === 'conflict') {
    const remote = await openBrowserRepository(factory, () => now); realRepositories.push(remote);
    let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
    const commit = repository.commit; repository.commit = async (document, revision) => {await gate; return commit(document, revision);};
    let saving!: Promise<BrowserSnapshot>;
    await act(async () => {saving = controller.change(document => ({...document, drafts: {...document.drafts, messages: {main: '待存输入'}}})); void saving.catch(() => {});});
    await act(async () => {
      const latest = (await remote.load()).document;
      await remote.commit({...latest, state: {...latest.state, lab: setLabCode(latest.state.lab, 'functions', 'practice', 'function greeting(name) { return "remote"; }')}}, 1);
      release(); await expect(saving).rejects.toMatchObject({code: 'revision-conflict'});
    });
    expect(controller.storageStatus()).toBe('conflict');
  } else {
    await act(async () => {
      const request = factory.open('growth-workbench', 2);
      await new Promise<void>((resolve, reject) => {request.onsuccess = () => {request.result.close(); resolve();}; request.onerror = () => reject(request.error);});
    });
    expect(controller.storageStatus()).toBe('unavailable');
  }
  const field = ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="你的代码"]')!;
  const text = 'function greeting(name) { return name; }\n// KEEP THIS INPUT  用户继续写出的代码';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {setter.call(field, text); field.dispatchEvent(new Event('input', {bubbles: true}));});
  expect(field.value).toBe(text);
  expect(controller.pendingDocument().state.lab.sessions['functions:practice'].code).toBe(text);
  await ui.click('资料'); await ui.click('学习');
  expect(ui.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="你的代码"]')!.value).toBe(text);
  await ui.click('设置'); expect(ui.host.textContent).toContain('导出待存备份');
  expect(readBackup(createBackup(controller.pendingDocument(), '0.9.0', now)).state.lab.sessions['functions:practice'].code).toBe(text);
  expect(controller.snapshot().document.state.lab.sessions['functions:practice'].code).toBe('function greeting(name) { return name; }');
});
