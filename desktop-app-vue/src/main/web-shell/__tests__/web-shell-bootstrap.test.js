/**
 * Phase 0 spike step 3 — verifies the bootstrap composes the SPA server +
 * WS bridge with a matching wsPort, and tears both down cleanly.
 */

import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import WebSocket from "ws";
import {
  startWebShell,
  shouldRunWebShell,
  WEB_SHELL_FLAG,
  NO_WEB_SHELL_FLAG,
  WEB_SHELL_ENV,
} from "../web-shell-bootstrap.js";

function rpc(ws, frame) {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    ws.once("error", reject);
    ws.send(JSON.stringify(frame));
  });
}

describe("startWebShell", () => {
  let handle;

  beforeAll(async () => {
    handle = await startWebShell({
      ukeyManager: {
        async detect() {
          return { detected: false, unlocked: false, reason: "no_device" };
        },
      },
    });
  }, 15000);

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  it("returns matching httpUrl and wsUrl with distinct ports", () => {
    expect(handle.httpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(handle.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/$/);
    expect(handle.httpPort).toBeGreaterThan(0);
    expect(handle.wsPort).toBeGreaterThan(0);
    expect(handle.httpPort).not.toBe(handle.wsPort);
  });

  it("the SPA's __CC_CONFIG__.wsPort points at the bridge", async () => {
    const html = await (await fetch(handle.httpUrl)).text();
    expect(html).toContain(`"wsPort":${handle.wsPort}`);
    expect(html).toContain('"wsHost":"127.0.0.1"');
  });

  it("ukey.status is registered and answers via the live bridge", async () => {
    const ws = new WebSocket(handle.wsUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    try {
      const reply = await rpc(ws, { type: "ukey.status", id: "boot-1" });
      expect(reply).toMatchObject({
        type: "ukey.status.result",
        id: "boot-1",
        ok: true,
      });
      expect(reply.result).toMatchObject({
        available: true,
        detected: false,
        unlocked: false,
      });
    } finally {
      ws.close();
    }
  });

  it("skill.list is registered and returns the resolved skill catalog", async () => {
    // Phase 1.A: in-process custom topic that bypasses ws.execute('skill list')
    // (which can't run inside Electron). The handler delegates to
    // CLISkillLoader.loadAll() — we don't stub it because the real loader
    // runs against the real .chainlesschain/skills + bundled layers and is
    // expected to return a non-empty array on this monorepo.
    const ws = new WebSocket(handle.wsUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    try {
      const reply = await rpc(ws, { type: "skill.list", id: "boot-skill-1" });
      expect(reply).toMatchObject({
        type: "skill.list.result",
        id: "boot-skill-1",
        ok: true,
      });
      expect(reply.result).toMatchObject({ schema: 1 });
      expect(Array.isArray(reply.result.skills)).toBe(true);
      // Every shaped skill carries the fields the web-panel store reads.
      for (const skill of reply.result.skills) {
        expect(typeof skill.name).toBe("string");
        expect(typeof skill.description).toBe("string");
        expect(typeof skill.category).toBe("string");
        expect(typeof skill.executionMode).toBe("string");
      }
    } finally {
      ws.close();
    }
  });

  it("the SPA's __CC_CONFIG__.embeddedShell is true so the web-panel branches off ws.execute()", async () => {
    const html = await (await fetch(handle.httpUrl)).text();
    expect(html).toContain('"embeddedShell":true');
  });

  it("injects a configured WS token into the SPA and gates native topics", async () => {
    const token = "desktop-test-token";
    const local = await startWebShell({
      ukeyManager: null,
      wsToken: token,
    });
    const ws = new WebSocket(local.wsUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    try {
      const html = await (await fetch(local.httpUrl)).text();
      expect(html).toContain(`"wsToken":${JSON.stringify(token)}`);

      const denied = await rpc(ws, {
        type: "ukey.status",
        id: "token-denied",
      });
      expect(denied).toMatchObject({
        type: "error",
        code: "AUTH_REQUIRED",
      });

      const auth = await rpc(ws, {
        type: "auth",
        id: "token-auth",
        token,
      });
      expect(auth).toMatchObject({
        type: "auth-result",
        success: true,
      });
      const allowed = await rpc(ws, {
        type: "ukey.status",
        id: "token-allowed",
      });
      expect(allowed).toMatchObject({
        type: "ukey.status.result",
        ok: true,
      });
    } finally {
      ws.close();
      await local.close();
    }
  });

  it("close() is idempotent", async () => {
    // Second close on the same handle is a no-op — but we'll call it via a
    // fresh handle so the global afterAll doesn't fight us.
    const localPtyManager = new EventEmitter();
    localPtyManager.shutdown = vi.fn();
    const createPtyManager = vi.fn(async () => localPtyManager);
    const projectRoot = path.resolve("trusted-web-shell-project");
    const local = await startWebShell({
      ukeyManager: null,
      projectRoot,
      createPtyManager,
    });
    expect(createPtyManager).toHaveBeenCalledWith({
      config: undefined,
      policyCwd: projectRoot,
      resolveSandboxPolicy: undefined,
      resolveProjectBinding: undefined,
      requireProjectBinding: false,
    });
    expect(local.ptyManager).toBe(localPtyManager);
    await local.close();
    await expect(local.close()).resolves.toBeUndefined();
    expect(localPtyManager.shutdown).toHaveBeenCalledOnce();
  });

  it("detaches terminal fan-out without shutting down a caller-owned manager", async () => {
    const sharedPtyManager = new EventEmitter();
    sharedPtyManager.shutdown = vi.fn();
    const local = await startWebShell({
      ukeyManager: null,
      projectRoot: path.resolve("shared-terminal-project"),
      ptyManager: sharedPtyManager,
    });
    expect(sharedPtyManager.listenerCount("stdout")).toBe(1);
    expect(sharedPtyManager.listenerCount("exit")).toBe(1);

    await local.close();

    expect(sharedPtyManager.listenerCount("stdout")).toBe(0);
    expect(sharedPtyManager.listenerCount("exit")).toBe(0);
    expect(sharedPtyManager.shutdown).not.toHaveBeenCalled();
  });

  it("does not use the desktop process cwd as a strict DB-bound terminal root", async () => {
    const localPtyManager = new EventEmitter();
    localPtyManager.shutdown = vi.fn();
    const createPtyManager = vi.fn(async () => localPtyManager);
    const local = await startWebShell({
      ukeyManager: null,
      createPtyManager,
      requireTerminalProjectBinding: true,
    });
    try {
      expect(createPtyManager).toHaveBeenCalledOnce();
      expect(createPtyManager.mock.calls[0][0]).toEqual({
        config: undefined,
        resolveSandboxPolicy: undefined,
        resolveProjectBinding: undefined,
        requireProjectBinding: true,
      });
    } finally {
      await local.close();
    }
  });

  it("fs.openDialog wired with no mainWindow returns main_window_unavailable error", async () => {
    // Stage 2 integration — fs handlers are registered at startWebShell time
    // with mainWindow:null when the boot path is too early to have a window.
    // The error must round-trip cleanly so the SPA can show "feature unavailable".
    const ws = new WebSocket(handle.wsUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    try {
      const reply = await rpc(ws, { type: "fs.openDialog", id: "fs-1" });
      expect(reply).toMatchObject({
        type: "fs.openDialog.result",
        id: "fs-1",
        ok: false,
        error: "main_window_unavailable",
      });
    } finally {
      ws.close();
    }
  });

  it("two concurrent clients see the same topic handlers (single shared registry)", async () => {
    // Stage 2 integration — multi-window UX (Phase 1.5) leans on this:
    // every BrowserWindow opens its own WS to the same server and must
    // see identical topic responses. We assert both clients get matching
    // ukey.status results within a short window.
    const ws1 = new WebSocket(handle.wsUrl);
    const ws2 = new WebSocket(handle.wsUrl);
    await Promise.all([
      new Promise((r, e) => {
        ws1.once("open", r);
        ws1.once("error", e);
      }),
      new Promise((r, e) => {
        ws2.once("open", r);
        ws2.once("error", e);
      }),
    ]);
    try {
      const [r1, r2] = await Promise.all([
        rpc(ws1, { type: "ukey.status", id: "c1" }),
        rpc(ws2, { type: "ukey.status", id: "c2" }),
      ]);
      // Both replies must succeed and report the same platform/detected
      // bits (the registry is server-side, ergo single source of truth).
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.result.platform).toBe(r2.result.platform);
      expect(r1.result.detected).toBe(r2.result.detected);
    } finally {
      ws1.close();
      ws2.close();
    }
  });
});

describe("startWebShell — startup failure cleanup", () => {
  it("shuts down an owned terminal manager if the WS bridge fails", async () => {
    // Force a WS port collision by starting one bridge first then asking
    // bootstrap to bind the same port.
    const { startWsBridge } = await import("../ws-bridge.js");
    const occupant = await startWsBridge({ port: 0 });
    const localPtyManager = new EventEmitter();
    localPtyManager.shutdown = vi.fn();
    const createPtyManager = vi.fn(async () => localPtyManager);
    try {
      await expect(
        startWebShell({
          wsPort: occupant.port,
          ukeyManager: null,
          createPtyManager,
        }),
      ).rejects.toBeDefined();
      expect(createPtyManager).toHaveBeenCalledOnce();
      expect(localPtyManager.shutdown).toHaveBeenCalledOnce();
    } finally {
      await occupant.close();
    }
  });

  it("shuts down an owned terminal manager when HTTP startup fails", async () => {
    const occupant = createServer((_request, response) => response.end());
    await new Promise((resolve, reject) => {
      occupant.once("error", reject);
      occupant.listen(0, "127.0.0.1", resolve);
    });
    const localPtyManager = new EventEmitter();
    localPtyManager.shutdown = vi.fn();
    const createPtyManager = vi.fn(async () => localPtyManager);
    try {
      const address = occupant.address();
      await expect(
        startWebShell({
          httpPort: address.port,
          ukeyManager: null,
          createPtyManager,
        }),
      ).rejects.toBeDefined();
      expect(createPtyManager).toHaveBeenCalledOnce();
      expect(localPtyManager.listenerCount("stdout")).toBe(0);
      expect(localPtyManager.listenerCount("exit")).toBe(0);
      expect(localPtyManager.shutdown).toHaveBeenCalledOnce();
    } finally {
      await new Promise((resolve) => occupant.close(resolve));
    }
  });
});

describe("shouldRunWebShell (Phase 1.6 hard-flip — opt-out semantics)", () => {
  it("returns true when --web-shell is in argv (force-on escape hatch preserved)", () => {
    expect(shouldRunWebShell(["node", "main.js", WEB_SHELL_FLAG], {})).toBe(
      true,
    );
  });

  it("returns true when env opt-in is set (force-on escape hatch preserved)", () => {
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "1" }),
    ).toBe(true);
  });

  it("returns true when settings.ui.useWebShellExperimental is true", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js"],
        {},
        { ui: { useWebShellExperimental: true } },
      ),
    ).toBe(true);
  });

  it("returns false when the setting is explicitly false (only opt-out path)", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js"],
        {},
        {
          ui: {
            useWebShellExperimental: false,
            useV6ShellByDefault: true,
          },
        },
      ),
    ).toBe(false);
  });

  it("explicit opt-out via setting wins over argv force-on", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js", WEB_SHELL_FLAG],
        {},
        { ui: { useWebShellExperimental: false } },
      ),
    ).toBe(false);
  });

  it("explicit opt-out via setting wins over env force-on", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js"],
        { [WEB_SHELL_ENV]: "1" },
        { ui: { useWebShellExperimental: false } },
      ),
    ).toBe(false);
  });

  it("settings opt-in wins over --no-web-shell argv (UI toggle is authoritative)", () => {
    // User clicks "切换到 Web Shell" in V6 preview → setting=true → relaunch.
    // app.relaunch() carries the original argv (still has --no-web-shell from
    // dev:no-web-shell), but the setting must win or the toggle is broken.
    expect(
      shouldRunWebShell(
        ["node", "main.js", NO_WEB_SHELL_FLAG],
        {},
        { ui: { useWebShellExperimental: true } },
      ),
    ).toBe(true);
  });

  it("settings opt-in wins over CHAINLESSCHAIN_WEB_SHELL=0 env", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js"],
        { [WEB_SHELL_ENV]: "0" },
        { ui: { useWebShellExperimental: true } },
      ),
    ).toBe(true);
  });

  it("defaults to true when no opt-out signal is present", () => {
    // Hard-flip default: empty / unset / non-recognized values land on true.
    expect(shouldRunWebShell(["node", "main.js"], {})).toBe(true);
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "" }),
    ).toBe(true);
    expect(shouldRunWebShell(["node", "main.js"], {}, null)).toBe(true);
    expect(shouldRunWebShell(["node", "main.js"], {}, {})).toBe(true);
    expect(shouldRunWebShell(["node", "main.js"], {}, { ui: {} })).toBe(true);
  });

  it("returns false when --no-web-shell is in argv (dev escape hatch)", () => {
    expect(shouldRunWebShell(["node", "main.js", NO_WEB_SHELL_FLAG], {})).toBe(
      false,
    );
  });

  it("returns false when env is '0' or 'false' (dev escape hatch)", () => {
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "0" }),
    ).toBe(false);
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "false" }),
    ).toBe(false);
  });

  it("--no-web-shell wins over --web-shell force-on", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js", WEB_SHELL_FLAG, NO_WEB_SHELL_FLAG],
        {},
      ),
    ).toBe(false);
  });
});
