'use client';

import { useContext } from 'react';
import { I18nContext } from './context';

export function useTranslation() {
  const { t, locale, setLocale } = useContext(I18nContext);
  return { t, locale, setLocale };
}

export { I18nProvider } from './context';
export type { Locale } from './context';
