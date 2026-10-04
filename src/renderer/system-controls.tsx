import React, {useEffect, useRef, useState} from 'react';
import type {DailyReminderStatus, LoginStatus, NotificationTestStatus} from '../core/system-controls';

type LoginApi = Pick<Window['workbench'], 'loginStatus' | 'setLogin'>;
type ReminderApi = Pick<Window['workbench'], 'reminderStatus' | 'testNotification' | 'notificationTestStatus'>;
function loginDescription(status: LoginStatus | null): string {
  if (!status) return '状态未知';
  if (!status.supported) return '此平台不支持登录项';
  if (status.openAtLogin === null) return '状态未知';
  if (status.mac?.status === 'requires-approval') return '待系统批准，请在系统登录项设置中确认';
  if (status.windows && status.openAtLogin && status.windows.executableWillLaunchAtLogin === false) return '已登记，系统已禁用';
  return status.openAtLogin ? '系统报告已启用' : '系统报告已关闭';
}
const notificationDescription = (status: string) => ({requested: '已请求，尚未确认显示', attempted: '已请求，尚未确认显示', shown: '系统回调已确认显示', failed: '发送或显示失败', unsupported: '系统不支持通知'}[status] || '状态未知');
const dailyDescription = (record: NonNullable<DailyReminderStatus['lastAttempt']>) => record.status === 'suppressed'
  ? `本次未发送（${({'checked-in': '当天已打卡', disabled: '每日提醒已关闭', 'not-due': '当前日期或时间不符合提醒条件', 'date-changed': '本地日期已改变', superseded: '已有较新的提醒尝试', 'eligibility-unavailable': '无法确认当前提醒条件'} as const)[record.suppressionReason!] || '提醒条件已改变'}）`
  : notificationDescription(record.status);

