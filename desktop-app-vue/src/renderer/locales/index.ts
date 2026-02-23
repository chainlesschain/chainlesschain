import { logger } from '@/utils/logger';
import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';
import zhTW from './zh-TW';
import jaJP from './ja-JP';
import koKR from './ko-KR';
import frFR from './fr-FR';
import esES from './es-ES';
import type { LocaleOption, SupportedLocale } from './types';

const getSavedLocale = (): SupportedLocale => {
  try {
    const saved = localStorage.getItem('app-locale');
    if (saved && ['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'ko-KR', 'fr-FR', 'es-ES'].includes(saved)) {
      return saved as SupportedLocale;
    }
    return 'zh-CN';
  } catch (error) {
    logger.error('Failed to get saved locale:', error);
    return 'zh-CN';
  }
};

const i18n = createI18n({
  legacy: false,
  locale: getSavedLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'zh-TW': zhTW,
    'ja-JP': jaJP,
    'ko-KR': koKR,
    'fr-FR': frFR,
    'es-ES': esES,
  },
  datetimeFormats: {
    'zh-CN': { short: { year: 'numeric', month: '2-digit', day: '2-digit' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
    'en-US': { short: { year: 'numeric', month: 'short', day: 'numeric' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
    'zh-TW': { short: { year: 'numeric', month: '2-digit', day: '2-digit' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
    'ja-JP': { short: { year: 'numeric', month: '2-digit', day: '2-digit' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
    'ko-KR': { short: { year: 'numeric', month: '2-digit', day: '2-digit' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
    'fr-FR': { short: { year: 'numeric', month: '2-digit', day: '2-digit' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
    'es-ES': { short: { year: 'numeric', month: '2-digit', day: '2-digit' }, long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' } },
  },
  numberFormats: {
    'zh-CN': { currency: { style: 'currency', currency: 'CNY' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
    'en-US': { currency: { style: 'currency', currency: 'USD' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
    'zh-TW': { currency: { style: 'currency', currency: 'TWD' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
    'ja-JP': { currency: { style: 'currency', currency: 'JPY' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
    'ko-KR': { currency: { style: 'currency', currency: 'KRW' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
    'fr-FR': { currency: { style: 'currency', currency: 'EUR' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
    'es-ES': { currency: { style: 'currency', currency: 'EUR' }, decimal: { style: 'decimal', minimumFractionDigits: 2 } },
  },
  silentTranslationWarn: true,
  silentFallbackWarn: true,
});

const globalLocaleRef = i18n.global.locale as unknown as { value: SupportedLocale };

export const setLocale = (locale: SupportedLocale): void => {
  globalLocaleRef.value = locale;
  try {
    localStorage.setItem('app-locale', locale);
  } catch (error) {
    logger.error('Failed to save locale:', error);
  }
};

export const getLocale = (): SupportedLocale => {
  return globalLocaleRef.value;
};

export const supportedLocales: LocaleOption[] = [
  { value: 'zh-CN', label: '\u7b80\u4f53\u4e2d\u6587', icon: '\ud83c\udde8\ud83c\uddf3' },
  { value: 'en-US', label: 'English', icon: '\ud83c\uddfa\ud83c\uddf8' },
  { value: 'zh-TW', label: '\u7e41\u9ad4\u4e2d\u6587', icon: '\ud83c\uddf9\ud83c\uddfc' },
  { value: 'ja-JP', label: '\u65e5\u672c\u8a9e', icon: '\ud83c\uddef\ud83c\uddf5' },
  { value: 'ko-KR', label: '\ud55c\uad6d\uc5b4', icon: '\ud83c\uddf0\ud83c\uddf7' },
  { value: 'fr-FR', label: 'Fran\u00e7ais', icon: '\ud83c\uddeb\ud83c\uddf7' },
  { value: 'es-ES', label: 'Espa\u00f1ol', icon: '\ud83c\uddea\ud83c\uddf8' },
];

export type { LocaleMessages, SupportedLocale, LocaleOption } from './types';

export default i18n;
