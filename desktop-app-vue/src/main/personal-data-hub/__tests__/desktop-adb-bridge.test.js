/**
 * Phase B0 — vitest unit cover for desktop-adb-bridge.js extension API.
 *
 * CJS module (Electron main process target) so we go through createRequire
 * for the same reason wechat-wiring.test.js documents — vi.mock against
 * CJS is unreliable in Vitest's forks pool.
 *
 * Mirrors `packages/cli/__tests__/unit/lib/host-adb-bridge.test.js` for
 * the ESM twin. Both must stay in lockstep — when one gains a new
 * extension-related capability the other should too.
 *
 * What we cover (pure JS, no real ADB):
 *  - createDesktopAdbBridge with no extensions: identical to pre-B0 behavior
 *  - Extension registration via opts.extensions map
 *  - Built-in wins over extension shadow (warn + ignore)
 *  - extensionMethods() introspection
 *  - Extension handler receives ctx = { adb, pickDevice, parseContentQueryRows }
 *  - Unknown method throws DESKTOP_ADB_BRIDGE_NOT_AVAILABLE
 */

import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { createDesktopAdbBridge, DesktopAdbBridgeUnavailableError, _internals } =
  require_("../desktop-adb-bridge.js");

describe("desktop-adb-bridge — extension API (Phase B0)", () => {
  it("merges phones, emails, organization, and job title into contacts", () => {
    const contacts = _internals.mergeContactRows(
      [
        {
          _id: "7",
          lookup: "lookup-7",
          display_name: "Alice",
          starred: "1",
          photo_uri: "content://photo/7",
        },
      ],
      [{ contact_id: "7", data1: "13800000000" }],
      [{ contact_id: "7", data1: "alice@example.com" }],
      [{ contact_id: "7", data1: "Acme", data4: "Engineer" }],
    );
    expect(contacts[0]).toEqual({
      lookupKey: "lookup-7",
      displayName: "Alice",
      phones: ["13800000000"],
      emails: ["alice@example.com"],
      starred: true,
      organization: "Acme",
      jobTitle: "Engineer",
      photoUri: "content://photo/7",
    });
  });

  it("treats SMS, call-log, and media methods as built-ins", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = createDesktopAdbBridge({
      extensions: {
        "sms.query": async () => [],
        "call.query": async () => [],
        "media.list": async () => [],
      },
    });
    expect(consoleWarn).toHaveBeenCalledTimes(3);
    expect(bridge.extensionMethods()).toEqual([]);
    consoleWarn.mockRestore();
  });

  it("caps() returns available:true sync (unchanged from pre-B0)", () => {
    const bridge = createDesktopAdbBridge();
    expect(bridge.caps()).toEqual({ available: true });
  });

  it("extensionMethods() returns empty array when no extensions", () => {
    const bridge = createDesktopAdbBridge();
    expect(bridge.extensionMethods()).toEqual([]);
  });

  it("invoke() throws DesktopAdbBridgeUnavailableError for unknown method", async () => {
    const bridge = createDesktopAdbBridge();
    await expect(bridge.invoke("nonexistent.method")).rejects.toThrow(
      DesktopAdbBridgeUnavailableError,
    );
    await expect(bridge.invoke("nonexistent.method")).rejects.toMatchObject({
      code: "DESKTOP_ADB_BRIDGE_NOT_AVAILABLE",
    });
  });

  it("registers an extension method via opts.extensions", async () => {
    const handler = vi.fn(async (params) => ({
      ok: true,
      received: params,
    }));
    const bridge = createDesktopAdbBridge({
      extensions: { "douyin.snapshot": handler },
    });
    const result = await bridge.invoke("douyin.snapshot", {
      uid: "1234567890",
    });
    expect(result).toEqual({ ok: true, received: { uid: "1234567890" } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("extension handler receives ctx with shared ADB primitives", async () => {
    let capturedCtx = null;
    const bridge = createDesktopAdbBridge({
      extensions: {
        "test.captureCtx": async (_params, ctx) => {
          capturedCtx = ctx;
          return { ok: true };
        },
      },
    });
    await bridge.invoke("test.captureCtx", {});
    expect(capturedCtx).not.toBeNull();
    expect(typeof capturedCtx.adb).toBe("function");
    expect(typeof capturedCtx.pickDevice).toBe("function");
    expect(typeof capturedCtx.parseContentQueryRows).toBe("function");
  });

  it("ctx.parseContentQueryRows handles CRLF (Windows ADB output)", async () => {
    let parser = null;
    const bridge = createDesktopAdbBridge({
      extensions: {
        "test.capture": async (_p, ctx) => {
          parser = ctx.parseContentQueryRows;
          return null;
        },
      },
    });
    await bridge.invoke("test.capture", {});
    const stdout = "Row: 0 lookup=abc, display_name=张三\r\n";
    const rows = parser(stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].lookup).toBe("abc");
    expect(rows[0].display_name).toBe("张三");
  });

  it("built-in (contacts.query) wins over extension shadow + warns", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const shadowHandler = vi.fn(async () => ({ shouldNotBeCalled: true }));
    const bridge = createDesktopAdbBridge({
      extensions: { "contacts.query": shadowHandler },
    });

    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toContain("shadows a built-in method");
    expect(bridge.extensionMethods()).toEqual([]);

    try {
      await bridge.invoke("contacts.query");
    } catch (e) {
      // Expected on CI/dev box (no real adb)
      expect(e).toBeInstanceOf(DesktopAdbBridgeUnavailableError);
    }
    expect(shadowHandler).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("multiple extensions on the same bridge instance", async () => {
    const bridge = createDesktopAdbBridge({
      extensions: {
        "douyin.a": async () => ({ source: "douyin.a" }),
        "weibo.b": async () => ({ source: "weibo.b" }),
      },
    });
    expect(await bridge.invoke("douyin.a")).toEqual({ source: "douyin.a" });
    expect(await bridge.invoke("weibo.b")).toEqual({ source: "weibo.b" });
  });

  it("extension thrown errors propagate to caller", async () => {
    const bridge = createDesktopAdbBridge({
      extensions: {
        "test.fail": async () => {
          throw new Error("simulated extension failure");
        },
      },
    });
    await expect(bridge.invoke("test.fail")).rejects.toThrow(
      "simulated extension failure",
    );
  });

  it("legacy createDesktopAdbBridge() with no opts still works", () => {
    const bridge = createDesktopAdbBridge();
    expect(bridge.caps).toBeInstanceOf(Function);
    expect(bridge.invoke).toBeInstanceOf(Function);
    expect(bridge.extensionMethods).toBeInstanceOf(Function);
    expect(bridge.extensionMethods()).toEqual([]);
  });
});
