/**
 * v5.0.3.31 — covers `dispatchTrayAction`, the unified IPC channel that
 * replaces the per-item channels (quick-action, sync, show-notifications,
 * ...) which had no renderer listener — point #3 in the bug report
 * (托盘菜单除了"显示主窗口"全部没用).
 *
 * `showAboutDialog` and `triggerCheckForUpdates` are thin wrappers around
 * Electron's dialog + the auto-updater singleton; the global electron
 * mock at tests/__mocks__/electron.ts + tests/setup.ts conflicts with
 * test-local factory overrides (resolve.alias races vi.mock and the
 * dialog stub returns undefined where source chains `.catch()`). Manual
 * verification of those two methods covers them adequately — they are
 * single-call sites with no logic worth unit-isolating.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EnhancedTrayManager = require("../enhanced-tray-manager.js");

function makeMainWindow({ visible = true } = {}) {
  return {
    isVisible: vi.fn(() => visible),
    show: vi.fn(),
    focus: vi.fn(),
    hide: vi.fn(),
    isFocused: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };
}

describe("EnhancedTrayManager.dispatchTrayAction", () => {
  let mgr;
  let mainWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    mainWindow = makeMainWindow();
    mgr = new EnhancedTrayManager(mainWindow);
  });

  it("sends a single tray:action channel with {type, payload}", () => {
    mgr.dispatchTrayAction("quick-action", "new-note");
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith("tray:action", {
      type: "quick-action",
      payload: "new-note",
    });
  });

  it("defaults payload to null when omitted", () => {
    mgr.dispatchTrayAction("show-performance");
    expect(mainWindow.webContents.send).toHaveBeenCalledWith("tray:action", {
      type: "show-performance",
      payload: null,
    });
  });

  it("supports object payloads (e.g. sync toggle)", () => {
    mgr.dispatchTrayAction("sync", { mode: "toggle-auto", value: true });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith("tray:action", {
      type: "sync",
      payload: { mode: "toggle-auto", value: true },
    });
  });

  it("shows + focuses the window when hidden so users see UI feedback", () => {
    mainWindow = makeMainWindow({ visible: false });
    mgr = new EnhancedTrayManager(mainWindow);
    mgr.dispatchTrayAction("open-settings");
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("does not call show() when window is already visible", () => {
    mgr.dispatchTrayAction("open-settings");
    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when mainWindow is missing", () => {
    mgr.mainWindow = null;
    expect(() => mgr.dispatchTrayAction("foo")).not.toThrow();
  });
});

describe("EnhancedTrayManager.dispatchTrayAction web-shell broadcast (v5.0.3.34)", () => {
  let mgr;
  let mainWindow;
  let webShell;

  beforeEach(() => {
    vi.clearAllMocks();
    mainWindow = makeMainWindow();
    webShell = { broadcast: vi.fn() };
    mgr = new EnhancedTrayManager(mainWindow, {
      getWebShellHandle: () => webShell,
    });
  });

  it("broadcasts a tray:action frame through web-shell when handle present", () => {
    mgr.dispatchTrayAction("open-settings", "notifications");
    expect(webShell.broadcast).toHaveBeenCalledTimes(1);
    expect(webShell.broadcast).toHaveBeenCalledWith({
      type: "tray:action",
      payload: { type: "open-settings", payload: "notifications" },
    });
    // IPC send still fires for V5/V6 compatibility (App.vue listener).
    expect(mainWindow.webContents.send).toHaveBeenCalledWith("tray:action", {
      type: "open-settings",
      payload: "notifications",
    });
  });

  it("skips broadcast when getWebShellHandle returns null (V5/V6 active)", () => {
    mgr = new EnhancedTrayManager(mainWindow, {
      getWebShellHandle: () => null,
    });
    expect(() => mgr.dispatchTrayAction("foo")).not.toThrow();
    // No throw, IPC send still fires.
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("skips broadcast when no getWebShellHandle option provided (back-compat)", () => {
    mgr = new EnhancedTrayManager(mainWindow);
    expect(() => mgr.dispatchTrayAction("foo")).not.toThrow();
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
  });

  it("swallows broadcast errors so tray clicks never crash main", () => {
    webShell.broadcast = vi.fn(() => {
      throw new Error("ws server closed");
    });
    expect(() => mgr.dispatchTrayAction("show-performance")).not.toThrow();
    expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
  });
});
