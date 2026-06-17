/**
 * ipc-shim 测试 — src/renderer/utils/ipc-shim.ts
 *
 * Normalizes an IpcBridge from window.electron.ipcRenderer / window.ipc /
 * window.electronAPI.invoke, with a module-level cache and auto-init on import.
 * Each test resets modules and sets window state BEFORE a fresh dynamic import
 * so the cache + auto-init see that shape.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  delete (window as any).electron;
  delete (window as any).ipc;
  delete (window as any).electronAPI;
  (window as any).require = undefined;
});

async function load() {
  return import("@/utils/ipc-shim");
}

describe("ipc-shim — resolveIpcBridge", () => {
  it("falls back to an erroring invoke when no bridge exists", async () => {
    const m = await load();
    await expect(m.resolveIpcBridge().invoke("some:channel")).rejects.toThrow(
      /unavailable for channel "some:channel"/,
    );
  });

  it("uses window.electronAPI.invoke when present", async () => {
    const invoke = vi.fn().mockResolvedValue("RESULT");
    (window as any).electronAPI = { invoke };
    const m = await load();
    await expect(m.getIpcBridge().invoke("ch", "a", "b")).resolves.toBe("RESULT");
    expect(invoke).toHaveBeenCalledWith("ch", "a", "b");
  });

  it("prefers window.electron.ipcRenderer over electronAPI", async () => {
    const ipcRendererInvoke = vi.fn().mockResolvedValue("FROM_IPC_RENDERER");
    const apiInvoke = vi.fn().mockResolvedValue("FROM_API");
    (window as any).electron = { ipcRenderer: { invoke: ipcRendererInvoke } };
    (window as any).electronAPI = { invoke: apiInvoke };
    const m = await load();
    await expect(m.resolveIpcBridge().invoke("c")).resolves.toBe(
      "FROM_IPC_RENDERER",
    );
    expect(apiInvoke).not.toHaveBeenCalled();
  });

  it("normalizes a partial bridge, filling missing methods with no-ops", async () => {
    (window as any).ipc = { invoke: vi.fn().mockResolvedValue(1) };
    const m = await load();
    const bridge = m.resolveIpcBridge();
    expect(typeof bridge.send).toBe("function");
    expect(() => bridge.send("x", 1)).not.toThrow();
    expect(() => bridge.removeAllListeners("x")).not.toThrow();
  });

  it("caches the resolved bridge (same instance on repeat)", async () => {
    (window as any).ipc = { invoke: vi.fn().mockResolvedValue(1) };
    const m = await load();
    expect(m.resolveIpcBridge()).toBe(m.resolveIpcBridge());
  });
});

describe("ipc-shim — invokeIPC + initIpcCompatibility", () => {
  it("invokeIPC delegates to the resolved bridge", async () => {
    const invoke = vi.fn().mockResolvedValue("X");
    (window as any).ipc = { invoke };
    const m = await load();
    await expect(m.invokeIPC("ch", 42)).resolves.toBe("X");
    expect(invoke).toHaveBeenCalledWith("ch", 42);
  });

  it("auto-init populates window.electron.ipcRenderer and window.ipc", async () => {
    await load(); // module top-level initIpcCompatibility() runs on import
    expect((window as any).electron?.ipcRenderer).toBeDefined();
    expect(typeof (window as any).electron.ipcRenderer.invoke).toBe("function");
    expect((window as any).ipc).toBeDefined();
  });
});
