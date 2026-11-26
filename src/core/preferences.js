import { REMINDER_INTERVALS } from './backup-reminder.js';
import { IDLE_LOCK_MINUTES } from './idle-lock.js';
export const LOCALES = ['zh-CN', 'zh-TW'];
export const THEMES = ['navy', 'light', 'ruby', 'jade'];
export const MAC_PULSE_PAGE_SIZES = [25, 50, 100];
const normalizeMacPulsePageSize = (size) =>
  MAC_PULSE_PAGE_SIZES.includes(size) ? size : MAC_PULSE_PAGE_SIZES[0];

export function readPreferences(
  storage,
  language = globalThis.navigator?.language || '',
) {
  const defaults = {
    locale: /(?:TW|HK|MO|Hant)/i.test(language) ? 'zh-TW' : 'zh-CN',
    theme: 'navy',
    backupReminderDays: 7,
    idleLockMinutes: 0,
    macPulsePageSize: MAC_PULSE_PAGE_SIZES[0],
  };
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const value = JSON.parse(storage?.getItem('cardpulse.preferences') || '{}');
    return {
      locale: LOCALES.includes(value?.locale) ? value.locale : defaults.locale,
      theme: THEMES.includes(value?.theme) ? value.theme : defaults.theme,
      backupReminderDays: REMINDER_INTERVALS.includes(value?.backupReminderDays)
        ? value.backupReminderDays
        : defaults.backupReminderDays,
      idleLockMinutes: IDLE_LOCK_MINUTES.includes(value?.idleLockMinutes)
        ? value.idleLockMinutes
        : defaults.idleLockMinutes,
      macPulsePageSize: normalizeMacPulsePageSize(value?.macPulsePageSize),
    };
  } catch {
    return defaults;
  }
}
export function savePreferences(preferences, storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    storage?.setItem(
      'cardpulse.preferences',
      JSON.stringify({
        locale: preferences.locale,
        theme: preferences.theme,
        backupReminderDays: REMINDER_INTERVALS.includes(
          preferences.backupReminderDays,
        )
          ? preferences.backupReminderDays
          : 7,
        idleLockMinutes: IDLE_LOCK_MINUTES.includes(preferences.idleLockMinutes)
          ? preferences.idleLockMinutes
          : 0,
        macPulsePageSize: normalizeMacPulsePageSize(preferences.macPulsePageSize),
      }),
    );
  } catch {
    /* UI preferences remain usable when browser storage is unavailable. */
  }
}
