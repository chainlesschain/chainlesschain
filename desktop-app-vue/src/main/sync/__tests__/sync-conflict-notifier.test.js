/**
 * sync-conflict-notifier 单元测试 — Phase 3c follow-up D10
 *
 * 验证 transition 状态机：
 *   clean / null / undefined / 'success' → conflict (skipped > 0) ⇒ notify
 *   conflict → conflict ⇒ suppress (anti-spam)
 *   anything → success / failed ⇒ no notify
 *   skipped == 0 ⇒ no notify (即使 status === 'conflict')
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  notifyIfNewConflict,
  shouldNotifyConflict,
  _setNotificationFactoryForTest,
  _resetNotificationFactoryForTest,
} = require("../sync-conflict-notifier");

function makeFakeNotificationFactory() {
  const calls = [];
  const factory = vi.fn((opts) => {
    const fakeNotification = {
      opts,
      show: vi.fn(() => calls.push({ shown: true, opts })),
      on: vi.fn(),
    };
    return fakeNotification;
  });
  return { factory, calls };
}

beforeEach(() => {
  _resetNotificationFactoryForTest();
});

// ── shouldNotifyConflict pure decision ───────────────────────────────

describe("shouldNotifyConflict · pure transition logic", () => {
  it("clean (null prev) → conflict with skipped > 0 ⇒ notify", () => {
    expect(
      shouldNotifyConflict({
        result: { status: "conflict", skipped: 3 },
        prevStatus: null,
      }),
    ).toBe(true);
  });

  it("undefined prev → conflict ⇒ notify (first run ever)", () => {
    expect(
      shouldNotifyConflict({
        result: { status: "conflict", skipped: 1 },
        prevStatus: undefined,
      }),
    ).toBe(true);
  });

  it("success prev → conflict ⇒ notify (reactivation)", () => {
    expect(
      shouldNotifyConflict({
        result: { status: "conflict", skipped: 2 },
        prevStatus: "success",
      }),
    ).toBe(true);
  });

  it("conflict prev → conflict ⇒ SUPPRESS", () => {
    expect(
      shouldNotifyConflict({
        result: { status: "conflict", skipped: 5 },
        prevStatus: "conflict",
      }),
    ).toBe(false);
  });

  it("success result ⇒ no notify (regardless of prev)", () => {
    expect(
      shouldNotifyConflict({
        result: { status: "success", skipped: 0 },
        prevStatus: "conflict",
      }),
    ).toBe(false);
  });

  it("failed result ⇒ no notify", () => {
    expect(
      shouldNotifyConflict({
        result: { status: "failed", skipped: 0 },
        prevStatus: null,
      }),
    ).toBe(false);
  });

  it("status=conflict but skipped=0 ⇒ no notify (defensive)", () => {
    // Engine technically shouldn't produce this, but defend anyway
    expect(
      shouldNotifyConflict({
        result: { status: "conflict", skipped: 0 },
        prevStatus: null,
      }),
    ).toBe(false);
  });

  it("null result ⇒ no notify", () => {
    expect(shouldNotifyConflict({ result: null, prevStatus: null })).toBe(
      false,
    );
  });
});

// ── notifyIfNewConflict integration with notification factory ────────

describe("notifyIfNewConflict · notification factory integration", () => {
  it("happy: clean→conflict triggers factory + show()", () => {
    const { factory, calls } = makeFakeNotificationFactory();
    _setNotificationFactoryForTest(factory);

    const r = notifyIfNewConflict({
      provider: "WebDAV",
      result: { status: "conflict", skipped: 3, pushed: 10, deleted: 0 },
      prevStatus: null,
    });

    expect(r.notified).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    const opts = factory.mock.calls[0][0];
    expect(opts.title).toMatch(/WebDAV/);
    expect(opts.title).toMatch(/冲突/);
    expect(opts.body).toMatch(/3/);
  });

  it("suppress: conflict→conflict does NOT invoke factory", () => {
    const { factory } = makeFakeNotificationFactory();
    _setNotificationFactoryForTest(factory);

    const r = notifyIfNewConflict({
      provider: "OSS / S3",
      result: { status: "conflict", skipped: 5 },
      prevStatus: "conflict",
    });

    expect(r.notified).toBe(false);
    expect(r.reason).toBe("already-notified-prior-run");
    expect(factory).not.toHaveBeenCalled();
  });

  it("success result → no factory call", () => {
    const { factory } = makeFakeNotificationFactory();
    _setNotificationFactoryForTest(factory);

    const r = notifyIfNewConflict({
      provider: "OSS",
      result: { status: "success", skipped: 0, pushed: 10 },
      prevStatus: "conflict",
    });

    expect(r.notified).toBe(false);
    expect(r.reason).toBe("not-conflict");
    expect(factory).not.toHaveBeenCalled();
  });

  it("reactivation path: notify → suppress → success → notify again", () => {
    const { factory } = makeFakeNotificationFactory();
    _setNotificationFactoryForTest(factory);

    // Run 1: first-ever conflict
    let r = notifyIfNewConflict({
      provider: "WebDAV",
      result: { status: "conflict", skipped: 1 },
      prevStatus: null,
    });
    expect(r.notified).toBe(true);

    // Run 2: same conflict batch repeats — suppressed
    r = notifyIfNewConflict({
      provider: "WebDAV",
      result: { status: "conflict", skipped: 1 },
      prevStatus: "conflict",
    });
    expect(r.notified).toBe(false);

    // Run 3: user fixes things, clean sync
    r = notifyIfNewConflict({
      provider: "WebDAV",
      result: { status: "success", skipped: 0 },
      prevStatus: "conflict",
    });
    expect(r.notified).toBe(false);

    // Run 4: new conflict emerges after clean
    r = notifyIfNewConflict({
      provider: "WebDAV",
      result: { status: "conflict", skipped: 2 },
      prevStatus: "success",
    });
    expect(r.notified).toBe(true);

    expect(factory).toHaveBeenCalledTimes(2); // run 1 + run 4
  });

  it("provider label appears in notification title (custom name)", () => {
    const { factory } = makeFakeNotificationFactory();
    _setNotificationFactoryForTest(factory);

    notifyIfNewConflict({
      provider: "Custom Cloud",
      result: { status: "conflict", skipped: 7 },
      prevStatus: null,
    });

    expect(factory.mock.calls[0][0].title).toMatch(/Custom Cloud/);
  });

  it("factory throw is non-fatal, returns notified=false reason=notification-error", () => {
    _setNotificationFactoryForTest(() => {
      throw new Error("Electron not ready");
    });

    const r = notifyIfNewConflict({
      provider: "WebDAV",
      result: { status: "conflict", skipped: 1 },
      prevStatus: null,
    });

    expect(r.notified).toBe(false);
    expect(r.reason).toBe("notification-error");
  });
});
