import { afterEach, describe, expect, it, vi } from "vitest";

import {
  injectCSS,
  removeInjectedCSS,
} from "../../../../../src/main/remote/browser-extension/handlers/page.js";
import { DEFAULT_INJECTED_STYLE_LIMITS } from "../../../../../src/main/remote/browser-extension/handlers/injected-style-registry.js";

function createChromeMock({ failInsert = false, failRemove = false } = {}) {
  const tabRemovalListeners = new Set();
  const insertCSS = vi.fn(async () => {
    if (failInsert) {
      throw new Error("insert failed");
    }
  });
  const removeCSS = vi.fn(async () => {
    if (failRemove) {
      throw new Error("remove failed");
    }
  });
  const onRemoved = {
    addListener: vi.fn((listener) => tabRemovalListeners.add(listener)),
    removeListener: vi.fn((listener) => tabRemovalListeners.delete(listener)),
  };
  vi.stubGlobal("chrome", {
    scripting: { insertCSS, removeCSS },
    tabs: { onRemoved },
  });
  return {
    insertCSS,
    removeCSS,
    onRemoved,
    tabRemovalListeners,
    emitTabRemoved(tabId) {
      for (const listener of [...tabRemovalListeners]) {
        listener(tabId, { isWindowClosing: false });
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded injected CSS state", () => {
  it("uses unique IDs and removes CSS with the same origin", async () => {
    const mock = createChromeMock();
    const first = await injectCSS(701, "body { color: red; }");
    const second = await injectCSS(701, "body { color: blue; }", {
      origin: "AUTHOR",
    });
    expect(first).toMatchObject({
      success: true,
      retainedBytes: 20,
      limits: { maxStylesPerTab: 64 },
    });
    expect(second.success).toBe(true);
    expect(first.cssId).not.toBe(second.cssId);
    expect(mock.onRemoved.addListener).toHaveBeenCalledTimes(1);

    await expect(removeInjectedCSS(701, first.cssId)).resolves.toEqual({
      success: true,
    });
    expect(mock.removeCSS).toHaveBeenLastCalledWith({
      target: { tabId: 701 },
      css: "body { color: red; }",
      origin: "USER",
    });
    await removeInjectedCSS(701, second.cssId);
    expect(mock.removeCSS).toHaveBeenLastCalledWith({
      target: { tabId: 701 },
      css: "body { color: blue; }",
      origin: "AUTHOR",
    });
  });

  it("rejects invalid and oversized CSS before invoking Chrome", async () => {
    const mock = createChromeMock();
    await expect(injectCSS(702, null)).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      injectCSS(
        702,
        "x".repeat(DEFAULT_INJECTED_STYLE_LIMITS.maxBytesPerStyle + 1),
      ),
    ).resolves.toMatchObject({
      code: "OVERLOADED",
      scope: "css_style_bytes",
    });
    await expect(
      injectCSS(702, "body{}", { origin: "INVALID" }),
    ).resolves.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(mock.insertCSS).not.toHaveBeenCalled();
  });

  it("rolls back a failed insert and retains styles for removal retry", async () => {
    const failedInsert = createChromeMock({ failInsert: true });
    await expect(injectCSS(703, "a{}")).resolves.toEqual({
      error: "insert failed",
    });
    expect(failedInsert.removeCSS).not.toHaveBeenCalled();

    const failedRemove = createChromeMock({ failRemove: true });
    const injected = await injectCSS(703, "b{}", { origin: "USER" });
    await expect(removeInjectedCSS(703, injected.cssId)).resolves.toEqual({
      error: "remove failed",
    });
    failedRemove.removeCSS.mockResolvedValue(undefined);
    await expect(removeInjectedCSS(703, injected.cssId)).resolves.toEqual({
      success: true,
    });
    expect(failedRemove.removeCSS).toHaveBeenCalledTimes(2);
  });

  it("releases retained CSS state when a tab closes", async () => {
    const mock = createChromeMock();
    const injected = await injectCSS(704, "body{}");
    mock.emitTabRemoved(704);
    await expect(removeInjectedCSS(704, injected.cssId)).resolves.toEqual({
      success: true,
    });
    expect(mock.removeCSS).not.toHaveBeenCalled();
  });
});
