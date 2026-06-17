/**
 * shortcutManager 测试 — src/renderer/utils/shortcutManager.ts
 *
 * Default-export singleton that auto-listens on window keydown. Register
 * shortcuts then drive them with dispatched KeyboardEvents (which exercises the
 * internal Shortcut.matches/execute). clear()+enableAll() reset per test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import shortcutManager, { CommonShortcuts } from "@/utils/shortcutManager";

function press(init: KeyboardEventInit, target?: HTMLElement) {
  const evt = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target ?? window).dispatchEvent(evt);
}

beforeEach(() => {
  shortcutManager.clear();
  shortcutManager.enableAll();
});

describe("shortcutManager — register / unregister", () => {
  it("registers, lists and unregisters shortcuts", () => {
    const id = shortcutManager.register({
      keys: ["ctrl", "s"],
      handler: vi.fn(),
    });
    expect(shortcutManager.getShortcuts()).toHaveLength(1);
    shortcutManager.unregister(id);
    expect(shortcutManager.getShortcuts()).toHaveLength(0);
  });

  it("registerMultiple returns one id per shortcut", () => {
    const ids = shortcutManager.registerMultiple([
      { keys: ["ctrl", "a"], handler: vi.fn() },
      { keys: ["ctrl", "b"], handler: vi.fn() },
    ]);
    expect(ids).toHaveLength(2);
    expect(shortcutManager.getShortcuts()).toHaveLength(2);
  });
});

describe("shortcutManager — matching + dispatch", () => {
  it("fires the handler for a matching combo and ignores non-matches", () => {
    const fn = vi.fn();
    shortcutManager.register({ keys: ["ctrl", "s"], handler: fn });
    press({ ctrlKey: true, key: "s" });
    expect(fn).toHaveBeenCalledTimes(1);
    press({ key: "s" }); // missing ctrl → combo length mismatch
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores keystrokes originating from input fields", () => {
    const fn = vi.fn();
    shortcutManager.register({ keys: ["ctrl", "s"], handler: fn });
    const input = document.createElement("input");
    document.body.appendChild(input);
    press({ ctrlKey: true, key: "s" }, input);
    expect(fn).not.toHaveBeenCalled();
    input.remove();
  });

  it("swallows handler errors without throwing", () => {
    shortcutManager.register({
      keys: ["ctrl", "e"],
      handler: () => {
        throw new Error("boom");
      },
    });
    expect(() => press({ ctrlKey: true, key: "e" })).not.toThrow();
  });
});

describe("shortcutManager — enable/disable", () => {
  it("disable(id) suppresses a single shortcut; enable restores it", () => {
    const fn = vi.fn();
    const id = shortcutManager.register({ keys: ["ctrl", "k"], handler: fn });
    shortcutManager.disable(id);
    press({ ctrlKey: true, key: "k" });
    expect(fn).not.toHaveBeenCalled();
    shortcutManager.enable(id);
    press({ ctrlKey: true, key: "k" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("disableAll halts dispatch globally; enableAll resumes", () => {
    const fn = vi.fn();
    shortcutManager.register({ keys: ["ctrl", "j"], handler: fn });
    shortcutManager.disableAll();
    press({ ctrlKey: true, key: "j" });
    expect(fn).not.toHaveBeenCalled();
    shortcutManager.enableAll();
    press({ ctrlKey: true, key: "j" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("shortcutManager — descriptions + constants", () => {
  it("getShortcutDescription renders symbols and upper-cases plain keys", () => {
    expect(shortcutManager.getShortcutDescription(["ctrl", "s"])).toBe("⌘ + S");
    expect(shortcutManager.getShortcutDescription(["shift", "enter"])).toBe(
      "⇧ + ↵",
    );
    expect(shortcutManager.getShortcutDescription(["arrowup"])).toBe("↑");
  });

  it("CommonShortcuts exposes well-known combos", () => {
    expect(CommonShortcuts.SAVE).toEqual(["ctrl", "s"]);
    expect(CommonShortcuts.COMMAND_PALETTE).toEqual(["ctrl", "shift", "p"]);
  });
});
