/**
 * Phase 6c — cc hub toutiao-adb-sync CLI command unit tests.
 *
 * Mirror of hub-xhs-adb-sync. Covers profileFetchFailed + CLI no-bridge
 * short-circuit banner + lastErrorCode propagation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy;
let prevExitCode;

function fakeHub(syncResult) {
  return { toutiaoAdbSync: vi.fn(async (_opts) => syncResult) };
}

const HAPPY_RESULT = {
  ok: true,
  report: {
    adapter: "social-toutiao",
    status: "ok",
    rawCount: 26,
    entityCounts: { events: 26, persons: 1, places: 0, items: 0, topics: 0 },
    toutiao: {
      uid: "12345",
      nickname: "Alice",
      eventCounts: {
        profile: 1,
        feed: 15,
        collection: 5,
        search: 5,
        total: 26,
      },
      lastErrorCode: 0,
      lastErrorMessage: null,
      cookieDiagnostic: { cookieCount: 8, hadEncrypted: false },
      profileFetchFailed: false,
      signProviderUsed: "ToutiaoSignBridge",
      signProviderHits: 3,
      signProviderFallbacks: 0,
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

describe("cc hub toutiao-adb-sync — happy path", () => {
  it("prints human summary with nickname", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdToutiaoAdbSync({ _getHub: async () => hub });
    expect(hub.toutiaoAdbSync).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/toutiao-adb-sync succeeded/);
    expect(out).toMatch(/uid:.*12345/);
    expect(out).toMatch(/nickname:\s+Alice/);
    expect(out).toMatch(/profile:\s+1/);
    expect(out).toMatch(/feed:\s+15/);
    expect(out).toMatch(/collection:\s+5/);
    expect(out).toMatch(/search:\s+5/);
    expect(out).toMatch(/total:\s+26/);
  });

  it("--json outputs raw result", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdToutiaoAdbSync({
      _getHub: async () => hub,
      json: true,
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.report.toutiao.uid).toBe("12345");
  });

  it("renders profileFetchFailed warning when set", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.toutiao.profileFetchFailed = true;
    result.report.toutiao.lastErrorCode = 1;
    result.report.toutiao.lastErrorMessage = "token expired";
    result.report.toutiao.uid = null;
    const hub = fakeHub(result);
    await _internal.cmdToutiaoAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/passport\/info\/v2 returned no user_id/);
    expect(out).toMatch(/profile fetch failed/);
  });

  it("renders 'no sign bridge' short-circuit banner in CLI context", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.toutiao.signProviderUsed = "none";
    result.report.toutiao.signProviderHits = 0;
    result.report.toutiao.signProviderFallbacks = 3;
    result.report.toutiao.eventCounts.feed = 0;
    result.report.toutiao.eventCounts.collection = 0;
    result.report.toutiao.eventCounts.search = 0;
    result.report.toutiao.eventCounts.total = 1; // just profile
    result.report.toutiao.lastErrorCode = -99;
    const hub = fakeHub(result);
    await _internal.cmdToutiaoAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/3 signed endpoints short-circuited/);
    expect(out).toMatch(/no sign bridge in CLI context/);
  });

  it("renders lastErrorCode partial-result warning (non-(-99))", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.toutiao.lastErrorCode = 412;
    result.report.toutiao.lastErrorMessage = "HTTP 412";
    const hub = fakeHub(result);
    await _internal.cmdToutiaoAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/partial: lastErrorCode=412/);
  });
});

describe("cc hub toutiao-adb-sync — failure paths", () => {
  function failCase(reason, expectedHint) {
    return async () => {
      const hub = fakeHub({ ok: false, reason, message: "synthetic" });
      await _internal.cmdToutiaoAdbSync({ _getHub: async () => hub });
      const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(out).toMatch(new RegExp(`toutiao-adb-sync failed: ${reason}`));
      if (expectedHint) {
        expect(out).toMatch(expectedHint);
      }
      expect(process.exitCode).toBe(1);
    };
  }

  it("BRIDGE_UNAVAILABLE banner", failCase("BRIDGE_UNAVAILABLE", /ADB_PATH/));
  it("TOUTIAO_NO_ROOT banner", failCase("TOUTIAO_NO_ROOT", /Magisk root/));
  it(
    "TOUTIAO_NOT_INSTALLED banner",
    failCase("TOUTIAO_NOT_INSTALLED", /com\.ss\.android\.article\.news/),
  );
  it(
    "TOUTIAO_COOKIES_INCOMPLETE banner",
    failCase("TOUTIAO_COOKIES_INCOMPLETE", /sessionid \/ sessionid_ss/),
  );
  it(
    "TOUTIAO_COOKIES_TRUNCATED banner",
    failCase("TOUTIAO_COOKIES_TRUNCATED", /unplug \+ replug USB/),
  );
});
