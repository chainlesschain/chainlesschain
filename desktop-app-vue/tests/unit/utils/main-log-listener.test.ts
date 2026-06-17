/**
 * main-log-listener 测试 — src/renderer/utils/main-log-listener.ts
 *
 * Subscribes to electronAPI.mainLog and mirrors main-process logs into the
 * console. Module-level state + auto-init on import → reset modules and set
 * window.electronAPI before a fresh dynamic import per test, then normalize via
 * stop() so init()/onLog counts are deterministic regardless of auto-init.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let captured: ((log: any) => void) | null;
let onLog: ReturnType<typeof vi.fn>;
let removeAllListeners: ReturnType<typeof vi.fn>;
const unsub = vi.fn();

beforeEach(() => {
  vi.resetModules();
  captured = null;
  unsub.mockClear();
  onLog = vi.fn((cb: (log: any) => void) => {
    captured = cb;
    return unsub;
  });
  removeAllListeners = vi.fn();
});
afterEach(() => {
  delete (window as any).electronAPI;
});

async function loadWithApi() {
  (window as any).electronAPI = { mainLog: { onLog, removeAllListeners } };
  const mod = await import("@/utils/main-log-listener");
  mod.stopMainLogListener(); // reset state regardless of auto-init
  onLog.mockClear();
  removeAllListeners.mockClear();
  unsub.mockClear();
  return mod;
}

describe("main-log-listener — init + forwarding", () => {
  it("subscribes once and is active after init; re-init is a no-op", async () => {
    const mod = await loadWithApi();
    mod.initMainLogListener();
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(mod.isMainLogListenerActive()).toBe(true);
    mod.initMainLogListener(); // guarded
    expect(onLog).toHaveBeenCalledTimes(1);
  });

  it("forwards a main-process log entry to the matching console method", async () => {
    const mod = await loadWithApi();
    mod.initMainLogListener();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      captured!({ level: "error", time: "12:00", args: ["boom"] });
      expect(spy).toHaveBeenCalled();
      expect(spy.mock.calls[0][0]).toContain("[Main X]"); // error icon
    } finally {
      spy.mockRestore();
    }
  });
});

describe("main-log-listener — stop", () => {
  it("unsubscribes, clears listeners and goes inactive", async () => {
    const mod = await loadWithApi();
    mod.initMainLogListener();
    expect(mod.isMainLogListenerActive()).toBe(true);
    mod.stopMainLogListener();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(removeAllListeners).toHaveBeenCalledTimes(1);
    expect(mod.isMainLogListenerActive()).toBe(false);
  });
});

describe("main-log-listener — missing API + default export", () => {
  it("stays inactive when electronAPI.mainLog is absent", async () => {
    delete (window as any).electronAPI;
    const mod = await import("@/utils/main-log-listener");
    mod.stopMainLogListener();
    mod.initMainLogListener();
    expect(mod.isMainLogListenerActive()).toBe(false);
  });

  it("default export delegates to the named functions", async () => {
    const mod = await loadWithApi();
    expect(typeof mod.default.init).toBe("function");
    mod.default.init();
    expect(mod.default.isActive()).toBe(true);
    mod.default.stop();
    expect(mod.default.isActive()).toBe(false);
  });
});
