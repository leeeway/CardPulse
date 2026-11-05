import { isIsoDate } from './campaigns.js';

export const BACKUP_REMINDER_KEY = 'cardpulse.backup-reminder';
export const REMINDER_INTERVALS = [0, 7, 14, 30];
const DAY_MS = 86_400_000;
const reasons = ['passwordChanged', 'restored'];
const validRevision = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
export const emptyBackupReminder = () => ({
  lastConfirmedOn: null,
  reason: null,
  revision: null,
});
const sanitize = (value) => ({
  lastConfirmedOn:
    typeof value?.lastConfirmedOn === 'string' &&
    isIsoDate(value.lastConfirmedOn)
      ? value.lastConfirmedOn
      : null,
  reason: reasons.includes(value?.reason) ? value.reason : null,
  revision: validRevision(value?.revision) ? value.revision : null,
});

// Distinguish unavailable storage from a valid empty/legacy record so a failed
// write never makes a session-only record look like a change from another tab.
export function readBackupReminderState(storage) {
  let raw;
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    if (typeof storage?.getItem !== 'function') throw new Error('unavailable');
    raw = storage.getItem(BACKUP_REMINDER_KEY);
  } catch {
    return { available: false, record: emptyBackupReminder() };
  }
  try {
    const value = JSON.parse(raw || '{}');
    return {
      available: true,
      record: value?.version === 1 ? sanitize(value) : emptyBackupReminder(),
    };
  } catch {
    return { available: true, record: emptyBackupReminder() };
  }
}

export function readBackupReminder(storage) {
  return readBackupReminderState(storage).record;
}

export function createBackupReminderRecord(value) {
  return { ...sanitize(value), revision: crypto.randomUUID() };
}

export function sameBackupReminder(left, right) {
  const a = sanitize(left),
    b = sanitize(right);
  return (
    a.lastConfirmedOn === b.lastConfirmedOn &&
    a.reason === b.reason &&
    a.revision === b.revision
  );
}

export function saveBackupReminder(value, storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(
      BACKUP_REMINDER_KEY,
      JSON.stringify({
        version: 1,
        ...(validRevision(value?.revision)
          ? sanitize(value)
          : createBackupReminderRecord(value)),
      }),
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
