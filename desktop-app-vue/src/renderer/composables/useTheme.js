/**
 * 主题管理 Hook
 */

import { ref, watch, onMounted } from 'vue';

// 主题类型
export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto',
};

// 当前主题
const currentTheme = ref(THEMES.LIGHT);

// 实际应用的主题（考虑自动模式）
const appliedTheme = ref(THEMES.LIGHT);

// 本地存储键
const STORAGE_KEY = 'skill-tool-theme';

/**
 * 检测系统主题偏好
 */
function detectSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return THEMES.DARK;
  }
  return THEMES.LIGHT;
}

/**
 * 应用主题
 */
function applyTheme(theme) {
  const root = document.documentElement;

  if (theme === THEMES.DARK) {
    root.classList.add('dark-theme');
    root.classList.remove('light-theme');
  } else {
    root.classList.add('light-theme');
    root.classList.remove('dark-theme');
  }

  appliedTheme.value = theme;
}

/**
 * 设置主题
 */
export function setTheme(theme) {
  currentTheme.value = theme;

  // 保存到本地存储
  localStorage.setItem(STORAGE_KEY, theme);

  // 应用主题
  if (theme === THEMES.AUTO) {
    applyTheme(detectSystemTheme());
  } else {
    applyTheme(theme);
  }
}

/**
 * 切换主题
 */
export function toggleTheme() {
  const newTheme = currentTheme.value === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
  setTheme(newTheme);
}

/**
 * 初始化主题
 */
export function initTheme() {
  // 从本地存储读取
  const savedTheme = localStorage.getItem(STORAGE_KEY);

  if (savedTheme && Object.values(THEMES).includes(savedTheme)) {
    currentTheme.value = savedTheme;
  }

  // 应用主题
  if (currentTheme.value === THEMES.AUTO) {
    applyTheme(detectSystemTheme());

    // 监听系统主题变化
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (currentTheme.value === THEMES.AUTO) {
          applyTheme(e.matches ? THEMES.DARK : THEMES.LIGHT);
        }
      });
    }
  } else {
    applyTheme(currentTheme.value);
  }
}

/**
 * 使用主题
 */
export function useTheme() {
  onMounted(() => {
    initTheme();
  });

  return {
    currentTheme,
    appliedTheme,
    setTheme,
    toggleTheme,
    THEMES,
  };
}

export default useTheme;
