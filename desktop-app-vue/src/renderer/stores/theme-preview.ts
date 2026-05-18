import { defineStore } from "pinia";

export type PreviewTheme = "light" | "dark" | "blue" | "green";

export const PREVIEW_THEMES: ReadonlyArray<{
  key: PreviewTheme;
  label: string;
  icon: string;
}> = [
  { key: "light", label: "浅色", icon: "L" },
  { key: "dark", label: "深色", icon: "D" },
  { key: "blue", label: "蓝调", icon: "B" },
  { key: "green", label: "青绿", icon: "G" },
];

const STORAGE_KEY = "cc.theme-preview";
const DEFAULT_THEME: PreviewTheme = "light";

function isValidTheme(value: unknown): value is PreviewTheme {
  return (
    value === "light" ||
    value === "dark" ||
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
      if (!isValidTheme(theme)) {
        return;
      }
      this.active = theme;
      if (typeof document !== "undefined") {
        document.documentElement.dataset.themePreview = theme;
      }
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        /* ignore localStorage issues */
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
