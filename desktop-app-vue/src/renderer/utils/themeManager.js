/**
 * 主题系统
 * 提供主题切换和自定义功能
 */

import { ref, computed, watch } from 'vue';

/**
 * 预定义主题
 */
export const Themes = {
  LIGHT: {
    id: 'light',
    name: '浅色主题',
    colors: {
      primary: '#1890ff',
      success: '#52c41a',
      warning: '#faad14',
      error: '#ff4d4f',
      info: '#1890ff',
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#262626',
      textSecondary: '#8c8c8c',
      border: '#d9d9d9',
      hover: '#f0f0f0',
    },
  },
  DARK: {
    id: 'dark',
    name: '深色主题',
    colors: {
      primary: '#177ddc',
      success: '#49aa19',
      warning: '#d89614',
      error: '#d32029',
      info: '#177ddc',
      background: '#141414',
      surface: '#1f1f1f',
      text: '#e8e8e8',
      textSecondary: '#a6a6a6',
      border: '#434343',
      hover: '#262626',
    },
  },
  AUTO: {
    id: 'auto',
    name: '跟随系统',
    colors: null, // 根据系统自动选择
  },
};

/**
 * 主题管理器
 */
class ThemeManager {
  constructor() {
    this.currentTheme = ref(null);
    this.customThemes = ref([]);
    this.systemPrefersDark = ref(false);

    // 监听系统主题变化
    this.watchSystemTheme();

    // 从本地存储加载主题
    this.loadFromStorage();

    // 应用主题
    this.applyTheme();
  }

  /**
   * 监听系统主题变化
   */
  watchSystemTheme() {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemPrefersDark.value = mediaQuery.matches;

    mediaQuery.addEventListener('change', (e) => {
      this.systemPrefersDark.value = e.matches;

      // 如果当前是自动模式，重新应用主题
      if (this.currentTheme.value?.id === 'auto') {
        this.applyTheme();
      }
    });
  }

  /**
   * 设置主题
   */
  setTheme(themeId) {
    const theme = this.getTheme(themeId);
    if (theme) {
      this.currentTheme.value = theme;
      this.applyTheme();
      this.saveToStorage();
    }
  }

  /**
   * 获取主题
   */
  getTheme(themeId) {
    // 先查找预定义主题
    const predefinedTheme = Object.values(Themes).find(t => t.id === themeId);
    if (predefinedTheme) {
      return predefinedTheme;
    }

    // 再查找自定义主题
    return this.customThemes.value.find(t => t.id === themeId);
  }

  /**
   * 获取当前有效主题
   */
  getEffectiveTheme() {
    if (!this.currentTheme.value) {
      return Themes.LIGHT;
    }

    // 如果是自动模式，根据系统偏好返回
    if (this.currentTheme.value.id === 'auto') {
      return this.systemPrefersDark.value ? Themes.DARK : Themes.LIGHT;
    }

    return this.currentTheme.value;
  }

  /**
   * 应用主题
   */
  applyTheme() {
    const theme = this.getEffectiveTheme();
    if (!theme || !theme.colors) return;

    // 应用CSS变量
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });

    // 设置body类名
    document.body.className = document.body.className
      .split(' ')
      .filter(c => !c.startsWith('theme-'))
      .concat(`theme-${theme.id}`)
      .join(' ');
  }

  /**
   * 添加自定义主题
   */
  addCustomTheme(theme) {
    if (!theme.id || !theme.name || !theme.colors) {
      throw new Error('Invalid theme format');
    }

    // 检查ID是否已存在
    const exists = this.customThemes.value.some(t => t.id === theme.id);
    if (exists) {
      throw new Error(`Theme with id "${theme.id}" already exists`);
    }

    this.customThemes.value.push(theme);
    this.saveToStorage();
  }

  /**
   * 更新自定义主题
   */
  updateCustomTheme(themeId, updates) {
    const theme = this.customThemes.value.find(t => t.id === themeId);
    if (theme) {
      Object.assign(theme, updates);
      this.saveToStorage();

      // 如果是当前主题，重新应用
      if (this.currentTheme.value?.id === themeId) {
        this.applyTheme();
      }
    }
  }

  /**
   * 删除自定义主题
   */
  removeCustomTheme(themeId) {
    const index = this.customThemes.value.findIndex(t => t.id === themeId);
    if (index > -1) {
      this.customThemes.value.splice(index, 1);
      this.saveToStorage();

      // 如果删除的是当前主题，切换到默认主题
      if (this.currentTheme.value?.id === themeId) {
        this.setTheme('light');
      }
    }
  }

  /**
   * 获取所有主题
   */
  getAllThemes() {
    return [
      ...Object.values(Themes),
      ...this.customThemes.value,
    ];
  }

  /**
   * 切换主题（在浅色和深色之间）
   */
  toggle() {
    const current = this.getEffectiveTheme();
    const newTheme = current.id === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
  }

  /**
   * 保存到本地存储
   */
  saveToStorage() {
    try {
      const data = {
        currentTheme: this.currentTheme.value?.id,
        customThemes: this.customThemes.value,
      };
      localStorage.setItem('theme', JSON.stringify(data));
    } catch (error) {
      console.error('[ThemeManager] Save to storage error:', error);
    }
  }

  /**
   * 从本地存储加载
   */
  loadFromStorage() {
    try {
      const stored = localStorage.getItem('theme');
      if (stored) {
        const data = JSON.parse(stored);

        // 加载自定义主题
        if (data.customThemes) {
          this.customThemes.value = data.customThemes;
        }

        // 加载当前主题
        if (data.currentTheme) {
          const theme = this.getTheme(data.currentTheme);
          if (theme) {
            this.currentTheme.value = theme;
          }
        }
      }

      // 如果没有设置主题，使用默认主题
      if (!this.currentTheme.value) {
        this.currentTheme.value = Themes.LIGHT;
      }
    } catch (error) {
      console.error('[ThemeManager] Load from storage error:', error);
      this.currentTheme.value = Themes.LIGHT;
    }
  }

  /**
   * 导出主题
   */
  exportTheme(themeId) {
    const theme = this.getTheme(themeId);
    if (theme) {
      return JSON.stringify(theme, null, 2);
    }
    return null;
  }

  /**
   * 导入主题
   */
  importTheme(themeJson) {
    try {
      const theme = JSON.parse(themeJson);
      this.addCustomTheme(theme);
      return true;
    } catch (error) {
      console.error('[ThemeManager] Import theme error:', error);
      return false;
    }
  }
}

// 创建全局实例
const themeManager = new ThemeManager();

/**
 * 组合式函数：使用主题
 */
export function useTheme() {
  return {
    currentTheme: computed(() => themeManager.currentTheme.value),
    effectiveTheme: computed(() => themeManager.getEffectiveTheme()),
    systemPrefersDark: computed(() => themeManager.systemPrefersDark.value),
    allThemes: computed(() => themeManager.getAllThemes()),
    setTheme: (themeId) => themeManager.setTheme(themeId),
    toggle: () => themeManager.toggle(),
    addCustomTheme: (theme) => themeManager.addCustomTheme(theme),
    updateCustomTheme: (themeId, updates) => themeManager.updateCustomTheme(themeId, updates),
    removeCustomTheme: (themeId) => themeManager.removeCustomTheme(themeId),
    exportTheme: (themeId) => themeManager.exportTheme(themeId),
    importTheme: (themeJson) => themeManager.importTheme(themeJson),
  };
}

export default themeManager;
