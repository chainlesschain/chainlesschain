/**
 * accessibility 测试 — src/renderer/utils/accessibility.ts
 *
 * AccessibilityManager: WCAG contrast math (pure), accessible button + ARIA
 * helpers (DOM), the screen-reader announcer (fake timers), and matchMedia
 * preference probes (stubbed), bounded focus history, focus traps, and global
 * keyboard-listener cleanup.
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

  it("restores only connected focus targets and bounds focus history", () => {
    const opener = document.createElement("button");
    const target = document.createElement("input");
    document.body.append(opener, target);
    opener.focus();
    expect(a.focus(target)).toBe(true);
    expect(a.restoreFocus()).toBe(true);
    expect(document.activeElement).toBe(opener);

    for (let index = 0; index < 40; index += 1) {
      opener.focus();
      a.focus(target);
    }
    expect((a as any).focusHistory).toHaveLength(32);
    opener.remove();
    while ((a as any).focusHistory.length > 0) {
      expect(a.restoreFocus()).toBe(false);
    }
  });

  it("traps tab navigation and restores the opener on release", () => {
    const opener = document.createElement("button");
    const dialog = document.createElement("div");
    const first = document.createElement("button");
    const last = document.createElement("button");
    dialog.append(first, last);
    document.body.append(opener, dialog);
    opener.focus();

    a.trapFocus(dialog);
    expect(document.activeElement).toBe(first);
    last.focus();
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(first);
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(document.activeElement).toBe(last);

    const dynamicLast = document.createElement("button");
    dialog.appendChild(dynamicLast);
    dynamicLast.focus();
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement).toBe(first);

    a.releaseFocusTrap();
    expect(document.activeElement).toBe(opener);
  });

  it("excludes hidden, inert, disabled, and negative-tabindex controls", () => {
    const container = document.createElement("div");
    const visible = document.createElement("button");
    const hidden = document.createElement("button");
    hidden.hidden = true;
    const disabled = document.createElement("button");
    disabled.disabled = true;
    const negative = document.createElement("div");
    negative.tabIndex = -2;
    const inert = document.createElement("div");
    inert.setAttribute("inert", "");
    const inertButton = document.createElement("button");
    inert.appendChild(inertButton);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    container.append(visible, hidden, disabled, negative, inert, editable);
    document.body.appendChild(container);

    expect(a.getFocusableElements(container)).toEqual([visible, editable]);
  });
});

describe("accessibility — keyboard lifecycle", () => {
  it("removes its global shortcut listener on destroy", () => {
    const manager = new AccessibilityManager({
      enableAnnouncements: false,
      enableKeyboardNav: true,
    });
    const shortcut = vi.fn();
    window.addEventListener("show-keyboard-shortcuts", shortcut);
    try {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          shiftKey: true,
          bubbles: true,
        }),
      );
      expect(shortcut).toHaveBeenCalledTimes(1);
      manager.destroy();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "?",
          shiftKey: true,
          bubbles: true,
        }),
      );
      expect(shortcut).toHaveBeenCalledTimes(1);
    } finally {
      manager.destroy();
      window.removeEventListener("show-keyboard-shortcuts", shortcut);
    }
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

  it("coalesces announcements and cancels pending work on destroy", () => {
    vi.useFakeTimers();
    try {
      a.announce("old");
      vi.advanceTimersByTime(50);
      a.announce("new");
      vi.advanceTimersByTime(100);
      expect(document.body.querySelector("div[aria-live]")?.textContent).toBe(
        "new",
      );

      a.announce("after destroy");
      a.destroy();
      vi.runAllTimers();
      expect(document.body.querySelector("div[aria-live]")).toBeNull();
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
    const singleton = getAccessibilityManager();
    expect(singleton).toBe(getAccessibilityManager());
    expect(checkContrastHelper("#000000", "#ffffff").AA).toBe(true);
    singleton.destroy();
    expect(getAccessibilityManager()).not.toBe(singleton);
    getAccessibilityManager().destroy();
  });
});
