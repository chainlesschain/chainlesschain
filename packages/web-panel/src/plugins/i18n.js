/**
 * vue-i18n setup for the web panel.
 *
 * Strategy: incremental adoption.
 *   - All currently-shipped strings stay hardcoded (52 views, thousands
 *     of strings — extracting them all is a separate milestone).
 *   - This plugin only owns: the language switcher itself, the global
 *     ErrorBoundary fallback, and a small `common.*` namespace for
 *     strings new code can opt into via `t('common.refresh')`.
 *   - When a view is touched for other reasons, opportunistically lift
 *     its strings into the locale files. No big-bang extraction.
 *
 * Runtime detection precedence: localStorage > navigator.language > zh-CN.
 * Persistence key: cc.web-panel.locale.
 *
 * The `useLocale` composable also hands callers the matching ant-d-v
 * locale bundle (zhCN / enUS) so <a-config-provider :locale> stays in
 * sync — date pickers, table pagination, popconfirm OK/Cancel and the
 * other ant-d-v built-in strings switch alongside our own translations.
 */

import { createI18n } from 'vue-i18n'
import { computed, watch } from 'vue'
import zhCN from '../locales/zh-CN.json'
import en from '../locales/en.json'
import antdZhCN from 'ant-design-vue/es/locale/zh_CN'
import antdEnUS from 'ant-design-vue/es/locale/en_US'

const STORAGE_KEY = 'cc.web-panel.locale'
const SUPPORTED = ['zh-CN', 'en']
const FALLBACK = 'zh-CN'

function detectInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED.includes(stored)) return stored
  } catch { /* localStorage may be blocked */ }

  if (typeof navigator !== 'undefined' && navigator.language) {
    if (navigator.language.startsWith('zh')) return 'zh-CN'
    if (navigator.language.startsWith('en')) return 'en'
  }
  return FALLBACK
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectInitialLocale(),
  fallbackLocale: FALLBACK,
  messages: { 'zh-CN': zhCN, en },
})

// Persist any locale change so the next page load remembers.
watch(
  () => i18n.global.locale.value,
  (newLocale) => {
    try { localStorage.setItem(STORAGE_KEY, newLocale) } catch { /* ignore */ }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = newLocale
    }
  },
  { immediate: true },
)

const ANTD_LOCALES = { 'zh-CN': antdZhCN, en: antdEnUS }

/**
 * Composable: returns the current locale, the ant-d-v locale bundle
 * paired to it, the supported list, and a setLocale() helper.
 */
export function useLocale() {
  const current = computed(() => i18n.global.locale.value)
  const antdLocale = computed(() => ANTD_LOCALES[current.value] || ANTD_LOCALES[FALLBACK])

  function setLocale(next) {
    if (!SUPPORTED.includes(next)) return false
    i18n.global.locale.value = next
    return true
  }

  return { current, antdLocale, supported: SUPPORTED, setLocale }
}

export const __testing = { detectInitialLocale, STORAGE_KEY, SUPPORTED, FALLBACK }
