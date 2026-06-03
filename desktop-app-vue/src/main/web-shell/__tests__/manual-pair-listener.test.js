/**
 * `manual-pair-listener` 单元测试 — iOS Phase 1.6 桌面 follow-up。
 *
 * 覆盖：
 *   - ManualPairAliasListener.start()：发送 register 含正确 peerId + role
 *   - 收到 type=message + payload.type=pair-ack → 触发 onPairAck callback
 *   - 收到无关消息（registered/pong/peer-status）→ 不触发
 *   - 收到 type=message 但 payload.type 不是 pair-ack → 不触发
 *   - stop() 关闭 ws 且 stopped 后 onopen 不再 register
 *   - startManualPairAliasListeners()：开 LAN+relay 两条，handle.stop() 关全部
 *   - 使用注入的 WebSocketImpl stub（不开真 socket）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  ManualPairAliasListener,
  startManualPairAliasListeners,
} = require("../handlers/manual-pair-listener.js");

/**
 * Fake WebSocket 模拟 — 实现 ws 库的 EventEmitter API + send/close。
 * 测试可 trigger fake.fireOpen() / fake.fireMessage(json) 模拟入站。
 */
class FakeWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
    FakeWebSocket._lastInstance = this;
    FakeWebSocket._instances.push(this);
  }
  send(data) {
    if (this.closed) {
      throw new Error("send after close");
    }
    this.sent.push(data);
  }
  close(code, reason) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    // 模拟 ws 库的 close event 异步触发
    queueMicrotask(() => this.emit("close", code, reason));
  }
  // 测试触发器
  fireOpen() {
    this.emit("open");
  }
  fireMessage(json) {
    this.emit(
      "message",
      Buffer.from(typeof json === "string" ? json : JSON.stringify(json)),
    );
  }
  fireError(err) {
    this.emit("error", err);
  }
}
FakeWebSocket._instances = [];
FakeWebSocket._lastInstance = null;

beforeEach(() => {
  FakeWebSocket._instances = [];
  FakeWebSocket._lastInstance = null;
});

