import { describe, it, expect } from "vitest";
import {
  THEMES,
  DEFAULT_THEME,
  listThemeNames,
  resolveTheme,
  promptAccent,
  applyThemeChalk,
  renderThemeList,
} from "../../src/repl/repl-theme.js";

describe("theme table", () => {
  it("exposes auto/dark/light/mono and a sane default", () => {
    expect(listThemeNames()).toEqual(["auto", "dark", "light", "mono"]);
    expect(DEFAULT_THEME).toBe("auto");
    expect(THEMES.mono.color).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("accepts known names case-insensitively", () => {
    expect(resolveTheme("DARK")).toBe("dark");
    expect(resolveTheme("  light ")).toBe("light");
  });
  it("rejects unknown names", () => {
    expect(resolveTheme("solarized")).toBeNull();
    expect(resolveTheme("")).toBeNull();
    expect(resolveTheme(null)).toBeNull();
  });
});

describe("promptAccent", () => {
  it("maps each theme to its accent", () => {
    expect(promptAccent("dark")).toBe("green");
    expect(promptAccent("light")).toBe("blue");
    expect(promptAccent("mono")).toBe("none");
  });
  it("falls back to default for an unknown theme", () => {
    expect(promptAccent("nope")).toBe(promptAccent(DEFAULT_THEME));
  });
});

describe("applyThemeChalk", () => {
  it("drops color to level 0 for mono", () => {
    const chalk = { level: 3 };
    expect(applyThemeChalk("mono", chalk, 3)).toBe(0);
    expect(chalk.level).toBe(0);
  });
  it("restores the captured baseline for a colored theme", () => {
    const chalk = { level: 0 };
    applyThemeChalk("dark", chalk, 2);
    expect(chalk.level).toBe(2);
  });
  it("leaves level untouched for a colored theme when no baseline given", () => {
    const chalk = { level: 1 };
    applyThemeChalk("light", chalk, null);
    expect(chalk.level).toBe(1);
  });
});

describe("renderThemeList", () => {
  it("marks the active theme and lists usage", () => {
    const out = renderThemeList("light");
    expect(out).toMatch(/\*\s+light/);
    expect(out).toMatch(/ {2}auto/);
    expect(out).toMatch(/Usage: \/theme <auto\|dark\|light\|mono>/);
  });
});
