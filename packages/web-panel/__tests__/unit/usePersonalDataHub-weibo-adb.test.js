/**
 * Phase 3b — composable weiboAdbSync routes to the right WS topic.
 *
 * Same pattern as usePersonalDataHub-bilibili-adb / -douyin-adb tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 3a/3b weiboAdbSync", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends weibo-adb-sync with empty payload + 60s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-weibo",
          status: "ok",
          rawCount: 0,
          weibo: {
            uid: 1234567890,
            eventCounts: { post: 0, favourite: 0, follow: 0, total: 0 },
            lastErrorCode: 0,
            cookieDiagnostic: { cookieCount: 5, hasSub: true, hadEncrypted: false },
            uidFetchFailed: false,
            cleanupFailed: false,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.weiboAdbSync();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.weibo-adb-sync");
    expect(timeout).toBe(60_000);
    expect(envelope.limits).toBeUndefined();
    expect(envelope.stagingDir).toBeUndefined();
    expect(envelope.displayName).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.report.weibo.uid).toBe(1234567890);
  });

  it("forwards limits + stagingDir + displayName", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, report: {} } });
    const hub = usePersonalDataHub();
    await hub.weiboAdbSync({
      limits: { post: 50, favourite: 30, follow: 100 },
      stagingDir: "/tmp/custom-staging",
      displayName: "alice",
    });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.limits).toEqual({ post: 50, favourite: 30, follow: 100 });
    expect(envelope.stagingDir).toBe("/tmp/custom-staging");
    expect(envelope.displayName).toBe("alice");
  });

  it("propagates typed-reason failure verbatim", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "WEIBO_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.weiboAdbSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("WEIBO_NO_ROOT");
  });

  it("propagates uidFetchFailed warning shape", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-weibo",
          status: "ok",
          weibo: {
            uid: null,
            eventCounts: { post: 0, favourite: 0, follow: 0, total: 0 },
            lastErrorCode: -4,
            lastErrorMessage: "non-json (cookie expired?)",
            uidFetchFailed: true,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.weiboAdbSync();
    expect(r.ok).toBe(true);
    expect(r.report.weibo.uidFetchFailed).toBe(true);
    expect(r.report.weibo.uid).toBe(null);
    expect(r.report.weibo.lastErrorCode).toBe(-4);
  });

  it("rethrows transport-level WS errors", async () => {
    sendRaw.mockResolvedValueOnce({ error: "ws disconnected" });
    const hub = usePersonalDataHub();
    await expect(hub.weiboAdbSync()).rejects.toThrow(/ws disconnected/);
  });
});
