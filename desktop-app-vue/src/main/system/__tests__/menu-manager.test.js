/**
 * Phase 1.6 — verifies the "在浏览器中打开 web 视图" menu hook resolves
 * the live web-shell handle and delegates to shell.openExternal at
 * click-time. The rest of MenuManager is covered by the integration
 * surface (createMenu just templates strings); we focus on the behavior
 * that has logic worth testing.
 *
 * MenuManager reads `electron` at require-time, so we vi.mock it with
 * the smallest stubs that satisfy module init.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => {
  return {
    Menu: {
      buildFromTemplate: vi.fn(() => ({})),
      setApplicationMenu: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(async () => {}),
    },
    app: {
      name: "ChainlessChain",
      getPath: vi.fn(() => "/tmp/cc-userdata"),
    },
  };
});

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const MenuManager = require("../menu-manager.js");

describe("MenuManager.openWebShellInBrowser", () => {
  let openExternal;
  let getWebShellHandle;
  let mgr;

  beforeEach(() => {
    openExternal = vi.fn(async () => {});
    getWebShellHandle = vi.fn(() => ({
      httpUrl: "http://127.0.0.1:51234/",
    }));
    mgr = new MenuManager(null, { getWebShellHandle, openExternal });
  });

  it("returns true and forwards the live httpUrl to openExternal", async () => {
    const ok = await mgr.openWebShellInBrowser();
    expect(ok).toBe(true);
    expect(getWebShellHandle).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:51234/");
  });

  it("re-reads the getter on every click so port changes are picked up", async () => {
    // First click: port 51234. Second click: port flipped (e.g., user
    // restarted web-shell mid-session, OS assigned a different port).
    let port = 51234;
    getWebShellHandle = vi.fn(() => ({
      httpUrl: `http://127.0.0.1:${port}/`,
    }));
    mgr = new MenuManager(null, { getWebShellHandle, openExternal });

    await mgr.openWebShellInBrowser();
    port = 60000;
    await mgr.openWebShellInBrowser();

    expect(openExternal).toHaveBeenNthCalledWith(1, "http://127.0.0.1:51234/");
    expect(openExternal).toHaveBeenNthCalledWith(2, "http://127.0.0.1:60000/");
  });

  it("returns false (and skips openExternal) when getter returns null", async () => {
    getWebShellHandle.mockReturnValue(null);
    const ok = await mgr.openWebShellInBrowser();
    expect(ok).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("returns false when the handle has no httpUrl (defensive)", async () => {
    getWebShellHandle.mockReturnValue({ httpUrl: null });
    const ok = await mgr.openWebShellInBrowser();
    expect(ok).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("returns false (no throw) if openExternal rejects — degrades silently", async () => {
    openExternal.mockRejectedValueOnce(new Error("EACCES"));
    const ok = await mgr.openWebShellInBrowser();
    expect(ok).toBe(false);
  });
});
