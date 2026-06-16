/**
 * useTheme 测试 — src/renderer/composables/useTheme.ts
 *
 * Theme apply/toggle/init + system-preference (auto) handling. matchMedia is
 * stubbed (jsdom lacks it); effects asserted via documentElement classes +
 * localStorage.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  setTheme,
  toggleTheme,
  initTheme,
  cleanupThemeListener,
  useTheme,
  THEMES,
} from "@/composables/useTheme";

let mql: any;
function stubMatchMedia(matches: boolean) {
  mql = { matches, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  (window as any).matchMedia = vi.fn(() => mql);
}

const root = () => document.documentElement;
const STORAGE_KEY = "skill-tool-theme";

beforeEach(() => {
  cleanupThemeListener();
  root().className = "";
  localStorage.clear();
  stubMatchMedia(false);
  setTheme(THEMES.LIGHT); // normalize module state
  root().className = "";
});

describe("setTheme", () => {
  it("applies dark theme + persists", () => {
    setTheme(THEMES.DARK);
    expect(root().classList.contains("dark-theme")).toBe(true);
    expect(root().classList.contains("light-theme")).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(THEMES.DARK);
  });

  it("applies light theme", () => {
    setTheme(THEMES.DARK);
    setTheme(THEMES.LIGHT);
    expect(root().classList.contains("light-theme")).toBe(true);
    expect(root().classList.contains("dark-theme")).toBe(false);
  });

  it("auto resolves to the system preference", () => {
    stubMatchMedia(true);
    setTheme(THEMES.AUTO);
    expect(root().classList.contains("dark-theme")).toBe(true);
    stubMatchMedia(false);
    setTheme(THEMES.AUTO);
    expect(root().classList.contains("light-theme")).toBe(true);
  });
});

describe("toggleTheme", () => {
  it("flips light↔dark", () => {
    setTheme(THEMES.LIGHT);
    toggleTheme();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(THEMES.DARK);
    toggleTheme();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(THEMES.LIGHT);
  });
});

describe("initTheme", () => {
  it("loads a saved theme and applies it", () => {
    localStorage.setItem(STORAGE_KEY, THEMES.DARK);
    initTheme();
    expect(root().classList.contains("dark-theme")).toBe(true);
  });

  it("registers a system listener in auto mode; cleanup removes it", () => {
    localStorage.setItem(STORAGE_KEY, THEMES.AUTO);
    stubMatchMedia(true);
    initTheme();
    expect(root().classList.contains("dark-theme")).toBe(true);
    expect(mql.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    cleanupThemeListener();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });

  it("ignores an invalid saved theme", () => {
    localStorage.setItem(STORAGE_KEY, "bogus");
    setTheme(THEMES.LIGHT);
    initTheme();
    // stays light (invalid value not adopted)
    expect(root().classList.contains("light-theme")).toBe(true);
  });
});

describe("useTheme", () => {
  it("exposes the theme API", () => {
    const t = useTheme();
    expect(typeof t.setTheme).toBe("function");
    expect(typeof t.toggleTheme).toBe("function");
    expect(t.THEMES).toBe(THEMES);
    expect(t.currentTheme).toBeDefined();
    expect(t.appliedTheme).toBeDefined();
  });
});
