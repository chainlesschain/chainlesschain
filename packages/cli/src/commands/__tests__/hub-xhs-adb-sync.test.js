/**
 * Phase 3c — cc hub xhs-adb-sync CLI command unit tests.
 *
 * Mirror of hub-weibo-adb-sync test. Covers meFetchFailed warning + 461
 * partial-result warning (X-S signing best-effort).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy;
let prevExitCode;

function fakeHub(syncResult) {
  return { xhsAdbSync: vi.fn(async (_opts) => syncResult) };
}

const HAPPY_RESULT = {
  ok: true,
  report: {
    adapter: "social-xiaohongshu",
    status: "ok",
    rawCount: 20,
    entityCounts: { events: 20, persons: 0, places: 0, items: 0, topics: 0 },
    xhs: {
      userId: "5e8c8f7e1234abcdef",
      nickname: "Alice",
      eventCounts: { note: 15, liked: 3, follow: 2, total: 20 },
      lastErrorCode: 0,
      lastErrorMessage: null,
      cookieDiagnostic: { cookieCount: 8, hadEncrypted: false },
      meFetchFailed: false,
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

describe("cc hub xhs-adb-sync — happy path", () => {
  it("prints human summary with nickname", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub });
    expect(hub.xhsAdbSync).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/xhs-adb-sync succeeded/);
    expect(out).toMatch(/userId:.*5e8c8f7e/);
    expect(out).toMatch(/nickname:\s+Alice/);
    expect(out).toMatch(/notes:\s+15/);
    expect(out).toMatch(/liked:\s+3/);
    expect(out).toMatch(/follows:\s+2/);
    expect(out).toMatch(/total:\s+20/);
  });

  it("--json outputs raw result", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub, json: true });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.report.xhs.userId).toBe("5e8c8f7e1234abcdef");
  });

  it("renders meFetchFailed warning when set", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.xhs.meFetchFailed = true;
    result.report.xhs.lastErrorCode = -7;
    result.report.xhs.userId = null;
    const hub = fakeHub(result);
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/\/user\/me returned no user_id/);
    expect(out).toMatch(/me fetch failed/);
  });

  it("renders X-S 461 partial-result warning", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.xhs.lastErrorCode = 461;
    result.report.xhs.lastErrorMessage = "X-S validation failed";
    result.report.xhs.eventCounts.total = 5; // partial — only 5 events got through
    const hub = fakeHub(result);
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/X-S 签名 best-effort/);
    expect(out).toMatch(/lastErrorCode=461/);
  });
});

describe("cc hub xhs-adb-sync — failure reasons", () => {
  it("BRIDGE_UNAVAILABLE → exit 1 + install tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BRIDGE_UNAVAILABLE",
      message: "adb not found",
    });
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub });
    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Install Android Platform Tools/);
  });

  it("XHS_NO_ROOT → Magisk tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "XHS_NO_ROOT",
      message: "uid=2000",
    });
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Magisk root/);
  });

  it("XHS_COOKIES_INCOMPLETE → a1/web_session tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "XHS_COOKIES_INCOMPLETE",
      message: "missing a1",
    });
    await _internal.cmdXhsAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/a1 \/ web_session cookie missing/);
  });
});

describe("cc hub xhs-adb-sync — options forwarding", () => {
  it("forwards limit-note / limit-liked / limit-follow", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdXhsAdbSync({
      _getHub: async () => hub,
      limitNote: "20",
      limitLiked: "15",
      limitFollow: "50",
    });
    const arg = hub.xhsAdbSync.mock.calls[0][0];
    expect(arg.limits).toEqual({ note: 20, liked: 15, follow: 50 });
  });
});

describe("cc hub xhs-adb-sync — _internal export", () => {
  it("cmdXhsAdbSync is exported", () => {
    expect(typeof _internal.cmdXhsAdbSync).toBe("function");
  });
});
