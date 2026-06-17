/**
 * accessibility 测试 — src/renderer/utils/accessibility.ts
 *
 * AccessibilityManager: WCAG contrast math (pure), accessible button + ARIA
 * helpers (DOM), the screen-reader announcer (fake timers), and matchMedia
 * preference probes (stubbed). Instances use enableKeyboardNav:false so the
 * constructor doesn't leak a document keydown listener; destroy() cleans up.
 *
 * getFocusableElements is intentionally not tested: it filters on offsetParent,
 * which jsdom always reports as null (no layout), so it can't be exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import AccessibilityManager, {
  checkContrast as checkContrastHelper,
  getAccessibilityManager,
} from "@/utils/accessibility";

let a: AccessibilityManager;
beforeEach(() => {
  a = new AccessibilityManager({ enableKeyboardNav: false });
});
afterEach(() => {
  a.destroy();
  document.body.innerHTML = "";
});

describe("accessibility — checkContrast (WCAG)", () => {
  it("computes ratios and threshold flags", () => {
    const max = a.checkContrast("#000000", "#ffffff");
    expect(max.ratio).toBe("21.00");
    expect(max).toMatchObject({ AA: true, AAA: true, AALarge: true });

    const none = a.checkContrast("#ffffff", "#ffffff");
    expect(none.ratio).toBe("1.00");
    expect(none).toMatchObject({ AA: false, AAA: false, AALarge: false });
  });

  it("is order-independent (foreground/background swap)", () => {
    const a1 = a.checkContrast("#333333", "#eeeeee");
    const a2 = a.checkContrast("#eeeeee", "#333333");
    expect(a1.ratio).toBe(a2.ratio);
  });
});

describe("accessibility — DOM helpers", () => {
  it("createAccessibleButton wires text, aria-label and click", () => {
    const onClick = vi.fn();
    const btn = a.createAccessibleButton({
      text: "Save",
      ariaLabel: "Save document",
      onClick,
      className: "primary",
    });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
    expect(btn.textContent).toBe("Save");
    expect(btn.getAttribute("aria-label")).toBe("Save document");
    expect(btn.className).toBe("primary");
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("setAria adds the aria- prefix only when missing", () => {
    const el = document.createElement("div");
    a.setAria(el, { label: "x", "aria-expanded": "true" });
    expect(el.getAttribute("aria-label")).toBe("x");
    expect(el.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("accessibility — announce", () => {
  it("writes the message into the live region after the delay", () => {
    vi.useFakeTimers();
    try {
      a.announce("Saved", "assertive");
      const region = document.body.querySelector("div[aria-live]")!;
      expect(region.getAttribute("aria-live")).toBe("assertive");
      expect(region.textContent).toBe(""); // not yet
      vi.advanceTimersByTime(100);
      expect(region.textContent).toBe("Saved");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("accessibility — media preferences", () => {
  it("reads matchMedia for reduced-motion / high-contrast / color-scheme", () => {
    const set = (matches: boolean) => {
      (window as any).matchMedia = vi.fn((q: string) => ({
        matches,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
    };
    set(true);
    expect(a.prefersReducedMotion()).toBe(true);
    expect(a.prefersHighContrast()).toBe(true);
    expect(a.getColorSchemePreference()).toBe("dark");
    set(false);
    expect(a.prefersReducedMotion()).toBe(false);
    expect(a.getColorSchemePreference()).toBe("light");
  });
});

describe("accessibility — named helpers", () => {
  it("getAccessibilityManager memoizes; checkContrast helper delegates", () => {
    expect(getAccessibilityManager()).toBe(getAccessibilityManager());
    expect(checkContrastHelper("#000000", "#ffffff").AA).toBe(true);
  });
});
