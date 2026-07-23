/**
 * Phase B0 — vitest unit cover for host-adb-bridge.js extension API.
 *
 * What we cover (pure JS, no real ADB):
 *  - createHostAdbBridge with no extensions: identical to pre-B0 behavior
 *    (built-in dispatch + unknown-method throw)
 *  - Extension method registration via opts.extensions map
 *  - Extension cannot shadow a built-in (warn + ignore, built-in wins)
 *  - extensionMethods() introspection reflects what's registered
 *  - Extension handler receives ctx = { adb, pickDevice, parseContentQueryRows }
 *  - Params forwarded to extension handler verbatim
 *  - Unknown method (no built-in, no extension) throws HOST_ADB_BRIDGE_NOT_AVAILABLE
 *
 * What we DON'T cover (gated to Phase 1+ platform extensions):
 *  - Real `adb` spawn — the bridge's adb helper is internal & not exported;
 *    extensions that need ADB will hit a real binary at runtime and test
 *    that path with their own _deps mocks
 */

import { describe, it, expect, vi } from "vitest";
import {
  createHostAdbBridge,
  HostAdbBridgeUnavailableError,
  _deps,
  _internals,
} from "../../../src/lib/host-adb-bridge.js";

describe("host-adb-bridge — extension API (Phase B0)", () => {
  it("routes adb through the Broker with serial argv and provenance", async () => {
    const original = _deps.execFile;
    const calls = [];
    try {
      _deps.execFile = (file, args, options, callback) => {
        calls.push([file, args, options]);
        callback(null, "device-output", "");
      };

      await expect(
        _internals.adb(["shell", "getprop"], {
          adbPath: "custom-adb",
          serial: "SER-123",
        }),
      ).resolves.toBe("device-output");
      expect(calls).toEqual([
        [
          "custom-adb",
          ["-s", "SER-123", "shell", "getprop"],
          expect.objectContaining({
            origin: "host-adb:command",
            policy: "allow",
            scope: "host-adb",
            shell: false,
          }),
        ],
      ]);
    } finally {
      _deps.execFile = original;
    }
  });

  it("merges complete contact metadata from the four public provider queries", () => {
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
      [
        { contact_id: "7", data1: " 13800000000 " },
        { contact_id: "7", data1: "13800000000" },
      ],
      [{ contact_id: "7", data1: "alice@example.com" }],
      [{ contact_id: "7", data1: "Acme", data4: "Engineer" }],
    );
    expect(contacts).toEqual([
      {
        lookupKey: "lookup-7",
        displayName: "Alice",
        phones: ["13800000000"],
        emails: ["alice@example.com"],
        starred: true,
        organization: "Acme",
        jobTitle: "Engineer",
        photoUri: "content://photo/7",
      },
    ]);
  });

  it("caps() returns available:true sync (unchanged from pre-B0)", () => {
    const bridge = createHostAdbBridge();
    expect(bridge.caps()).toEqual({ available: true });
  });

  it("extensionMethods() returns empty array when no extensions registered", () => {
    const bridge = createHostAdbBridge();
    expect(bridge.extensionMethods()).toEqual([]);
  });

  it("invoke() throws HostAdbBridgeUnavailableError for unknown method", async () => {
    const bridge = createHostAdbBridge();
    await expect(bridge.invoke("nonexistent.method")).rejects.toThrow(
      HostAdbBridgeUnavailableError,
    );
    await expect(bridge.invoke("nonexistent.method")).rejects.toMatchObject({
      code: "HOST_ADB_BRIDGE_NOT_AVAILABLE",
    });
  });

  it("registers an extension method via opts.extensions", async () => {
    const handler = vi.fn(async (params) => ({
      ok: true,
      received: params,
    }));
    const bridge = createHostAdbBridge({
      extensions: { "douyin.snapshot": handler },
    });
    const result = await bridge.invoke("douyin.snapshot", {
      uid: "1234567890",
    });
    expect(result).toEqual({ ok: true, received: { uid: "1234567890" } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("extensionMethods() lists registered non-shadowing methods", () => {
    const bridge = createHostAdbBridge({
      extensions: {
        "douyin.snapshot": async () => ({}),
        "weibo.cookies": async () => ({}),
        "bilibili.history": async () => ({}),
      },
    });
    const methods = bridge.extensionMethods();
    expect(methods).toHaveLength(3);
    expect(methods).toContain("douyin.snapshot");
    expect(methods).toContain("weibo.cookies");
    expect(methods).toContain("bilibili.history");
  });

  it("extension handler receives ctx with shared ADB primitives", async () => {
    let capturedCtx = null;
    const bridge = createHostAdbBridge({
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

  it("ctx.parseContentQueryRows is the real parser (handles CRLF)", async () => {
    let parser = null;
    const bridge = createHostAdbBridge({
      extensions: {
        "test.capture": async (_p, ctx) => {
          parser = ctx.parseContentQueryRows;
          return null;
        },
      },
    });
    await bridge.invoke("test.capture", {});
    // Smoke test the parser against Windows CRLF output — same trap that
    // the built-in queryContacts / listApps / querySms etc all guard.
    const stdout =
      "Row: 0 lookup=abc, display_name=张三\r\nRow: 1 lookup=def, display_name=李四\r\n";
    const rows = parser(stdout);
    expect(rows).toHaveLength(2);
    expect(rows[0].lookup).toBe("abc");
    expect(rows[0].display_name).toBe("张三");
    expect(rows[1].lookup).toBe("def");
    expect(rows[1].display_name).toBe("李四");
  });

  it("forwards params verbatim to extension handler", async () => {
    let received = null;
    const bridge = createHostAdbBridge({
      extensions: {
        "test.echo": async (params) => {
          received = params;
          return null;
        },
      },
    });
    const input = {
      uid: "1234",
      since: 1716383021000,
      nested: { foo: ["a", "b"] },
    };
    await bridge.invoke("test.echo", input);
    expect(received).toEqual(input);
  });

  it("invoke() with no params passes empty object to extension", async () => {
    let received = "unset";
    const bridge = createHostAdbBridge({
      extensions: {
        "test.noparams": async (params) => {
          received = params;
          return null;
        },
      },
    });
    await bridge.invoke("test.noparams");
    expect(received).toEqual({});
  });

  it("built-in method wins over extension that tries to shadow it", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const shadowHandler = vi.fn(async () => ({
      pretended: "to be contacts",
    }));
    const bridge = createHostAdbBridge({
      extensions: { "contacts.query": shadowHandler },
    });

    // The warn fires at bridge-creation time (not at invoke time).
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(consoleWarn.mock.calls[0][0]).toContain("shadows a built-in method");

    // extensionMethods() must NOT report the shadowed name.
    expect(bridge.extensionMethods()).toEqual([]);

    // Invoking the built-in goes to the built-in path (which will then
    // try to fork real adb and fail since there's none on CI / dev box).
    // We just assert the shadow handler was never called.
    try {
      await bridge.invoke("contacts.query");
    } catch (e) {
      // Expected — no real ADB binary on test host
      expect(e).toBeInstanceOf(HostAdbBridgeUnavailableError);
    }
    expect(shadowHandler).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it("non-shadowing extensions do not trigger the shadow warning", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createHostAdbBridge({
      extensions: { "douyin.snapshot": async () => ({}) },
    });
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it("extension thrown errors propagate to invoke caller", async () => {
    const bridge = createHostAdbBridge({
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

  it("multiple extensions on the same bridge instance work independently", async () => {
    const calls = [];
    const bridge = createHostAdbBridge({
      extensions: {
        "douyin.a": async (p) => {
          calls.push(["douyin.a", p]);
          return { source: "douyin.a" };
        },
        "weibo.b": async (p) => {
          calls.push(["weibo.b", p]);
          return { source: "weibo.b" };
        },
      },
    });
    const r1 = await bridge.invoke("douyin.a", { x: 1 });
    const r2 = await bridge.invoke("weibo.b", { y: 2 });
    expect(r1.source).toBe("douyin.a");
    expect(r2.source).toBe("weibo.b");
    expect(calls).toEqual([
      ["douyin.a", { x: 1 }],
      ["weibo.b", { y: 2 }],
    ]);
  });

  it("legacy createHostAdbBridge() with no opts still works (pre-B0 callers)", () => {
    // The 7 built-in methods were the entire pre-B0 surface; callers that
    // never pass `extensions` must continue to work unchanged.
    const bridge = createHostAdbBridge();
    expect(bridge.caps).toBeInstanceOf(Function);
    expect(bridge.invoke).toBeInstanceOf(Function);
    expect(bridge.extensionMethods).toBeInstanceOf(Function);
    expect(bridge.extensionMethods()).toEqual([]);
  });
});
