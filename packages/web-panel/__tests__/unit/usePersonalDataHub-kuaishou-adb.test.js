/**
 * Phase 6d — composable kuaishouAdbSync routes to the right WS topic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 6d kuaishouAdbSync", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends kuaishou-adb-sync with empty payload + 120s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-kuaishou",
          status: "ok",
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
            profileFetchFailed: false,
            signProviderUsed: "KuaishouSignBridge",
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.kuaishouAdbSync();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.kuaishou-adb-sync");
    // 120s > Toutiao's 90s — NS_sig3 init heavier (~5-8s warmUp)
    expect(timeout).toBe(120_000);
    expect(r.ok).toBe(true);
    expect(r.report.kuaishou.uid).toBe("12345");
  });

  it("forwards limits + stagingDir + displayName", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, report: {} } });
    const hub = usePersonalDataHub();
    await hub.kuaishouAdbSync({
      limits: { watch: 30, collect: 50, search: 20 },
      stagingDir: "/tmp/k",
      displayName: "alice",
    });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.limits).toEqual({
      watch: 30,
      collect: 50,
      search: 20,
    });
    expect(envelope.stagingDir).toBe("/tmp/k");
    expect(envelope.displayName).toBe("alice");
  });

  it("propagates KUAISHOU_NO_ROOT failure", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "KUAISHOU_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.kuaishouAdbSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("KUAISHOU_NO_ROOT");
  });

  it("propagates signProviderUsed=none short-circuit shape", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          kuaishou: {
            uid: "12345",
            eventCounts: {
              profile: 1,
              watch: 0,
              collect: 0,
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
    const r = await hub.kuaishouAdbSync();
    expect(r.report.kuaishou.signProviderUsed).toBe("none");
    expect(r.report.kuaishou.signProviderFallbacks).toBe(3);
    expect(r.report.kuaishou.lastErrorCode).toBe(-99);
  });
});
