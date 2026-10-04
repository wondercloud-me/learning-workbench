// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, expect, it} from 'vitest';
import {LoginControl, ReminderControls} from '../src/renderer/system-controls';
import type {DailyReminderStatus, LoginStatus, NotificationTestStatus} from '../src/core/system-controls';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounts: Array<{host: HTMLDivElement; root: Root}> = [];
afterEach(async () => {for (const {host, root} of mounts.splice(0)) {await act(async () => root.unmount()); host.remove();}});
async function mount(node: React.ReactNode) {const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounts.push({host, root}); await act(async () => root.render(node)); return host;}
const deferred = <T,>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
const click = async (host: HTMLElement, text: string) => {const button = [...host.querySelectorAll('button')].find(b => b.textContent === text); if (!button) throw new Error(`missing ${text}`); await act(async () => button.click());};
const loginStatus = (patch: Partial<LoginStatus> = {}): LoginStatus => ({platform: 'darwin', supported: true, configurable: true, requestedPreference: false, openAtLogin: false, mac: {status: 'not-registered', wasOpenedAtLogin: false}, windows: null, errors: [], ...patch});
const daily: DailyReminderStatus = {lastAttempt: null, readError: null, storageError: null};
const testResult: NotificationTestStatus = {requestId: 'test-1', status: 'requested', at: '2026-10-05T13:00:00Z', error: null};

it('starts login as unknown, catches initial IPC failures and allows refresh without inventing disabled status', async () => {
  const request = deferred<LoginStatus>(); let calls = 0;
  const host = await mount(<LoginControl api={{loginStatus: () => ++calls === 1 ? request.promise : Promise.resolve(loginStatus()), setLogin: async () => loginStatus()}}/>);
  expect(host.textContent).toContain('状态未知'); expect(host.querySelector('input')?.disabled).toBe(true);
  await act(async () => request.resolve(loginStatus({openAtLogin: null, errors: [{code: 'login-system-read', message: '系统登录项状态无法读取。'}]})));
  expect(host.textContent).toContain('系统登录项状态无法读取'); expect(host.textContent).toContain('状态未知');
  await click(host, '刷新登录项状态'); expect(host.textContent).toContain('系统报告已关闭');
  const failed = await mount(<LoginControl api={{loginStatus: async () => {throw new Error('PRIVATE');}, setLogin: async () => loginStatus()}}/>);
  expect(failed.textContent).toContain('状态未知'); expect(failed.textContent).toContain('读取登录项状态失败'); expect(failed.textContent).not.toContain('PRIVATE');
});

it('shows macOS approval and Windows system disablement alongside saved intent', async () => {
  const mac = await mount(<LoginControl api={{loginStatus: async () => loginStatus({requestedPreference: true, openAtLogin: true, mac: {status: 'requires-approval', wasOpenedAtLogin: false}}), setLogin: async () => loginStatus()}}/>);
  expect(mac.textContent).toContain('待系统批准'); expect(mac.textContent).toContain('保存偏好：开启');
  const win = await mount(<LoginControl api={{loginStatus: async () => loginStatus({platform: 'win32', requestedPreference: true, openAtLogin: true, mac: null, windows: {executableWillLaunchAtLogin: false, launchItems: []}}), setLogin: async () => loginStatus()}}/>);
  expect(win.textContent).toContain('已登记，系统已禁用'); expect(win.querySelector('input')?.checked).toBe(false);
});

it('reports login toggle failures without replacing the last known system report', async () => {
  const host = await mount(<LoginControl api={{loginStatus: async () => loginStatus(), setLogin: async () => {throw new Error('PRIVATE');}}}/>);
  await act(async () => host.querySelector('input')!.click());
  expect(host.textContent).toContain('登录项修改请求失败'); expect(host.textContent).not.toContain('PRIVATE');
  expect(host.querySelector('input')!.checked).toBe(false);
});

