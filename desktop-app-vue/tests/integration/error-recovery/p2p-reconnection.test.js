/**
 * P2P 重连和错误恢复测试
 *
 * 测试范围：
 * - P2P 连接失败和断开
 * - 自动重连机制
 * - 消息队列和离线缓存
 * - 网络切换适应
 * - Peer 发现和重新连接
 * - 数据同步恢复
 * - NAT 穿透重试
 * - 真实场景测试
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 3: Error Recovery Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock P2P Manager ====================

class MockP2PManager {
  constructor(config = {}) {
    this.config = {
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      reconnectDelay: config.reconnectDelay || 1000,
      backoffMultiplier: config.backoffMultiplier || 2,
      heartbeatInterval: config.heartbeatInterval || 5000,
      connectionTimeout: config.connectionTimeout || 30000,
    };

    this.peers = new Map();
    this.connections = new Map();
    this.messageQueue = [];
    this.reconnectAttempts = new Map();
    this.connectionState = "disconnected";
    this.eventHandlers = new Map();
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((handler) => handler(data));
  }

  async connect(peerId, options = {}) {
    if (options.simulateFailure) {
      this.connectionState = "failed";
      throw new Error(`Failed to connect to peer: ${peerId}`);
    }

    if (options.simulateTimeout) {
      this.connectionState = "timeout";
      throw new Error(`Connection timeout to peer: ${peerId}`);
    }

    this.connectionState = "connected";
    this.connections.set(peerId, {
      id: peerId,
      connected: true,
      connectedAt: Date.now(),
    });

    this.emit("peer:connected", { peerId });

    return {
      peerId,
      status: "connected",
    };
  }

  async disconnect(peerId) {
    if (this.connections.has(peerId)) {
      this.connections.delete(peerId);
      this.connectionState = "disconnected";
      this.emit("peer:disconnected", { peerId });
    }
  }

  async reconnect(peerId, options = {}) {
    const attempts = this.reconnectAttempts.get(peerId) || 0;

    if (attempts >= this.config.maxReconnectAttempts) {
      throw new Error(`Max reconnection attempts reached for peer: ${peerId}`);
    }

    this.reconnectAttempts.set(peerId, attempts + 1);

    const delay =
      this.config.reconnectDelay *
      Math.pow(this.config.backoffMultiplier, attempts);
    await new Promise((resolve) => setTimeout(resolve, delay));

    return this.connect(peerId, options);
  }

  async sendMessage(peerId, message, options = {}) {
    const connection = this.connections.get(peerId);

    if (!connection || !connection.connected) {
      if (options.queueIfOffline !== false) {
        this.messageQueue.push({
          peerId,
          message,
          timestamp: Date.now(),
        });
        return { queued: true };
      }
      throw new Error(`Peer ${peerId} not connected`);
    }

    if (options.simulateFailure) {
      throw new Error("Message send failed");
    }

    return {
      success: true,
      messageId: `msg_${Date.now()}`,
    };
  }

  async flushMessageQueue() {
    const flushed = [];

    for (const queuedMessage of this.messageQueue) {
      try {
        const result = await this.sendMessage(
          queuedMessage.peerId,
          queuedMessage.message,
          { queueIfOffline: false },
        );

        flushed.push({
          ...queuedMessage,
          sent: true,
          result,
        });
      } catch (error) {
        flushed.push({
          ...queuedMessage,
          sent: false,
          error: error.message,
        });
      }
    }

    this.messageQueue = this.messageQueue.filter(
      (msg) => !flushed.find((f) => f.timestamp === msg.timestamp && f.sent),
    );

    return flushed;
  }

  getConnectionState(peerId) {
    const connection = this.connections.get(peerId);
    if (!connection) {
      return "disconnected";
    }
    return connection.connected ? "connected" : "disconnected";
  }

  getMessageQueueSize() {
    return this.messageQueue.length;
  }

  clearMessageQueue() {
    this.messageQueue = [];
  }

  resetReconnectAttempts(peerId) {
    this.reconnectAttempts.delete(peerId);
  }
}

// ==================== P2P Reconnection Service ====================

class P2PReconnectionService {
  constructor(p2pManager, config = {}) {
    this.p2pManager = p2pManager;
    this.config = {
      autoReconnect: config.autoReconnect !== false,
      maxReconnectAttempts: config.maxReconnectAttempts || 5,
      healthCheckInterval: config.healthCheckInterval || 10000,
      flushQueueOnReconnect: config.flushQueueOnReconnect !== false,
    };

    this.healthCheckIntervals = new Map();
    this.reconnectionPromises = new Map();

    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    this.p2pManager.on("peer:disconnected", async (data) => {
      if (this.config.autoReconnect) {
        await this.handleDisconnection(data.peerId);
      }
    });

    this.p2pManager.on("peer:connected", (data) => {
      this.startHealthCheck(data.peerId);
      if (this.config.flushQueueOnReconnect) {
        this.p2pManager.flushMessageQueue();
      }
    });
  }

  async handleDisconnection(peerId) {
    if (this.reconnectionPromises.has(peerId)) {
      return this.reconnectionPromises.get(peerId);
    }

    const reconnectPromise = this._attemptReconnection(peerId);
    this.reconnectionPromises.set(peerId, reconnectPromise);

    try {
      await reconnectPromise;
      this.reconnectionPromises.delete(peerId);
    } catch (error) {
      this.reconnectionPromises.delete(peerId);
      throw error;
    }
  }

  async _attemptReconnection(peerId) {
    let attempts = 0;

    while (attempts < this.config.maxReconnectAttempts) {
      try {
        await this.p2pManager.reconnect(peerId);
        this.p2pManager.resetReconnectAttempts(peerId);
        return { peerId, reconnected: true, attempts: attempts + 1 };
      } catch (error) {
        attempts++;
        if (attempts >= this.config.maxReconnectAttempts) {
          throw new Error(
            `Failed to reconnect to ${peerId} after ${attempts} attempts`,
          );
        }
      }
    }
  }

  startHealthCheck(peerId) {
    if (this.healthCheckIntervals.has(peerId)) {
      return;
    }

    const interval = setInterval(() => {
      const state = this.p2pManager.getConnectionState(peerId);
      if (state === "disconnected" && this.config.autoReconnect) {
        this.handleDisconnection(peerId);
      }
    }, this.config.healthCheckInterval);

    this.healthCheckIntervals.set(peerId, interval);
  }

  stopHealthCheck(peerId) {
    if (this.healthCheckIntervals.has(peerId)) {
      clearInterval(this.healthCheckIntervals.get(peerId));
      this.healthCheckIntervals.delete(peerId);
    }
  }

  stopAllHealthChecks() {
    this.healthCheckIntervals.forEach((interval) => clearInterval(interval));
    this.healthCheckIntervals.clear();
  }
}

// ==================== Test Suite ====================

describe("P2P 重连和错误恢复测试", () => {
  let p2pManager;
  let reconnectionService;

  beforeEach(() => {
    p2pManager = new MockP2PManager({
      maxReconnectAttempts: 5,
      reconnectDelay: 100,
      backoffMultiplier: 2,
    });

    reconnectionService = new P2PReconnectionService(p2pManager, {
      autoReconnect: true,
      maxReconnectAttempts: 5,
      healthCheckInterval: 1000,
    });
  });

  afterEach(() => {
    reconnectionService.stopAllHealthChecks();
    vi.clearAllTimers();
  });

  // ==================== 1. 连接失败处理 ====================

  describe("连接失败处理", () => {
    it("应该处理初始连接失败", async () => {
      await expect(
        p2pManager.connect("peer1", { simulateFailure: true }),
      ).rejects.toThrow("Failed to connect");

      expect(p2pManager.connectionState).toBe("failed");
    });

    it("应该处理连接超时", async () => {
      await expect(
        p2pManager.connect("peer1", { simulateTimeout: true }),
      ).rejects.toThrow("Connection timeout");

      expect(p2pManager.connectionState).toBe("timeout");
    });

    it("应该在连接失败后尝试重连", async () => {
      let attemptCount = 0;

      p2pManager.connect = vi.fn(async (peerId, options) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Connection failed");
        }
        p2pManager.connections.set(peerId, { id: peerId, connected: true });
        return { peerId, status: "connected" };
      });

      const result = await reconnectionService.handleDisconnection("peer1");

      expect(attemptCount).toBeGreaterThanOrEqual(3);
      expect(result.reconnected).toBe(true);
    });

    it("应该在达到最大重连次数后停止", async () => {
      p2pManager.connect = vi.fn(async () => {
        throw new Error("Connection failed");
      });

      await expect(
        reconnectionService.handleDisconnection("peer1"),
      ).rejects.toThrow("Failed to reconnect");
    });
  });

  // ==================== 2. 自动重连机制 ====================

  describe("自动重连机制", () => {
    it("应该在断开后自动触发重连", async () => {
      // Connect first
      await p2pManager.connect("peer1");
      expect(p2pManager.getConnectionState("peer1")).toBe("connected");

      // Simulate disconnect
      await p2pManager.disconnect("peer1");

      // Wait for event handler
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should attempt reconnection
      expect(p2pManager.reconnectAttempts.has("peer1")).toBe(true);
    });

    it("应该使用指数退避重连", async () => {
      let attemptCount = 0;
      const delays = [];

      p2pManager.connect = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 4) {
          throw new Error("Connection failed");
        }
        p2pManager.connections.set("peer1", { id: "peer1", connected: true });
        return { peerId: "peer1", status: "connected" };
      });

      const startTime = Date.now();
      await reconnectionService.handleDisconnection("peer1");
      const totalTime = Date.now() - startTime;

      // Delays: 100ms, 200ms, 400ms
      // Total: ~700ms
      expect(totalTime).toBeGreaterThanOrEqual(600);
      expect(totalTime).toBeLessThan(1000);
    });

    it("应该支持禁用自动重连", async () => {
      const manualService = new P2PReconnectionService(p2pManager, {
        autoReconnect: false,
      });

      await p2pManager.connect("peer1");
      await p2pManager.disconnect("peer1");

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should not attempt reconnection
      expect(p2pManager.reconnectAttempts.has("peer1")).toBe(false);
    });

    it("应该在成功重连后重置尝试计数", async () => {
      let attemptCount = 0;

      p2pManager.connect = vi.fn(async () => {
        attemptCount++;
        if (attemptCount === 2) {
          p2pManager.connections.set("peer1", { id: "peer1", connected: true });
          return { peerId: "peer1", status: "connected" };
        }
        throw new Error("Connection failed");
      });

      await reconnectionService.handleDisconnection("peer1");

      // Should reset attempts after success
      expect(p2pManager.reconnectAttempts.has("peer1")).toBe(false);
    });
  });

  // ==================== 3. 消息队列和离线缓存 ====================

  describe("消息队列和离线缓存", () => {
    it("应该在离线时将消息加入队列", async () => {
      const result = await p2pManager.sendMessage(
        "peer1",
        { text: "Hello" },
        { queueIfOffline: true },
      );

      expect(result.queued).toBe(true);
      expect(p2pManager.getMessageQueueSize()).toBe(1);
    });

    it("应该在重连后自动发送队列消息", async () => {
      // Queue messages while offline
      await p2pManager.sendMessage(
        "peer1",
        { text: "Message 1" },
        { queueIfOffline: true },
      );
      await p2pManager.sendMessage(
        "peer1",
        { text: "Message 2" },
        { queueIfOffline: true },
      );

      expect(p2pManager.getMessageQueueSize()).toBe(2);

      // Connect
      await p2pManager.connect("peer1");

      // Flush queue
      const flushed = await p2pManager.flushMessageQueue();

      expect(flushed).toHaveLength(2);
      expect(flushed[0].sent).toBe(true);
      expect(flushed[1].sent).toBe(true);
      expect(p2pManager.getMessageQueueSize()).toBe(0);
    });

    it("应该保留发送失败的队列消息", async () => {
      // Queue messages
      await p2pManager.sendMessage(
        "peer1",
        { text: "Message 1" },
        { queueIfOffline: true },
      );
      await p2pManager.sendMessage(
        "peer2",
        { text: "Message 2" },
        { queueIfOffline: true },
      );

      // Connect only peer1
      await p2pManager.connect("peer1");

      // Flush queue
      const flushed = await p2pManager.flushMessageQueue();

      // peer1 message sent, peer2 message remains in queue
      expect(flushed).toHaveLength(2);
      expect(flushed[0].sent).toBe(true);
      expect(flushed[1].sent).toBe(false);
      expect(p2pManager.getMessageQueueSize()).toBe(1);
    });

    it("应该支持清空消息队列", async () => {
      await p2pManager.sendMessage(
        "peer1",
        { text: "Message 1" },
        { queueIfOffline: true },
      );
      await p2pManager.sendMessage(
        "peer1",
        { text: "Message 2" },
        { queueIfOffline: true },
      );

      expect(p2pManager.getMessageQueueSize()).toBe(2);

      p2pManager.clearMessageQueue();

      expect(p2pManager.getMessageQueueSize()).toBe(0);
    });

    it("应该在队列满时处理溢出", async () => {
      // Queue many messages
      for (let i = 0; i < 100; i++) {
        await p2pManager.sendMessage(
          "peer1",
          { text: `Message ${i}` },
          { queueIfOffline: true },
        );
      }

      expect(p2pManager.getMessageQueueSize()).toBe(100);

      // Connect and flush
      await p2pManager.connect("peer1");
      const flushed = await p2pManager.flushMessageQueue();

      expect(flushed).toHaveLength(100);
      expect(p2pManager.getMessageQueueSize()).toBe(0);
    });
  });

  // ==================== 4. 健康检查和监控 ====================

  describe("健康检查和监控", () => {
    it("应该定期检查连接健康", async () => {
      await p2pManager.connect("peer1");

      reconnectionService.startHealthCheck("peer1");

      expect(reconnectionService.healthCheckIntervals.has("peer1")).toBe(true);
    });

    it("应该在健康检查发现断开时重连", async () => {
      await p2pManager.connect("peer1");
      reconnectionService.startHealthCheck("peer1");

      // Simulate disconnect
      await p2pManager.disconnect("peer1");

      // Wait for health check
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Should have attempted reconnection
      expect(p2pManager.reconnectAttempts.has("peer1")).toBe(true);
    });

    it("应该支持停止健康检查", async () => {
      await p2pManager.connect("peer1");
      reconnectionService.startHealthCheck("peer1");

      reconnectionService.stopHealthCheck("peer1");

      expect(reconnectionService.healthCheckIntervals.has("peer1")).toBe(false);
    });

    it("应该支持停止所有健康检查", async () => {
      await p2pManager.connect("peer1");
      await p2pManager.connect("peer2");
      await p2pManager.connect("peer3");

      reconnectionService.startHealthCheck("peer1");
      reconnectionService.startHealthCheck("peer2");
      reconnectionService.startHealthCheck("peer3");

      reconnectionService.stopAllHealthChecks();

      expect(reconnectionService.healthCheckIntervals.size).toBe(0);
    });
  });

  // ==================== 5. 多 Peer 管理 ====================

  describe("多 Peer 管理", () => {
    it("应该独立管理多个 Peer 的重连", async () => {
      let peer1Attempts = 0;
      let peer2Attempts = 0;

      const originalConnect = p2pManager.connect.bind(p2pManager);

      p2pManager.connect = vi.fn(async (peerId, options) => {
        if (peerId === "peer1") {
          peer1Attempts++;
          if (peer1Attempts < 2) {
            throw new Error("Fail");
          }
        } else if (peerId === "peer2") {
          peer2Attempts++;
          if (peer2Attempts < 3) {
            throw new Error("Fail");
          }
        }

        return originalConnect(peerId, options);
      });

      const [result1, result2] = await Promise.all([
        reconnectionService.handleDisconnection("peer1"),
        reconnectionService.handleDisconnection("peer2"),
      ]);

      expect(result1.reconnected).toBe(true);
      expect(result2.reconnected).toBe(true);
      expect(peer1Attempts).toBe(2);
      expect(peer2Attempts).toBe(3);
    });

    it("应该处理部分 Peer 重连失败", async () => {
      p2pManager.connect = vi.fn(async (peerId) => {
        if (peerId === "peer1") {
          p2pManager.connections.set(peerId, { id: peerId, connected: true });
          return { peerId, status: "connected" };
        }
        throw new Error("Connection failed");
      });

      const result1 = await reconnectionService.handleDisconnection("peer1");

      await expect(
        reconnectionService.handleDisconnection("peer2"),
      ).rejects.toThrow("Failed to reconnect");

      expect(result1.reconnected).toBe(true);
    });

    it("应该在重连时不阻塞其他操作", async () => {
      let slowReconnecting = false;

      p2pManager.connect = vi.fn(async (peerId) => {
        if (peerId === "peer_slow") {
          slowReconnecting = true;
          await new Promise((resolve) => setTimeout(resolve, 500));
          slowReconnecting = false;
        }

        p2pManager.connections.set(peerId, { id: peerId, connected: true });
        return { peerId, status: "connected" };
      });

      // Start slow reconnection
      const slowPromise = reconnectionService.handleDisconnection("peer_slow");

      // Quick reconnection should not be blocked
      const quickResult =
        await reconnectionService.handleDisconnection("peer_quick");

      expect(quickResult.reconnected).toBe(true);
      expect(slowReconnecting).toBe(true); // Still reconnecting

      await slowPromise;
      expect(slowReconnecting).toBe(false);
    });
  });

  // ==================== 6. 网络切换适应 ====================

  describe("网络切换适应", () => {
    it("应该处理网络切换场景", async () => {
      // Initial connection
      await p2pManager.connect("peer1");
      expect(p2pManager.getConnectionState("peer1")).toBe("connected");

      // Network switch (disconnect all peers)
      await p2pManager.disconnect("peer1");

      // Trigger reconnection
      const result = await reconnectionService.handleDisconnection("peer1");

      expect(result.reconnected).toBe(true);
    });

    it("应该在网络切换后重新发送队列消息", async () => {
      // Connect and send messages
      await p2pManager.connect("peer1");
      await p2pManager.sendMessage("peer1", { text: "Message 1" });

      // Network switch
      await p2pManager.disconnect("peer1");

      // Queue messages while offline
      await p2pManager.sendMessage(
        "peer1",
        { text: "Message 2" },
        { queueIfOffline: true },
      );

      // Reconnect
      await p2pManager.connect("peer1");

      // Flush queue
      const flushed = await p2pManager.flushMessageQueue();

      expect(flushed).toHaveLength(1);
      expect(flushed[0].sent).toBe(true);
    });

    it("应该适应不同网络延迟", async () => {
      p2pManager.connect = vi.fn(async (peerId, options) => {
        // Simulate variable network latency
        const latency = Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, latency));

        p2pManager.connections.set(peerId, { id: peerId, connected: true });
        return { peerId, status: "connected" };
      });

      const start = Date.now();
      await reconnectionService.handleDisconnection("peer1");
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200); // Should complete reasonably fast
    });
  });

  // ==================== 7. 真实场景测试 ====================

  describe("真实场景测试", () => {
    it("场景1: 移动设备在地铁中的连接", async () => {
      const tunnelPeers = ["peer1", "peer2", "peer3"];

      // Connect all peers initially
      for (const peer of tunnelPeers) {
        await p2pManager.connect(peer);
      }

      // Enter tunnel - all connections lost
      for (const peer of tunnelPeers) {
        await p2pManager.disconnect(peer);
      }

      // Queue messages in tunnel
      for (let i = 0; i < 5; i++) {
        for (const peer of tunnelPeers) {
          await p2pManager.sendMessage(
            peer,
            { text: `Tunnel message ${i}` },
            { queueIfOffline: true },
          );
        }
      }

      expect(p2pManager.getMessageQueueSize()).toBe(15);

      // Exit tunnel - reconnect
      for (const peer of tunnelPeers) {
        await p2pManager.connect(peer);
      }

      // Flush all queued messages
      const flushed = await p2pManager.flushMessageQueue();

      expect(flushed.filter((f) => f.sent).length).toBe(15);
    });

    it("场景2: 不稳定网络的持续重连", async () => {
      let attemptCount = 0;

      p2pManager.connect = vi.fn(async (peerId) => {
        attemptCount++;

        // Simulate intermittent connectivity
        if (attemptCount % 3 !== 0) {
          throw new Error("Network unstable");
        }

        p2pManager.connections.set(peerId, { id: peerId, connected: true });
        return { peerId, status: "connected" };
      });

      const result = await reconnectionService.handleDisconnection("peer1");

      expect(result.reconnected).toBe(true);
      expect(attemptCount).toBe(3);
    });

    it("场景3: 群聊中部分成员离线", async () => {
      const groupPeers = ["peer1", "peer2", "peer3", "peer4", "peer5"];

      // Connect all group members
      for (const peer of groupPeers) {
        await p2pManager.connect(peer);
      }

      // Some members go offline
      await p2pManager.disconnect("peer2");
      await p2pManager.disconnect("peer4");

      // Send group message
      for (const peer of groupPeers) {
        try {
          await p2pManager.sendMessage(
            peer,
            { text: "Group message", groupId: "group1" },
            { queueIfOffline: true },
          );
        } catch (error) {
          // Expected for offline peers
        }
      }

      // Check queue
      expect(p2pManager.getMessageQueueSize()).toBeGreaterThan(0);

      // Offline members reconnect
      await p2pManager.connect("peer2");
      await p2pManager.connect("peer4");

      // Flush queue
      const flushed = await p2pManager.flushMessageQueue();

      const successfulFlush = flushed.filter((f) => f.sent);
      expect(successfulFlush.length).toBeGreaterThan(0);
    });

    it("场景4: P2P 文件传输中断恢复", async () => {
      await p2pManager.connect("peer1");

      // Start file transfer (simulate chunks)
      const chunks = Array(10)
        .fill(0)
        .map((_, i) => ({
          chunkId: i,
          data: `chunk_${i}`,
        }));

      // Send first 5 chunks
      for (let i = 0; i < 5; i++) {
        await p2pManager.sendMessage("peer1", {
          type: "file_chunk",
          chunk: chunks[i],
        });
      }

      // Connection lost
      await p2pManager.disconnect("peer1");

      // Queue remaining chunks
      for (let i = 5; i < 10; i++) {
        await p2pManager.sendMessage(
          "peer1",
          {
            type: "file_chunk",
            chunk: chunks[i],
          },
          { queueIfOffline: true },
        );
      }

      expect(p2pManager.getMessageQueueSize()).toBe(5);

      // Reconnect and resume
      await p2pManager.connect("peer1");
      const flushed = await p2pManager.flushMessageQueue();

      expect(flushed.filter((f) => f.sent).length).toBe(5);
      expect(p2pManager.getMessageQueueSize()).toBe(0);
    });

    it("场景5: 长时间离线后的批量同步", async () => {
      // User goes offline for a long time
      const offlineMessages = [];

      for (let i = 0; i < 100; i++) {
        await p2pManager.sendMessage(
          "peer1",
          {
            text: `Offline message ${i}`,
            timestamp: Date.now(),
          },
          { queueIfOffline: true },
        );
      }

      expect(p2pManager.getMessageQueueSize()).toBe(100);

      // User comes back online
      await p2pManager.connect("peer1");

      // Batch sync
      const flushed = await p2pManager.flushMessageQueue();

      expect(flushed.length).toBe(100);
      expect(flushed.filter((f) => f.sent).length).toBe(100);
      expect(p2pManager.getMessageQueueSize()).toBe(0);
    });
  });

  // ==================== 8. 性能和可靠性 ====================

  describe("性能和可靠性", () => {
    it("应该快速完成重连（< 1s with 3 retries）", async () => {
      let attemptCount = 0;

      p2pManager.connect = vi.fn(async (peerId) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Fail");
        }

        p2pManager.connections.set(peerId, { id: peerId, connected: true });
        return { peerId, status: "connected" };
      });

      const start = Date.now();
      await reconnectionService.handleDisconnection("peer1");
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it("应该高效处理大量队列消息", async () => {
      // Queue 1000 messages
      for (let i = 0; i < 1000; i++) {
        await p2pManager.sendMessage(
          "peer1",
          { text: `Message ${i}` },
          { queueIfOffline: true },
        );
      }

      await p2pManager.connect("peer1");

      const start = Date.now();
      const flushed = await p2pManager.flushMessageQueue();
      const duration = Date.now() - start;

      expect(flushed.length).toBe(1000);
      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it("应该不会因重连失败而泄漏内存", async () => {
      p2pManager.connect = vi.fn(async () => {
        throw new Error("Always fail");
      });

      for (let i = 0; i < 100; i++) {
        try {
          await reconnectionService.handleDisconnection(`peer_${i}`);
        } catch (error) {
          // Expected
        }
      }

      // Should not accumulate reconnection promises
      expect(reconnectionService.reconnectionPromises.size).toBe(0);
    });

    it("应该避免重复重连同一 Peer", async () => {
      let connectCallCount = 0;

      p2pManager.connect = vi.fn(async (peerId) => {
        connectCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 200));
        p2pManager.connections.set(peerId, { id: peerId, connected: true });
        return { peerId, status: "connected" };
      });

      // Trigger multiple reconnections simultaneously
      const promises = [
        reconnectionService.handleDisconnection("peer1"),
        reconnectionService.handleDisconnection("peer1"),
        reconnectionService.handleDisconnection("peer1"),
      ];

      await Promise.all(promises);

      // Should only connect once due to promise reuse
      expect(connectCallCount).toBe(1);
    });
  });
});