describe("ManualPairAliasListener", () => {
  it("constructor throws without url or code", () => {
    expect(() => new ManualPairAliasListener({ code: "123456" })).toThrow(
      /url/,
    );
    expect(() => new ManualPairAliasListener({ url: "ws://x" })).toThrow(
      /code/,
    );
  });

  it("start() opens WS to given url and aliasPeerId derived from code", () => {
    const listener = new ManualPairAliasListener({
      url: "ws://test:9001",
      code: "654321",
      onPairAck: vi.fn(),
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    expect(FakeWebSocket._lastInstance).not.toBeNull();
    expect(FakeWebSocket._lastInstance.url).toBe("ws://test:9001");
    expect(listener.aliasPeerId).toBe("pairing-code:654321");
  });

  it("on open: sends register with correct peerId, deviceType, role", () => {
    const listener = new ManualPairAliasListener({
      url: "ws://test:9001",
      code: "987654",
      onPairAck: vi.fn(),
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    FakeWebSocket._lastInstance.fireOpen();
    expect(FakeWebSocket._lastInstance.sent).toHaveLength(1);
    const sent = JSON.parse(FakeWebSocket._lastInstance.sent[0]);
    expect(sent.type).toBe("register");
    expect(sent.peerId).toBe("pairing-code:987654");
    expect(sent.deviceType).toBe("desktop");
    expect(sent.deviceInfo.role).toBe("manual-pair-alias");
    expect(sent.deviceInfo.code).toBe("987654");
  });

  it("inbound type=message + payload.type=pair-ack triggers onPairAck", () => {
    const onPairAck = vi.fn();
    const listener = new ManualPairAliasListener({
      url: "ws://test",
      code: "111222",
      onPairAck,
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    FakeWebSocket._lastInstance.fireOpen();
    FakeWebSocket._lastInstance.fireMessage({
      type: "message",
      from: "did:cc:abc",
      payload: {
        type: "pair-ack",
        pairingCode: "111222",
        mobileDid: "did:cc:abc",
        deviceInfo: { name: "iPhone", platform: "ios" },
        timestamp: 1700000000000,
      },
    });
    expect(onPairAck).toHaveBeenCalledTimes(1);
    const call = onPairAck.mock.calls[0][0];
    expect(call.type).toBe("pair-ack");
    expect(call.pairingCode).toBe("111222");
    expect(call.mobileDid).toBe("did:cc:abc");
  });

  it("inbound type=registered does NOT trigger onPairAck", () => {
    const onPairAck = vi.fn();
    const listener = new ManualPairAliasListener({
      url: "ws://test",
      code: "111111",
      onPairAck,
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    FakeWebSocket._lastInstance.fireOpen();
    FakeWebSocket._lastInstance.fireMessage({
      type: "registered",
      peerId: "pairing-code:111111",
    });
    FakeWebSocket._lastInstance.fireMessage({ type: "pong", timestamp: 0 });
    FakeWebSocket._lastInstance.fireMessage({
      type: "peer-status",
      peerId: "x",
      status: "online",
    });
    expect(onPairAck).not.toHaveBeenCalled();
  });

  it("inbound type=message but payload.type != pair-ack does NOT trigger onPairAck", () => {
    const onPairAck = vi.fn();
    const listener = new ManualPairAliasListener({
      url: "ws://test",
      code: "222222",
      onPairAck,
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    FakeWebSocket._lastInstance.fireOpen();
    FakeWebSocket._lastInstance.fireMessage({
      type: "message",
      from: "x",
      payload: { type: "ice-candidate", candidate: "..." },
    });
    expect(onPairAck).not.toHaveBeenCalled();
  });

  it("malformed JSON inbound is ignored (no throw)", () => {
    const onPairAck = vi.fn();
    const listener = new ManualPairAliasListener({
      url: "ws://test",
      code: "333333",
      onPairAck,
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    FakeWebSocket._lastInstance.fireOpen();
    expect(() => {
      FakeWebSocket._lastInstance.emit("message", Buffer.from("not-json"));
    }).not.toThrow();
    expect(onPairAck).not.toHaveBeenCalled();
  });

  it("stop() closes the ws", () => {
    const listener = new ManualPairAliasListener({
      url: "ws://test",
      code: "444444",
      onPairAck: vi.fn(),
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    expect(FakeWebSocket._lastInstance.closed).toBe(false);
    listener.stop();
    expect(FakeWebSocket._lastInstance.closed).toBe(true);
    expect(FakeWebSocket._lastInstance.closeCode).toBe(1000);
  });

  it("stop() before open: does not register on subsequent open", () => {
    const listener = new ManualPairAliasListener({
      url: "ws://test",
      code: "555555",
      onPairAck: vi.fn(),
      WebSocketImpl: FakeWebSocket,
    });
    listener.start();
    listener.stop(); // 在 fireOpen 前就 stop
    FakeWebSocket._lastInstance.fireOpen();
    expect(FakeWebSocket._lastInstance.sent).toHaveLength(0);
  });

  it("does not throw when WebSocket constructor throws", () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error("connect failed");
      }
    }
    const listener = new ManualPairAliasListener({
      url: "ws://broken",
      code: "666666",
      onPairAck: vi.fn(),
      WebSocketImpl: ThrowingWebSocket,
    });
    expect(() => listener.start()).not.toThrow();
    expect(listener.ws).toBeNull();
  });
});

describe("startManualPairAliasListeners", () => {
  it("opens 2 listeners (LAN + relay) with same code", () => {
    const handle = startManualPairAliasListeners({
      code: "777777",
      onPairAck: vi.fn(),
      lanUrl: "ws://lan:9001",
      relayUrl: "wss://relay.example",
      WebSocketImpl: FakeWebSocket,
    });
    expect(handle.listeners).toHaveLength(2);
    expect(FakeWebSocket._instances).toHaveLength(2);
    expect(FakeWebSocket._instances[0].url).toBe("ws://lan:9001");
    expect(FakeWebSocket._instances[1].url).toBe("wss://relay.example");
    expect(handle.listeners[0].aliasPeerId).toBe("pairing-code:777777");
    expect(handle.listeners[1].aliasPeerId).toBe("pairing-code:777777");
  });

  it("handle.stop() closes both listeners", () => {
    const handle = startManualPairAliasListeners({
      code: "888888",
      onPairAck: vi.fn(),
      lanUrl: "ws://lan",
      relayUrl: "ws://relay",
      WebSocketImpl: FakeWebSocket,
    });
    handle.stop();
    expect(FakeWebSocket._instances[0].closed).toBe(true);
    expect(FakeWebSocket._instances[1].closed).toBe(true);
  });

  it("either listener receiving pair-ack triggers shared onPairAck", () => {
    const onPairAck = vi.fn();
    startManualPairAliasListeners({
      code: "999000",
      onPairAck,
      lanUrl: "ws://lan",
      relayUrl: "ws://relay",
      WebSocketImpl: FakeWebSocket,
    });
    // 模拟 relay 收到（[1]）
    FakeWebSocket._instances[1].fireOpen();
    FakeWebSocket._instances[1].fireMessage({
      type: "message",
      from: "did:cc:x",
      payload: {
        type: "pair-ack",
        pairingCode: "999000",
        mobileDid: "did:cc:x",
      },
    });
    expect(onPairAck).toHaveBeenCalledTimes(1);
    expect(onPairAck.mock.calls[0][0].pairingCode).toBe("999000");
  });

  it("throws if code missing", () => {
    expect(() => startManualPairAliasListeners({ onPairAck: vi.fn() })).toThrow(
      /code/,
    );
  });
});
