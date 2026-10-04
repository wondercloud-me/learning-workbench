export function reminderDue(now: Date, time: string, enabled: boolean, alreadyNotified: string | null, checkedIn: boolean, startDate = ''): boolean {
  if (!enabled || checkedIn || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  if (startDate && date < startDate) return false;
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return current >= time && alreadyNotified !== date;
}
