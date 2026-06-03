/**
 * Phase 1d — composable bilibiliAdbSync routes to the right WS topic.
 *
 * Mocks useWsStore to capture sendRaw payloads so we never need a real
 * connection. Same pattern as usePersonalDataHub-wechat.test.js.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 1d bilibiliAdbSync", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends bilibili-adb-sync with empty payload + 120s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-bilibili",
          status: "ok",
          rawCount: 0,
          entityCounts: { events: 0, persons: 0, places: 0, items: 0, topics: 0 },
          bilibili: {
            uid: 1234567890,
            eventCounts: { history: 0, favourite: 0, dynamic: 0, follow: 0, total: 0 },
            lastErrorCode: 0,
            lastErrorMessage: null,
            cookieDiagnostic: { cookieCount: 5, hadEncrypted: false },
            cleanupFailed: false,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const result = await hub.bilibiliAdbSync();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.bilibili-adb-sync");
    expect(timeout).toBe(120_000);
    // No-args call → envelope fields should be undefined (composable
    // doesn't fabricate defaults, lets the hub method apply its own)
    expect(envelope.limits).toBeUndefined();
    expect(envelope.stagingDir).toBeUndefined();
    expect(envelope.displayName).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.report.bilibili.uid).toBe(1234567890);
  });

  it("forwards limits + stagingDir + displayName when provided", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, report: {} } });
    const hub = usePersonalDataHub();
    await hub.bilibiliAdbSync({
      limits: { history: 100, favourite: 25, dynamic: 30, follow: 200 },
      stagingDir: "/tmp/custom-staging",
      displayName: "alice",
    });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.limits).toEqual({
      history: 100,
      favourite: 25,
      dynamic: 30,
      follow: 200,
    });
    expect(envelope.stagingDir).toBe("/tmp/custom-staging");
    expect(envelope.displayName).toBe("alice");
  });

  it("propagates typed-reason failure response verbatim", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "BILIBILI_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bilibiliAdbSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BILIBILI_NO_ROOT");
    expect(r.message).toBe("su returned uid=2000");
  });

  it("propagates partial-result (ok:true with lastErrorCode != 0)", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          status: "ok",
          bilibili: {
            uid: 42,
            eventCounts: { history: 30, favourite: 0, dynamic: 0, follow: 0, total: 30 },
            lastErrorCode: -412,
            lastErrorMessage: "anti-spider",
            cleanupFailed: false,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bilibiliAdbSync();
    expect(r.ok).toBe(true);
    expect(r.report.bilibili.lastErrorCode).toBe(-412);
    expect(r.report.bilibili.lastErrorMessage).toBe("anti-spider");
  });

  it("rethrows transport-level WS errors", async () => {
    sendRaw.mockResolvedValueOnce({
      error: "ws timeout after 120000ms",
    });
    const hub = usePersonalDataHub();
    await expect(hub.bilibiliAdbSync()).rejects.toThrow(/ws timeout/);
  });
});

describe("usePersonalDataHub — Phase 1e bilibiliAdbDoctor", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends bilibili-adb-doctor with empty payload + 15s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        uid: 1234567890,
        extractedAt: 1716383021000,
        cookieDiagnostic: { cookieCount: 5, hadEncrypted: false },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bilibiliAdbDoctor();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.bilibili-adb-doctor");
    expect(timeout).toBe(15_000);
    expect(r.ok).toBe(true);
    expect(r.uid).toBe(1234567890);
    expect(r.cookieDiagnostic.cookieCount).toBe(5);
  });

  it("propagates typed-reason failure verbatim", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "BILIBILI_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bilibiliAdbDoctor();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BILIBILI_NO_ROOT");
  });

  it("propagates hadEncrypted=true diagnostic", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        uid: 1,
        extractedAt: 1,
        cookieDiagnostic: { cookieCount: 3, hadEncrypted: true },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.bilibiliAdbDoctor();
    expect(r.cookieDiagnostic.hadEncrypted).toBe(true);
  });

  it("rethrows transport-level WS errors", async () => {
    sendRaw.mockResolvedValueOnce({
      error: "ws disconnected",
    });
    const hub = usePersonalDataHub();
    await expect(hub.bilibiliAdbDoctor()).rejects.toThrow(/ws disconnected/);
  });
});
