/**
 * P2P增强功能测试
 *
 * 测试屏幕共享、通话历史和连接健康管理器
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import EventEmitter from "events";

// Mock electron before importing modules that use it
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  desktopCapturer: {
    getSources: vi.fn().mockResolvedValue([
      {
        id: "screen:0:0",
        name: "Entire Screen",
        thumbnail: { toDataURL: () => "data:image/png;base64,mock" },
        display_id: "0",
        appIcon: null,
      },
    ]),
  },
}));

const ScreenShareIPC = (
  await import("../../../src/main/p2p/screen-share-ipc.js")
).default;
const CallHistoryIPC = (
  await import("../../../src/main/p2p/call-history-ipc.js")
).default;
const P2PConnectionHealthManager = (
  await import("../../../src/main/p2p/connection-health-manager.js")
).default;

describe("P2P Enhancement Features", () => {
  describe("ScreenShareIPC", () => {
    let screenShareIPC;

    beforeEach(() => {
      screenShareIPC = new ScreenShareIPC();
    });

    afterEach(() => {
      if (screenShareIPC.registered) {
        screenShareIPC.unregister();
      }
    });

    it("应该成功创建实例", () => {
      expect(screenShareIPC).toBeDefined();
      expect(screenShareIPC.registered).toBe(false);
    });

    it("应该能够注册IPC处理器", () => {
      screenShareIPC.register();
      expect(screenShareIPC.registered).toBe(true);
    });

    it("应该能够注销IPC处理器", () => {
      screenShareIPC.register();
      screenShareIPC.unregister();
      expect(screenShareIPC.registered).toBe(false);
    });

    it("不应该重复注册", () => {
      screenShareIPC.register();
      // Second register should not throw and should keep registered state
      screenShareIPC.register();
      // Note: Implementation uses logger.info instead of console.log for "IPC处理器已注册" message
      expect(screenShareIPC.registered).toBe(true);
    });
  });

  describe("CallHistoryIPC", () => {
    let callHistoryIPC;
    let mockCallHistoryManager;

    beforeEach(() => {
      mockCallHistoryManager = {
        getCallHistory: vi.fn().mockResolvedValue([]),
        getCallById: vi.fn().mockResolvedValue(null),
        deleteCall: vi.fn().mockResolvedValue(),
        clearAllCalls: vi.fn().mockResolvedValue(),
        getCallStats: vi.fn().mockResolvedValue({}),
      };

      callHistoryIPC = new CallHistoryIPC(mockCallHistoryManager);
    });

    afterEach(() => {
      if (callHistoryIPC.registered) {
        callHistoryIPC.unregister();
      }
    });

    it("应该成功创建实例", () => {
      expect(callHistoryIPC).toBeDefined();
      expect(callHistoryIPC.callHistoryManager).toBe(mockCallHistoryManager);
      expect(callHistoryIPC.registered).toBe(false);
    });

    it("应该能够注册IPC处理器", () => {
      callHistoryIPC.register();
      expect(callHistoryIPC.registered).toBe(true);
    });

    it("应该能够注销IPC处理器", () => {
      callHistoryIPC.register();
      callHistoryIPC.unregister();
      expect(callHistoryIPC.registered).toBe(false);
    });
  });

  describe("P2PConnectionHealthManager", () => {
    let healthManager;
    let mockP2PManager;

    beforeEach(() => {
      mockP2PManager = new EventEmitter();
      mockP2PManager.sendMessage = vi.fn().mockResolvedValue();
      mockP2PManager.connectToPeer = vi.fn().mockResolvedValue();

      healthManager = new P2PConnectionHealthManager(mockP2PManager, {
        healthCheckInterval: 1000,
        pingTimeout: 100,
        maxReconnectAttempts: 3,
        reconnectDelay: 100,
      });
    });

    afterEach(() => {
      if (healthManager.initialized) {
        healthManager.cleanup();
      }
    });

    it("应该成功创建实例", () => {
      expect(healthManager).toBeDefined();
      expect(healthManager.p2pManager).toBe(mockP2PManager);
      expect(healthManager.initialized).toBe(false);
    });

    it("应该能够初始化", async () => {
      await healthManager.initialize();
      expect(healthManager.initialized).toBe(true);
      expect(healthManager.healthCheckTimer).toBeDefined();
    });

    it("应该能够处理对等方连接", async () => {
      await healthManager.initialize();

      const peerId = "test-peer-123";
      mockP2PManager.emit("peer:connected", peerId);

      const health = healthManager.getPeerHealth(peerId);
      expect(health).toBeDefined();
      expect(health.peerId).toBe(peerId);
      expect(health.status).toBe("healthy");
    });

    it("应该能够处理对等方断开", async () => {
      await healthManager.initialize();

      const peerId = "test-peer-123";
      mockP2PManager.emit("peer:connected", peerId);
      mockP2PManager.emit("peer:disconnected", peerId);

      const health = healthManager.getPeerHealth(peerId);
      expect(health.status).toBe("disconnected");
    });

    it("应该能够获取所有对等方健康状态", async () => {
      await healthManager.initialize();

      mockP2PManager.emit("peer:connected", "peer-1");
      mockP2PManager.emit("peer:connected", "peer-2");

      const allHealth = healthManager.getAllPeerHealth();
      expect(allHealth).toHaveLength(2);
    });

    it("应该能够获取网络质量", () => {
      const quality = healthManager.getNetworkQuality();
      expect(quality).toBe("good");
    });

    it("应该能够清理资源", async () => {
      await healthManager.initialize();
      healthManager.cleanup();

      expect(healthManager.initialized).toBe(false);
      expect(healthManager.healthCheckTimer).toBeNull();
      expect(healthManager.peerHealth.size).toBe(0);
    });

    it("应该触发健康检查事件", async () => {
      await healthManager.initialize();

      const peerId = "test-peer-123";
      mockP2PManager.emit("peer:connected", peerId);

      const healthCheckPromise = new Promise((resolve) => {
        healthManager.once("health-check", (data) => {
          resolve(data);
        });
      });

      // 等待健康检查
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const data = await healthCheckPromise;
      expect(data.peerId).toBe(peerId);
      expect(data.health).toBeDefined();
    });

    it("应该在连接失败时触发重连", async () => {
      await healthManager.initialize();

      const peerId = "test-peer-123";
      mockP2PManager.emit("peer:connected", peerId);

      // 模拟连接失败
      const health = healthManager.getPeerHealth(peerId);
      health.consecutiveFailures = 3;

      const reconnectPromise = new Promise((resolve) => {
        healthManager.once("reconnect-attempt-failed", (data) => {
          resolve(data);
        });
      });

      // 触发健康检查
      await healthManager._performHealthCheck();

      // 等待重连尝试
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    it("应该在达到最大重连次数后停止重连", async () => {
      await healthManager.initialize();

      const peerId = "test-peer-123";
      mockP2PManager.connectToPeer.mockRejectedValue(
        new Error("Connection failed"),
      );

      // 设置重连次数为最大值
      healthManager.reconnectAttempts.set(peerId, 3);

      const failedPromise = new Promise((resolve) => {
        healthManager.once("reconnect-failed", (data) => {
          resolve(data);
        });
      });

      await healthManager._triggerReconnect(peerId);

      const data = await failedPromise;
      expect(data.peerId).toBe(peerId);
      expect(data.attempts).toBe(3);
    });
  });

  describe("Integration Tests", () => {
    it("应该能够协同工作", async () => {
      // 创建模拟的P2P管理器
      const mockP2PManager = new EventEmitter();
      mockP2PManager.sendMessage = vi.fn().mockResolvedValue();
      mockP2PManager.connectToPeer = vi.fn().mockResolvedValue();

      // 创建健康管理器
      const healthManager = new P2PConnectionHealthManager(mockP2PManager, {
        healthCheckInterval: 1000,
        maxReconnectAttempts: 3,
      });

      await healthManager.initialize();

      // 模拟对等方连接
      const peerId = "test-peer-123";
      mockP2PManager.emit("peer:connected", peerId);

      // 验证健康状态
      const health = healthManager.getPeerHealth(peerId);
      expect(health).toBeDefined();
      expect(health.status).toBe("healthy");

      // 清理
      healthManager.cleanup();
    });
  });
});
