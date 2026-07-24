import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
    setApplicationMenu: vi.fn(),
  },
  shell: { openExternal: vi.fn(async () => {}) },
  app: { name: "ChainlessChain", getVersion: vi.fn(() => "test") },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

const MenuManager = require("../menu-manager.js");

describe("MenuManager process execution", () => {
  it("routes the control-panel API through the desktop process broker boundary", async () => {
    const process = new EventEmitter();
    const spawnProcess = vi.fn(() => process);
    const manager = new MenuManager(null, {
      spawnProcess,
      openExternal: vi.fn(async () => {}),
    });

    await manager.startControlPanelAPI();

    expect(spawnProcess).toHaveBeenCalledWith(
      "node",
      [expect.stringMatching(/control-panel-api\.js$/), 3001],
      expect.objectContaining({
        detached: false,
        stdio: "ignore",
        windowsHide: true,
        origin: "desktop:menu-control-panel-api",
      }),
    );
    expect(manager.controlPanelProcess).toBe(process);
  });
});
