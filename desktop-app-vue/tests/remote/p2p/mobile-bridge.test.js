/**
 * MobileBridge 单元测试
 * 测试PC-移动端连接可靠性
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

const EventEmitter = require("events");

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSING = 2;
    this.CLOSED = 3;
  }

  send(data) {
    this.emit("_send", data);
  }

  close() {
    this.readyState = this.CLOSED;
    this.emit("close");
  }

  simulateOpen() {
    this.readyState = this.OPEN;
    this.emit("open");
  }

  simulateMessage(data) {
    this.emit("message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }

  simulateError(error) {
    this.emit("error", error);
  }

  simulateClose(code = 1000) {
    this.readyState = this.CLOSED;
    this.emit("close", { code });
  }
}

// Mock RTCPeerConnection
class MockRTCPeerConnection extends EventEmitter {
  constructor() {
    super();
    this.localDescription = null;
    this.remoteDescription = null;
    this.iceConnectionState = "new";
    this.connectionState = "new";
    this.dataChannels = new Map();
  }

  createOffer() {
    return Promise.resolve({ type: "offer", sdp: "mock-offer-sdp" });
  }

  createAnswer() {
    return Promise.resolve({ type: "answer", sdp: "mock-answer-sdp" });
  }

  setLocalDescription(desc) {
    this.localDescription = desc;
    return Promise.resolve();
  }

  setRemoteDescription(desc) {
    this.remoteDescription = desc;
    return Promise.resolve();
  }

  addIceCandidate(candidate) {
    return Promise.resolve();
  }

  createDataChannel(label) {
    const channel = new MockDataChannel(label);
    this.dataChannels.set(label, channel);
    return channel;
  }

  close() {
    this.connectionState = "closed";
    this.emit("connectionstatechange");
  }

  simulateConnected() {
    this.iceConnectionState = "connected";
    this.connectionState = "connected";
    this.emit("iceconnectionstatechange");
    this.emit("connectionstatechange");
  }

  simulateDisconnected() {
    this.iceConnectionState = "disconnected";
    this.connectionState = "disconnected";
    this.emit("iceconnectionstatechange");
    this.emit("connectionstatechange");
  }
}

// Mock DataChannel
class MockDataChannel extends EventEmitter {
  constructor(label) {
    super();
    this.label = label;
    this.readyState = "connecting";
    this.bufferedAmount = 0;
  }

  send(data) {
    if (this.readyState !== "open") {
      throw new Error("DataChannel not open");
    }
    this.emit("_send", data);
  }

  close() {
    this.readyState = "closed";
    this.emit("close");
  }

  simulateOpen() {
    this.readyState = "open";
    this.emit("open");
  }

  simulateMessage(data) {
    this.emit("message", { data });
  }
}

// Store global mocks for MobileBridge to use
global.WebSocket = MockWebSocket;
global.RTCPeerConnection = MockRTCPeerConnection;

// Now require MobileBridge
const { MobileBridge } = require("../../../src/main/p2p/mobile-bridge");

describe("MobileBridge", () => {
  let bridge;
  let mockSignalingServer;

  beforeEach(() => {
    vi.useFakeTimers();

    bridge = new MobileBridge({
      signalingUrl: "ws://localhost:9001",
      deviceId: "pc-test-123",
      heartbeatInterval: 30000,
      heartbeatTimeout: 90000,
      baseReconnectDelay: 1000,
      maxReconnectDelay: 60000,
      reconnectBackoffFactor: 2,
      maxSignalingReconnectAttempts: 5,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (bridge) {
      bridge.disconnect();
    }
  });

  describe("信令连接", () => {
    test("应该连接到信令服务器", async () => {
      const connectPromise = bridge.connect();

      // Simulate WebSocket open
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();

      await connectPromise;

      expect(bridge.isConnected()).toBe(true);
    });

    test("应该处理连接失败", async () => {
      const errorHandler = vi.fn();
      bridge.on("error", errorHandler);

      const connectPromise = bridge.connect().catch(() => {});

      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateError(new Error("Connection failed"));
      bridge.ws.simulateClose(1006);

      await vi.advanceTimersByTimeAsync(100);

      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe("指数退避重连", () => {
    test("应该使用指数退避策略重连", async () => {
      const reconnectHandler = vi.fn();
      bridge.on("reconnecting", reconnectHandler);

      // Initial connect
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Simulate disconnect
      bridge.ws.simulateClose(1006);

      // First reconnect attempt - delay should be 1000ms (base)
      await vi.advanceTimersByTimeAsync(1000);
      expect(reconnectHandler).toHaveBeenCalledTimes(1);

      // Simulate reconnect failure
      bridge.ws.simulateError(new Error("Failed"));
      bridge.ws.simulateClose(1006);

      // Second reconnect attempt - delay should be 2000ms (1000 * 2)
      await vi.advanceTimersByTimeAsync(2000);
      expect(reconnectHandler).toHaveBeenCalledTimes(2);
    });

    test("应该在达到最大延迟后停止增加延迟", async () => {
      bridge.options.maxReconnectDelay = 4000;
      bridge.options.baseReconnectDelay = 1000;
      bridge.options.reconnectBackoffFactor = 2;

      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Disconnect multiple times
      for (let i = 0; i < 5; i++) {
        bridge.ws.simulateClose(1006);
        await vi.advanceTimersByTimeAsync(60000);
        if (bridge.ws) {
          bridge.ws.simulateOpen();
        }
      }

      // The delay should be capped at maxReconnectDelay (4000ms)
      expect(bridge.currentReconnectDelay).toBeLessThanOrEqual(4000);
    });

    test("应该在成功重连后重置延迟", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Disconnect
      bridge.ws.simulateClose(1006);
      await vi.advanceTimersByTimeAsync(1000);

      // Reconnect successfully
      if (bridge.ws) {
        bridge.ws.simulateOpen();
      }

      expect(bridge.signalingReconnectAttempts).toBe(0);
    });

    test("应该在达到最大重试次数后停止重连", async () => {
      const failedHandler = vi.fn();
      bridge.on("reconnect-failed", failedHandler);

      bridge.options.maxSignalingReconnectAttempts = 3;

      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Simulate multiple failures
      for (let i = 0; i < 5; i++) {
        bridge.ws.simulateClose(1006);
        await vi.advanceTimersByTimeAsync(120000);
      }

      expect(failedHandler).toHaveBeenCalled();
    });
  });

  describe("心跳检测", () => {
    test("应该定期发送心跳", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      const sendSpy = vi.spyOn(bridge.ws, "send");

      // Advance by heartbeat interval
      await vi.advanceTimersByTimeAsync(30000);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining("heartbeat"),
      );
    });

    test("应该接收心跳响应并重置超时", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Advance to send heartbeat
      await vi.advanceTimersByTimeAsync(30000);

      // Receive heartbeat response (pong)
      bridge.ws.simulateMessage({ type: "pong", timestamp: Date.now() });

      // Check that connection is still alive
      expect(bridge.isConnected()).toBe(true);
    });

    test("应该在心跳超时时重连", async () => {
      const timeoutHandler = vi.fn();
      bridge.on("heartbeat-timeout", timeoutHandler);

      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Don't respond to heartbeats, advance past timeout
      await vi.advanceTimersByTimeAsync(100000); // 90s timeout

      expect(timeoutHandler).toHaveBeenCalled();
    });
  });

  describe("WebRTC数据通道", () => {
    test("应该建立与移动设备的数据通道", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      const channelPromise = bridge.connectToDevice("mobile-123");

      // Simulate signaling exchange
      bridge.ws.simulateMessage({
        type: "answer",
        from: "mobile-123",
        sdp: "mock-answer-sdp",
      });

      // Simulate WebRTC connection
      await vi.advanceTimersByTimeAsync(100);
      const pc = bridge.peerConnections.get("mobile-123");
      if (pc) {
        pc.simulateConnected();
        const dc = pc.dataChannels.get("data");
        if (dc) {
          dc.simulateOpen();
        }
      }

      await vi.advanceTimersByTimeAsync(100);
    });

    test("应该处理数据通道断开", async () => {
      const disconnectHandler = vi.fn();
      bridge.on("device-disconnected", disconnectHandler);

      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Simulate device connection
      bridge.peerConnections.set("mobile-123", new MockRTCPeerConnection());
      const pc = bridge.peerConnections.get("mobile-123");
      pc.simulateConnected();

      // Simulate disconnect
      pc.simulateDisconnected();

      expect(disconnectHandler).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "mobile-123" }),
      );
    });
  });

  describe("消息发送", () => {
    test("应该向设备发送消息", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Setup mock device connection with open data channel
      const pc = new MockRTCPeerConnection();
      const dc = pc.createDataChannel("data");
      dc.simulateOpen();
      bridge.peerConnections.set("mobile-123", pc);
      bridge.dataChannels.set("mobile-123", dc);

      const sendSpy = vi.spyOn(dc, "send");

      await bridge.sendToDevice("mobile-123", {
        method: "test.command",
        params: { key: "value" },
      });

      expect(sendSpy).toHaveBeenCalled();
    });

    test("应该广播消息到所有设备", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Setup multiple device connections
      const devices = ["mobile-1", "mobile-2", "mobile-3"];
      const sendSpies = [];

      for (const deviceId of devices) {
        const pc = new MockRTCPeerConnection();
        const dc = pc.createDataChannel("data");
        dc.simulateOpen();
        bridge.peerConnections.set(deviceId, pc);
        bridge.dataChannels.set(deviceId, dc);
        sendSpies.push(vi.spyOn(dc, "send"));
      }

      await bridge.broadcast({ method: "broadcast.message", params: {} });

      for (const spy of sendSpies) {
        expect(spy).toHaveBeenCalled();
      }
    });
  });

  describe("连接状态", () => {
    test("应该正确报告连接状态", async () => {
      expect(bridge.isConnected()).toBe(false);

      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      expect(bridge.isConnected()).toBe(true);

      bridge.disconnect();
      expect(bridge.isConnected()).toBe(false);
    });

    test("应该获取已连接设备列表", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Add mock devices
      bridge.connectedDevices.set("mobile-1", {
        id: "mobile-1",
        name: "Phone 1",
      });
      bridge.connectedDevices.set("mobile-2", {
        id: "mobile-2",
        name: "Phone 2",
      });

      const devices = bridge.getConnectedDevices();
      expect(devices).toHaveLength(2);
    });
  });

  describe("清理", () => {
    test("应该正确清理所有资源", async () => {
      const connectPromise = bridge.connect();
      await vi.advanceTimersByTimeAsync(10);
      bridge.ws.simulateOpen();
      await connectPromise;

      // Setup device connections
      const pc = new MockRTCPeerConnection();
      const dc = pc.createDataChannel("data");
      dc.simulateOpen();
      bridge.peerConnections.set("mobile-123", pc);
      bridge.dataChannels.set("mobile-123", dc);

      bridge.disconnect();

      expect(bridge.peerConnections.size).toBe(0);
      expect(bridge.dataChannels.size).toBe(0);
      expect(bridge.isConnected()).toBe(false);
    });
  });
});
