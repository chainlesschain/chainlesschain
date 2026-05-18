/**
 * vue-i18n plugin tests.
 *
 * Covers: locale detection precedence, persistence to localStorage,
 * setLocale validation, and the ant-d-v locale bundle pairing.
 *
 * The plugin imports ant-design-vue/es/locale which we don't want to
 * load at module-eval in a test environment — vi.mock isolates that
 * before the real module gets imported.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('ant-design-vue/es/locale/zh_CN', () => ({ default: { locale: 'zh_CN' } }))
vi.mock('ant-design-vue/es/locale/en_US', () => ({ default: { locale: 'en_US' } }))

const STORAGE_KEY = 'cc.web-panel.locale'

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY)
  vi.resetModules()
})

describe('i18n plugin', () => {
  it('detects zh-CN as the default fallback when nothing is stored', async () => {
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true })
    const { __testing } = await import('../../src/plugins/i18n.js')
    expect(__testing.detectInitialLocale()).toBe('zh-CN')
  })

  it('honours navigator.language=en-US over the fallback', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    const { __testing } = await import('../../src/plugins/i18n.js')
    expect(__testing.detectInitialLocale()).toBe('en')
  })

  it('honours localStorage above navigator.language', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    localStorage.setItem(STORAGE_KEY, 'zh-CN')
    const { __testing } = await import('../../src/plugins/i18n.js')
    expect(__testing.detectInitialLocale()).toBe('zh-CN')
  })

  it('ignores unsupported localStorage values', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
    localStorage.setItem(STORAGE_KEY, 'klingon')
    const { __testing } = await import('../../src/plugins/i18n.js')
    expect(__testing.detectInitialLocale()).toBe('en')
  })

  it('useLocale.setLocale switches the active locale and persists it', async () => {
    const mod = await import('../../src/plugins/i18n.js')
    const { current, setLocale } = mod.useLocale()
    expect(setLocale('en')).toBe(true)
    expect(current.value).toBe('en')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en')
  })

  it('useLocale.setLocale rejects unsupported codes', async () => {
    const { setLocale, current } = (await import('../../src/plugins/i18n.js')).useLocale()
    const before = current.value
    expect(setLocale('klingon')).toBe(false)
    expect(current.value).toBe(before)
  })

  it('useLocale.antdLocale tracks the current locale', async () => {
    const { antdLocale, setLocale } = (await import('../../src/plugins/i18n.js')).useLocale()
    setLocale('zh-CN')
    expect(antdLocale.value.locale).toBe('zh_CN')
    setLocale('en')
    expect(antdLocale.value.locale).toBe('en_US')
  })

  it('translates seed keys for both locales', async () => {
    const { i18n, useLocale } = await import('../../src/plugins/i18n.js')
    const { setLocale } = useLocale()

    setLocale('zh-CN')
    expect(i18n.global.t('common.refresh')).toBe('刷新')
    expect(i18n.global.t('error.boundary.title')).toBe('此页面渲染失败')

    setLocale('en')
    expect(i18n.global.t('common.refresh')).toBe('Refresh')
    expect(i18n.global.t('error.boundary.title')).toBe('Page failed to render')
  })
})
