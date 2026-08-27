import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONSOLE_SANITIZATION_LIMITS,
  clearConsoleLogs,
  disableConsoleCapture,
  enableConsoleCapture,
  getConsoleLogs,
  sanitizeConsoleEvent,
} from "../../../../../src/main/remote/browser-extension/handlers/console.js";

function createChromeMock({ failLogEnable = false } = {}) {
  const eventListeners = new Set();
  const detachListeners = new Set();
  const onEvent = {
    addListener: vi.fn((listener) => eventListeners.add(listener)),
    removeListener: vi.fn((listener) => eventListeners.delete(listener)),
  };
  const onDetach = {
    addListener: vi.fn((listener) => detachListeners.add(listener)),
    removeListener: vi.fn((listener) => detachListeners.delete(listener)),
  };
  const emitDetach = (tabId) => {
    for (const listener of [...detachListeners]) {
      listener({ tabId }, "target_closed");
    }
  };
  const debuggerApi = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn(async ({ tabId }) => emitDetach(tabId)),
    sendCommand: vi.fn(async (_source, method) => {
      if (method === "Log.enable" && failLogEnable) {
        throw new Error("log enable failed");
      }
      return undefined;
    }),
    onEvent,
    onDetach,
  };
  vi.stubGlobal("chrome", { debugger: debuggerApi });

  return {
    debuggerApi,
    eventListeners,
    detachListeners,
    emitEvent(tabId, method, params) {
      for (const listener of eventListeners) {
        listener({ tabId }, method, params);
      }
    },
    emitDetach,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded console capture", () => {
  it("sanitizes retained CDP values, arguments, and stack frames", () => {
    const longText = "x".repeat(CONSOLE_SANITIZATION_LIMITS.maxTextChars + 10);
    const entry = sanitizeConsoleEvent("Runtime.consoleAPICalled", {
      type: "log",
      args: Array.from(
        { length: CONSOLE_SANITIZATION_LIMITS.maxArgs + 5 },
        () => ({ description: longText }),
      ),
      stackTrace: {
        callFrames: Array.from(
          { length: CONSOLE_SANITIZATION_LIMITS.maxStackFrames + 5 },
          () => ({ functionName: longText, url: longText }),
        ),
      },
    });

    expect(entry.args).toHaveLength(CONSOLE_SANITIZATION_LIMITS.maxArgs);
    expect(entry.args[0]).toHaveLength(
      CONSOLE_SANITIZATION_LIMITS.maxTextChars,
    );
    expect(entry.stackTrace.callFrames).toHaveLength(
      CONSOLE_SANITIZATION_LIMITS.maxStackFrames,
    );
    expect(entry.stackTrace.callFrames[0].url).toHaveLength(
      CONSOLE_SANITIZATION_LIMITS.maxTextChars,
    );
  });

  it("returns captured logs from the same bounded state and retains them after disable", async () => {
    const mock = createChromeMock();
    await expect(enableConsoleCapture(401)).resolves.toMatchObject({
      success: true,
      limits: { maxActiveCaptures: 8, maxLogsPerCapture: 1000 },
    });
    mock.emitEvent(401, "Log.entryAdded", {
      entry: {
        level: "warning",
        text: "captured",
        url: "https://example.test",
        timestamp: 1,
      },
    });

    expect(getConsoleLogs(401)).toMatchObject({
      logs: [{ type: "warning", text: "captured" }],
      status: "active",
    });
    await expect(disableConsoleCapture(401)).resolves.toEqual({
      success: true,
    });
    expect(getConsoleLogs(401)).toMatchObject({
      logs: [{ type: "warning", text: "captured" }],
      status: "inactive",
    });
    expect(mock.eventListeners.size).toBe(0);
    expect(mock.detachListeners.size).toBe(0);

    expect(clearConsoleLogs(401)).toEqual({ success: true });
    expect(getConsoleLogs(401).logs).toEqual([]);
  });

  it("rejects duplicate enable and cleans a failed start", async () => {
    const failed = createChromeMock({ failLogEnable: true });
    await expect(enableConsoleCapture(402)).resolves.toEqual({
      error: "log enable failed",
    });
    expect(failed.eventListeners.size).toBe(0);
    expect(failed.detachListeners.size).toBe(0);

    const recovered = createChromeMock();
    await expect(enableConsoleCapture(402)).resolves.toMatchObject({
      success: true,
    });
    await expect(enableConsoleCapture(402)).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "console_capture_tab",
    });
    await disableConsoleCapture(402);
  });

  it("releases physical admission and listeners on debugger detach", async () => {
    const mock = createChromeMock();
    await enableConsoleCapture(403);
    mock.emitDetach(403);

    expect(mock.eventListeners.size).toBe(0);
    expect(mock.detachListeners.size).toBe(0);
    expect(getConsoleLogs(403).status).toBe("inactive");
    await expect(enableConsoleCapture(403)).resolves.toMatchObject({
      success: true,
    });
    await disableConsoleCapture(403);
  });

  it("serializes disable calls", async () => {
    const mock = createChromeMock();
    await enableConsoleCapture(404);
    let finishDisable;
    const disablePending = new Promise((resolve) => {
      finishDisable = resolve;
    });
    mock.debuggerApi.sendCommand.mockImplementation(async (_source, method) => {
      if (method === "Runtime.disable") {
        await disablePending;
      }
    });

    const stopping = disableConsoleCapture(404);
    await expect(disableConsoleCapture(404)).resolves.toMatchObject({
      code: "CONSOLE_CAPTURE_STOPPING",
      retryAfterMs: 1000,
    });
    finishDisable();
    await stopping;
  });
});
