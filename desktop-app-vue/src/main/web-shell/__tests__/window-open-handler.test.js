/**
 * Phase 1.5 window.open handler — unit tests.
 *
 * The handler depends on Electron's BrowserWindow. We inject a fake factory
 * via `browserWindowFactory` so the suite never touches Electron, which keeps
 * vitest fast and CI-friendly.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createWindowOpenHandler,
  VALID_OPENABLE_ROLES,
} from "../handlers/window-open-handler.js";
import { WindowRegistry } from "../../window-registry.js";

const HTTP_URL = "http://127.0.0.1:54321/";

function makeFakeWindow() {
  const listeners = new Map();
  return {
    loadURL: vi.fn(),
    focus: vi.fn(),
    on: vi.fn((evt, fn) => {
      listeners.set(evt, fn);
    }),
    /** Test-only — fire the registered "closed" listener. */
    _fireClosed() {
      const fn = listeners.get("closed");
      if (typeof fn === "function") {
        fn();
      }
    },
  };
}

let registry;
let factory;
let factoryCalls;

beforeEach(() => {
  registry = new WindowRegistry();
  factoryCalls = [];
  factory = vi.fn((opts) => {
    const win = makeFakeWindow();
    factoryCalls.push({ opts, win });
    return win;
  });
});

describe("createWindowOpenHandler — construction", () => {
  it("requires a registry", () => {
    expect(() => createWindowOpenHandler({ httpUrl: HTTP_URL })).toThrow(
      /registry is required/,
    );
  });

  it("requires an httpUrl", () => {
    expect(() => createWindowOpenHandler({ registry })).toThrow(
      /httpUrl is required/,
    );
    expect(() => createWindowOpenHandler({ registry, httpUrl: 123 })).toThrow(
      /httpUrl is required/,
    );
  });
});

describe("window.open handler — happy path", () => {
  it("spawns a fresh BrowserWindow for each openable role and registers it", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    const result = await handler({
      id: "1",
      type: "window.open",
      role: "artifact",
    });
    expect(result).toMatchObject({
      role: "artifact",
      opened: true,
      url: "http://127.0.0.1:54321/#/artifact",
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(registry.has("artifact")).toBe(true);
    expect(registry.get("artifact")?.url).toBe(
      "http://127.0.0.1:54321/#/artifact",
    );
  });

  it("forwards the caller's query into the resolved URL", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    const result = await handler({
      id: "2",
      type: "window.open",
      role: "artifact",
      query: { id: "abc-123" },
    });
    expect(result.url).toBe("http://127.0.0.1:54321/#/artifact?id=abc-123");
  });

  it("applies preloadPath to webPreferences when provided", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      preloadPath: "/abs/web-shell.js",
      browserWindowFactory: factory,
    });
    await handler({ id: "3", type: "window.open", role: "dashboard" });
    expect(factoryCalls[0].opts.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: "/abs/web-shell.js",
    });
  });

  it("uses the registry's per-role default geometry", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await handler({ id: "4", type: "window.open", role: "artifact" });
    expect(factoryCalls[0].opts.width).toBe(600);
    expect(factoryCalls[0].opts.height).toBe(800);
  });
});

