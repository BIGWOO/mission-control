/**
 * Server-side i18n helper
 * Shares the same locale JSON files as the client-side context
 */

import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';

export type Locale = 'en' | 'zh-TW';

type Translations = Record<string, string>;

const localeMap: Record<Locale, Translations> = {
  en: en as Translations,
  'zh-TW': zhTW as Translations,
};

/**
 * Server-side translation function
 */
export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = localeMap[locale]?.[key] ?? localeMap.en?.[key] ?? key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    });
  }
  return text;
}
