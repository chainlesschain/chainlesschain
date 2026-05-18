/**
 * mobile.pair.send-confirmation WS handler 单元测试 — Android v1.1 W3.6
 * (issue #19)。
 *
 * 验证：
 *   - frame.qrPayload 缺/不是 object/缺 did/缺 code → throw
 *   - mobileBridge 未就绪 → throw "mobile_bridge_unavailable"
 *   - mobileBridge.isConnected=false → throw "signaling_server_disconnected"
 *   - happy path：调 mobileBridge.send 用正确 shape；返 {ok:true}
 *   - p2pManager null 时 pcPeerId 兜底 "desktop-unknown"
 */

import { describe, it, expect, vi } from "vitest";

const {
  createMobilePairConfirmationHandler,
} = require("../handlers/mobile-pair-handlers");

const VALID_PAYLOAD = {
  type: "device-pairing",
  code: "123456",
  did: "did:cc:phone-test",
  deviceInfo: {
    deviceId: "android-test-abc",
    name: "Pixel Test",
    platform: "android",
  },
  timestamp: 1_700_000_000_000,
};

function makeMobileBridge({ isConnected = true, sendImpl = () => {} } = {}) {
  return {
    isConnected,
    send: vi.fn(sendImpl),
  };
}

describe("mobile.pair.send-confirmation handler", () => {
  it("throws when frame.qrPayload missing", async () => {
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await expect(handler({})).rejects.toThrow(/qrPayload required/);
  });

  it("throws when qrPayload is not an object", async () => {
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await expect(handler({ qrPayload: "not-an-object" })).rejects.toThrow(
      /qrPayload required/,
    );
  });

  it("throws when qrPayload.did missing", async () => {
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await expect(
      handler({ qrPayload: { ...VALID_PAYLOAD, did: undefined } }),
    ).rejects.toThrow(/did required/);
  });

  it("throws when qrPayload.code missing", async () => {
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await expect(
      handler({ qrPayload: { ...VALID_PAYLOAD, code: "" } }),
    ).rejects.toThrow(/code required/);
  });

  it("throws mobile_bridge_unavailable when getMobileBridge returns null", async () => {
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => null,
    });
    await expect(handler({ qrPayload: VALID_PAYLOAD })).rejects.toThrow(
      /mobile_bridge_unavailable/,
    );
  });

  it("throws signaling_server_disconnected when bridge.isConnected=false", async () => {
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => makeMobileBridge({ isConnected: false }),
    });
    await expect(handler({ qrPayload: VALID_PAYLOAD })).rejects.toThrow(
      /signaling_server_disconnected/,
    );
  });

  it("happy path: calls bridge.send with correct shape and returns ok:true", async () => {
    const bridge = makeMobileBridge();
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => bridge,
      getP2pManager: () => ({ peerId: "desktop-peer-xyz" }),
    });
    const result = await handler({ qrPayload: VALID_PAYLOAD });

    expect(result).toEqual({ ok: true });
    expect(bridge.send).toHaveBeenCalledTimes(1);
    const sent = bridge.send.mock.calls[0][0];
    expect(sent.type).toBe("message");
    expect(sent.to).toBe("did:cc:phone-test");
    expect(sent.payload.type).toBe("pairing:confirmation");
    expect(sent.payload.pairingCode).toBe("123456");
    expect(sent.payload.pcPeerId).toBe("desktop-peer-xyz");
    expect(sent.payload.deviceInfo.platform).toBe(process.platform);
    expect(typeof sent.payload.timestamp).toBe("number");
  });

  it("pcPeerId falls back to 'desktop-unknown' when p2pManager null", async () => {
    const bridge = makeMobileBridge();
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => bridge,
      // No getP2pManager
    });
    await handler({ qrPayload: VALID_PAYLOAD });
    expect(bridge.send.mock.calls[0][0].payload.pcPeerId).toBe(
      "desktop-unknown",
    );
  });

  it("late-binding: getMobileBridge called each invocation (re-resolves null→ready)", async () => {
    let bridge = null;
    const handler = createMobilePairConfirmationHandler({
      getMobileBridge: () => bridge,
    });
    // First call — bridge not ready
    await expect(handler({ qrPayload: VALID_PAYLOAD })).rejects.toThrow(
      /mobile_bridge_unavailable/,
    );
    // Late binding: bridge becomes available
    bridge = makeMobileBridge();
    const result = await handler({ qrPayload: VALID_PAYLOAD });
    expect(result).toEqual({ ok: true });
  });
});
