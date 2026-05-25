/**
 * Phase 1c — cc hub bilibili-adb-sync CLI command unit tests.
 *
 * Same _getHub test-seam pattern as hub-wechat.test.js: we synthesize a
 * tiny fake hub whose `bilibiliAdbSync` method returns canned `{ok, ...}`
 * shapes matching the real wiring contract.
 *
 * What we cover:
 *  - Happy path (status=ok, all 4 counts) — human + JSON output
 *  - Each typed failure reason emits the right inline tip + exit code 1
 *  - Limits options are parsed + forwarded
 *  - stagingDir / displayName forward
 *  - Partial-result diagnostic (lastErrorCode) renders the warning line
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy;
let prevExitCode;

function fakeHub(syncResult) {
  return {
    bilibiliAdbSync: vi.fn(async (_opts) => syncResult),
  };
}

const HAPPY_RESULT = {
  ok: true,
  report: {
    adapter: "social-bilibili",
    status: "ok",
    rawCount: 42,
    entityCounts: { events: 42, persons: 0, places: 0, items: 0, topics: 0 },
    bilibili: {
      uid: 1234567890,
      eventCounts: {
        history: 30,
        favourite: 5,
        dynamic: 2,
        follow: 5,
        total: 42,
      },
      lastErrorCode: 0,
      lastErrorMessage: null,
      cookieDiagnostic: { cookieCount: 5, hadEncrypted: false },
      cleanupFailed: false,
    },
  },
};

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  prevExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = prevExitCode;
});

describe("cc hub bilibili-adb-sync — happy path", () => {
  it("prints human-readable summary by default", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    expect(hub.bilibiliAdbSync).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/bilibili-adb-sync succeeded/);
    expect(out).toMatch(/uid:.*1234567890/);
    expect(out).toMatch(/history:\s+30/);
    expect(out).toMatch(/favourite:\s+5/);
    expect(out).toMatch(/dynamic:\s+2/);
    expect(out).toMatch(/follow:\s+5/);
    expect(out).toMatch(/total:\s+42/);
    expect(out).toMatch(/status:\s+ok/);
  });

  it("prints JSON when --json", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdBilibiliAdbSync({
      _getHub: async () => hub,
      json: true,
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.report.bilibili.uid).toBe(1234567890);
  });

  it("renders partial-result warning when lastErrorCode != 0", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.bilibili.lastErrorCode = -412;
    result.report.bilibili.lastErrorMessage = "anti-spider";
    const hub = fakeHub(result);
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/partial.*lastErrorCode=-412.*anti-spider/);
  });

  it("renders cleanup-failed note when reported", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.bilibili.cleanupFailed = true;
    const hub = fakeHub(result);
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/staging file cleanup failed/);
  });
});

describe("cc hub bilibili-adb-sync — failure reasons", () => {
  it("BRIDGE_UNAVAILABLE → exit 1 + install-platform-tools tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BRIDGE_UNAVAILABLE",
      message: "adb not found",
    });
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/bilibili-adb-sync failed.*BRIDGE_UNAVAILABLE/);
    expect(out).toMatch(/Install Android Platform Tools/);
  });

  it("BILIBILI_NO_ROOT → exit 1 + root-required tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BILIBILI_NO_ROOT",
      message: "su returned uid=2000",
    });
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/BILIBILI_NO_ROOT/);
    expect(out).toMatch(/root \+ Magisk required/);
  });

  it("BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN → install-and-relog tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN",
      message: "Cookies path not found",
    });
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Install Bilibili App on the phone/);
  });

  it("BILIBILI_COOKIES_INCOMPLETE → relog tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BILIBILI_COOKIES_INCOMPLETE",
      message: "missing buvid3",
    });
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Cookie file is missing required fields/);
  });

  it("unknown reason → generic failure message + exit 1", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "SYNC_FAILED",
      message: "vault write failed",
    });
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/SYNC_FAILED/);
    expect(out).toMatch(/vault write failed/);
  });

  it("--json on failure outputs full result", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BILIBILI_NO_ROOT",
      message: "su returned 2000",
    });
    await _internal.cmdBilibiliAdbSync({
      _getHub: async () => hub,
      json: true,
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("BILIBILI_NO_ROOT");
  });
});

describe("cc hub bilibili-adb-sync — options forwarding", () => {
  it("limit-* options become hub.limits object", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdBilibiliAdbSync({
      _getHub: async () => hub,
      limitHistory: "50",
      limitFavourite: "10",
      limitDynamic: "20",
      limitFollow: "30",
    });
    const callArg = hub.bilibiliAdbSync.mock.calls[0][0];
    expect(callArg.limits).toEqual({
      history: 50,
      favourite: 10,
      dynamic: 20,
      follow: 30,
    });
  });

  it("no limit options → limits is undefined", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdBilibiliAdbSync({ _getHub: async () => hub });
    const callArg = hub.bilibiliAdbSync.mock.calls[0][0];
    expect(callArg.limits).toBeUndefined();
  });

  it("displayName + stagingDir are forwarded", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdBilibiliAdbSync({
      _getHub: async () => hub,
      displayName: "alice",
      stagingDir: "/tmp/custom-staging",
    });
    const callArg = hub.bilibiliAdbSync.mock.calls[0][0];
    expect(callArg.displayName).toBe("alice");
    expect(callArg.stagingDir).toBe("/tmp/custom-staging");
  });
});

describe("cc hub bilibili-adb-sync — _internal export", () => {
  it("cmdBilibiliAdbSync is exported", () => {
    expect(typeof _internal.cmdBilibiliAdbSync).toBe("function");
  });
});
