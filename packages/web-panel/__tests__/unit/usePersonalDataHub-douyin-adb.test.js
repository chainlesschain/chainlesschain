/**
 * Phase 2a — composable douyinAdbSync routes to the right WS topic.
 *
 * Same pattern as usePersonalDataHub-bilibili-adb.test.js.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 2a douyinAdbSync", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("sends douyin-adb-sync with empty payload + 60s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        report: {
          adapter: "social-douyin",
          status: "ok",
          rawCount: 0,
          douyin: {
            uid: "1234567890123456789",
            eventCounts: { message: 0, contact: 0, total: 0 },
            parserDiagnostic: { hadMsgTable: true, hadSimpleUserTable: true },
            cleanupFailed: false,
          },
        },
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.douyinAdbSync();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.douyin-adb-sync");
    expect(timeout).toBe(60_000);
    expect(envelope.uid).toBeUndefined();
    expect(envelope.limits).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it("forwards uid + limits + stagingDir + displayName", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, report: {} } });
    const hub = usePersonalDataHub();
    await hub.douyinAdbSync({
      uid: "1234567890123456789",
      limits: { messages: 500, contacts: 100 },
      stagingDir: "/tmp/x",
      displayName: "alice",
    });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.uid).toBe("1234567890123456789");
    expect(envelope.limits).toEqual({ messages: 500, contacts: 100 });
    expect(envelope.stagingDir).toBe("/tmp/x");
    expect(envelope.displayName).toBe("alice");
  });

  it("propagates typed-reason failure verbatim", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: false,
        reason: "DOUYIN_NO_ROOT",
        message: "su returned uid=2000",
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.douyinAdbSync();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("DOUYIN_NO_ROOT");
  });

  it("rethrows transport-level WS errors", async () => {
    sendRaw.mockResolvedValueOnce({ error: "ws disconnected" });
    const hub = usePersonalDataHub();
    await expect(hub.douyinAdbSync()).rejects.toThrow(/ws disconnected/);
  });
});
