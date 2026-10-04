export const desktopAppId = 'dev.growthworkbench.app';
// Keep this identity stable across upgrades; Electron owns its native registration.
export const desktopToastClsid = 'a5d5b6ea-2271-4f1b-a9d4-42e74b65b9ad';

export type SystemControlErrorCode = 'login-read' | 'login-write' | 'login-registration-write' | 'login-system-read' | 'login-system-write' | 'reminder-read' | 'reminder-write' | 'notification-support' | 'notification-create' | 'notification-show' | 'notification-failed';
export interface SystemControlError {code: SystemControlErrorCode; message: string;}
export type MacLoginStatus = 'not-registered' | 'enabled' | 'requires-approval' | 'not-found';
export interface LoginLaunchItem {name: string; path: string; args: string[]; scope: 'user' | 'machine'; enabled: boolean;}
export interface LoginStatus {
  platform: string;
  supported: boolean;
  configurable: boolean;
  requestedPreference: boolean | null;
  openAtLogin: boolean | null;
  mac: {status: MacLoginStatus | null; wasOpenedAtLogin: boolean | null} | null;
  windows: {executableWillLaunchAtLogin: boolean | null; launchItems: LoginLaunchItem[]} | null;
  errors: SystemControlError[];
}
export type NotificationAttemptStatus = 'requested' | 'shown' | 'failed' | 'unsupported';
export interface NotificationTestStatus {requestId: string; status: NotificationAttemptStatus; at: string; error: SystemControlError | null;}
export type DailyReminderSuppression = 'checked-in' | 'disabled' | 'not-due' | 'date-changed' | 'superseded' | 'eligibility-unavailable';
export interface DailyReminderRecord {requestId: string | null; date: string; status: NotificationAttemptStatus | 'attempted' | 'suppressed'; suppressionReason?: DailyReminderSuppression; at: string; error: SystemControlError | null;}
export interface DailyReminderStatus {lastAttempt: DailyReminderRecord | null; readError: SystemControlError | null; storageError: SystemControlError | null;}
