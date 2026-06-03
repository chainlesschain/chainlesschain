/**
 * settingsHelpers — pure-function unit tests
 *
 * Covers:
 *  - buildSettingsRoute returns base path when tab is empty/undefined
 *  - buildSettingsRoute encodes tab key via encodeURIComponent
 *  - themeLabel / languageLabel / v6ShellLabel handle known + unknown +
 *    falsy values
 */

import { describe, it, expect } from "vitest";
import {
  buildSettingsRoute,
  languageLabel,
  themeLabel,
  v6ShellLabel,
  SETTINGS_TAB_KEYS,
} from "../settingsHelpers";

describe("buildSettingsRoute", () => {
  it("returns /settings/system when tab is undefined", () => {
    expect(buildSettingsRoute()).toBe("/settings/system");
  });

  it("returns /settings/system when tab is empty string or whitespace", () => {
    expect(buildSettingsRoute("")).toBe("/settings/system");
    expect(buildSettingsRoute("   ")).toBe("/settings/system");
  });

  it("appends ?tab=key for valid tab keys", () => {
    for (const k of SETTINGS_TAB_KEYS) {
      expect(buildSettingsRoute(k)).toBe(`/settings/system?tab=${k}`);
    }
  });

  it("encodes special characters in unknown tab values", () => {
    expect(buildSettingsRoute("foo bar")).toBe(
      "/settings/system?tab=foo%20bar",
    );
    expect(buildSettingsRoute("a&b")).toBe("/settings/system?tab=a%26b");
  });

  it("trims surrounding whitespace before building the route", () => {
    expect(buildSettingsRoute("  general  ")).toBe(
      "/settings/system?tab=general",
    );
  });
});

describe("themeLabel", () => {
  it("maps known theme values", () => {
    expect(themeLabel("light")).toBe("浅色");
    expect(themeLabel("dark")).toBe("深色");
    expect(themeLabel("auto")).toBe("跟随系统");
  });

  it("returns the raw value for unknown themes", () => {
    expect(themeLabel("solarized")).toBe("solarized");
  });

  it("returns 未设置 for falsy / non-string", () => {
    expect(themeLabel(undefined)).toBe("未设置");
    expect(themeLabel(null)).toBe("未设置");
    expect(themeLabel("")).toBe("未设置");
    expect(themeLabel(123)).toBe("未设置");
  });
});

describe("languageLabel", () => {
  it("maps known language codes to native labels", () => {
    expect(languageLabel("zh-CN")).toBe("简体中文");
    expect(languageLabel("en-US")).toBe("English");
    expect(languageLabel("ja-JP")).toBe("日本語");
  });

  it("returns the raw value for unknown locales", () => {
    expect(languageLabel("fr-FR")).toBe("fr-FR");
  });

  it("returns 未设置 for falsy", () => {
    expect(languageLabel(undefined)).toBe("未设置");
    expect(languageLabel("")).toBe("未设置");
  });
});

describe("v6ShellLabel", () => {
  it("maps boolean true → 'V6 (默认)' and false → 'V5 (经典)'", () => {
    expect(v6ShellLabel(true)).toBe("V6 (默认)");
    expect(v6ShellLabel(false)).toBe("V5 (经典)");
  });

  it("returns 未设置 for non-boolean values", () => {
    expect(v6ShellLabel(undefined)).toBe("未设置");
    expect(v6ShellLabel(null)).toBe("未设置");
    expect(v6ShellLabel("true")).toBe("未设置");
    expect(v6ShellLabel(1)).toBe("未设置");
  });
});