export function LoginControl({api = window.workbench}: {api?: LoginApi}) {
  const [status, setStatus] = useState<LoginStatus | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const inFlight = useRef(false), checkbox = useRef<HTMLInputElement>(null), generation = useRef(0);
  const read = async () => {
    if (inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true; setPending(true); setError('');
    try {const value = await api.loginStatus(); if (request === generation.current) setStatus(value);}
    catch {if (request === generation.current) {setStatus(null); setError('读取登录项状态失败，状态未知。');}}
    finally {inFlight.current = false; setPending(false);}
  };
  useEffect(() => {const request = ++generation.current; let current = true; api.loginStatus().then(value => {if (current && request === generation.current) setStatus(value);}).catch(() => {if (current && request === generation.current) setError('读取登录项状态失败，状态未知。');}); return () => {current = false;};}, [api]);
  useEffect(() => {if (checkbox.current) checkbox.current.indeterminate = !status || status.openAtLogin === null;}, [status]);
  const toggle = async (enabled: boolean) => {
    if (inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true; setPending(true); setError('');
    try {const value = await api.setLogin(enabled); if (request === generation.current) setStatus(value);}
    catch {if (request === generation.current) setError('登录项修改请求失败，请刷新系统状态。');}
    finally {inFlight.current = false; setPending(false);}
  };
  const actual = status?.windows?.executableWillLaunchAtLogin ?? status?.openAtLogin;
  return <div><label><input ref={checkbox} type="checkbox" checked={actual === true} disabled={pending || !status?.configurable || status.openAtLogin === null} onChange={event => void toggle(event.target.checked)}/> 登录时启动</label>
    <p aria-live="polite">{loginDescription(status)}</p>
    <small>保存偏好：{status?.requestedPreference === true ? '开启' : status?.requestedPreference === false ? '关闭' : '未选择或无法读取'}</small>
    {status?.supported && !status.configurable && <small>开发运行不可设置登录项，请使用打包应用。</small>}
    <button disabled={pending} onClick={() => void read()}>刷新登录项状态</button>
    {error && <p role="alert">{error}</p>}{status?.errors.map(item => <p role="alert" key={item.code}>{item.message}</p>)}
  </div>;
}

export function ReminderControls({enabled, date, time, onChange, api = window.workbench}: {
  enabled: boolean; date: string; time: string;
  onChange(change: {reminderEnabled?: boolean; reminderDate?: string; reminderTime?: string}): void;
  api?: ReminderApi;
}) {
  const [daily, setDaily] = useState<DailyReminderStatus | null>(null), [dailyError, setDailyError] = useState('');
  const [test, setTest] = useState<NotificationTestStatus | null>(null), [testError, setTestError] = useState(''), [pending, setPending] = useState(false);
  const testing = useRef(false), dailyGeneration = useRef(0), testGeneration = useRef(0);
  useEffect(() => {const request = ++dailyGeneration.current; let current = true; api.reminderStatus().then(value => {if (current && request === dailyGeneration.current) setDaily(value);}).catch(() => {if (current && request === dailyGeneration.current) setDailyError('读取每日提醒状态失败，状态未知。');}); return () => {current = false;};}, [api]);
  const refreshDaily = async () => {const request = ++dailyGeneration.current; setDailyError(''); try {const value = await api.reminderStatus(); if (request === dailyGeneration.current) setDaily(value);} catch {if (request === dailyGeneration.current) {setDaily(null); setDailyError('读取每日提醒状态失败，状态未知。');}}};
  const refreshTest = async () => {if (testing.current) return; const request = ++testGeneration.current; setTestError(''); try {const value = await api.notificationTestStatus(); if (request === testGeneration.current) setTest(value);} catch {if (request === testGeneration.current) {setTest(null); setTestError('读取测试通知结果失败，状态未知。');}}};
  const runTest = async () => {
    if (testing.current) return;
    const request = ++testGeneration.current;
    testing.current = true; setPending(true); setTestError(''); setTest(null);
    try {const value = await api.testNotification(); if (request === testGeneration.current) setTest(value);}
    catch {if (request === testGeneration.current) setTestError('测试通知请求失败，结果未知。');}
    finally {testing.current = false; setPending(false);}
  };
  return <>
    <div className="panel-card"><h2>每日提醒</h2>
      <label><input type="checkbox" checked={enabled} onChange={event => onChange({reminderEnabled: event.target.checked})}/> 开启每日提醒</label>
      <label>开始日期<input type="date" value={date} onChange={event => onChange({reminderDate: event.target.value})}/></label>
      <label>提醒时间<input type="time" value={time} onChange={event => onChange({reminderTime: event.target.value})}/></label>
      <p>每天最多自动尝试一次；当天打卡后不再发送。提醒需要应用进程运行，包括留在托盘或菜单栏时；退出应用后不会发送。</p>
      <button onClick={() => void refreshDaily()}>检查最近每日提醒</button>
      <p aria-live="polite">{!daily ? '最近每日提醒：状态未知' : daily.readError ? '最近每日提醒：历史无法读取，自动限频状态未知' : daily.lastAttempt ? `最近每日提醒：${daily.lastAttempt.date} · ${dailyDescription(daily.lastAttempt)}` : '最近每日提醒：无记录'}</p>
      {dailyError && <p role="alert">{dailyError}</p>}{daily?.readError && <p role="alert">{daily.readError.message}</p>}{daily?.storageError && <p role="alert">{daily.storageError.message}</p>}{daily?.lastAttempt?.error && <p role="alert">{daily.lastAttempt.error.message}</p>}
    </div>
    <div className="panel-card"><h2>测试通知</h2><p>发送一条独立测试通知，可在每日提醒关闭时使用。不会消耗当天自动提醒次数或修改打卡。</p>
      <div className="button-row"><button disabled={pending} onClick={() => void runTest()}>{pending ? '正在测试…' : '测试通知'}</button><button disabled={pending} onClick={() => void refreshTest()}>刷新测试结果</button></div>
      <p aria-live="polite">{pending ? '正在请求系统通知…' : test ? notificationDescription(test.status) : '测试结果：尚无已读取结果'}</p>
      {testError && <p role="alert">{testError}</p>}{test?.error && <p role="alert">{test.error.message}</p>}
    </div>
  </>;
}
