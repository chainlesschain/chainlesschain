/**
 * themeManager 测试 — src/renderer/utils/themeManager.ts
 *
 * The default singleton calls window.matchMedia in its constructor at import
 * time, so matchMedia is stubbed before a dynamic import. The manager's public
 * refs (currentTheme/customThemes/systemPrefersDark) are reset between tests.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let tm: any;
let Themes: any;

beforeAll(async () => {
  (window as any).matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const mod = await import("@/utils/themeManager");
  tm = mod.default;
  Themes = mod.Themes;
});

beforeEach(() => {
  localStorage.clear();
  tm.customThemes.value = [];
  tm.systemPrefersDark.value = false;
  tm.setTheme("light");
});
afterEach(() => {
  tm.customThemes.value = [];
});

function makeTheme(id: string): any {
  return { id, name: `Theme ${id}`, colors: { ...Themes.LIGHT.colors } };
}

describe("themeManager — setTheme + effective theme", () => {
  it("sets a predefined theme and ignores unknown ids", () => {
    tm.setTheme("dark");
    expect(tm.getEffectiveTheme().id).toBe("dark");
    tm.setTheme("does-not-exist");
    expect(tm.getEffectiveTheme().id).toBe("dark"); // unchanged
    tm.setTheme("light");
    expect(tm.getEffectiveTheme().id).toBe("light");
  });

  it("auto resolves to the system preference", () => {
    tm.systemPrefersDark.value = true;
    tm.setTheme("auto");
    expect(tm.getEffectiveTheme().id).toBe("dark");
    tm.systemPrefersDark.value = false;
    expect(tm.getEffectiveTheme().id).toBe("light");
  });

  it("toggle flips between light and dark", () => {
    tm.setTheme("light");
    tm.toggle();
    expect(tm.getEffectiveTheme().id).toBe("dark");
    tm.toggle();
    expect(tm.getEffectiveTheme().id).toBe("light");
  });

  it("applyTheme writes CSS vars + a theme- body class", () => {
    tm.setTheme("dark");
    expect(
      document.documentElement.style.getPropertyValue("--color-primary"),
    ).toBe(Themes.DARK.colors.primary);
    expect(document.body.className).toContain("theme-dark");
  });
});

describe("themeManager — custom themes", () => {
  it("adds, finds, lists and rejects duplicate/invalid themes", () => {
    tm.addCustomTheme(makeTheme("custom-a"));
    expect(tm.getTheme("custom-a")).toMatchObject({ id: "custom-a" });
    expect(tm.getAllThemes().some((t: any) => t.id === "custom-a")).toBe(true);
    expect(() => tm.addCustomTheme(makeTheme("custom-a"))).toThrow(
      /already exists/,
    );
    expect(() => tm.addCustomTheme({ id: "", name: "", colors: null })).toThrow(
      /Invalid/,
    );
  });

  it("removes a custom theme and falls back to light when it was active", () => {
    tm.addCustomTheme(makeTheme("custom-b"));
    tm.setTheme("custom-b");
    expect(tm.getEffectiveTheme().id).toBe("custom-b");
    tm.removeCustomTheme("custom-b");
    expect(tm.getTheme("custom-b")).toBeUndefined();
    expect(tm.getEffectiveTheme().id).toBe("light");
  });
});

describe("themeManager — export / import", () => {
  it("exportTheme returns JSON for known themes, null otherwise", () => {
    const json = tm.exportTheme("light");
    expect(JSON.parse(json!).id).toBe("light");
    expect(tm.exportTheme("nope")).toBeNull();
  });

  it("importTheme adds valid JSON and reports false on garbage", () => {
    expect(tm.importTheme(JSON.stringify(makeTheme("imported-1")))).toBe(true);
    expect(tm.getTheme("imported-1")).toMatchObject({ id: "imported-1" });
    expect(tm.importTheme("{not json")).toBe(false);
  });
});
