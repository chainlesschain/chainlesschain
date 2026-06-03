/**
 * `cc android` command + cc-android-bridge unit tests (Plan A A7 scaffold).
 *
 * These exercise the command routing without a real Android device. The
 * `_deps` injection seam swaps the bridge module with a mock so we hit both
 * the success path (bridge resolves) and error path (bridge throws
 * AndroidBridgeUnavailableError, which on a real non-Android host is what
 * actually happens).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import * as androidCmd from "../android.js";
import * as bridge from "../../lib/cc-android-bridge.js";

let logSpy, errSpy, exitSpy, jsonSpy;

function withMockBridge(invokeResult) {
  const mock = {
    invoke: vi.fn(async (method, params) => {
      if (invokeResult instanceof Error) throw invokeResult;
      if (typeof invokeResult === "function")
        return await invokeResult(method, params);
      return invokeResult;
    }),
    caps: vi.fn(() => ({ available: true, reason: "mock" })),
    AndroidBridgeUnavailableError: bridge.AndroidBridgeUnavailableError,
  };
  androidCmd._deps.bridge = mock;
  return mock;
}

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`__exit:${code}`);
  });
});

afterEach(() => {
  androidCmd._deps.bridge = bridge;
  vi.restoreAllMocks();
});

// ─── cc-android-bridge ────────────────────────────────────────────────

describe("cc-android-bridge", () => {
  it("detectAndroid returns false on a vanilla non-Android host", () => {
    // Test runs on win32 / linux / darwin — not android.
    expect(bridge.detectAndroid()).toBe(false);
  });

  it("detectAndroid returns true under CC_ANDROID_BRIDGE_OVERRIDE=1", () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    try {
      expect(bridge.detectAndroid()).toBe(true);
    } finally {
      delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    }
  });

  it("invoke rejects with ANDROID_BRIDGE_NOT_AVAILABLE on non-Android host", async () => {
    await expect(bridge.invoke("contacts.query", {})).rejects.toMatchObject({
      code: "ANDROID_BRIDGE_NOT_AVAILABLE",
    });
  });

  it("invoke routes through testInvoke when override is set", async () => {
    process.env.CC_ANDROID_BRIDGE_OVERRIDE = "1";
    const original = bridge._deps.testInvoke;
    bridge._deps.testInvoke = vi.fn(async (m, p) => ({ echo: m, params: p }));
    try {
      const r = await bridge.invoke("foo.bar", { x: 1 });
      expect(r).toEqual({ echo: "foo.bar", params: { x: 1 } });
      expect(bridge._deps.testInvoke).toHaveBeenCalledWith("foo.bar", { x: 1 });
    } finally {
      bridge._deps.testInvoke = original;
      delete process.env.CC_ANDROID_BRIDGE_OVERRIDE;
    }
  });

  it("invoke rejects empty method", async () => {
    await expect(bridge.invoke("")).rejects.toThrow(/non-empty string/);
  });

  it("caps reports unavailable on non-Android host", () => {
    const c = bridge.caps();
    expect(c.available).toBe(false);
    expect(c.reason).toMatch(/not-on-android/);
  });
});

// ─── cmd routing — bridge success path ─────────────────────────────────

describe("cc android commands — success path (mocked bridge)", () => {
  it("cmdCaps prints available when bridge.caps returns available", async () => {
    withMockBridge({});
    await androidCmd._cmds.cmdCaps({ json: true });
    expect(logSpy).toHaveBeenCalled();
    const out = logSpy.mock.calls[0][0];
    expect(JSON.parse(out).available).toBe(true);
  });

  it("cmdContactsPull invokes contacts.query with --since", async () => {
    const mock = withMockBridge({ ingested: 42, events: [] });
    await androidCmd._cmds.cmdContactsPull({
      json: true,
      since: "1700000000000",
    });
    expect(mock.invoke).toHaveBeenCalledWith("contacts.query", {
      since: 1700000000000,
    });
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(out.ingested).toBe(42);
  });

  it("cmdSmsPull invokes sms.query", async () => {
    const mock = withMockBridge({ ok: true });
    await androidCmd._cmds.cmdSmsPull({ json: true });
    expect(mock.invoke).toHaveBeenCalledWith("sms.query", { since: undefined });
  });

  it("cmdCallsPull invokes calls.query", async () => {
    const mock = withMockBridge({ ok: true });
    await androidCmd._cmds.cmdCallsPull({ json: true });
    expect(mock.invoke).toHaveBeenCalledWith("calls.query", {
      since: undefined,
    });
  });

  it("cmdAppList passes includeSystem flag", async () => {
    const mock = withMockBridge([{ pkg: "com.foo" }]);
    await androidCmd._cmds.cmdAppList({ json: true, system: true });
    expect(mock.invoke).toHaveBeenCalledWith("app.list", {
      includeSystem: true,
    });
  });

  it("cmdAppLaunch forwards pkg", async () => {
    const mock = withMockBridge({ ok: true });
    await androidCmd._cmds.cmdAppLaunch("com.tencent.mm", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("app.launch", {
      pkg: "com.tencent.mm",
    });
  });

  it("cmdAppIntent parses --extra K=V repeatable", async () => {
    const mock = withMockBridge({ ok: true });
    await androidCmd._cmds.cmdAppIntent("com.foo", "VIEW", {
      json: true,
      extra: ["url=https://x", "id=42"],
    });
    expect(mock.invoke).toHaveBeenCalledWith("app.intent", {
      pkg: "com.foo",
      action: "VIEW",
      extras: { url: "https://x", id: "42" },
    });
  });

  it("cmdFsRead forwards SAF tree URI", async () => {
    const mock = withMockBridge({ bytes: 100 });
    await androidCmd._cmds.cmdFsRead(
      "content://com.android.externalstorage.documents/tree/abc",
      {
        json: true,
      },
    );
    expect(mock.invoke).toHaveBeenCalledWith("fs.read", {
      target: "content://com.android.externalstorage.documents/tree/abc",
    });
  });

  it("cmdFsList invokes fs.list", async () => {
    const mock = withMockBridge([]);
    await androidCmd._cmds.cmdFsList("/sdcard/Download/", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("fs.list", {
      target: "/sdcard/Download/",
    });
  });

  it("cmdA11yQuery forwards --filter", async () => {
    const mock = withMockBridge({ nodes: [] });
    await androidCmd._cmds.cmdA11yQuery({ json: true, filter: "button" });
    expect(mock.invoke).toHaveBeenCalledWith("a11y.query", {
      filter: "button",
    });
  });

  it("cmdA11yClick forwards nodeId", async () => {
    const mock = withMockBridge({ ok: true });
    await androidCmd._cmds.cmdA11yClick("node-7", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("a11y.click", {
      nodeId: "node-7",
    });
  });

  it("cmdA11yType forwards text", async () => {
    const mock = withMockBridge({ ok: true });
    await androidCmd._cmds.cmdA11yType("hello", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("a11y.type", { text: "hello" });
  });

  it("cmdShizukuExec forwards cmd", async () => {
    const mock = withMockBridge({ stdout: "ok" });
    await androidCmd._cmds.cmdShizukuExec("pm list packages", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("shizuku.exec", {
      cmd: "pm list packages",
    });
  });

  it("cmdRootExec forwards cmd", async () => {
    const mock = withMockBridge({ stdout: "" });
    await androidCmd._cmds.cmdRootExec("ls /data/data", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("root.exec", {
      cmd: "ls /data/data",
    });
  });

  it("cmdPerms forwards permission name", async () => {
    const mock = withMockBridge({ granted: false });
    await androidCmd._cmds.cmdPerms("READ_CONTACTS", { json: true });
    expect(mock.invoke).toHaveBeenCalledWith("perms.check", {
      name: "READ_CONTACTS",
    });
  });
});

// ─── cmd routing — bridge error path ──────────────────────────────────

describe("cc android commands — error path", () => {
  it("propagates ANDROID_BRIDGE_NOT_AVAILABLE as JSON when --json", async () => {
    withMockBridge(
      new bridge.AndroidBridgeUnavailableError("test-not-on-android"),
    );
    await expect(
      androidCmd._cmds.cmdContactsPull({ json: true }),
    ).rejects.toThrow(/__exit:1/);
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(out.code).toBe("ANDROID_BRIDGE_NOT_AVAILABLE");
    expect(out.error).toMatch(/test-not-on-android/);
  });

  it("propagates error human-readable on non-JSON", async () => {
    withMockBridge(new bridge.AndroidBridgeUnavailableError("nope"));
    await expect(androidCmd._cmds.cmdSmsPull({ json: false })).rejects.toThrow(
      /__exit:1/,
    );
    expect(errSpy).toHaveBeenCalled();
  });

  it("non-bridge errors still surface", async () => {
    withMockBridge(new Error("network timeout"));
    await expect(androidCmd._cmds.cmdAppList({ json: true })).rejects.toThrow(
      /__exit:1/,
    );
    const out = JSON.parse(logSpy.mock.calls[0][0]);
    expect(out.error).toMatch(/network timeout/);
  });
});
