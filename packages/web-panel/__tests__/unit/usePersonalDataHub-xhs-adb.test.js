/**
 * Phase 3c — composable xhsAdbSync routes to the right WS topic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 3c xhsAdbSync", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends xhs-adb-sync with empty payload + 60s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-xiaohongshu",
          status: "ok",
          xhs: {
            userId: "5e8c8f7e",
            nickname: "Alice",
            eventCounts: { note: 0, liked: 0, follow: 0, total: 0 },
            lastErrorCode: 0,
            meFetchFailed: false,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.xhsAdbSync();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.xhs-adb-sync");
    expect(timeout).toBe(60_000);
    expect(r.ok).toBe(true);
    expect(r.report.xhs.userId).toBe("5e8c8f7e");
  });

  it("forwards limits + stagingDir + displayName", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, report: {} } });
    const hub = usePersonalDataHub();
    await hub.xhsAdbSync({
      limits: { note: 20, liked: 15, follow: 50 },
      stagingDir: "/tmp/x",
      displayName: "alice",
    });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.limits).toEqual({ note: 20, liked: 15, follow: 50 });
    expect(envelope.stagingDir).toBe("/tmp/x");
    expect(envelope.displayName).toBe("alice");
  });

  it("propagates XHS_NO_ROOT failure", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "XHS_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.xhsAdbSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("XHS_NO_ROOT");
  });

  it("propagates meFetchFailed shape", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          xhs: {
            userId: null,
            meFetchFailed: true,
            lastErrorCode: -7,
            eventCounts: { note: 0, liked: 0, follow: 0, total: 0 },
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.xhsAdbSync();
    expect(r.ok).toBe(true);
    expect(r.report.xhs.meFetchFailed).toBe(true);
  });

  it("rethrows transport-level WS errors", async () => {
    sendRaw.mockResolvedValueOnce({ error: "ws disconnected" });
    const hub = usePersonalDataHub();
    await expect(hub.xhsAdbSync()).rejects.toThrow(/ws disconnected/);
  });
});
