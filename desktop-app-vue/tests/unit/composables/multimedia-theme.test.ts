/**
 * useMultimediaTheme 测试 — src/renderer/composables/useMultimediaTheme.ts
 *
 * Light/dark/auto theme with CSS-var application. matchMedia stubbed; effects
 * asserted via documentElement.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  useMultimediaTheme,
  initMultimediaTheme,
  lightTheme,
  darkTheme,
} from "@/composables/useMultimediaTheme";

let mql: any;
function stubMatchMedia(matches: boolean) {
  mql = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  (window as any).matchMedia = vi.fn(() => mql);
}

const root = () => document.documentElement;
let m: ReturnType<typeof useMultimediaTheme>;

beforeEach(() => {
  localStorage.clear();
  root().className = "";
  root().removeAttribute("data-multimedia-theme");
  stubMatchMedia(false);
  m = useMultimediaTheme();
  m.watchSystemTheme(); // systemPrefersDark = false
  m.setTheme("light"); // normalize mode + apply
  localStorage.clear();
});

describe("useMultimediaTheme — mode + colors", () => {
  it("light/dark explicit modes", () => {
    m.setTheme("dark");
    expect(m.effectiveMode.value).toBe("dark");
    expect(m.colors.value).toBe(darkTheme);
    expect(m.isDark.value).toBe(true);
    m.setTheme("light");
    expect(m.effectiveMode.value).toBe("light");
    expect(m.colors.value).toBe(lightTheme);
    expect(m.isDark.value).toBe(false);
  });

  it("auto resolves to the system preference", () => {
    stubMatchMedia(true);
    m.watchSystemTheme(); // systemPrefersDark = true
    m.setTheme("auto");
    expect(m.effectiveMode.value).toBe("dark");
    expect(m.isDark.value).toBe(true);
  });
});

describe("useMultimediaTheme — toggle", () => {
  it("light→dark, dark→light", () => {
    m.setTheme("light");
    m.toggleTheme();
    expect(m.mode.value).toBe("dark");
    m.toggleTheme();
    expect(m.mode.value).toBe("light");
  });

  it("auto toggles relative to system preference", () => {
    stubMatchMedia(false);
    m.watchSystemTheme();
    m.setTheme("auto");
    m.toggleTheme(); // system is light → go dark
    expect(m.mode.value).toBe("dark");
  });
});

describe("useMultimediaTheme — applyTheme + accessors", () => {
  it("setTheme applies class, data-attr and CSS vars + persists", () => {
    m.setTheme("dark");
    expect(root().classList.contains("multimedia-theme-dark")).toBe(true);
    expect(root().getAttribute("data-multimedia-theme")).toBe("dark");
    expect(root().style.getPropertyValue("--multimedia-background")).toBe(
      darkTheme.background,
    );
    expect(localStorage.getItem("multimedia-theme")).toBe("dark");
  });

  it("getColor + getCSSVar (kebab-cased)", () => {
    m.setTheme("light");
    expect(m.getColor("primary")).toBe(lightTheme.primary);
    expect(m.getCSSVar("backgroundSecondary")).toBe(
      "var(--multimedia-background-secondary)",
    );
  });
});

describe("useMultimediaTheme — watchSystemTheme + init", () => {
  it("watchSystemTheme registers a listener and returns a cleanup", () => {
    stubMatchMedia(true);
    const cleanup = m.watchSystemTheme();
    expect(mql.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    cleanup?.();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });

  it("initMultimediaTheme restores a saved mode + applies", () => {
    localStorage.setItem("multimedia-theme", "dark");
    initMultimediaTheme();
    expect(root().getAttribute("data-multimedia-theme")).toBe("dark");
  });
});