it('ignores an old initial login response after a newer refresh', async () => {
  const initial = deferred<LoginStatus>(); let calls = 0;
  const host = await mount(<LoginControl api={{loginStatus: () => ++calls === 1 ? initial.promise : Promise.resolve(loginStatus({openAtLogin: true})), setLogin: async () => loginStatus()}}/>);
  await click(host, '刷新登录项状态'); await act(async () => initial.resolve(loginStatus()));
  expect(host.textContent).toContain('系统报告已启用'); expect(host.querySelector('input')!.checked).toBe(true);
});

it('manual test works while daily reminder is off, blocks duplicate pending clicks, and refreshes late callbacks', async () => {
  const pending = deferred<NotificationTestStatus>(); let tests = 0;
  const host = await mount(<ReminderControls enabled={false} date="" time="20:00" onChange={() => {}} api={{reminderStatus: async () => daily, notificationTestStatus: async () => ({...testResult, status: 'shown'}), testNotification: () => {tests++; return pending.promise;}}}/>);
  await click(host, '测试通知'); const button = [...host.querySelectorAll('button')].find(b => b.textContent === '正在测试…')!;
  expect(button.disabled).toBe(true); await act(async () => button.click()); expect(tests).toBe(1);
  await act(async () => pending.resolve(testResult)); expect(host.textContent).toContain('已请求，尚未确认显示');
  expect(host.textContent).toContain('最近每日提醒：无记录'); expect(host.textContent).toContain('应用进程运行');
  await click(host, '刷新测试结果'); expect(host.textContent).toContain('系统回调已确认显示');
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});

it('keeps failed daily records separate from manual results and catches all query/test rejections', async () => {
  const api = {reminderStatus: async () => ({...daily, lastAttempt: {date: '2026-10-05', requestId: 'daily-1', at: testResult.at, status: 'failed' as const, error: {code: 'notification-failed' as const, message: '系统报告通知显示失败。'}}}), notificationTestStatus: async () => null, testNotification: async () => ({...testResult, status: 'unsupported' as const})};
  const host = await mount(<ReminderControls enabled={true} date="" time="20:00" onChange={() => {}} api={api}/>);
  expect(host.textContent).toContain('最近每日提醒：2026-10-05'); expect(host.textContent).toContain('显示失败');
  await click(host, '测试通知'); expect(host.textContent).toContain('系统不支持通知'); expect(host.textContent).toContain('最近每日提醒：2026-10-05');
  api.reminderStatus = async () => {throw new Error('PRIVATE');}; api.notificationTestStatus = async () => {throw new Error('PRIVATE');}; api.testNotification = async () => {throw new Error('PRIVATE');};
  await click(host, '检查最近每日提醒'); await click(host, '刷新测试结果'); await click(host, '测试通知');
  expect(host.textContent).toContain('读取每日提醒状态失败'); expect(host.textContent).toContain('测试通知请求失败'); expect(host.textContent).not.toContain('PRIVATE');
});

it('ignores an old test refresh response after a newer manual request', async () => {
  const refresh = deferred<NotificationTestStatus | null>();
  const host = await mount(<ReminderControls enabled={false} date="" time="20:00" onChange={() => {}} api={{reminderStatus: async () => daily, notificationTestStatus: () => refresh.promise, testNotification: async () => ({...testResult, requestId: 'new'})}}/>);
  await click(host, '刷新测试结果'); await click(host, '测试通知');
  await act(async () => refresh.resolve({...testResult, requestId: 'old', status: 'shown'}));
  expect(host.textContent).toContain('已请求，尚未确认显示'); expect(host.textContent).not.toContain('系统回调已确认显示');
});

it('shows a suppressed daily reservation as not sent with its reason', async () => {
  const host = await mount(<ReminderControls enabled={false} date="" time="20:00" onChange={() => {}} api={{reminderStatus: async () => ({...daily, lastAttempt: {date: '2026-10-05', requestId: 'daily-1', at: testResult.at, status: 'suppressed', suppressionReason: 'disabled', error: null}}), notificationTestStatus: async () => null, testNotification: async () => testResult}}/>);
  expect(host.textContent).toContain('本次未发送'); expect(host.textContent).toContain('每日提醒已关闭');
  expect(host.textContent).not.toContain('已请求，尚未确认显示');
});
