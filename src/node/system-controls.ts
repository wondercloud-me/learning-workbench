import {randomUUID} from 'node:crypto';
import {reminderDue} from '../core/reminders';
import {desktopAppId, type DailyReminderRecord, type DailyReminderStatus, type DailyReminderSuppression, type LoginLaunchItem, type LoginStatus, type MacLoginStatus, type NotificationAttemptStatus, type NotificationTestStatus, type SystemControlError, type SystemControlErrorCode} from '../core/system-controls';

interface TextStorage {read(): Promise<string>; write(value: string): Promise<void>;}
interface LoginQueryOptions {name?: string; path?: string; args?: string[];}
interface LoginWriteOptions extends LoginQueryOptions {openAtLogin: boolean; enabled?: boolean;}
interface NativeLoginReport {openAtLogin?: boolean; status?: string; wasOpenedAtLogin?: boolean; executableWillLaunchAtLogin?: boolean; launchItems?: LoginLaunchItem[];}
interface LoginDependencies {
  platform: string; isPackaged: boolean; execPath: string; storage: TextStorage;
  api: {get(options?: LoginQueryOptions): NativeLoginReport; set(options: LoginWriteOptions): void;};
}
const messages: Record<SystemControlErrorCode, string> = {
  'login-read': '保存的启动偏好无法读取，未自动修改登录项。',
  'login-write': '启动偏好保存失败，未申请修改登录项。',
  'login-registration-write': '系统修改失败记录无法保存；启动偏好已保存。',
  'login-system-read': '系统登录项状态无法读取。',
  'login-system-write': '启动偏好已保存，但系统登录项修改失败。',
  'reminder-read': '最近每日提醒记录无法读取，自动提醒已暂停。',
  'reminder-write': '每日提醒记录保存失败；当天不会再次自动尝试。',
  'notification-support': '系统通知支持状态查询失败。',
  'notification-create': '系统通知创建失败。',
  'notification-show': '系统通知发送失败。',
  'notification-failed': '系统报告通知显示失败。',
};
const controlledError = (code: SystemControlErrorCode): SystemControlError => ({code, message: messages[code]});
const isMissing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input);
const bool = (input: unknown): boolean | null => typeof input === 'boolean' ? input : null;

export class LoginControls {
  private preference: boolean | null = null;
  private errors = new Map<SystemControlErrorCode, SystemControlError>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  constructor(private readonly dependencies: LoginDependencies) {}
  private get supported() {return this.dependencies.platform === 'darwin' || this.dependencies.platform === 'win32';}
  private get configurable() {return this.supported && this.dependencies.isPackaged;}
  private options(): LoginQueryOptions | undefined {return this.dependencies.platform === 'win32' ? {name: desktopAppId, path: this.dependencies.execPath, args: []} : undefined;}
  private enqueue<T>(action: () => Promise<T>): Promise<T> {const pending = this.queue.then(action); this.queue = pending.catch(() => {}); return pending;}
  async initialize(): Promise<LoginStatus> {
    if (!this.initialization) this.initialization = this.enqueue(async () => {
      let defaultAllowed = false;
      try {
        const input: unknown = JSON.parse(await this.dependencies.storage.read());
        if (input === null || object(input) && input.enabled === null) defaultAllowed = true;
        else if (object(input) && typeof input.enabled === 'boolean') this.preference = input.enabled;
        else throw new Error('invalid preference');
        if (object(input) && input.registrationError === 'login-system-write') this.errors.set('login-system-write', controlledError('login-system-write'));
      } catch (error) {
        if (isMissing(error)) defaultAllowed = true;
        else this.errors.set('login-read', controlledError('login-read'));
      }
      // Initialization is authorized once. Later launches and refreshes only query.
      if (defaultAllowed && this.configurable) await this.apply(true);
    });
    await this.initialization;
    return this.status();
  }
  private async apply(enabled: boolean): Promise<void> {
    try {await this.dependencies.storage.write(JSON.stringify({enabled}));}
    catch {this.errors.set('login-write', controlledError('login-write')); return;}
    this.preference = enabled;
    this.errors.delete('login-read'); this.errors.delete('login-write'); this.errors.delete('login-registration-write'); this.errors.delete('login-system-write');
    try {
      const options = {...this.options(), openAtLogin: enabled};
      this.dependencies.api.set(this.dependencies.platform === 'win32' ? {...options, enabled} : options);
    } catch {
      this.errors.set('login-system-write', controlledError('login-system-write'));
      // The saved intent prevents retries after restart even if this diagnostic write fails.
      try {await this.dependencies.storage.write(JSON.stringify({enabled, registrationError: 'login-system-write'}));}
      catch {this.errors.set('login-registration-write', controlledError('login-registration-write'));}
    }
  }
  async set(input: unknown): Promise<LoginStatus> {
    if (typeof input !== 'boolean') throw new Error('登录项设置必须是 boolean');
    if (!this.configurable) throw new Error(this.supported ? '开发运行不可设置登录项，请使用打包应用。' : '此平台不支持登录项设置。');
    await this.initialize();
    return this.enqueue(async () => {await this.apply(input); return this.readStatus();});
  }
  async status(): Promise<LoginStatus> {await this.queue; return this.readStatus();}
  private readStatus(): LoginStatus {
    let report: NativeLoginReport = {};
    this.errors.delete('login-system-read');
    if (this.supported) {
      try {report = this.dependencies.api.get(this.options());}
      catch {this.errors.set('login-system-read', controlledError('login-system-read'));}
    }
    const statuses: string[] = ['not-registered', 'enabled', 'requires-approval', 'not-found'];
    return {
      platform: this.dependencies.platform, supported: this.supported, configurable: this.configurable,
      requestedPreference: this.preference, openAtLogin: bool(report.openAtLogin),
      mac: this.dependencies.platform === 'darwin' ? {status: statuses.includes(report.status || '') ? report.status as MacLoginStatus : null, wasOpenedAtLogin: bool(report.wasOpenedAtLogin)} : null,
      windows: this.dependencies.platform === 'win32' ? {executableWillLaunchAtLogin: bool(report.executableWillLaunchAtLogin), launchItems: (report.launchItems || []).map(item => ({...item, args: [...item.args]}))} : null,
      errors: [...this.errors.values()].map(error => ({...error})),
    };
  }
}

