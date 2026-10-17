export const LOCALES = ['zh-CN', 'zh-TW'];
export const THEMES = ['navy', 'light', 'ruby', 'jade'];
export function readPreferences(
  storage,
  language = globalThis.navigator?.language || '',
) {
  const defaults = {
    locale: /(?:TW|HK|MO|Hant)/i.test(language) ? 'zh-TW' : 'zh-CN',
    theme: 'navy',
  };
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const value = JSON.parse(storage?.getItem('cardpulse.preferences') || '{}');
    return {
      locale: LOCALES.includes(value?.locale) ? value.locale : defaults.locale,
      theme: THEMES.includes(value?.theme) ? value.theme : defaults.theme,
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
      JSON.stringify({ locale: preferences.locale, theme: preferences.theme }),
    );
  } catch {
    /* UI preferences remain usable when browser storage is unavailable. */
  }
}
