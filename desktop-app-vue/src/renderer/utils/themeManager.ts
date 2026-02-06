/**
 * 主题系统
 * 提供主题切换和自定义功能
 */

import { logger } from '@/utils/logger';
import { ref, computed, type Ref, type ComputedRef } from "vue";

// ==================== 类型定义 ====================

/**
 * 主题颜色配置
 */
export interface ThemeColors {
  primary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  hover: string;
}

/**
 * 主题配置
 */
export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors | null;
}

/**
 * 主题存储数据
 */
interface ThemeStorageData {
  currentTheme: string | undefined;
  customThemes: Theme[];
}

/**
 * useTheme 返回类型
 */
export interface UseThemeReturn {
  currentTheme: ComputedRef<Theme | null>;
  effectiveTheme: ComputedRef<Theme>;
  systemPrefersDark: ComputedRef<boolean>;
  allThemes: ComputedRef<Theme[]>;
  setTheme: (themeId: string) => void;
  toggle: () => void;
  addCustomTheme: (theme: Theme) => void;
  updateCustomTheme: (themeId: string, updates: Partial<Theme>) => void;
  removeCustomTheme: (themeId: string) => void;
  exportTheme: (themeId: string) => string | null;
  importTheme: (themeJson: string) => boolean;
}

// ==================== 预定义主题 ====================

/**
 * 预定义主题
 */
export const Themes: Record<string, Theme> = {
  LIGHT: {
    id: "light",
    name: "浅色主题",
    colors: {
      primary: "#1890ff",
      success: "#52c41a",
      warning: "#faad14",
      error: "#ff4d4f",
      info: "#1890ff",
      background: "#ffffff",
      surface: "#f5f5f5",
      text: "#262626",
      textSecondary: "#8c8c8c",
      border: "#d9d9d9",
      hover: "#f0f0f0",
    },
  },
  DARK: {
    id: "dark",
    name: "深色主题",
    colors: {
      primary: "#177ddc",
      success: "#49aa19",
      warning: "#d89614",
      error: "#d32029",
      info: "#177ddc",
      background: "#141414",
      surface: "#1f1f1f",
      text: "#e8e8e8",
      textSecondary: "#a6a6a6",
      border: "#434343",
      hover: "#262626",
    },
  },
  AUTO: {
    id: "auto",
    name: "跟随系统",
    colors: null,
  },
};

// ==================== 主题管理器类 ====================

/**
 * 主题管理器
 */
class ThemeManager {
  currentTheme: Ref<Theme | null>;
  customThemes: Ref<Theme[]>;
  systemPrefersDark: Ref<boolean>;

  constructor() {
    this.currentTheme = ref(null);
    this.customThemes = ref([]);
    this.systemPrefersDark = ref(false);

    this.watchSystemTheme();
    this.loadFromStorage();
    this.applyTheme();
  }

  /**
   * 监听系统主题变化
   */
  private watchSystemTheme(): void {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this.systemPrefersDark.value = mediaQuery.matches;

    mediaQuery.addEventListener("change", (e) => {
      this.systemPrefersDark.value = e.matches;

      if (this.currentTheme.value?.id === "auto") {
        this.applyTheme();
      }
    });
  }

