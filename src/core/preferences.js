import { REMINDER_INTERVALS } from './backup-reminder.js';
export const LOCALES = ['zh-CN', 'zh-TW'];
export const THEMES = ['navy', 'light', 'ruby', 'jade'];
export function readPreferences(
  storage,
  language = globalThis.navigator?.language || '',
) {
  const defaults = {
    locale: /(?:TW|HK|MO|Hant)/i.test(language) ? 'zh-TW' : 'zh-CN',
    theme: 'navy',
    backupReminderDays: 7,
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
      }),
    );
  } catch {
    /* UI preferences remain usable when browser storage is unavailable. */
  }
}
