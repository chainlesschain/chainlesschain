import { describe, expect, it } from "vitest";

import {
  DEFAULT_INJECTED_STYLE_LIMITS,
  HARD_INJECTED_STYLE_LIMITS,
  InjectedStyleRegistry,
} from "../../../../../src/main/remote/browser-extension/handlers/injected-style-registry.js";

describe("InjectedStyleRegistry", () => {
  it("uses finite defaults and clamps configuration to hard limits", () => {
    expect(new InjectedStyleRegistry().getStats().limits).toEqual(
      DEFAULT_INJECTED_STYLE_LIMITS,
    );
    const hard = new InjectedStyleRegistry(
      Object.fromEntries(
        Object.keys(HARD_INJECTED_STYLE_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );
    expect(hard.getStats().limits).toEqual(HARD_INJECTED_STYLE_LIMITS);
  });

  it("reserves unique IDs and counts pending injections against limits", () => {
    const registry = new InjectedStyleRegistry({
      maxStylesPerTab: 2,
      now: () => 10,
    });
    const first = registry.reserve(1, "a{}", "USER");
    const second = registry.reserve(1, "b{}", "AUTHOR");
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(first.cssId).not.toBe(second.cssId);
    expect(registry.reserve(1, "c{}")).toMatchObject({
      code: "OVERLOADED",
      scope: "css_styles_tab",
    });
    expect(registry.getTab(1).styles).toMatchObject([
      { cssId: first.cssId, status: "pending", origin: "USER" },
      { cssId: second.cssId, status: "pending", origin: "AUTHOR" },
    ]);
  });

  it("bounds UTF-8 bytes per style, tab, and global registry", () => {
    const registry = new InjectedStyleRegistry({
      maxTabs: 2,
      maxStylesPerTab: 3,
      maxBytesPerStyle: 12,
      maxBytesPerTab: 16,
      maxTotalBytes: 20,
    });
    expect(registry.reserve(1, "你".repeat(5))).toMatchObject({
      code: "OVERLOADED",
      scope: "css_style_bytes",
    });
    const first = registry.reserve(1, "x".repeat(10));
    registry.markActive(first.reservation);
    expect(registry.reserve(1, "y".repeat(7))).toMatchObject({
      scope: "css_tab_bytes",
    });
    const second = registry.reserve(2, "z".repeat(10));
    registry.markActive(second.reservation);
    expect(registry.reserve(2, "q")).toMatchObject({
      scope: "css_bytes",
    });
    expect(registry.getStats().totalBytes).toBe(20);
  });

  it("serializes removal and keeps state available after a failed removal", () => {
    const registry = new InjectedStyleRegistry();
    const admission = registry.reserve(3, "body{}", "USER");
    registry.markActive(admission.reservation);
    const removal = registry.beginRemove(3, admission.cssId);
    expect(removal).toMatchObject({
      accepted: true,
      removal: { css: "body{}", origin: "USER" },
    });
    expect(registry.beginRemove(3, admission.cssId)).toMatchObject({
      code: "CSS_STYLE_BUSY",
    });
    expect(registry.cancelRemove(admission.reservation)).toBe(true);
    expect(registry.getTab(3).styles[0].status).toBe("active");

    registry.beginRemove(3, admission.cssId);
    expect(registry.completeRemove(admission.reservation)).toBe(true);
    expect(registry.getStats()).toMatchObject({
      retainedTabs: 0,
      retainedStyles: 0,
      totalBytes: 0,
    });
  });

  it("releases pending and active styles when their tab closes", () => {
    const registry = new InjectedStyleRegistry();
    const first = registry.reserve(4, "a{}");
    registry.markActive(first.reservation);
    registry.reserve(4, "b{}");
    expect(registry.clearTab(4)).toBe(true);
    expect(registry.markActive(first.reservation)).toBe(false);
    expect(registry.getStats()).toMatchObject({
      retainedTabs: 0,
      retainedStyles: 0,
      totalBytes: 0,
    });
  });
});
