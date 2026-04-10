/**
 * theme.js — Global theme store.
 * Provides 4 themes: dark | light | blue | green
 * Each theme defines:
 *   - antdTheme: passed to <a-config-provider :theme="...">
 *   - vars: CSS custom properties injected on <html data-theme="...">
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { theme as antTheme } from 'ant-design-vue'

const STORAGE_KEY = 'cc_theme'

export const THEMES = {
  dark: {
    label: '暗黑',
    icon: '🌑',
    antd: {
      algorithm: antTheme.darkAlgorithm,
      token: {
        colorPrimary: '#1677ff',
        colorBgBase: '#141414',
        colorBgContainer: '#1f1f1f',
        colorBgElevated: '#2a2a2a',
        borderRadius: 8,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      },
      components: {
        Layout: { siderBg: '#1c1c1c', headerBg: '#1c1c1c', bodyBg: '#141414' },
        Menu: { darkItemBg: '#1c1c1c', darkSubMenuItemBg: '#171717' },
      },
    },
    vars: {
      '--bg-base':        '#141414',
      '--bg-sidebar':     '#1c1c1c',
      '--bg-header':      '#1c1c1c',
      '--bg-card':        '#1f1f1f',
      '--bg-card-hover':  '#262626',
      '--border-color':   '#252525',
      '--border-subtle':  '#1e1e1e',
      '--text-primary':   '#e0e0e0',
      '--text-secondary': '#888',
      '--text-muted':     '#444',
      '--logo-text':      '#ffffff',
      '--menu-mode':      'dark',
      '--shadow-card':    '0 2px 8px rgba(0,0,0,.45)',
      '--group-title':    '#3a3a3a',
    },
  },

  light: {
    label: '亮白',
    icon: '☀️',
    antd: {
      algorithm: antTheme.defaultAlgorithm,
      token: {
        colorPrimary: '#1677ff',
        colorBgBase: '#ffffff',
        colorBgContainer: '#ffffff',
        colorBgElevated: '#ffffff',
        borderRadius: 8,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      },
      components: {
        Layout: { siderBg: '#ffffff', headerBg: '#ffffff', bodyBg: '#f4f6fb' },
        Menu: { itemBg: '#ffffff' },
      },
    },
    vars: {
      '--bg-base':        '#f4f6fb',
      '--bg-sidebar':     '#ffffff',
      '--bg-header':      '#ffffff',
      '--bg-card':        '#ffffff',
      '--bg-card-hover':  '#f0f4ff',
      '--border-color':   '#e8edf5',
      '--border-subtle':  '#f0f0f0',
      '--text-primary':   '#1a1a2e',
      '--text-secondary': '#5a6474',
      '--text-muted':     '#b0b8c8',
      '--logo-text':      '#1a1a2e',
      '--menu-mode':      'light',
      '--shadow-card':    '0 2px 12px rgba(0,0,0,.07)',
      '--group-title':    '#aab0bc',
    },
  },

  blue: {
    label: '深蓝',
    icon: '🌊',
    antd: {
      algorithm: antTheme.darkAlgorithm,
      token: {
        colorPrimary: '#2f80ed',
        colorBgBase: '#0d1117',
        colorBgContainer: '#161b22',
        colorBgElevated: '#1c2230',
        borderRadius: 8,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      },
      components: {
        Layout: { siderBg: '#0f1923', headerBg: '#0f1923', bodyBg: '#0d1117' },
        Menu: { darkItemBg: '#0f1923', darkSubMenuItemBg: '#0b1520' },
      },
    },
    vars: {
      '--bg-base':        '#0d1117',
      '--bg-sidebar':     '#0f1923',
      '--bg-header':      '#0f1923',
      '--bg-card':        '#161b22',
      '--bg-card-hover':  '#1c2230',
      '--border-color':   '#21303f',
      '--border-subtle':  '#182030',
      '--text-primary':   '#c9d8ef',
      '--text-secondary': '#6e8caa',
      '--text-muted':     '#2d4060',
      '--logo-text':      '#e0eeff',
      '--menu-mode':      'dark',
      '--shadow-card':    '0 2px 8px rgba(0,40,80,.5)',
      '--group-title':    '#2d4060',
    },
  },

  green: {
    label: '翠绿',
    icon: '🌿',
    antd: {
      algorithm: antTheme.darkAlgorithm,
      token: {
        colorPrimary: '#29a270',
        colorBgBase: '#0a1a12',
        colorBgContainer: '#0f2318',
        colorBgElevated: '#152e20',
        borderRadius: 8,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      },
      components: {
        Layout: { siderBg: '#0c1e14', headerBg: '#0c1e14', bodyBg: '#0a1a12' },
        Menu: { darkItemBg: '#0c1e14', darkSubMenuItemBg: '#091810' },
      },
    },
    vars: {
      '--bg-base':        '#0a1a12',
      '--bg-sidebar':     '#0c1e14',
      '--bg-header':      '#0c1e14',
      '--bg-card':        '#0f2318',
      '--bg-card-hover':  '#152e20',
      '--border-color':   '#1a3828',
      '--border-subtle':  '#122a1c',
      '--text-primary':   '#c0e8c8',
      '--text-secondary': '#5a9a6a',
      '--text-muted':     '#1e4028',
      '--logo-text':      '#d8f0e0',
      '--menu-mode':      'dark',
      '--shadow-card':    '0 2px 8px rgba(0,40,20,.5)',
      '--group-title':    '#1e4028',
    },
  },
}

export const useThemeStore = defineStore('theme', () => {
  const current = ref(localStorage.getItem(STORAGE_KEY) || 'light')

  const config = computed(() => THEMES[current.value] || THEMES.dark)
  const antdTheme = computed(() => config.value.antd)
  const isDark = computed(() => current.value !== 'light')

  function applyVars() {
    const vars = config.value.vars
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    root.setAttribute('data-theme', current.value)
  }

  function setTheme(name) {
    if (!THEMES[name]) return
    current.value = name
    localStorage.setItem(STORAGE_KEY, name)
    applyVars()
  }

  function init() { applyVars() }

  return { current, config, antdTheme, isDark, setTheme, init }
})
