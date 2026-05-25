/**
 * Phase 6d — cc hub kuaishou-adb-sync CLI command unit tests.
 *
 * Mirror of hub-toutiao-adb-sync. Covers profileFetchFailed + CLI no-bridge
 * short-circuit banner + lastErrorCode propagation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy;
let prevExitCode;

function fakeHub(syncResult) {
  return { kuaishouAdbSync: vi.fn(async (_opts) => syncResult) };
}

const HAPPY_RESULT = {
  ok: true,
  report: {
    adapter: "social-kuaishou",
    status: "ok",
    rawCount: 26,
    entityCounts: { events: 26, persons: 1, places: 0, items: 0, topics: 0 },
    kuaishou: {
      uid: "12345",
      nickname: "Alice",
      eventCounts: {
        profile: 1,
        watch: 15,
        collect: 5,
        search: 5,
        total: 26,
      },
      lastErrorCode: 0,
      lastErrorMessage: null,
      cookieDiagnostic: { cookieCount: 8, hadEncrypted: false },
      profileFetchFailed: false,
      signProviderUsed: "KuaishouSignBridge",
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

describe("cc hub kuaishou-adb-sync — happy path", () => {
  it("prints human summary with nickname", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdKuaishouAdbSync({ _getHub: async () => hub });
    expect(hub.kuaishouAdbSync).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/kuaishou-adb-sync succeeded/);
    expect(out).toMatch(/uid:.*12345/);
    expect(out).toMatch(/nickname:\s+Alice/);
    expect(out).toMatch(/profile:\s+1/);
    expect(out).toMatch(/watch:\s+15/);
    expect(out).toMatch(/collect:\s+5/);
    expect(out).toMatch(/search:\s+5/);
    expect(out).toMatch(/total:\s+26/);
  });

  it("--json outputs raw result", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdKuaishouAdbSync({
      _getHub: async () => hub,
      json: true,
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.report.kuaishou.uid).toBe("12345");
  });

  it("renders profileFetchFailed warning when set", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.kuaishou.profileFetchFailed = true;
    result.report.kuaishou.lastErrorCode = -8;
    result.report.kuaishou.uid = null;
    const hub = fakeHub(result);
    await _internal.cmdKuaishouAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/cookie 缺 kuaishou\.web\.cp\.api_ph/);
    expect(out).toMatch(/profile fetch failed/);
  });

  it("renders 'no sign bridge' short-circuit banner in CLI context", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.kuaishou.signProviderUsed = "none";
    result.report.kuaishou.signProviderHits = 0;
    result.report.kuaishou.signProviderFallbacks = 3;
    result.report.kuaishou.eventCounts.watch = 0;
    result.report.kuaishou.eventCounts.collect = 0;
    result.report.kuaishou.eventCounts.search = 0;
    result.report.kuaishou.eventCounts.total = 1;
    result.report.kuaishou.lastErrorCode = -99;
    const hub = fakeHub(result);
    await _internal.cmdKuaishouAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/3 signed endpoints short-circuited/);
    expect(out).toMatch(/no sign bridge in CLI context/);
    expect(out).toMatch(/__NS_sig3 via Electron WebContentsView/);
  });

  it("renders lastErrorCode partial-result warning (non-(-99))", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.kuaishou.lastErrorCode = 412;
    result.report.kuaishou.lastErrorMessage = "HTTP 412";
    const hub = fakeHub(result);
    await _internal.cmdKuaishouAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/partial: lastErrorCode=412/);
  });
});

describe("cc hub kuaishou-adb-sync — failure paths", () => {
  function failCase(reason, expectedHint) {
    return async () => {
      const hub = fakeHub({ ok: false, reason, message: "synthetic" });
      await _internal.cmdKuaishouAdbSync({ _getHub: async () => hub });
      const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(out).toMatch(new RegExp(`kuaishou-adb-sync failed: ${reason}`));
      if (expectedHint) {
        expect(out).toMatch(expectedHint);
      }
      expect(process.exitCode).toBe(1);
    };
  }

  it("BRIDGE_UNAVAILABLE banner", failCase("BRIDGE_UNAVAILABLE", /ADB_PATH/));
  it("KUAISHOU_NO_ROOT banner", failCase("KUAISHOU_NO_ROOT", /Magisk root/));
  it(
    "KUAISHOU_NOT_INSTALLED banner",
    failCase("KUAISHOU_NOT_INSTALLED", /com\.smile\.gifmaker/),
  );
  it(
    "KUAISHOU_COOKIES_INCOMPLETE banner",
    failCase(
      "KUAISHOU_COOKIES_INCOMPLETE",
      /userId \/ kuaishou\.web\.cp\.api_ph/,
    ),
  );
  it(
    "KUAISHOU_COOKIES_TRUNCATED banner",
    failCase("KUAISHOU_COOKIES_TRUNCATED", /unplug \+ replug USB/),
  );
});
