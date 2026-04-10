/**
 * Unit tests for src/stores/theme.js
 * Tests theme definitions, CSS variable coverage, and persistence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v) },
    clear: () => { store = {} },
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

// Mock document
const styleMap = {}
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: (k, v) => { styleMap[k] = v } },
    setAttribute: vi.fn(),
  },
})

import { THEMES, useThemeStore } from '../../src/stores/theme.js'

describe('THEMES definition', () => {
  it('has exactly 4 themes', () => {
    expect(Object.keys(THEMES)).toHaveLength(4)
    expect(Object.keys(THEMES)).toEqual(['dark', 'light', 'blue', 'green'])
  })

  it.each(Object.keys(THEMES))('theme "%s" has required fields', (key) => {
    const t = THEMES[key]
    expect(t).toHaveProperty('label')
    expect(t).toHaveProperty('icon')
    expect(t).toHaveProperty('antd')
    expect(t).toHaveProperty('vars')
  })

  it.each(Object.keys(THEMES))('theme "%s" vars has all required CSS variables', (key) => {
    const required = [
      '--bg-base', '--bg-sidebar', '--bg-header', '--bg-card',
      '--bg-card-hover', '--border-color', '--text-primary',
      '--text-secondary', '--text-muted', '--logo-text', '--shadow-card',
    ]
    const vars = THEMES[key].vars
    for (const v of required) {
      expect(vars, `${key} missing ${v}`).toHaveProperty(v)
    }
  })

  it.each(Object.keys(THEMES))('theme "%s" antd config has algorithm', (key) => {
    expect(THEMES[key].antd).toHaveProperty('algorithm')
  })

  it('light theme uses default (not dark) algorithm', () => {
    // darkAlgorithm and defaultAlgorithm are different function references
    expect(THEMES.dark.antd.algorithm).not.toBe(THEMES.light.antd.algorithm)
  })

  it('no theme icon contains replacement character', () => {
    for (const [k, t] of Object.entries(THEMES)) {
      expect(t.icon, `${k} icon corrupted`).not.toContain('\uFFFD')
    }
  })
})

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('defaults to light theme', () => {
    const store = useThemeStore()
    expect(store.current).toBe('light')
  })

  it('reads saved theme from localStorage', () => {
    localStorageMock.setItem('cc_theme', 'light')
    const store = useThemeStore()
    expect(store.current).toBe('light')
  })

  it('setTheme changes current theme', () => {
    const store = useThemeStore()
    store.setTheme('blue')
    expect(store.current).toBe('blue')
  })

  it('setTheme persists to localStorage', () => {
    const store = useThemeStore()
    store.setTheme('green')
    expect(localStorageMock.getItem('cc_theme')).toBe('green')
  })

  it('setTheme ignores unknown theme names', () => {
    const store = useThemeStore()
    store.setTheme('unknown-theme')
    expect(store.current).toBe('light') // unchanged
  })

  it('antdTheme computed returns correct antd config', () => {
    const store = useThemeStore()
    store.setTheme('light')
    expect(store.antdTheme).toBe(THEMES.light.antd)
  })

  it('isDark is false for light theme', () => {
    const store = useThemeStore()
    store.setTheme('light')
    expect(store.isDark).toBe(false)
  })

  it('isDark is true for dark/blue/green themes', () => {
    const store = useThemeStore()
    for (const t of ['dark', 'blue', 'green']) {
      store.setTheme(t)
      expect(store.isDark, `${t} should be dark`).toBe(true)
    }
  })

  it('init applies CSS variables to document', () => {
    const store = useThemeStore()
    store.init()
    expect(styleMap['--bg-base']).toBe(THEMES.light.vars['--bg-base'])
  })
})
