import { describe, it, expect } from "vitest";
import { deepMerge } from "@renderer/pages/settings/systemSettingsUtils";

describe("systemSettingsUtils.deepMerge", () => {
  it("overlays source scalars over target", () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
  });

  it("recursively merges nested plain objects", () => {
    const target = { ui: { theme: "dark", lang: "zh" }, x: 1 };
    const source = { ui: { lang: "en" } };
    expect(deepMerge(target, source)).toEqual({
      ui: { theme: "dark", lang: "en" },
      x: 1,
    });
  });

  it("creates nested branches missing from target", () => {
    expect(deepMerge({}, { a: { b: { c: 1 } } })).toEqual({
      a: { b: { c: 1 } },
    });
  });

  it("replaces arrays wholesale (does not merge element-wise)", () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({
      list: [9],
    });
  });

  it("does not mutate the target", () => {
    const target = { ui: { theme: "dark" } };
    const result = deepMerge(target, { ui: { theme: "light" } });
    expect(target.ui.theme).toBe("dark");
    expect(result.ui.theme).toBe("light");
  });

  it("ignores inherited (non-own) source properties", () => {
    const proto = { inherited: "x" };
    const source = Object.create(proto);
    source.own = "y";
    expect(deepMerge({}, source)).toEqual({ own: "y" });
  });
});
