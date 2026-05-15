/**
 * `desktop.pair.*` WS handlers 单元测试 — Android v1.1 W3.7 Flow B (issue #19)。
 *
 * 覆盖：
 *   - generate-qr：mobileBridge 缺/null → throw；happy path 用 mobileBridge.peerId；
 *     mobileBridge.peerId null 时 fallback deviceManager.getCurrentDevice；
 *     都 null 时 fallback "desktop-unknown"；payload 字段完整
 *   - poll-ack：idle / waiting / acked / expired 四态
 *   - reset：清 session
 *   - recordPairAck：无 session → drop；code 不匹配 → drop；happy path → stored
 *
 * 注意 module-level sessionState 在每个测试间用 _resetSession 清。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// iOS Phase 1.6 follow-up — mock manual-pair-listener 避免测试时打开真 WS
// 连接 (LAN ws://localhost:9001 + relay wss://signaling.chainlesschain.com)。
// 注意：vi.mock 会被 hoist 到 import 之前。
vi.mock("../handlers/manual-pair-listener.js", () => ({
  startManualPairAliasListeners: vi.fn(() => ({
    listeners: [],
    stop: vi.fn(),
  })),
  ManualPairAliasListener: class {
    constructor() {}
    start() {}
    stop() {}
  },
}));

const {
  createDesktopPairGenerateHandler,
  createDesktopPairPollAckHandler,
  createDesktopPairResetHandler,
  recordPairAck,
  _sessionState,
  _resetSession,
} = require("../handlers/desktop-pair-handlers.js");

beforeEach(() => {
  _resetSession();
});

function makeMobileBridge(opts = {}) {
  return { peerId: opts.peerId !== undefined ? opts.peerId : "desktop-peer-1" };
}

function makeDeviceManager(deviceId) {
  return {
    getCurrentDevice: () => (deviceId ? { deviceId } : null),
  };
}

describe("createDesktopPairGenerateHandler", () => {
  it("throws when getMobileBridge missing", async () => {
    const handler = createDesktopPairGenerateHandler({});
    await expect(handler({})).rejects.toThrow(/mobile_bridge_unavailable/);
  });

  it("throws when getMobileBridge returns null", async () => {
    const handler = createDesktopPairGenerateHandler({
      getMobileBridge: () => null,
    });
    await expect(handler({})).rejects.toThrow(/mobile_bridge_unavailable/);
  });

  it("happy path: uses mobileBridge.peerId and emits 6-digit code", async () => {
    const handler = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge({ peerId: "abc-123" }),
    });
    const result = await handler({});
    expect(result.payload.type).toBe("desktop-pairing");
    expect(result.payload.pcPeerId).toBe("abc-123");
    expect(result.payload.code).toMatch(/^\d{6}$/);
    expect(result.payload.deviceInfo).toBeDefined();
    expect(typeof result.payload.timestamp).toBe("number");
    expect(typeof result.payloadJson).toBe("string");
    expect(JSON.parse(result.payloadJson).code).toBe(result.payload.code);

    // sessionState updated
    expect(_sessionState.code).toBe(result.payload.code);
    expect(_sessionState.pcPeerId).toBe("abc-123");
    expect(_sessionState.ack).toBeNull();
  });

  it("falls back to deviceManager.getCurrentDevice when bridge.peerId null", async () => {
    const handler = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge({ peerId: null }),
      getDeviceManager: () => makeDeviceManager("device-xyz"),
    });
    const result = await handler({});
    expect(result.payload.pcPeerId).toBe("device-xyz");
  });

  it("falls back to 'desktop-unknown' when bridge.peerId and deviceManager both empty", async () => {
    const handler = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge({ peerId: null }),
      getDeviceManager: () => makeDeviceManager(null),
    });
    const result = await handler({});
    expect(result.payload.pcPeerId).toBe("desktop-unknown");
  });

  it("regenerating overwrites prior session", async () => {
    const handler = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    const r1 = await handler({});
    const r2 = await handler({});
    expect(r1.payload.code).not.toBe(r2.payload.code);
    expect(_sessionState.code).toBe(r2.payload.code);
  });
});

describe("createDesktopPairPollAckHandler", () => {
  it("returns idle when no active session", async () => {
    const handler = createDesktopPairPollAckHandler();
    const r = await handler({});
    expect(r).toEqual({ status: "idle" });
  });

  it("returns waiting when session active but no ack yet", async () => {
    const gen = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await gen({});

    const poll = createDesktopPairPollAckHandler();
    const r = await poll({});
    expect(r.status).toBe("waiting");
    expect(r.code).toBe(_sessionState.code);
  });

  it("returns acked with ack payload after recordPairAck", async () => {
    const gen = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    const genRes = await gen({});
    const ackPayload = {
      type: "pair-ack",
      pairingCode: genRes.payload.code,
      mobileDid: "did:cc:phone",
      deviceInfo: { deviceId: "m-1", name: "Phone", platform: "android" },
      timestamp: Date.now(),
    };
    const ok = recordPairAck(ackPayload);
    expect(ok).toBe(true);

    const poll = createDesktopPairPollAckHandler();
    const r = await poll({});
    expect(r.status).toBe("acked");
    expect(r.ack.mobileDid).toBe("did:cc:phone");
    expect(r.ack.pairingCode).toBe(genRes.payload.code);
    expect(typeof r.receivedAt).toBe("number");
  });

  it("returns expired when 5min passed without ack", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const gen = createDesktopPairGenerateHandler({
        getMobileBridge: () => makeMobileBridge(),
      });
      await gen({});

      vi.setSystemTime(1_700_000_000_000 + 6 * 60 * 1000);
      const poll = createDesktopPairPollAckHandler();
      const r = await poll({});
      expect(r.status).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createDesktopPairResetHandler", () => {
  it("clears session and returns ok:true", async () => {
    const gen = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await gen({});
    expect(_sessionState.code).not.toBeNull();

    const reset = createDesktopPairResetHandler();
    const r = await reset({});
    expect(r).toEqual({ ok: true });
    expect(_sessionState.code).toBeNull();
    expect(_sessionState.pcPeerId).toBeNull();
    expect(_sessionState.ack).toBeNull();
  });
});

describe("recordPairAck", () => {
  it("drops ack when no active session", () => {
    const ok = recordPairAck({
      type: "pair-ack",
      pairingCode: "123456",
      mobileDid: "did:cc:phone",
    });
    expect(ok).toBe(false);
  });

  it("drops ack on pairingCode mismatch", async () => {
    const gen = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await gen({});
    const ok = recordPairAck({
      type: "pair-ack",
      pairingCode: "000000",
      mobileDid: "did:cc:phone",
    });
    expect(ok).toBe(false);
    expect(_sessionState.ack).toBeNull();
  });

  it("drops ack when payload missing pairingCode", async () => {
    const gen = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    await gen({});
    const ok = recordPairAck({ type: "pair-ack", mobileDid: "did:cc:phone" });
    expect(ok).toBe(false);
  });

  it("records ack with receivedAt timestamp on match", async () => {
    const gen = createDesktopPairGenerateHandler({
      getMobileBridge: () => makeMobileBridge(),
    });
    const genRes = await gen({});
    const before = Date.now();
    const ok = recordPairAck({
      type: "pair-ack",
      pairingCode: genRes.payload.code,
      mobileDid: "did:cc:phone",
      deviceInfo: { deviceId: "m-1", name: "Phone", platform: "android" },
      timestamp: before,
    });
    const after = Date.now();
    expect(ok).toBe(true);
    expect(_sessionState.ack.mobileDid).toBe("did:cc:phone");
    expect(_sessionState.ack.receivedAt).toBeGreaterThanOrEqual(before);
    expect(_sessionState.ack.receivedAt).toBeLessThanOrEqual(after);
  });
});
