/**
 * RemoteGateway 单元测试
 *
 * 测试远程网关的核心功能：
 * - 初始化和生命周期
 * - 命令处理
 * - 设备管理
 * - 统计信息
 *
 * 注意：开关机相关测试已跳过
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock 所有依赖模块
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock P2P Command Adapter
vi.mock("../p2p-command-adapter", () => ({
  P2PCommandAdapter: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    sendCommand: vi.fn().mockResolvedValue({ success: true }),
    broadcastEvent: vi.fn(),
    getConnectedDevices: vi.fn().mockReturnValue([]),
    disconnectPeer: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockReturnValue({ connected: 0 }),
  })),
}));

// Mock Permission Gate
vi.mock("../permission-gate", () => ({
  PermissionGate: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue(true),
    setDevicePermissionLevel: vi.fn().mockResolvedValue({ success: true }),
    getDevicePermissionLevel: vi.fn().mockResolvedValue(2),
    getAuditLogs: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({ devicePermissions: 0 }),
    stopCleanup: vi.fn(),
  })),
  PERMISSION_LEVELS: {
    PUBLIC: 1,
    NORMAL: 2,
    ADMIN: 3,
    ROOT: 4,
  },
}));

// Mock Command Router
vi.mock("../command-router", () => ({
  CommandRouter: vi.fn().mockImplementation(() => ({
    registerHandler: vi.fn(),
    route: vi.fn().mockResolvedValue({
      jsonrpc: "2.0",
      id: "1",
      result: { success: true },
    }),
    getStats: vi.fn().mockReturnValue({ totalCommands: 0 }),
  })),
}));

// Mock all handlers
vi.mock("../handlers/ai-handler", () => ({
  default: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/system-handler", () => ({
  default: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/file-transfer-handler", () => ({
  FileTransferHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/remote-desktop-handler", () => ({
  RemoteDesktopHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/knowledge-handler", () => ({
  default: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/command-history-handler", () => ({
  default: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    recordCommand: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../handlers/device-manager-handler", () => ({
  DeviceManagerHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    disconnectDevice: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../handlers/clipboard-handler", () => ({
  ClipboardHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    setEventEmitter: vi.fn(),
  })),
}));
vi.mock("../handlers/notification-handler", () => ({
  NotificationHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    setEventEmitter: vi.fn(),
  })),
}));
vi.mock("../handlers/workflow-handler", () => ({
  WorkflowHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    setEventEmitter: vi.fn(),
  })),
}));
vi.mock("../handlers/browser-handler", () => ({
  BrowserHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/power-handler", () => ({
  PowerHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/process-handler", () => ({
  ProcessHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/media-handler", () => ({
  MediaHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/network-handler", () => ({
  NetworkHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/storage-handler", () => ({
  StorageHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/display-handler", () => ({
  DisplayHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/input-handler", () => ({
  InputHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/application-handler", () => ({
  ApplicationHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/system-info-handler", () => ({
  SystemInfoHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/security-handler", () => ({
  SecurityHandler: vi.fn().mockImplementation(() => ({ handle: vi.fn() })),
}));
vi.mock("../handlers/user-browser-handler", () => ({
  UserBrowserHandler: vi.fn().mockImplementation(() => ({
    handle: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../browser-extension-server", () => ({
  BrowserExtensionServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
  ExtensionBrowserHandler: vi
    .fn()
    .mockImplementation(() => ({ handle: vi.fn() })),
}));

// 在所有 mock 定义之后导入被测模块
const RemoteGateway = (await import("../remote-gateway")).default;

describe("RemoteGateway", () => {
  let gateway;
  let mockDependencies;

  beforeEach(() => {
    mockDependencies = {
      p2pManager: {
        on: vi.fn(),
        sendMessage: vi.fn(),
      },
      didManager: {
        cache: { get: vi.fn() },
      },
      ukeyManager: {
        verifyPIN: vi.fn().mockResolvedValue({ success: true }),
      },
      database: {
        exec: vi.fn(),
        prepare: vi.fn().mockReturnValue({
          run: vi.fn(),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        }),
      },
      mainWindow: {
        webContents: { send: vi.fn() },
      },
      aiEngine: {},
      ragManager: {},
    };

    gateway = new RemoteGateway(mockDependencies, {
      enableP2P: true,
      enableWebSocket: false,
      fileTransfer: {
        uploadDir: "/tmp/test-uploads",
        downloadDir: "/tmp/test-downloads",
        tempDir: "/tmp/test-temp",
      },
    });
  });

  afterEach(async () => {
    if (gateway && gateway.running) {
      await gateway.stop();
    }
    vi.clearAllMocks();
  });

  describe("构造函数", () => {
    it("应该使用正确的依赖初始化", () => {
      expect(gateway.p2pManager).toBe(mockDependencies.p2pManager);
      expect(gateway.didManager).toBe(mockDependencies.didManager);
      expect(gateway.ukeyManager).toBe(mockDependencies.ukeyManager);
      expect(gateway.database).toBe(mockDependencies.database);
    });

    it("应该使用默认选项", () => {
      expect(gateway.options.enableP2P).toBe(true);
      expect(gateway.options.enableWebSocket).toBe(false);
    });

    it("应该初始化状态为未初始化", () => {
      expect(gateway.initialized).toBe(false);
      expect(gateway.running).toBe(false);
    });

    it("应该初始化统计信息", () => {
      expect(gateway.stats.totalCommands).toBe(0);
      expect(gateway.stats.successCommands).toBe(0);
      expect(gateway.stats.failedCommands).toBe(0);
      expect(gateway.stats.permissionDenied).toBe(0);
      expect(gateway.stats.connectedDevices).toBe(0);
    });
  });

  describe("initialize", () => {
    it("应该成功初始化所有组件", async () => {
      await gateway.initialize();

      expect(gateway.initialized).toBe(true);
      expect(gateway.running).toBe(true);
      expect(gateway.permissionGate).toBeDefined();
      expect(gateway.commandRouter).toBeDefined();
      expect(gateway.p2pCommandAdapter).toBeDefined();
    });

    it("应该触发 initialized 事件", async () => {
      const initHandler = vi.fn();
      gateway.on("initialized", initHandler);

      await gateway.initialize();

      expect(initHandler).toHaveBeenCalled();
    });

    it("应该跳过重复初始化", async () => {
      await gateway.initialize();
      const firstPermissionGate = gateway.permissionGate;

      await gateway.initialize();

      expect(gateway.permissionGate).toBe(firstPermissionGate);
    });

    it("应该注册所有命令处理器", async () => {
      await gateway.initialize();

      expect(Object.keys(gateway.handlers).length).toBeGreaterThan(0);
      expect(gateway.handlers.ai).toBeDefined();
      expect(gateway.handlers.system).toBeDefined();
      expect(gateway.handlers.file).toBeDefined();
    });
  });

  describe("handleCommand", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该成功处理有效命令", async () => {
      const sendResponse = vi.fn();

      await gateway.handleCommand({
        peerId: "peer1",
        request: {
          id: "1",
          method: "ai.chat",
          params: { message: "hello" },
          auth: {
            did: "did:test:123",
            signature: "sig",
            timestamp: Date.now(),
            nonce: "nonce1",
          },
        },
        sendResponse,
      });

      expect(sendResponse).toHaveBeenCalled();
      const response = sendResponse.mock.calls[0][0];
      expect(response.result).toBeDefined();
    });

    it("应该拒绝缺少认证信息的命令", async () => {
      const sendResponse = vi.fn();

      await gateway.handleCommand({
        peerId: "peer1",
        request: {
          id: "2",
          method: "ai.chat",
          params: {},
          auth: null,
        },
        sendResponse,
      });

      expect(sendResponse).toHaveBeenCalled();
      const response = sendResponse.mock.calls[0][0];
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32001);
    });

    it("应该更新统计信息", async () => {
      const sendResponse = vi.fn();

      await gateway.handleCommand({
        peerId: "peer1",
        request: {
          id: "3",
          method: "ai.chat",
          params: {},
          auth: {
            did: "did:test:123",
            signature: "sig",
            timestamp: Date.now(),
            nonce: "nonce2",
          },
        },
        sendResponse,
      });

      expect(gateway.stats.totalCommands).toBe(1);
    });

    it("应该触发 command:completed 事件", async () => {
      const completedHandler = vi.fn();
      gateway.on("command:completed", completedHandler);
      const sendResponse = vi.fn();

      await gateway.handleCommand({
        peerId: "peer1",
        request: {
          id: "4",
          method: "ai.chat",
          params: {},
          auth: {
            did: "did:test:123",
            signature: "sig",
            timestamp: Date.now(),
            nonce: "nonce3",
          },
        },
        sendResponse,
      });

      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ai.chat",
          peerId: "peer1",
        }),
      );
    });
  });

  describe("sendCommand", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该发送命令到设备", async () => {
      const response = await gateway.sendCommand("peer1", "mobile.vibrate", {
        duration: 500,
      });

      expect(response).toEqual({ success: true });
    });

    it("P2P 未初始化时应该抛出错误", async () => {
      const noP2PGateway = new RemoteGateway(
        { ...mockDependencies, p2pManager: null },
        { enableP2P: false },
      );
      await noP2PGateway.initialize();

      await expect(
        noP2PGateway.sendCommand("peer1", "test", {}),
      ).rejects.toThrow("P2P Command Adapter not initialized");
    });
  });

  describe("broadcastEvent", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该广播事件到所有设备", () => {
      gateway.broadcastEvent("status.changed", { status: "busy" });

      expect(gateway.p2pCommandAdapter.broadcastEvent).toHaveBeenCalledWith(
        "status.changed",
        { status: "busy" },
        null,
      );
    });

    it("P2P 未初始化时应该静默处理", async () => {
      const noP2PGateway = new RemoteGateway(
        { ...mockDependencies, p2pManager: null },
        { enableP2P: false },
      );
      await noP2PGateway.initialize();

      // 不应该抛出错误
      expect(() => {
        noP2PGateway.broadcastEvent("test", {});
      }).not.toThrow();
    });
  });

  describe("getConnectedDevices", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该返回已连接设备列表", () => {
      const devices = gateway.getConnectedDevices();

      expect(Array.isArray(devices)).toBe(true);
    });

    it("P2P 未初始化时应该返回空数组", async () => {
      const noP2PGateway = new RemoteGateway(
        { ...mockDependencies, p2pManager: null },
        { enableP2P: false },
      );
      await noP2PGateway.initialize();

      const devices = noP2PGateway.getConnectedDevices();

      expect(devices).toEqual([]);
    });
  });

  describe("disconnectDevice", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该断开设备连接", async () => {
      const disconnectHandler = vi.fn();
      gateway.on("device:disconnected", disconnectHandler);

      const result = await gateway.disconnectDevice("peer1");

      expect(result.success).toBe(true);
      expect(disconnectHandler).toHaveBeenCalledWith("peer1");
    });
  });

  describe("setDevicePermission", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该设置设备权限", async () => {
      const result = await gateway.setDevicePermission("did:test:123", 3, {
        deviceName: "Test",
      });

      expect(result.success).toBe(true);
      expect(
        gateway.permissionGate.setDevicePermissionLevel,
      ).toHaveBeenCalled();
    });

    it("Permission Gate 未初始化时应该抛出错误", async () => {
      const noPermGateway = new RemoteGateway(mockDependencies);
      // 不调用 initialize

      await expect(
        noPermGateway.setDevicePermission("did:test:123", 2),
      ).rejects.toThrow("Permission Gate not initialized");
    });
  });

  describe("getDevicePermission", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该获取设备权限", async () => {
      const level = await gateway.getDevicePermission("did:test:123");

      expect(level).toBe(2);
    });
  });

  describe("getAuditLogs", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该返回审计日志", () => {
      const logs = gateway.getAuditLogs({ limit: 10 });

      expect(Array.isArray(logs)).toBe(true);
    });

    it("Permission Gate 未初始化时应该返回空数组", () => {
      const noPermGateway = new RemoteGateway(mockDependencies);

      const logs = noPermGateway.getAuditLogs();

      expect(logs).toEqual([]);
    });
  });

  describe("getStats", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该返回完整统计信息", () => {
      const stats = gateway.getStats();

      expect(stats.totalCommands).toBeDefined();
      expect(stats.successCommands).toBeDefined();
      expect(stats.failedCommands).toBeDefined();
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeDefined();
    });

    it("应该包含子组件统计", () => {
      const stats = gateway.getStats();

      expect(stats.router).toBeDefined();
      expect(stats.p2p).toBeDefined();
      expect(stats.permission).toBeDefined();
    });
  });

  describe("stop", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该停止所有组件", async () => {
      await gateway.stop();

      expect(gateway.running).toBe(false);
      expect(gateway.p2pCommandAdapter.cleanup).toHaveBeenCalled();
      expect(gateway.permissionGate.stopCleanup).toHaveBeenCalled();
    });

    it("应该触发 stopped 事件", async () => {
      const stopHandler = vi.fn();
      gateway.on("stopped", stopHandler);

      await gateway.stop();

      expect(stopHandler).toHaveBeenCalled();
    });
  });

  describe("isRunning", () => {
    it("初始化前应该返回 false", () => {
      expect(gateway.isRunning()).toBe(false);
    });

    it("初始化后应该返回 true", async () => {
      await gateway.initialize();

      expect(gateway.isRunning()).toBe(true);
    });

    it("停止后应该返回 false", async () => {
      await gateway.initialize();
      await gateway.stop();

      expect(gateway.isRunning()).toBe(false);
    });
  });

  describe("事件处理", () => {
    beforeEach(async () => {
      await gateway.initialize();
    });

    it("应该继承 EventEmitter", () => {
      expect(typeof gateway.on).toBe("function");
      expect(typeof gateway.emit).toBe("function");
    });

    it("应该正确发射自定义事件", () => {
      const handler = vi.fn();
      gateway.on("custom:event", handler);

      gateway.emit("custom:event", { data: "test" });

      expect(handler).toHaveBeenCalledWith({ data: "test" });
    });
  });

  describe("电源相关功能（跳过开关机测试）", () => {
    it.skip("shutdown 命令处理", () => {
      // 跳过 - 开关机相关测试
    });

    it.skip("restart 命令处理", () => {
      // 跳过 - 开关机相关测试
    });

    it("应该注册 power handler", async () => {
      await gateway.initialize();

      expect(gateway.handlers.power).toBeDefined();
    });
  });
});
