/**
 * Phase 6c — composable toutiaoAdbSync routes to the right WS topic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 6c toutiaoAdbSync", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends toutiao-adb-sync with empty payload + 90s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-toutiao",
          status: "ok",
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
            profileFetchFailed: false,
            signProviderUsed: "ToutiaoSignBridge",
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.toutiaoAdbSync();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.toutiao-adb-sync");
    // 90s > Xhs's 60s — Toutiao needs warmUp (~3-5s) + 3 signed endpoints
    expect(timeout).toBe(90_000);
    expect(r.ok).toBe(true);
    expect(r.report.toutiao.uid).toBe("12345");
  });

  it("forwards limits + stagingDir + displayName", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, report: {} } });
    const hub = usePersonalDataHub();
    await hub.toutiaoAdbSync({
      limits: { feed: 30, collection: 100, search: 50 },
      stagingDir: "/tmp/t",
      displayName: "alice",
    });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.limits).toEqual({
      feed: 30,
      collection: 100,
      search: 50,
    });
    expect(envelope.stagingDir).toBe("/tmp/t");
    expect(envelope.displayName).toBe("alice");
  });

  it("propagates TOUTIAO_NO_ROOT failure", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "TOUTIAO_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.toutiaoAdbSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("TOUTIAO_NO_ROOT");
  });

  it("propagates signProviderUsed=none short-circuit shape", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          toutiao: {
            uid: "12345",
            eventCounts: {
              profile: 1,
              feed: 0,
              collection: 0,
              search: 0,
              total: 1,
            },
            signProviderUsed: "none",
            signProviderHits: 0,
            signProviderFallbacks: 3,
            lastErrorCode: -99,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.toutiaoAdbSync();
    expect(r.report.toutiao.signProviderUsed).toBe("none");
    expect(r.report.toutiao.signProviderFallbacks).toBe(3);
    expect(r.report.toutiao.lastErrorCode).toBe(-99);
  });
});
