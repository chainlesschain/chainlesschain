import { logger, createLogger } from '@/utils/logger';
import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN';
import enUS from './en-US';
import zhTW from './zh-TW';
import jaJP from './ja-JP';
import koKR from './ko-KR';

// 从localStorage获取保存的语言设置
const getSavedLocale = () => {
  try {
    return localStorage.getItem('app-locale') || 'zh-CN';
  } catch (error) {
    logger.error('Failed to get saved locale:', error);
    return 'zh-CN';
  }
};

// 创建i18n实例
const i18n = createI18n({
  legacy: false, // 使用 Composition API 模式
  locale: getSavedLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'zh-TW': zhTW,
    'ja-JP': jaJP,
    'ko-KR': koKR
  },
  // 关闭警告
  silentTranslationWarn: true,
  silentFallbackWarn: true
});

// 语言切换函数
export const setLocale = (locale) => {
  i18n.global.locale.value = locale;
  try {
    localStorage.setItem('app-locale', locale);
  } catch (error) {
    logger.error('Failed to save locale:', error);
  }
};

// 获取当前语言
export const getLocale = () => {
  return i18n.global.locale.value;
};

// 支持的语言列表
export const supportedLocales = [
  { value: 'zh-CN', label: '简体中文', icon: '🇨🇳' },
  { value: 'en-US', label: 'English', icon: '🇺🇸' },
  { value: 'zh-TW', label: '繁體中文', icon: '🇹🇼' },
  { value: 'ja-JP', label: '日本語', icon: '🇯🇵' },
  { value: 'ko-KR', label: '한국어', icon: '🇰🇷' }
];

export default i18n;
