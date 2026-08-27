import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearMutationMonitorInPage,
  installMutationMonitorInPage,
  readMutationMonitorInPage,
  startMutationObserver,
  stopMutationObserver,
  stopMutationMonitorInPage,
} from "../../../../../src/main/remote/browser-extension/handlers/dom.js";
import { MUTATION_MONITOR_LIMITS } from "../../../../../src/main/remote/browser-extension/handlers/page-monitor-boundary.js";

let latestObserver;

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.disconnect = vi.fn();
    this.observe = vi.fn();
    latestObserver = this;
  }
}

afterEach(() => {
  latestObserver = undefined;
  vi.unstubAllGlobals();
});

describe("bounded DOM mutation monitor", () => {
  it("retains a byte/count ring and truncates mutation metadata", () => {
    const target = { tagName: "DIV", id: "target" };
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { body: target, querySelector: () => target });
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    const limits = {
      ...MUTATION_MONITOR_LIMITS,
      maxEntries: 2,
      maxTotalBytes: 16 * 1024,
      maxOldValueChars: 8,
    };
    expect(
      installMutationMonitorInPage("", { childList: true }, limits),
    ).toMatchObject({ success: true, targetSelector: "body" });

    latestObserver.callback(
      ["one", "two", "three"].map((oldValue) => ({
        type: "attributes",
        target,
        attributeName: "data-value",
        oldValue: oldValue.repeat(10),
        addedNodes: [],
        removedNodes: [],
      })),
    );
    const retained = readMutationMonitorInPage();
    expect(retained).toMatchObject({
      count: 2,
      droppedMutations: 1,
      status: "active",
    });
    expect(retained.mutations[0].oldValue).toHaveLength(8);
    expect(retained.mutations[0]).not.toHaveProperty("__bytes");

    expect(clearMutationMonitorInPage()).toEqual({ success: true });
    expect(readMutationMonitorInPage()).toMatchObject({
      count: 0,
      droppedMutations: 0,
      retainedBytes: 0,
    });
    stopMutationMonitorInPage();
    expect(latestObserver.disconnect).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input before page execution and releases failed starts", async () => {
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([{ result: { error: "target missing" } }])
      .mockResolvedValue([{ result: { success: true } }]);
    const onRemoved = { addListener: vi.fn() };
    vi.stubGlobal("chrome", {
      scripting: { executeScript },
      tabs: { onRemoved },
    });

    await expect(startMutationObserver(821, 123, {})).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(executeScript).not.toHaveBeenCalled();
    await expect(startMutationObserver(821, "#missing", {})).resolves.toEqual({
      error: "target missing",
    });
    await expect(startMutationObserver(821, "", {})).resolves.toMatchObject({
      success: true,
    });
    await stopMutationObserver(821);
  });
});