describe("window.open handler — idempotency", () => {
  it("does not spawn a second window for an already-open role", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await handler({ id: "1", type: "window.open", role: "project" });
    const second = await handler({
      id: "2",
      type: "window.open",
      role: "project",
    });
    expect(second).toMatchObject({
      role: "project",
      opened: false,
      reason: "already_open",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("focuses the existing window on a duplicate open", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await handler({ id: "1", type: "window.open", role: "dashboard" });
    const firstWin = factoryCalls[0].win;
    await handler({ id: "2", type: "window.open", role: "dashboard" });
    expect(firstWin.focus).toHaveBeenCalledTimes(1);
  });

  it("releases the registry slot when the BrowserWindow fires 'closed'", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await handler({ id: "1", type: "window.open", role: "artifact" });
    expect(registry.has("artifact")).toBe(true);
    factoryCalls[0].win._fireClosed();
    expect(registry.has("artifact")).toBe(false);

    // Re-opening after close must succeed (factory called twice total).
    await handler({ id: "2", type: "window.open", role: "artifact" });
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe("window.open handler — desktop:* roles", () => {
  it("opens a V5/V6 window with hash route + desktop preload for desktop:hardware-wallet", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      v5EntryUrl: "http://localhost:5173",
      desktopPreloadPath: "/abs/desktop-preload.js",
      preloadPath: "/abs/web-shell.js",
      browserWindowFactory: factory,
    });
    const result = await handler({
      id: "1",
      type: "window.open",
      role: "desktop:hardware-wallet",
    });
    expect(result).toMatchObject({
      role: "desktop:hardware-wallet",
      opened: true,
    });
    expect(result.url).toBe("http://localhost:5173#/hardware-wallet");
    // Desktop preload (NOT web-shell preload) + sandbox:false (Electron 39
    // workaround that the comment in main/index.js documents).
    expect(factoryCalls[0].opts.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: "/abs/desktop-preload.js",
    });
    // Per-role default geometry from window-registry.
    expect(factoryCalls[0].opts.width).toBe(1100);
    expect(factoryCalls[0].opts.height).toBe(800);
  });

  it("maps each desktop:* role to its V5 hash path", async () => {
    const cases = [
      ["desktop:hardware-wallet", "#/hardware-wallet"],
      ["desktop:backup-dashboard", "#/backup-dashboard"],
      ["desktop:llm-test-chat", "#/llm/test-chat"],
      ["desktop:settings", "#/settings/system"],
    ];
    for (const [role, expectedFragment] of cases) {
      registry = new (
        await import("../../window-registry.js")
      ).WindowRegistry();
      const handler = createWindowOpenHandler({
        registry,
        httpUrl: HTTP_URL,
        v5EntryUrl: "http://localhost:5173",
        browserWindowFactory: factory,
      });
      const r = await handler({ role });
      expect(r.url).toContain(expectedFragment);
    }
  });

  it("falls back to web-shell preloadPath when desktopPreloadPath is omitted", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      v5EntryUrl: "http://localhost:5173",
      preloadPath: "/abs/web-shell.js",
      // desktopPreloadPath: not set
      browserWindowFactory: factory,
    });
    await handler({ role: "desktop:settings" });
    expect(factoryCalls[0].opts.webPreferences.preload).toBe(
      "/abs/web-shell.js",
    );
  });

  it("throws v5_entry_unavailable when desktop:* opened without v5EntryUrl", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await expect(handler({ role: "desktop:hardware-wallet" })).rejects.toThrow(
      "v5_entry_unavailable",
    );
  });

  it("does NOT add sandbox:false for non-desktop roles", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      v5EntryUrl: "http://localhost:5173",
      browserWindowFactory: factory,
    });
    await handler({ role: "artifact" });
    expect(factoryCalls[0].opts.webPreferences.sandbox).toBeUndefined();
  });

  it("sets backgroundColor for desktop:* roles to avoid white flash", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      v5EntryUrl: "http://localhost:5173",
      browserWindowFactory: factory,
    });
    await handler({ role: "desktop:hardware-wallet" });
    expect(factoryCalls[0].opts.backgroundColor).toBe("#764ba2");
  });

  it("does NOT set backgroundColor for non-desktop roles", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      v5EntryUrl: "http://localhost:5173",
      browserWindowFactory: factory,
    });
    await handler({ role: "artifact" });
    expect(factoryCalls[0].opts.backgroundColor).toBeUndefined();
  });

  it("supports a v5EntryUrl already containing # (preserves existing hash)", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      v5EntryUrl: "file:///app/renderer/index.html#",
      browserWindowFactory: factory,
    });
    const r = await handler({ role: "desktop:settings" });
    // Already had a hash; we don't append another one.
    expect(r.url).toBe("file:///app/renderer/index.html#");
  });
});

describe("window.open handler — onWindowOpened observer", () => {
  it("invokes onWindowOpened with role + window after register", async () => {
    const observed = [];
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
      onWindowOpened: (role, win) => observed.push({ role, win }),
    });
    await handler({ id: "1", type: "window.open", role: "artifact" });
    expect(observed).toHaveLength(1);
    expect(observed[0].role).toBe("artifact");
    expect(observed[0].win).toBe(factoryCalls[0].win);
  });

  it("does not invoke onWindowOpened on already_open path", async () => {
    const onOpen = vi.fn();
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
      onWindowOpened: onOpen,
    });
    await handler({ id: "1", type: "window.open", role: "project" });
    await handler({ id: "2", type: "window.open", role: "project" });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("swallows errors thrown by onWindowOpened so the window still opens", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
      onWindowOpened: () => {
        throw new Error("persister exploded");
      },
    });
    const result = await handler({
      id: "1",
      type: "window.open",
      role: "dashboard",
    });
    expect(result).toMatchObject({ role: "dashboard", opened: true });
    expect(registry.has("dashboard")).toBe(true);
  });
});

describe("window.open handler — rejections", () => {
  it("throws role_required when role is missing or non-string", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await expect(handler({})).rejects.toThrow("role_required");
    await expect(handler({ role: "" })).rejects.toThrow("role_required");
    await expect(handler({ role: 42 })).rejects.toThrow("role_required");
  });

  it("returns role_reserved (not throws) when caller asks for main", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    const result = await handler({
      id: "1",
      type: "window.open",
      role: "main",
    });
    expect(result).toMatchObject({
      role: "main",
      opened: false,
      reason: "role_reserved",
      url: null,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(registry.has("main")).toBe(false);
  });

  it("throws unknown_role:<role> for any other unknown role", async () => {
    const handler = createWindowOpenHandler({
      registry,
      httpUrl: HTTP_URL,
      browserWindowFactory: factory,
    });
    await expect(handler({ role: "ghost" })).rejects.toThrow(
      "unknown_role:ghost",
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it("VALID_OPENABLE_ROLES is the public roster (sanity check)", () => {
    expect(VALID_OPENABLE_ROLES.has("artifact")).toBe(true);
    expect(VALID_OPENABLE_ROLES.has("project")).toBe(true);
    expect(VALID_OPENABLE_ROLES.has("dashboard")).toBe(true);
    expect(VALID_OPENABLE_ROLES.has("main")).toBe(false);
  });
});
