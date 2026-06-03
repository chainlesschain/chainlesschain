/**
 * Phase 12.6.10 — composable WeChat methods route to the right WS topics.
 *
 * Mocks useWsStore to capture sendRaw payloads so we never need a real
 * connection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendRaw = vi.fn();

vi.mock("../../src/stores/ws.js", () => ({
  useWsStore: () => ({
    sendRaw: (...args) => sendRaw(...args),
  }),
}));

import { usePersonalDataHub } from "../../src/composables/usePersonalDataHub.js";

describe("usePersonalDataHub — Phase 12.6.10 WeChat wizard topics", () => {
  beforeEach(() => {
    sendRaw.mockReset();
  });

  it("probeWechatEnv sends wechat-env-probe with empty payload + 15s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: {
        ok: true,
        suggestedKeyProvider: "md5",
        reasons: [],
        device: { reachable: true, serial: "X", abi: "arm64-v8a" },
        root: { detected: false, magiskInstalled: false },
        frida: { serverRunning: false, port: null },
        wechat: { installed: true, versionName: "7.0.22", majorVersion: 7 },
        warnings: [],
      },
    });
    const hub = usePersonalDataHub();
    const r = await hub.probeWechatEnv();
    expect(sendRaw).toHaveBeenCalledOnce();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.wechat-env-probe");
    expect(timeout).toBe(15_000);
    expect(r.suggestedKeyProvider).toBe("md5");
  });

  it("registerWechat sends register-wechat with all 5 fields + 45s timeout", async () => {
    sendRaw.mockResolvedValueOnce({
      result: { ok: true, name: "wechat", chosenKeyProvider: "md5", sensitivity: "high" },
    });
    const hub = usePersonalDataHub();
    await hub.registerWechat({
      account: { uin: "1234567890" },
      dbPath: "/tmp/EnMicroMsg.db",
      wechatDataPath: "/tmp/com.tencent.mm",
      fridaOpts: { deviceId: "A" },
      keyProviderOverride: "md5",
    });
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.register-wechat");
    expect(envelope.account).toEqual({ uin: "1234567890" });
    expect(envelope.dbPath).toBe("/tmp/EnMicroMsg.db");
    expect(envelope.wechatDataPath).toBe("/tmp/com.tencent.mm");
    expect(envelope.fridaOpts).toEqual({ deviceId: "A" });
    expect(envelope.keyProviderOverride).toBe("md5");
    expect(timeout).toBe(45_000);
  });

  it("registerWechat passes account.uin verbatim with no fabricated defaults", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true } });
    const hub = usePersonalDataHub();
    await hub.registerWechat({ account: { uin: "X" } });
    const [envelope] = sendRaw.mock.calls[0];
    expect(envelope.account).toEqual({ uin: "X" });
    // The composable forwards undefined for absent keys (don't fabricate
    // values — the server treats undefined and null the same way).
    expect(envelope.dbPath).toBeUndefined();
    expect(envelope.wechatDataPath).toBeUndefined();
  });

  it("listWechatAccounts sends list-wechat-accounts with 5s timeout", async () => {
    sendRaw.mockResolvedValueOnce({ result: [{ uin: "1", chosenKeyProvider: "md5" }] });
    const hub = usePersonalDataHub();
    const r = await hub.listWechatAccounts();
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.list-wechat-accounts");
    expect(timeout).toBe(5_000);
    expect(r).toEqual([{ uin: "1", chosenKeyProvider: "md5" }]);
  });

  it("unregisterWechat sends unregister-wechat with uin", async () => {
    sendRaw.mockResolvedValueOnce({ result: { ok: true, removed: true, uin: "X" } });
    const hub = usePersonalDataHub();
    const r = await hub.unregisterWechat("X");
    const [envelope, timeout] = sendRaw.mock.calls[0];
    expect(envelope.type).toBe("personal-data-hub.unregister-wechat");
    expect(envelope.uin).toBe("X");
    expect(timeout).toBe(5_000);
    expect(r.removed).toBe(true);
  });

  it("unwraps error envelope by throwing", async () => {
    sendRaw.mockResolvedValueOnce({ error: "BOOM" });
    const hub = usePersonalDataHub();
    await expect(hub.probeWechatEnv()).rejects.toThrow(/BOOM/);
  });
});
