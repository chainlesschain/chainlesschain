import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startPerformanceTrace,
  stopPerformanceTrace,
} from "../../../../../src/main/remote/browser-extension/handlers/performance.js";

function createChromeMock({ failStart = false, failEnd = false } = {}) {
  const listeners = new Set();
  const onEvent = {
    addListener: vi.fn((listener) => listeners.add(listener)),
    removeListener: vi.fn((listener) => listeners.delete(listener)),
  };
  const sendCommand = vi.fn(async (_source, method) => {
    if (method === "Tracing.start" && failStart) {
      throw new Error("trace start failed");
    }
    if (method === "Tracing.end" && failEnd) {
      throw new Error("trace end failed");
    }
    return undefined;
  });

  return {
    chrome: {
      debugger: {
        attach: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
        sendCommand,
        onEvent,
      },
    },
    listeners,
    onEvent,
  };
}

function emitTraceEvents(listeners, tabId, events) {
  for (const listener of listeners) {
    listener({ tabId }, "Tracing.dataCollected", { value: events });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("performance trace bounds", () => {
  it("counts events without retaining them and removes the listener on stop", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await expect(startPerformanceTrace(201)).resolves.toMatchObject({
      success: true,
      limits: { maxActiveTraces: 4 },
    });
    emitTraceEvents(mock.listeners, 201, [{ id: 1 }, { id: 2 }, { id: 3 }]);
    emitTraceEvents(mock.listeners, 202, [{ ignored: true }]);

    await expect(stopPerformanceTrace(201)).resolves.toMatchObject({
      success: true,
      eventCount: 3,
      eventCountExact: true,
    });
    expect(mock.listeners.size).toBe(0);
    expect(mock.onEvent.removeListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 201 });
  });

  it("keeps per-tab and global admission occupied until stop settles", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await startPerformanceTrace(210);
    await expect(startPerformanceTrace(210)).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "performance_trace_tab",
    });
    await startPerformanceTrace(211);
    await startPerformanceTrace(212);
    await startPerformanceTrace(213);
    await expect(startPerformanceTrace(214)).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "performance_traces",
      limit: { maxActiveTraces: 4 },
    });

    await Promise.all([210, 211, 212, 213].map(stopPerformanceTrace));
    expect(mock.listeners.size).toBe(0);
  });

  it("cleans listener, debugger, and admission when start fails", async () => {
    const failed = createChromeMock({ failStart: true });
    vi.stubGlobal("chrome", failed.chrome);

    await expect(startPerformanceTrace(220)).resolves.toEqual({
      error: "trace start failed",
    });
    expect(failed.listeners.size).toBe(0);
    expect(failed.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 220 });

    const recovered = createChromeMock();
    vi.stubGlobal("chrome", recovered.chrome);
    await expect(startPerformanceTrace(220)).resolves.toMatchObject({
      success: true,
    });
    await stopPerformanceTrace(220);
  });

  it("physically detaches and releases admission when stop fails", async () => {
    const failed = createChromeMock({ failEnd: true });
    vi.stubGlobal("chrome", failed.chrome);

    await startPerformanceTrace(230);
    await expect(stopPerformanceTrace(230)).resolves.toEqual({
      error: "trace end failed",
    });
    expect(failed.listeners.size).toBe(0);
    expect(failed.chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 230 });

    const recovered = createChromeMock();
    vi.stubGlobal("chrome", recovered.chrome);
    await expect(startPerformanceTrace(230)).resolves.toMatchObject({
      success: true,
    });
    await stopPerformanceTrace(230);
  });

  it("serializes concurrent start and stop calls", async () => {
    let finishAttach;
    const attachPending = new Promise((resolve) => {
      finishAttach = resolve;
    });
    const mock = createChromeMock();
    mock.chrome.debugger.attach.mockImplementation(() => attachPending);
    vi.stubGlobal("chrome", mock.chrome);

    const starting = startPerformanceTrace(240);
    await expect(stopPerformanceTrace(240)).resolves.toMatchObject({
      code: "TRACE_STARTING",
      retryAfterMs: 1000,
    });
    finishAttach();
    await starting;

    let finishEnd;
    const endPending = new Promise((resolve) => {
      finishEnd = resolve;
    });
    mock.chrome.debugger.sendCommand.mockImplementation(
      async (_source, method) => {
        if (method === "Tracing.end") {
          await endPending;
        }
      },
    );
    const stopping = stopPerformanceTrace(240);
    await expect(stopPerformanceTrace(240)).resolves.toMatchObject({
      code: "TRACE_STOPPING",
      retryAfterMs: 1000,
    });
    finishEnd();
    await stopping;
    expect(mock.listeners.size).toBe(0);
  });

  it("returns a stable error for a tab without an active trace", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome);

    await expect(stopPerformanceTrace(999)).resolves.toEqual({
      error: "No active performance trace for this tab",
      code: "TRACE_NOT_ACTIVE",
    });
    expect(mock.chrome.debugger.sendCommand).not.toHaveBeenCalled();
  });

  it("keeps the trace source free of raw event aggregation", () => {
    const sourcePath = resolve(
      process.cwd(),
      "src/main/remote/browser-extension/handlers/performance.js",
    );
    const source = readFileSync(sourcePath, "utf8");
    const traceSource = source.slice(
      source.indexOf("export async function startPerformanceTrace"),
      source.indexOf("// ---------- Phase 21 metrics"),
    );

    expect(traceSource).not.toMatch(/events\s*\.\s*push/);
    expect(traceSource).not.toMatch(/\.\.\.params\.value/);
  });
});
