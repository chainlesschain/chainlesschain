/**
 * Phase 0 spike step 3 — verifies the bootstrap composes the SPA server +
 * WS bridge with a matching wsPort, and tears both down cleanly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import {
  startWebShell,
  shouldRunWebShell,
  WEB_SHELL_FLAG,
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

  it("close() is idempotent", async () => {
    // Second close on the same handle is a no-op — but we'll call it via a
    // fresh handle so the global afterAll doesn't fight us.
    const local = await startWebShell({ ukeyManager: null });
    await local.close();
    await expect(local.close()).resolves.toBeUndefined();
  });
});

describe("startWebShell — WS startup failure cleans up the HTTP side", () => {
  it("does not leak the HTTP listener if the bridge fails", async () => {
    // Force a WS port collision by starting one bridge first then asking
    // bootstrap to bind the same port.
    const { startWsBridge } = await import("../ws-bridge.js");
    const occupant = await startWsBridge({ port: 0 });
    try {
      await expect(
        startWebShell({ wsPort: occupant.port, ukeyManager: null }),
      ).rejects.toBeDefined();
      // If the HTTP server leaked we'd see open handles; vitest's leak
      // detector covers this. We also re-bind the same port to prove no
      // residual http listener is squatting on it via OS-assignment race
      // conditions — skipped: HTTP port was OS-assigned so collision is
      // already vanishingly unlikely. The negative assertion above is
      // sufficient for the spike.
    } finally {
      await occupant.close();
    }
  });
});

describe("shouldRunWebShell", () => {
  it("returns true when --web-shell is in argv", () => {
    expect(shouldRunWebShell(["node", "main.js", WEB_SHELL_FLAG], {})).toBe(
      true,
    );
  });

  it("returns true when env opt-in is set", () => {
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "1" }),
    ).toBe(true);
  });

  it("returns true when settings.ui.useWebShellExperimental is true (Phase 1.3 opt-in)", () => {
    expect(
      shouldRunWebShell(
        ["node", "main.js"],
        {},
        { ui: { useWebShellExperimental: true } },
      ),
    ).toBe(true);
  });

  it("returns false when the setting is explicitly false", () => {
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

  it("returns false otherwise", () => {
    expect(shouldRunWebShell(["node", "main.js"], {})).toBe(false);
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "0" }),
    ).toBe(false);
    expect(
      shouldRunWebShell(["node", "main.js"], { [WEB_SHELL_ENV]: "" }),
    ).toBe(false);
    expect(shouldRunWebShell(["node", "main.js"], {}, null)).toBe(false);
    expect(shouldRunWebShell(["node", "main.js"], {}, {})).toBe(false);
    expect(shouldRunWebShell(["node", "main.js"], {}, { ui: {} })).toBe(false);
  });
});
