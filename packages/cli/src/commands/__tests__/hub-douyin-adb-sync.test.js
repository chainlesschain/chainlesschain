/**
 * Phase 2a — cc hub douyin-adb-sync CLI command unit tests.
 *
 * Mirrors hub-bilibili-adb-sync.test.js. Synthesizes a fake hub whose
 * `douyinAdbSync` returns canned `{ok, ...}` shapes matching the wiring
 * contract.
 *
 * Covers:
 *  - Happy path: human + JSON
 *  - 5 typed failure reasons each emit the right inline tip + exit 1
 *  - Parser diagnostic warnings (msg / SIMPLE_USER missing)
 *  - Options forwarding (uid / limit-messages / limit-contacts / staging-dir / display-name)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { _internal } from "../hub.js";

let logSpy, errSpy;
let prevExitCode;

function fakeHub(syncResult) {
  return {
    douyinAdbSync: vi.fn(async (_opts) => syncResult),
  };
}

const HAPPY_RESULT = {
  ok: true,
  report: {
    adapter: "social-douyin",
    status: "ok",
    rawCount: 12,
    entityCounts: { events: 12, persons: 0, places: 0, items: 0, topics: 0 },
    douyin: {
      uid: "1234567890123456789",
      eventCounts: { message: 10, contact: 2, total: 12 },
      parserDiagnostic: {
        hadMsgTable: true,
        hadSimpleUserTable: true,
        messageCount: 10,
        contactCount: 2,
      },
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

describe("cc hub douyin-adb-sync — happy path", () => {
  it("prints human-readable summary by default", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    expect(hub.douyinAdbSync).toHaveBeenCalledOnce();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/douyin-adb-sync succeeded/);
    expect(out).toMatch(/uid:.*1234567890123456789/);
    expect(out).toMatch(/messages:\s+10/);
    expect(out).toMatch(/contacts:\s+2/);
    expect(out).toMatch(/total:\s+12/);
  });

  it("--json outputs raw result", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub, json: true });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.report.douyin.uid).toBe("1234567890123456789");
  });

  it("renders missing-msg-table warning", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.douyin.parserDiagnostic.hadMsgTable = false;
    const hub = fakeHub(result);
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/msg table not found/);
  });

  it("renders missing-SIMPLE_USER warning", async () => {
    const result = JSON.parse(JSON.stringify(HAPPY_RESULT));
    result.report.douyin.parserDiagnostic.hadSimpleUserTable = false;
    const hub = fakeHub(result);
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/SIMPLE_USER table not found/);
  });
});

describe("cc hub douyin-adb-sync — failure reasons", () => {
  it("BRIDGE_UNAVAILABLE → exit 1 + install tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "BRIDGE_UNAVAILABLE",
      message: "adb not found",
    });
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    expect(process.exitCode).toBe(1);
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Install Android Platform Tools/);
  });

  it("DOUYIN_NO_ROOT → exit 1 + Magisk tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "DOUYIN_NO_ROOT",
      message: "uid=2000",
    });
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Magisk root/);
  });

  it("DOUYIN_NOT_INSTALLED → install tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "DOUYIN_NOT_INSTALLED",
      message: "dir missing",
    });
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Install Douyin App on the phone/);
  });

  it("DOUYIN_NO_IM_DB → login+open-chat tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "DOUYIN_NO_IM_DB",
      message: "no <uid>_im.db",
    });
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Log in to Douyin App.*open any chat thread/);
  });

  it("DOUYIN_MULTIPLE_USERS → --uid tip", async () => {
    const hub = fakeHub({
      ok: false,
      reason: "DOUYIN_MULTIPLE_USERS",
      message: "multiple",
    });
    await _internal.cmdDouyinAdbSync({ _getHub: async () => hub });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/--uid <19-digit>/);
  });
});

describe("cc hub douyin-adb-sync — options forwarding", () => {
  it("forwards --uid", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdDouyinAdbSync({
      _getHub: async () => hub,
      uid: "1234567890123456789",
    });
    expect(hub.douyinAdbSync.mock.calls[0][0].uid).toBe("1234567890123456789");
  });

  it("forwards limit-messages + limit-contacts → limits object", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdDouyinAdbSync({
      _getHub: async () => hub,
      limitMessages: "500",
      limitContacts: "100",
    });
    const arg = hub.douyinAdbSync.mock.calls[0][0];
    expect(arg.limits).toEqual({ messages: 500, contacts: 100 });
  });

  it("forwards display-name + staging-dir", async () => {
    const hub = fakeHub(HAPPY_RESULT);
    await _internal.cmdDouyinAdbSync({
      _getHub: async () => hub,
      displayName: "alice",
      stagingDir: "/tmp/x",
    });
    const arg = hub.douyinAdbSync.mock.calls[0][0];
    expect(arg.displayName).toBe("alice");
    expect(arg.stagingDir).toBe("/tmp/x");
  });
});

describe("cc hub douyin-adb-sync — _internal export", () => {
  it("cmdDouyinAdbSync is exported", () => {
    expect(typeof _internal.cmdDouyinAdbSync).toBe("function");
  });
});
