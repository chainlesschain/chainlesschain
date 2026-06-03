/**
 * Default barrel export for `@chainlesschain/locales`.
 *
 * Provides:
 *   - SUPPORTED — canonical list of locale codes (ordered)
 *   - FALLBACK  — locale to use when detection finds nothing usable
 *   - messages  — { 'zh-CN': {…}, en: {…} } shape ready to feed createI18n
 *
 * Consumers can either grab `messages` whole or import individual locales
 * from the per-locale subpath exports (`@chainlesschain/locales/zh-CN`).
 *
 * Namespace conventions live in README.md alongside this file — see the
 * "Namespace ownership" section before adding new top-level keys.
 */

import zhCN from './zh-CN.json'
import en from './en.json'

export const SUPPORTED = ['zh-CN', 'en']
export const FALLBACK = 'zh-CN'
export const messages = { 'zh-CN': zhCN, en }

export { zhCN, en }
