/**
 * 多媒体i18n Composable
 *
 * 提供多媒体组件的国际化支持
 */

import { ref, computed } from 'vue';
import type { ComputedRef } from 'vue';
import { multimediaI18n, type MultimediaLocale } from '../i18n/multimedia';

// 默认语言
const DEFAULT_LOCALE: MultimediaLocale = 'zh-CN';

// 全局语言设置
const currentLocale = ref<MultimediaLocale>(DEFAULT_LOCALE);

/**
 * 获取嵌套对象的值
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * 多媒体i18n Composable
 */
export function useMultimediaI18n() {
  /**
   * 翻译函数
   * @param key - 翻译键（支持点号分隔的路径，如'progressMonitor.title'）
   * @param fallback - 备用文本（可选）
   * @returns 翻译后的文本
   */
  const t = (key: string, fallback?: string): string => {
    const locale = currentLocale.value;
    const messages = multimediaI18n[locale];

    // 获取翻译值
    const value = getNestedValue(messages.multimedia, key);

    // 如果找到翻译，返回翻译值
    if (value !== undefined && value !== null) {
      return String(value);
    }

    // 如果没有找到翻译，尝试使用默认语言
    if (locale !== DEFAULT_LOCALE) {
      const defaultMessages = multimediaI18n[DEFAULT_LOCALE];
      const defaultValue = getNestedValue(defaultMessages.multimedia, key);

      if (defaultValue !== undefined && defaultValue !== null) {
        return String(defaultValue);
      }
    }

    // 返回备用文本或键本身
    return fallback || key;
  };

  /**
   * 切换语言
   * @param locale - 新的语言代码
   */
  const setLocale = (locale: MultimediaLocale) => {
    if (multimediaI18n[locale]) {
      currentLocale.value = locale;

      // 保存到localStorage
      try {
        localStorage.setItem('multimedia-locale', locale);
      } catch (e) {
        console.warn('[useMultimediaI18n] Failed to save locale to localStorage:', e);
      }
    } else {
      console.warn(`[useMultimediaI18n] Locale "${locale}" not found, using default`);
    }
  };

  /**
   * 获取当前语言
   */
  const locale = computed(() => currentLocale.value);

  /**
   * 检查是否支持某个语言
   * @param locale - 语言代码
   */
  const isLocaleSupported = (locale: string): locale is MultimediaLocale => {
    return locale in multimediaI18n;
  };

  /**
   * 获取所有支持的语言
   */
  const supportedLocales: ComputedRef<MultimediaLocale[]> = computed(() => {
    return Object.keys(multimediaI18n) as MultimediaLocale[];
  });

  /**
   * 带插值的翻译
   * @param key - 翻译键
   * @param values - 插值对象
   * @example
   * // translation: "Hello, {name}!"
   * ti('greeting', { name: 'John' }) // => "Hello, John!"
   */
  const ti = (key: string, values: Record<string, string | number>): string => {
    let text = t(key);

    // 替换占位符
    Object.entries(values).forEach(([placeholder, value]) => {
      text = text.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), String(value));
    });

    return text;
  };

  /**
   * 复数翻译
   * @param key - 翻译键（应该包含{count}占位符）
   * @param count - 数量
   * @example
   * // translation: "{count} files"
   * tp('files', 5) // => "5 files"
   */
  const tp = (key: string, count: number): string => {
    return ti(key, { count });
  };

  return {
    t,
    ti,
    tp,
    locale,
    setLocale,
    isLocaleSupported,
    supportedLocales,
  };
}

/**
 * 初始化i18n
 * 从localStorage恢复语言设置
 */
export function initMultimediaI18n() {
  try {
    const savedLocale = localStorage.getItem('multimedia-locale');
    if (savedLocale && savedLocale in multimediaI18n) {
      currentLocale.value = savedLocale as MultimediaLocale;
    }
  } catch (e) {
    console.warn('[initMultimediaI18n] Failed to load locale from localStorage:', e);
  }
}

/**
 * 类型安全的翻译键
 * 用于提供更好的IDE自动补全支持
 */
export type MultimediaTranslationKey =
  | 'progressMonitor.title'
  | 'progressMonitor.expand'
  | 'progressMonitor.collapse'
  | 'mediaProcessor.title'
  | 'mediaProcessor.tabs.image'
  | 'mediaProcessor.tabs.audio'
  | 'videoEditor.title'
  | 'videoEditor.tabs.filters'
  | 'common.upload'
  | 'common.processing'
  | 'common.completed'
  | 'common.failed'
  | 'errors.fileNotSupported'
  | 'errors.uploadFailed'
  | 'success.uploadSuccess'
  | 'success.processSuccess';

/**
 * 类型安全的翻译函数
 * @param key - 翻译键（带类型检查）
 */
export function useTypedMultimediaI18n() {
  const { t, ti, tp, locale, setLocale } = useMultimediaI18n();

  return {
    t: (key: MultimediaTranslationKey, fallback?: string) => t(key, fallback),
    ti,
    tp,
    locale,
    setLocale,
  };
}

// 导出默认实例
export default useMultimediaI18n;
