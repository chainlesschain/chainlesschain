import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { takeHeapSnapshot } from "../../../../../src/main/remote/browser-extension/handlers/devtools-inspect.js";

function createChromeMock(onTakeSnapshot = async () => undefined) {
  const listeners = new Set();
  const onEvent = {
    addListener: vi.fn((listener) => listeners.add(listener)),
    removeListener: vi.fn((listener) => listeners.delete(listener)),
  };
  const sendCommand = vi.fn(async (source, method, params) => {
    if (method === "HeapProfiler.takeHeapSnapshot") {
      return onTakeSnapshot({ source, params, listeners });
    }
    return undefined;
  });

  return {
    chrome: {
      debugger: {
        attach: vi.fn().mockResolvedValue(undefined),
        sendCommand,
        onEvent,
      },
    },
    listeners,
    onEvent,
    sendCommand,
  };
}

function emitChunk(listeners, tabId, chunk) {
  for (const listener of listeners) {
    listener({ tabId }, "HeapProfiler.addHeapSnapshotChunk", { chunk });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("takeHeapSnapshot bounded streaming", () => {
  it("counts streamed UTF-8 bytes and chunks without retaining the body", async () => {
    const mock = createChromeMock(async ({ source, listeners }) => {
      emitChunk(listeners, source.tabId, "ab");
      emitChunk(listeners, source.tabId, "测试");
      emitChunk(listeners, source.tabId, "😀");
      emitChunk(listeners, source.tabId + 1, "ignored");
    });
    vi.stubGlobal("chrome", mock.chrome);

    const result = await takeHeapSnapshot(11);

    expect(result).toMatchObject({
      success: true,
      size: 12,
      chunkCount: 3,
      limits: {
        maxActiveSnapshots: 2,
        maxRetainedSnapshots: 32,
      },
    });
    expect(result.snapshotId).toMatch(/^snapshot-\d+-\d+$/);
    expect(mock.listeners.size).toBe(0);
    expect(mock.onEvent.removeListener).toHaveBeenCalledTimes(1);
  });

  it("removes the listener and releases admission when CDP fails", async () => {
    const failed = createChromeMock(async () => {
      throw new Error("snapshot failed");
    });
    vi.stubGlobal("chrome", failed.chrome);

    await expect(takeHeapSnapshot(12)).resolves.toEqual({
      error: "snapshot failed",
    });
    expect(failed.listeners.size).toBe(0);
    expect(failed.onEvent.removeListener).toHaveBeenCalledTimes(1);

    const recovered = createChromeMock();
    vi.stubGlobal("chrome", recovered.chrome);
    await expect(takeHeapSnapshot(12)).resolves.toMatchObject({
      success: true,
    });
  });

  it("keeps per-tab admission occupied until the CDP command settles", async () => {
    let settleSnapshot;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise((resolve) => {
      settleSnapshot = resolve;
    });
    const mock = createChromeMock(async () => {
      markStarted();
      await pending;
    });
    vi.stubGlobal("chrome", mock.chrome);

    const first = takeHeapSnapshot(13);
    await started;
    await expect(takeHeapSnapshot(13)).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "heap_snapshot_tab",
      retryAfterMs: 1000,
    });

    settleSnapshot();
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it("bounds global physical admission and retained metadata", async () => {
    const pendingResolvers = [];
    const twoPending = createChromeMock(
      () =>
        new Promise((resolve) => {
          pendingResolvers.push(resolve);
        }),
    );
    vi.stubGlobal("chrome", twoPending.chrome);

    const first = takeHeapSnapshot(21);
    const second = takeHeapSnapshot(22);
    while (pendingResolvers.length < 2) {
      await Promise.resolve();
    }
    await expect(takeHeapSnapshot(23)).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "heap_snapshots",
      limit: { maxActiveSnapshots: 2 },
    });
    pendingResolvers.forEach((resolve) => resolve());
    await Promise.all([first, second]);

    const immediate = createChromeMock();
    vi.stubGlobal("chrome", immediate.chrome);
    let lastResult;
    for (let index = 0; index < 35; index += 1) {
      lastResult = await takeHeapSnapshot(100 + index);
    }
    expect(lastResult).toMatchObject({
      success: true,
      retainedSnapshots: 32,
      limits: { maxRetainedSnapshots: 32 },
    });
  });

  it("keeps the handler source free of snapshot chunk aggregation", () => {
    const sourcePath = resolve(
      process.cwd(),
      "src/main/remote/browser-extension/handlers/devtools-inspect.js",
    );
    const source = readFileSync(sourcePath, "utf8");
    const takeSnapshotSource = source.slice(
      source.indexOf("export async function takeHeapSnapshot"),
      source.indexOf("export async function startMemorySampling"),
    );

    expect(takeSnapshotSource).not.toMatch(/chunks\s*\.\s*push/);
    expect(takeSnapshotSource).not.toMatch(/chunks\s*\.\s*join/);
  });
});
