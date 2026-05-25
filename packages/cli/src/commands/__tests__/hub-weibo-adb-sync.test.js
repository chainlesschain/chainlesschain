/**
 * Phase 3a — cc hub weibo-adb-sync CLI command unit tests.
 *
 * Same _getHub test-seam pattern. Mirrors hub-bilibili / hub-douyin tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy;
let prevExitCode;

function fakeHub(syncResult) {
  return { weiboAdbSync: vi.fn(async (_opts) => syncResult) };
}

const HAPPY_RESULT = {
  ok: true,
  report: {
    adapter: "social-weibo",
    status: "ok",
    rawCount: 25,
    entityCounts: { events: 25, persons: 0, places: 0, items: 0, topics: 0 },
    weibo: {
      uid: 1234567890,
      eventCounts: { post: 15, favourite: 5, follow: 5, total: 25 },
      lastErrorCode: 0,
      lastErrorMessage: null,
      cookieDiagnostic: { cookieCount: 6, hasSub: true, hadEncrypted: false },
      uidFetchFailed: false,
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

describe("cc hub weibo-adb-sync — happy path", () => {
  it("prints human summary", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub });
    expect(hub.weiboAdbSync).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/weibo-adb-sync succeeded/);
    expect(out).toMatch(/uid:.*1234567890/);
    expect(out).toMatch(/posts:\s+15/);
    expect(out).toMatch(/favourites:\s+5/);
    expect(out).toMatch(/follows:\s+5/);
    expect(out).toMatch(/total:\s+25/);
  });

  it("--json outputs raw result", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub, json: true });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.report.weibo.uid).toBe(1234567890);
  });

  it("renders uidFetchFailed warning when set", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.weibo.uidFetchFailed = true;
    result.report.weibo.lastErrorCode = -4;
    result.report.weibo.uid = null;
    const hub = fakeHub(result);
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/api\/config returned login=false/);
    expect(out).toMatch(/uid fetch failed/);
  });
});

describe("cc hub weibo-adb-sync — failure reasons", () => {
  it("BRIDGE_UNAVAILABLE → exit 1 + install tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BRIDGE_UNAVAILABLE",
      message: "adb not found",
    });
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub });
    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Install Android Platform Tools/);
  });

  it("WEIBO_NO_ROOT → Magisk tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "WEIBO_NO_ROOT",
      message: "uid=2000",
    });
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Magisk root/);
  });

  it("WEIBO_NOT_INSTALLED → install tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "WEIBO_NOT_INSTALLED",
      message: "Cookies path missing",
    });
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Install Weibo App/);
  });

  it("WEIBO_COOKIES_INCOMPLETE → relog tip (SUB missing)", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "WEIBO_COOKIES_INCOMPLETE",
      message: "missing SUB",
    });
    await _internal.cmdWeiboAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/SUB cookie missing.*relog/);
  });
});

describe("cc hub weibo-adb-sync — options forwarding", () => {
  it("forwards limit-post / limit-favourite / limit-follow", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdWeiboAdbSync({
      _getHub: async () => hub,
      limitPost: "50",
      limitFavourite: "30",
      limitFollow: "100",
    });
    const arg = hub.weiboAdbSync.mock.calls[0][0];
    expect(arg.limits).toEqual({ post: 50, favourite: 30, follow: 100 });
  });

  it("forwards display-name + staging-dir", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdWeiboAdbSync({
      _getHub: async () => hub,
      displayName: "alice",
      stagingDir: "/tmp/x",
    });
    const arg = hub.weiboAdbSync.mock.calls[0][0];
    expect(arg.displayName).toBe("alice");
    expect(arg.stagingDir).toBe("/tmp/x");
  });
});

describe("cc hub weibo-adb-sync — _internal export", () => {
  it("cmdWeiboAdbSync is exported", () => {
    expect(typeof _internal.cmdWeiboAdbSync).toBe("function");
  });
});
