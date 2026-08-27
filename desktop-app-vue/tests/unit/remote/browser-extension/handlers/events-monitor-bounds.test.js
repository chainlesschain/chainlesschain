import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEventListeners,
  installEventMonitorInPage,
  readEventMonitorInPage,
  startEventMonitor,
  stopEventMonitor,
  stopEventMonitorInPage,
} from "../../../../../src/main/remote/browser-extension/handlers/events.js";
import { EVENT_MONITOR_LIMITS } from "../../../../../src/main/remote/browser-extension/handlers/page-monitor-boundary.js";

function createEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    }),
    emit(type, event) {
      listeners.get(type)?.(event);
    },
  };
}

function createChromeMock({ pageError = null } = {}) {
  const tabRemovalListeners = new Set();
  const executeScript = vi.fn(async ({ func }) => [
    {
      result: pageError
        ? { error: pageError }
        : func === stopEventMonitorInPage
          ? { success: true }
          : { success: true, monitoredTypes: ["click"] },
    },
  ]);
  const onRemoved = {
    addListener: vi.fn((listener) => tabRemovalListeners.add(listener)),
  };
  vi.stubGlobal("chrome", {
    scripting: { executeScript },
    tabs: { onRemoved },
  });
  return {
    executeScript,
    emitTabRemoved(tabId) {
      for (const listener of tabRemovalListeners) {
        listener(tabId);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded page event monitor", () => {
  it("bounds the CDP event-listener response", async () => {
    const listeners = Array.from(
      { length: EVENT_MONITOR_LIMITS.maxReturnedListeners + 1 },
      (_, index) => ({
        type: `event-${index}`,
        scriptId: `script-${index}`,
      }),
    );
    const sendCommand = vi.fn(async (_source, method) => {
      if (method === "DOM.getDocument") {
        return { root: { nodeId: 1 } };
      }
      if (method === "DOM.querySelector") {
        return { nodeId: 2 };
      }
      if (method === "DOM.resolveNode") {
        return { object: { objectId: "object-1" } };
      }
      if (method === "DOMDebugger.getEventListeners") {
        return { listeners };
      }
      return {};
    });
    vi.stubGlobal("chrome", {
      debugger: {
        attach: vi.fn().mockResolvedValue(undefined),
        sendCommand,
      },
    });

    const result = await getEventListeners(810, "body");
    expect(result).toMatchObject({
      totalListeners: EVENT_MONITOR_LIMITS.maxReturnedListeners + 1,
      truncated: true,
      listeners: expect.any(Array),
    });
    expect(result.listeners).toHaveLength(
      EVENT_MONITOR_LIMITS.maxReturnedListeners,
    );
  });

  it("retains a byte/count ring, redacts passwords, and removes target listeners", () => {
    const target = createEventTarget();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => target),
    });
    const limits = {
      ...EVENT_MONITOR_LIMITS,
      maxEntries: 2,
      maxTotalBytes: 4096,
    };
    expect(
      installEventMonitorInPage("#target", ["input"], limits),
    ).toMatchObject({ success: true, monitoredTypes: ["input"] });

    target.emit("input", {
      type: "input",
      target: { tagName: "INPUT", id: "one", type: "text", value: "first" },
    });
    target.emit("input", {
      type: "input",
      target: { tagName: "INPUT", id: "two", type: "text", value: "second" },
    });
    target.emit("input", {
      type: "input",
      target: {
        tagName: "INPUT",
        id: "secret",
        type: "password",
        value: "must-not-be-retained",
      },
    });

    expect(readEventMonitorInPage()).toMatchObject({
      count: 2,
      droppedEvents: 1,
      status: "active",
      events: [{ value: "second" }, { value: "[REDACTED]" }],
    });
    expect(stopEventMonitorInPage()).toEqual({ success: true });
    expect(target.listeners.size).toBe(0);
    expect(readEventMonitorInPage().status).toBe("inactive");
  });

  it("restarts without duplicating service-worker admission", async () => {
    const mock = createChromeMock();
    await expect(startEventMonitor(811, "", ["click"])).resolves.toMatchObject({
      success: true,
      admissionLimits: { maxActiveMonitors: 32 },
    });
    await expect(startEventMonitor(811, "", ["click"])).resolves.toMatchObject({
      success: true,
    });
    expect(mock.executeScript).toHaveBeenCalledTimes(3);
    await stopEventMonitor(811);
  });

  it("releases failed starts and tab-closed admission", async () => {
    const failed = createChromeMock({ pageError: "target missing" });
    await expect(startEventMonitor(812, "#missing", [])).resolves.toEqual({
      error: "target missing",
    });
    failed.executeScript.mockImplementation(async () => [
      { result: { success: true, monitoredTypes: ["click"] } },
    ]);
    await expect(startEventMonitor(812, "", [])).resolves.toMatchObject({
      success: true,
    });
    failed.emitTabRemoved(812);
    await expect(startEventMonitor(812, "", [])).resolves.toMatchObject({
      success: true,
    });
    await stopEventMonitor(812);
  });
});