interface NativeNotification {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  show(): void;
}
interface NotificationDependencies {
  storage: TextStorage;
  native: {supported(): boolean; create(payload: {title: string; body: string}): NativeNotification;};
  dailySettings(now: Date): DailySettings;
  focus(): void; now?: () => Date; requestId?: () => string; callbackWaitMs?: number; retentionMs?: number;
}
interface DailySettings {time: string; enabled: boolean; checkedIn: boolean; startDate: string;}
const suppressionReasons: DailyReminderSuppression[] = ['checked-in', 'disabled', 'not-due', 'date-changed', 'superseded', 'eligibility-unavailable'];
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function readReminder(input: unknown): DailyReminderRecord {
  if (!object(input) || !validDate(input.date) || !['attempted', 'requested', 'shown', 'failed', 'unsupported', 'suppressed'].includes(String(input.status)) || typeof input.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(input.at) || !validDate(input.at.slice(0, 10)) || !Number.isFinite(Date.parse(input.at))) throw new Error('invalid reminder');
  if (input.requestId !== undefined && input.requestId !== null && (typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 128)) throw new Error('invalid request id');
  if (['requested', 'failed', 'suppressed'].includes(String(input.status)) && typeof input.requestId !== 'string') throw new Error('missing request id');
  if (input.status === 'suppressed' && !suppressionReasons.includes(input.suppressionReason as DailyReminderSuppression)) throw new Error('invalid suppression reason');
  const error = object(input.error) && typeof input.error.code === 'string' && ['notification-support', 'notification-create', 'notification-show', 'notification-failed'].includes(input.error.code) ? controlledError(input.error.code as SystemControlErrorCode) : null;
  return {date: input.date, status: input.status as DailyReminderRecord['status'], at: input.at, requestId: typeof input.requestId === 'string' ? input.requestId : null, error, ...(input.status === 'suppressed' ? {suppressionReason: input.suppressionReason as DailyReminderSuppression} : {})};
}
const localDate = (now: Date) => [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');

export class NotificationControls {
  private daily: DailyReminderRecord | null = null;
  private lastAttemptDate: string | null = null;
  private readError: SystemControlError | null = null;
  private storageError: SystemControlError | null = null;
  private lastTest: NotificationTestStatus | null = null;
  private testPending: Promise<NotificationTestStatus> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  // Hold native objects for callbacks and click handling, including late display callbacks.
  private active = new Map<string, NativeNotification>();
  constructor(private readonly dependencies: NotificationDependencies) {}
  private now() {return (this.dependencies.now || (() => new Date()))();}
  private id() {return (this.dependencies.requestId || randomUUID)();}
  async initialize(): Promise<void> {
    if (!this.initialization) this.initialization = (async () => {
      try {this.daily = readReminder(JSON.parse(await this.dependencies.storage.read())); this.lastAttemptDate = this.daily.date;}
      catch (error) {if (!isMissing(error)) this.readError = controlledError('reminder-read');}
    })();
    await this.initialization;
  }
  status(): DailyReminderStatus {return {lastAttempt: this.daily ? {...this.daily} : null, readError: this.readError, storageError: this.storageError};}
  testStatus(): NotificationTestStatus | null {return this.lastTest ? {...this.lastTest} : null;}
  private persist(record: DailyReminderRecord): Promise<boolean> {
    const text = JSON.stringify(record);
    const pending = this.writes.then(async () => {
      try {await this.dependencies.storage.write(text); this.storageError = null; return true;}
      catch {this.storageError = controlledError('reminder-write'); return false;}
    });
    this.writes = pending.then(() => {});
    return pending;
  }
  test(): Promise<NotificationTestStatus> {
    if (this.testPending) return this.testPending;
    const record: NotificationTestStatus = {requestId: this.id(), status: 'requested', at: this.now().toISOString(), error: null};
    this.lastTest = record;
    this.testPending = this.send(record, 'test').then(() => this.testStatus()!);
    void this.testPending.finally(() => {this.testPending = null;});
    return this.testPending;
  }
  private isCurrent(record: DailyReminderRecord): boolean {return this.daily?.requestId === record.requestId && this.daily.date === record.date && this.lastAttemptDate === record.date;}
  private suppression(record: DailyReminderRecord): DailyReminderSuppression | null {
    if (!this.isCurrent(record)) return 'superseded';
    const now = this.now();
    if (localDate(now) !== record.date) return 'date-changed';
    let current: DailySettings;
    try {current = this.dependencies.dailySettings(now);} catch {return 'eligibility-unavailable';}
    if (current.checkedIn) return 'checked-in';
    if (!current.enabled) return 'disabled';
    // The reserved date is intentionally excluded from this eligibility recheck.
    if (!reminderDue(now, current.time, current.enabled, null, current.checkedIn, current.startDate)) return 'not-due';
    return null;
  }
  async checkDaily(): Promise<DailyReminderRecord | null> {
    await this.initialize();
    const now = this.now();
    const settings = this.dependencies.dailySettings(now);
    if (this.readError || !reminderDue(now, settings.time, settings.enabled, this.lastAttemptDate, settings.checkedIn, settings.startDate)) return null;
    const record: DailyReminderRecord = {requestId: this.id(), date: localDate(now), status: 'requested', at: now.toISOString(), error: null};
    // Reserve before awaiting storage so concurrent interval ticks cannot send twice.
    this.lastAttemptDate = record.date; this.daily = record;
    if (!await this.persist(record)) {
      const failed: DailyReminderRecord = {...record, status: 'failed', error: {code: 'reminder-write', message: '每日提醒记录保存失败，通知未发送；当天不会再次自动尝试。'}};
      if (this.isCurrent(record)) this.daily = failed;
      return {...failed};
    }
    // Storage may have awaited another write. Re-read authoritative eligibility
    // immediately before the synchronous native support/create/show sequence.
    const reason = this.suppression(record);
    if (reason) {
      const suppressed: DailyReminderRecord = {...record, status: 'suppressed', suppressionReason: reason, at: this.now().toISOString()};
      if (this.isCurrent(record)) {this.daily = suppressed; await this.persist(suppressed);}
      return {...suppressed};
    }
    await this.send(record as DailyReminderRecord & {requestId: string}, 'daily');
    await this.writes;
    return this.daily ? {...this.daily} : null;
  }
  private send(record: {requestId: string; status: string; at: string; error: SystemControlError | null}, kind: 'test' | 'daily'): Promise<void> {
    return new Promise(resolve => {
      let settled = false, terminal = false;
      let waitTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {if (!settled) {settled = true; if (waitTimer) clearTimeout(waitTimer); resolve();}};
      const update = (status: NotificationAttemptStatus, error: SystemControlError | null = null) => {
        if (terminal) return;
        terminal = true;
        const change = {status, at: this.now().toISOString(), error};
        if (kind === 'test' && this.lastTest?.requestId === record.requestId) this.lastTest = {...this.lastTest, ...change};
        if (kind === 'daily' && this.daily?.requestId === record.requestId && this.daily.date === this.lastAttemptDate) {
          this.daily = {...this.daily, ...change}; void this.persist(this.daily);
        }
        finish();
      };
      try {if (!this.dependencies.native.supported()) {update('unsupported'); return;}}
      catch {update('failed', controlledError('notification-support')); return;}
      let notification: NativeNotification;
      try {notification = this.dependencies.native.create({title: kind === 'test' ? '学习工作台 · 测试通知' : '学习工作台', body: kind === 'test' ? '这是一条测试通知，不影响每日提醒或打卡。' : '今天留一点时间推进最重要的一步。'});}
      catch {update('failed', controlledError('notification-create')); return;}
      this.active.set(record.requestId, notification);
      const shown = () => update('shown');
      const failed = () => update('failed', controlledError('notification-failed'));
      const click = () => this.dependencies.focus();
      let retentionTimer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(retentionTimer); this.active.delete(record.requestId);
        for (const [event, listener] of [['show', shown], ['failed', failed], ['click', click], ['close', cleanup]] as const) notification.removeListener(event, listener);
      };
      retentionTimer = setTimeout(cleanup, this.dependencies.retentionMs ?? 300000);
      retentionTimer.unref?.();
      notification.on('show', shown); notification.on('failed', failed); notification.on('click', click); notification.on('close', cleanup);
      waitTimer = setTimeout(finish, this.dependencies.callbackWaitMs ?? 1500);
      try {notification.show();}
      catch {update('failed', controlledError('notification-show')); cleanup();}
    });
  }
}
