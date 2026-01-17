/**
 * 多媒体主题 Composable
 *
 * 提供明暗主题切换功能
 */

import { ref, computed, watch } from 'vue';
import type { ComputedRef } from 'vue';

/**
 * 主题类型
 */
export type ThemeMode = 'light' | 'dark' | 'auto';

/**
 * 主题配置接口
 */
export interface ThemeConfig {
  mode: ThemeMode;
  primaryColor?: string;
  customColors?: Record<string, string>;
}

/**
 * 主题色彩方案
 */
export interface ThemeColors {
  // 背景色
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;

  // 文本色
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // 边框色
  border: string;
  borderLight: string;

  // 主题色
  primary: string;
  primaryHover: string;
  primaryActive: string;

  // 状态色
  success: string;
  warning: string;
  error: string;
  info: string;

  // 阴影
  shadow: string;
  shadowLight: string;
}

/**
 * 预定义主题
 */
const lightTheme: ThemeColors = {
  background: '#ffffff',
  backgroundSecondary: '#f5f5f5',
  backgroundTertiary: '#fafafa',
  textPrimary: '#262626',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  border: '#d9d9d9',
  borderLight: '#f0f0f0',
  primary: '#667eea',
  primaryHover: '#5a67d8',
  primaryActive: '#4c51bf',
  success: '#52c41a',
  warning: '#faad14',
  error: '#f5222d',
  info: '#1890ff',
  shadow: 'rgba(0, 0, 0, 0.1)',
  shadowLight: 'rgba(0, 0, 0, 0.05)',
};

const darkTheme: ThemeColors = {
  background: '#1f1f1f',
  backgroundSecondary: '#2d2d2d',
  backgroundTertiary: '#3a3a3a',
  textPrimary: '#f5f5f5',
  textSecondary: '#d9d9d9',
  textTertiary: '#8c8c8c',
  border: '#434343',
  borderLight: '#303030',
  primary: '#7c3aed',
  primaryHover: '#8b5cf6',
  primaryActive: '#a78bfa',
  success: '#73d13d',
  warning: '#ffc53d',
  error: '#ff4d4f',
  info: '#40a9ff',
  shadow: 'rgba(0, 0, 0, 0.4)',
  shadowLight: 'rgba(0, 0, 0, 0.2)',
};

// 全局状态
const currentMode = ref<ThemeMode>('auto');
const systemPrefersDark = ref(false);

/**
 * 多媒体主题 Composable
 */
export function useMultimediaTheme() {
  /**
   * 计算实际主题模式（考虑auto）
   */
  const effectiveMode: ComputedRef<'light' | 'dark'> = computed(() => {
    if (currentMode.value === 'auto') {
      return systemPrefersDark.value ? 'dark' : 'light';
    }
    return currentMode.value;
  });

  /**
   * 当前主题颜色
   */
  const colors: ComputedRef<ThemeColors> = computed(() => {
    return effectiveMode.value === 'dark' ? darkTheme : lightTheme;
  });

  /**
   * 是否为暗色主题
   */
  const isDark = computed(() => effectiveMode.value === 'dark');

  /**
   * 设置主题模式
   */
  const setTheme = (mode: ThemeMode) => {
    currentMode.value = mode;

    // 保存到localStorage
    try {
      localStorage.setItem('multimedia-theme', mode);
    } catch (e) {
      console.warn('[useMultimediaTheme] Failed to save theme to localStorage:', e);
    }

    // 应用主题
    applyTheme();
  };

  /**
   * 切换主题
   */
  const toggleTheme = () => {
    if (currentMode.value === 'light') {
      setTheme('dark');
    } else if (currentMode.value === 'dark') {
      setTheme('light');
    } else {
      // 如果是auto，切换到相反的模式
      setTheme(systemPrefersDark.value ? 'light' : 'dark');
    }
  };

  /**
   * 应用主题到DOM
   */
  const applyTheme = () => {
    const root = document.documentElement;
    const themeColors = colors.value;

    // 设置CSS变量
    Object.entries(themeColors).forEach(([key, value]) => {
      root.style.setProperty(`--multimedia-${kebabCase(key)}`, value);
    });

    // 设置主题类名
    root.classList.remove('multimedia-theme-light', 'multimedia-theme-dark');
    root.classList.add(`multimedia-theme-${effectiveMode.value}`);

    // 设置data属性
    root.setAttribute('data-multimedia-theme', effectiveMode.value);
  };

  /**
   * 监听系统主题变化
   */
  const watchSystemTheme = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // 初始值
    systemPrefersDark.value = mediaQuery.matches;

    // 监听变化
    const handler = (e: MediaQueryListEvent) => {
      systemPrefersDark.value = e.matches;
    };

    try {
      // 现代浏览器
      mediaQuery.addEventListener('change', handler);
    } catch (e) {
      // 旧浏览器
      mediaQuery.addListener(handler);
    }

    // 返回清理函数
    return () => {
      try {
        mediaQuery.removeEventListener('change', handler);
      } catch (e) {
        mediaQuery.removeListener(handler);
      }
    };
  };

  /**
   * 获取特定颜色
   */
  const getColor = (key: keyof ThemeColors): string => {
    return colors.value[key];
  };

  /**
   * 获取CSS变量名
   */
  const getCSSVar = (key: keyof ThemeColors): string => {
    return `var(--multimedia-${kebabCase(key)})`;
  };

  /**
   * 主题配置对象
   */
  const themeConfig: ComputedRef<ThemeConfig> = computed(() => ({
    mode: currentMode.value,
    primaryColor: colors.value.primary,
  }));

  return {
    // 状态
    mode: currentMode,
    effectiveMode,
    colors,
    isDark,
    themeConfig,

    // 方法
    setTheme,
    toggleTheme,
    getColor,
    getCSSVar,
    watchSystemTheme,
    applyTheme,
  };
}

/**
 * 初始化主题系统
 */
export function initMultimediaTheme() {
  const { setTheme: _setTheme, watchSystemTheme, applyTheme } = useMultimediaTheme();

  // 从localStorage恢复主题
  try {
    const savedTheme = localStorage.getItem('multimedia-theme');
    if (savedTheme && ['light', 'dark', 'auto'].includes(savedTheme)) {
      currentMode.value = savedTheme as ThemeMode;
    }
  } catch (e) {
    console.warn('[initMultimediaTheme] Failed to load theme from localStorage:', e);
  }

  // 监听系统主题
  watchSystemTheme();

  // 应用主题
  applyTheme();

  // 监听主题变化
  watch([currentMode, systemPrefersDark], () => {
    applyTheme();
  });
}

/**
 * 辅助函数：将驼峰命名转换为短横线命名
 */
function kebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * 导出预定义主题供其他地方使用
 */
export { lightTheme, darkTheme };

// 导出默认实例
export default useMultimediaTheme;
