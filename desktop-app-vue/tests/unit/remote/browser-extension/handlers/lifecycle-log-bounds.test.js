import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_LIFECYCLE_LOG_ENTRIES,
  subscribeLifecycleChanges,
} from "../../../../../src/main/remote/browser-extension/handlers/lifecycle.js";

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener: vi.fn((type, handler) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(handler);
    }),
    removeEventListener: vi.fn((type, handler) => {
      listeners.get(type)?.delete(handler);
    }),
    dispatch(type, event = {}) {
      for (const handler of listeners.get(type) || []) {
        handler(event);
      }
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
  };
}

function installPageMock() {
  const pageWindow = createEventTarget();
  const pageDocument = createEventTarget();
  pageDocument.visibilityState = "visible";
  const executeScript = vi.fn(async ({ func, args = [] }) => [
    { result: await func(...args) },
  ]);

  vi.stubGlobal("window", pageWindow);
  vi.stubGlobal("document", pageDocument);
  vi.stubGlobal("chrome", { scripting: { executeScript } });
  return { pageWindow, pageDocument };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lifecycle log bounds", () => {
  it("keeps a bounded recent-event ring and counts dropped entries", async () => {
    const { pageWindow } = installPageMock();

    await expect(subscribeLifecycleChanges(1)).resolves.toEqual({
      success: true,
      maxEntries: MAX_LIFECYCLE_LOG_ENTRIES,
    });
    for (let index = 0; index < MAX_LIFECYCLE_LOG_ENTRIES + 44; index += 1) {
      pageWindow.dispatch("focus");
    }

    expect(pageWindow.__chainlessLifecycleLog).toHaveLength(
      MAX_LIFECYCLE_LOG_ENTRIES,
    );
    expect(pageWindow.__chainlessLifecycleDropped).toBe(44);
  });

  it("removes old listeners before replacing a subscription", async () => {
    const { pageWindow, pageDocument } = installPageMock();
    await subscribeLifecycleChanges(2);
    expect(pageWindow.listenerCount("focus")).toBe(1);
    expect(pageDocument.listenerCount("visibilitychange")).toBe(1);

    await subscribeLifecycleChanges(2);
    expect(pageWindow.listenerCount("focus")).toBe(1);
    expect(pageDocument.listenerCount("visibilitychange")).toBe(1);
    pageWindow.dispatch("focus");
    expect(pageWindow.__chainlessLifecycleLog).toHaveLength(1);
  });
});
