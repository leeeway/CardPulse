import { isIsoDate } from './campaigns.js';

export const BACKUP_REMINDER_KEY = 'cardpulse.backup-reminder';
export const REMINDER_INTERVALS = [0, 7, 14, 30];
const DAY_MS = 86_400_000;
const reasons = ['passwordChanged', 'restored'];
export const emptyBackupReminder = () => ({
  lastConfirmedOn: null,
  reason: null,
});
const sanitize = (value) => ({
  lastConfirmedOn:
    typeof value?.lastConfirmedOn === 'string' &&
    isIsoDate(value.lastConfirmedOn)
      ? value.lastConfirmedOn
      : null,
  reason: reasons.includes(value?.reason) ? value.reason : null,
});

export function readBackupReminder(storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const value = JSON.parse(storage?.getItem(BACKUP_REMINDER_KEY) || '{}');
    return value?.version === 1 ? sanitize(value) : emptyBackupReminder();
  } catch {
    return emptyBackupReminder();
  }
}

export function saveBackupReminder(value, storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(
      BACKUP_REMINDER_KEY,
      JSON.stringify({ version: 1, ...sanitize(value) }),
    );
    return true;
  } catch {
    return false;
  }
}

// Calendar days use the same Hong Kong cutoff as the reward calculations.
export function backupReminderStatus(reminder, today, interval = 7) {
  if (!REMINDER_INTERVALS.includes(interval)) interval = 7;
  if (interval === 0) return { kind: 'off', due: false };
  const value = sanitize(reminder);
  if (value.reason) return { kind: value.reason, due: true };
  if (!value.lastConfirmedOn) return { kind: 'never', due: true };
  if (!isIsoDate(today) || value.lastConfirmedOn > today)
    return { kind: 'clock', due: true };
  const last = Date.parse(`${value.lastConfirmedOn}T00:00:00Z`);
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - last) / DAY_MS);
  return days >= interval
    ? { kind: 'overdue', due: true, days }
    : {
        kind: 'scheduled',
        due: false,
        nextOn: new Date(last + interval * DAY_MS).toISOString().slice(0, 10),
      };
}
