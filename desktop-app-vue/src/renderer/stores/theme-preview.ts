import { defineStore } from "pinia";

export type PreviewTheme = "dark" | "light" | "blue" | "green";

export const PREVIEW_THEMES: ReadonlyArray<{
  key: PreviewTheme;
  label: string;
  icon: string;
}> = [
  { key: "dark", label: "暗黑", icon: "🌑" },
  { key: "light", label: "亮白", icon: "☀️" },
  { key: "blue", label: "深蓝", icon: "🌊" },
  { key: "green", label: "翠绿", icon: "🌿" },
];

const STORAGE_KEY = "cc.theme-preview";
const DEFAULT_THEME: PreviewTheme = "dark";

function isValidTheme(value: unknown): value is PreviewTheme {
  return (
    value === "dark" ||
    value === "light" ||
    value === "blue" ||
    value === "green"
  );
}

export const useThemePreviewStore = defineStore("theme-preview", {
  state: () => ({
    active: DEFAULT_THEME as PreviewTheme,
  }),
  actions: {
    apply(theme: PreviewTheme) {
      if (!isValidTheme(theme)) return;
      this.active = theme;
      if (typeof document !== "undefined") {
        document.documentElement.dataset.themePreview = theme;
      }
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        /* localStorage unavailable (private mode / SSR) */
      }
    },
    restore() {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(STORAGE_KEY);
      } catch {
        saved = null;
      }
      this.apply(isValidTheme(saved) ? saved : DEFAULT_THEME);
    },
    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      if (typeof document !== "undefined") {
        delete document.documentElement.dataset.themePreview;
      }
      this.active = DEFAULT_THEME;
    },
  },
});
