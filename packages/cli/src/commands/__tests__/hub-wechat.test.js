/**
 * cc hub wechat <verb> CLI command unit tests (Phase 12.6.9 CLI surface).
 *
 * The command handlers accept `_getHub` test seam so this suite never
 * starts a real hub. We synthesize a tiny fake hub whose methods return
 * canned responses matching the real ones (Phase 12.6.8 wiring methods).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy, exitSpy;

function fakeHub(overrides = {}) {
  return {
    probeWechatEnv: vi.fn(async () => ({
      ok: true,
      suggestedKeyProvider: "md5",
      reasons: ["WeChat 7.0.22 — md5 path"],
      device: { reachable: true, serial: "DEVICE_A", abi: "arm64-v8a" },
      root: { detected: false, magiskInstalled: false },
      frida: { serverRunning: false, port: null },
      wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
      warnings: [],
      ...overrides.probe,
    })),
    registerWechatAdapter: vi.fn(async (opts) => {
      if (!opts.account || !opts.account.uin) {
        return { ok: false, reason: "UIN_REQUIRED" };
      }
      return {
        ok: true,
        name: "wechat",
        version: "0.5.0",
        capabilities: ["sync:sqlite"],
        sensitivity: "high",
        chosenKeyProvider: opts.keyProviderOverride || "md5",
        probe: { suggestedKeyProvider: "md5", reasons: [] },
        registeredAt: 1716280000000,
        ...overrides.register,
      };
    }),
    listWechatAccounts: vi.fn(() => overrides.list || [
      {
        uin: "1234567890",
        dbPath: "/tmp/EnMicroMsg.db",
        hasWechatDataPath: true,
        chosenKeyProvider: "md5",
        registeredAt: 1716280000000,
        lastSyncAt: null,
      },
    ]),
    unregisterWechatAdapter: vi.fn(async (uin) => {
      if (!uin) return { ok: false, reason: "UIN_REQUIRED" };
      return { ok: true, removed: uin === "1234567890", uin, ...overrides.unregister };
    }),
  };
}

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
    throw new Error("process.exit called");
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  exitSpy.mockRestore();
});

describe("cc hub wechat env-probe", () => {
  it("prints human-readable summary by default", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatEnvProbe({ _getHub: async () => hub });
    expect(hub.probeWechatEnv).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/suggested.*md5/);
    expect(out).toMatch(/device.*reachable.*DEVICE_A/);
    expect(out).toMatch(/wechat.*7\.0\.22/);
  });

  it("--json prints raw probe shape", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatEnvProbe({ _getHub: async () => hub, json: true });
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(JSON.parse(out)).toEqual(
      expect.objectContaining({
        suggestedKeyProvider: "md5",
        device: expect.objectContaining({ reachable: true }),
      }),
    );
  });
});

describe("cc hub wechat register", () => {
  it("requires --uin (exits 1 via fail())", async () => {
    const hub = fakeHub();
    // With --json, fail() writes { error: "..." } to console.log; without
    // --json, it writes a red ✗ to logger.error. We test both paths and
    // assert at least one captured the missing-uin reason.
    await expect(
      _internal.cmdWechatRegister({ _getHub: async () => hub, json: true }),
    ).rejects.toThrow(/process\.exit/);
    const allOut =
      logSpy.mock.calls.map((c) => c.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")).join("\n") +
      "\n" +
      errSpy.mock.calls.map((c) => c.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")).join("\n");
    expect(allOut).toMatch(/--uin|uin/i);
  });

  it("forwards --uin / --db / --wechat-data-path / --force-provider to hub", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatRegister({
      _getHub: async () => hub,
      uin: "1234567890",
      db: "/tmp/EnMicroMsg.db",
      wechatDataPath: "/tmp/com.tencent.mm",
      forceProvider: "md5",
    });
    const callArg = hub.registerWechatAdapter.mock.calls[0][0];
    expect(callArg.account.uin).toBe("1234567890");
    expect(callArg.dbPath).toBe("/tmp/EnMicroMsg.db");
    expect(callArg.wechatDataPath).toBe("/tmp/com.tencent.mm");
    expect(callArg.keyProviderOverride).toBe("md5");
  });

  it("forwards --frida-device-id into fridaOpts", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatRegister({
      _getHub: async () => hub,
      uin: "wxid_abc",
      forceProvider: "frida",
      fridaDeviceId: "EMU_X",
    });
    const callArg = hub.registerWechatAdapter.mock.calls[0][0];
    expect(callArg.fridaOpts).toEqual({ deviceId: "EMU_X" });
  });

  it("prints provider + sensitivity on success", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatRegister({
      _getHub: async () => hub,
      uin: "1234567890",
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/wechat registered.*1234567890/);
    expect(out).toMatch(/provider.*md5/);
    expect(out).toMatch(/sensitivity.*high/);
  });

  it("exits 1 and surfaces reason + probe.reasons on ENV_UNSUPPORTED", async () => {
    const hub = fakeHub({
      register: {
        ok: false,
        reason: "ENV_UNSUPPORTED",
        message: "No root",
        probe: { reasons: ["WeChat 8.0.50 needs root", "frida not running"] },
      },
    });
    await expect(
      _internal.cmdWechatRegister({
        _getHub: async () => hub,
        uin: "wxid_abc",
      }),
    ).rejects.toThrow(/process\.exit/);
    const errOut = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOut).toMatch(/ENV_UNSUPPORTED/);
    expect(errOut).toMatch(/needs root/);
    expect(errOut).toMatch(/frida not running/);
  });

  it("--json prints raw register response without ANSI noise", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatRegister({
      _getHub: async () => hub,
      uin: "1234567890",
      json: true,
    });
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.chosenKeyProvider).toBe("md5");
    expect(parsed.sensitivity).toBe("high");
  });
});

describe("cc hub wechat list", () => {
  it("prints account rows", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatList({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/uin=1234567890/);
    expect(out).toMatch(/provider=md5/);
  });

  it("prints '(no registered)' when empty", async () => {
    const hub = fakeHub({ list: [] });
    await _internal.cmdWechatList({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/no registered/);
  });

  it("--json prints accounts array", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatList({ _getHub: async () => hub, json: true });
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.accounts)).toBe(true);
    expect(parsed.accounts[0].uin).toBe("1234567890");
  });
});

describe("cc hub wechat unregister", () => {
  it("calls hub with uin + reports removed", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatUnregister("1234567890", { _getHub: async () => hub });
    expect(hub.unregisterWechatAdapter).toHaveBeenCalledWith("1234567890");
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/removed wechat account.*1234567890/);
  });

  it("reports nothing-removed for missing uin (still ok:true)", async () => {
    const hub = fakeHub({ unregister: { removed: false } });
    await _internal.cmdWechatUnregister("ghost", { _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/was not registered/);
  });

  it("--json prints raw response", async () => {
    const hub = fakeHub();
    await _internal.cmdWechatUnregister("1234567890", {
      _getHub: async () => hub,
      json: true,
    });
    const out = logSpy.mock.calls.map((c) => c[0]).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(expect.objectContaining({ ok: true, removed: true, uin: "1234567890" }));
  });
});