  /**
   * 设置主题
   */
  setTheme(themeId: string): void {
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
  getTheme(themeId: string): Theme | undefined {
    const predefinedTheme = Object.values(Themes).find((t) => t.id === themeId);
    if (predefinedTheme) {
      return predefinedTheme;
    }

    return this.customThemes.value.find((t) => t.id === themeId);
  }

  /**
   * 获取当前有效主题
   */
  getEffectiveTheme(): Theme {
    if (!this.currentTheme.value) {
      return Themes.LIGHT;
    }

    if (this.currentTheme.value.id === "auto") {
      return this.systemPrefersDark.value ? Themes.DARK : Themes.LIGHT;
    }

    return this.currentTheme.value;
  }

  /**
   * 应用主题
   */
  applyTheme(): void {
    const theme = this.getEffectiveTheme();
    if (!theme || !theme.colors) return;

    const root = document.documentElement;
    if (root) {
      Object.entries(theme.colors).forEach(([key, value]) => {
        root.style.setProperty(`--color-${key}`, value);
      });
    }

    if (document.body) {
      document.body.className = document.body.className
        .split(" ")
        .filter((c) => !c.startsWith("theme-"))
        .concat(`theme-${theme.id}`)
        .join(" ");
    }
  }

  /**
   * 添加自定义主题
   */
  addCustomTheme(theme: Theme): void {
    if (!theme.id || !theme.name || !theme.colors) {
      throw new Error("Invalid theme format");
    }

    const exists = this.customThemes.value.some((t) => t.id === theme.id);
    if (exists) {
      throw new Error(`Theme with id "${theme.id}" already exists`);
    }

    this.customThemes.value.push(theme);
    this.saveToStorage();
  }

  /**
   * 更新自定义主题
   */
  updateCustomTheme(themeId: string, updates: Partial<Theme>): void {
    const theme = this.customThemes.value.find((t) => t.id === themeId);
    if (theme) {
      Object.assign(theme, updates);
      this.saveToStorage();

      if (this.currentTheme.value?.id === themeId) {
        this.applyTheme();
      }
    }
  }

  /**
   * 删除自定义主题
   */
  removeCustomTheme(themeId: string): void {
    const index = this.customThemes.value.findIndex((t) => t.id === themeId);
    if (index > -1) {
      this.customThemes.value.splice(index, 1);
      this.saveToStorage();

      if (this.currentTheme.value?.id === themeId) {
        this.setTheme("light");
      }
    }
  }

  /**
   * 获取所有主题
   */
  getAllThemes(): Theme[] {
    return [...Object.values(Themes), ...this.customThemes.value];
  }

  /**
   * 切换主题（在浅色和深色之间）
   */
  toggle(): void {
    const current = this.getEffectiveTheme();
    const newTheme = current.id === "light" ? "dark" : "light";
    this.setTheme(newTheme);
  }

  /**
   * 保存到本地存储
   */
  private saveToStorage(): void {
    try {
      const data: ThemeStorageData = {
        currentTheme: this.currentTheme.value?.id,
        customThemes: this.customThemes.value,
      };
      localStorage.setItem("theme", JSON.stringify(data));
    } catch (error) {
      logger.error("[ThemeManager] Save to storage error:", error);
    }
  }

  /**
   * 从本地存储加载
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem("theme");
      if (stored) {
        const data: ThemeStorageData = JSON.parse(stored);

        if (data.customThemes) {
          this.customThemes.value = data.customThemes;
        }

        if (data.currentTheme) {
          const theme = this.getTheme(data.currentTheme);
          if (theme) {
            this.currentTheme.value = theme;
          }
        }
      }

      if (!this.currentTheme.value) {
        this.currentTheme.value = Themes.LIGHT;
      }
    } catch (error) {
      logger.error("[ThemeManager] Load from storage error:", error);
      this.currentTheme.value = Themes.LIGHT;
    }
  }

  /**
   * 导出主题
   */
  exportTheme(themeId: string): string | null {
    const theme = this.getTheme(themeId);
    if (theme) {
      return JSON.stringify(theme, null, 2);
    }
    return null;
  }

  /**
   * 导入主题
   */
  importTheme(themeJson: string): boolean {
    try {
      const theme: Theme = JSON.parse(themeJson);
      this.addCustomTheme(theme);
      return true;
    } catch (error) {
      logger.error("[ThemeManager] Import theme error:", error);
      return false;
    }
  }
}

// 创建全局实例
const themeManager = new ThemeManager();

/**
 * 组合式函数：使用主题
 */
export function useTheme(): UseThemeReturn {
  return {
    currentTheme: computed(() => themeManager.currentTheme.value),
    effectiveTheme: computed(() => themeManager.getEffectiveTheme()),
    systemPrefersDark: computed(() => themeManager.systemPrefersDark.value),
    allThemes: computed(() => themeManager.getAllThemes()),
    setTheme: (themeId: string) => themeManager.setTheme(themeId),
    toggle: () => themeManager.toggle(),
    addCustomTheme: (theme: Theme) => themeManager.addCustomTheme(theme),
    updateCustomTheme: (themeId: string, updates: Partial<Theme>) =>
      themeManager.updateCustomTheme(themeId, updates),
    removeCustomTheme: (themeId: string) => themeManager.removeCustomTheme(themeId),
    exportTheme: (themeId: string) => themeManager.exportTheme(themeId),
    importTheme: (themeJson: string) => themeManager.importTheme(themeJson),
  };
}

export default themeManager;
