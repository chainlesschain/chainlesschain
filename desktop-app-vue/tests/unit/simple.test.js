import { describe, it, expect, vi } from "vitest";

// Test-local mock (jsdom window doesn't support arbitrary property injection from setup files)
globalThis.electronAPI = {
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn(),
  send: vi.fn(),
};
globalThis.electron = {
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue({}),
    on: vi.fn(),
    send: vi.fn(),
  },
};

describe("Simple Test", () => {
  it("should pass", () => {
    expect(1 + 1).toBe(2);
  });

  it("should have window.electronAPI", () => {
    expect(window.electronAPI).toBeDefined();
    expect(window.electronAPI.invoke).toBeDefined();
  });

  it("should have window.electron.ipcRenderer", () => {
    expect(window.electron).toBeDefined();
    expect(window.electron.ipcRenderer).toBeDefined();
    expect(window.electron.ipcRenderer.invoke).toBeDefined();
  });
});
