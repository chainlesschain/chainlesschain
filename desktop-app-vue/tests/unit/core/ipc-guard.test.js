/**
 * IPC Guard 单元测试
 * 测试IPC注册保护机制
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

// Create a fresh instance of the guard logic for testing
// This simulates the core logic without requiring actual electron imports
function createIpcGuard() {
  const registeredChannels = new Map();
  const registeredModules = new Set();

  // Mock ipcMain for testing
  const mockIpcMain = {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  };

  // Mock logger
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
  };

  function isChannelRegistered(channel) {
    return registeredChannels.has(channel);
  }

  function isModuleRegistered(moduleName) {
    return registeredModules.has(moduleName);
  }

  function markChannelRegistered(channel, moduleName) {
    registeredChannels.set(channel, {
      module: moduleName,
      timestamp: Date.now(),
    });
  }

  function markModuleRegistered(moduleName) {
    registeredModules.add(moduleName);
  }

  function safeRegisterHandler(channel, handler, moduleName = "unknown") {
    if (isChannelRegistered(channel)) {
      const existing = registeredChannels.get(channel);
      mockLogger.info(
        `[IPC Guard] Channel "${channel}" already registered by ${existing.module}, skipping...`,
      );
      return false;
    }

    try {
      mockIpcMain.handle(channel, handler);
      markChannelRegistered(channel, moduleName);
      return true;
    } catch (error) {
      mockLogger.error(`[IPC Guard] Failed to register channel "${channel}":`, error);
      return false;
    }
  }

  function safeRegisterHandlers(handlers, moduleName = "unknown") {
    let registered = 0;
    let skipped = 0;

    for (const [channel, handler] of Object.entries(handlers)) {
      if (safeRegisterHandler(channel, handler, moduleName)) {
        registered++;
      } else {
        skipped++;
      }
    }

    return { registered, skipped };
  }

  function safeRegisterModule(moduleName, registerFunc) {
    if (isModuleRegistered(moduleName)) {
      mockLogger.info(
        `[IPC Guard] Module "${moduleName}" already registered, skipping...`,
      );
      return false;
    }

    try {
      registerFunc();
      markModuleRegistered(moduleName);
      mockLogger.info(`[IPC Guard] Module "${moduleName}" registered successfully`);
      return true;
    } catch (error) {
      mockLogger.error(
        `[IPC Guard] Failed to register module "${moduleName}":`,
        error,
      );
      return false;
    }
  }

  function unregisterChannel(channel) {
    if (registeredChannels.has(channel)) {
      try {
        mockIpcMain.removeHandler(channel);
        registeredChannels.delete(channel);
        mockLogger.info(`[IPC Guard] Channel "${channel}" unregistered`);
      } catch (error) {
        mockLogger.error(
          `[IPC Guard] Failed to unregister channel "${channel}":`,
          error,
        );
      }
    }
  }

  function unregisterModule(moduleName) {
    const channelsToRemove = [];
    for (const [channel, info] of registeredChannels.entries()) {
      if (info.module === moduleName) {
        channelsToRemove.push(channel);
      }
    }

    channelsToRemove.forEach((channel) => unregisterChannel(channel));
    registeredModules.delete(moduleName);
    mockLogger.info(
      `[IPC Guard] Module "${moduleName}" unregistered (${channelsToRemove.length} channels)`,
    );
  }

  function resetAll() {
    for (const channel of registeredChannels.keys()) {
      try {
        mockIpcMain.removeHandler(channel);
      } catch (err) {
        // Ignore individual channel removal errors
      }
    }
    registeredChannels.clear();
    registeredModules.clear();
  }

  function getStats() {
    return {
      totalChannels: registeredChannels.size,
      totalModules: registeredModules.size,
      channels: Array.from(registeredChannels.entries()).map(
        ([channel, info]) => ({
          channel,
          module: info.module,
          registeredAt: new Date(info.timestamp).toISOString(),
        }),
      ),
      modules: Array.from(registeredModules),
    };
  }

  function printStats() {
    const stats = getStats();
    mockLogger.info("[IPC Guard] Registration Statistics:");
    mockLogger.info(`  Total Modules: ${stats.totalModules}`);
    mockLogger.info(`  Total Channels: ${stats.totalChannels}`);
    mockLogger.info(`  Registered Modules:`, stats.modules);
  }

  return {
    isChannelRegistered,
    isModuleRegistered,
    markChannelRegistered,
    markModuleRegistered,
    safeRegisterHandler,
    safeRegisterHandlers,
    safeRegisterModule,
    unregisterChannel,
    unregisterModule,
    resetAll,
    getStats,
    printStats,
    // Expose mocks for testing
    _mockIpcMain: mockIpcMain,
    _mockLogger: mockLogger,
  };
}

describe("IPC Guard", () => {
  let ipcGuard;

  beforeEach(() => {
    // Create a fresh instance for each test
    ipcGuard = createIpcGuard();
  });

  afterEach(() => {
    if (ipcGuard?.resetAll) {
      ipcGuard.resetAll();
    }
  });

  describe("Channel注册保护", () => {
    it("应该能够注册新的channel", () => {
      const handler = vi.fn();
      const result = ipcGuard.safeRegisterHandler(
        "test:channel",
        handler,
        "test-module",
      );

      expect(result).toBe(true);
      expect(ipcGuard.isChannelRegistered("test:channel")).toBe(true);
    });

    it("应该阻止重复注册相同的channel", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const result1 = ipcGuard.safeRegisterHandler(
        "test:channel",
        handler1,
        "module1",
      );
      const result2 = ipcGuard.safeRegisterHandler(
        "test:channel",
        handler2,
        "module2",
      );

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    it("应该正确跟踪channel的模块信息", () => {
      ipcGuard.safeRegisterHandler("test:channel", vi.fn(), "test-module");

      const stats = ipcGuard.getStats();
      const channelInfo = stats.channels.find(
        (c) => c.channel === "test:channel",
      );

      expect(channelInfo).toBeDefined();
      expect(channelInfo.module).toBe("test-module");
    });
  });

  describe("模块注册保护", () => {
    it("应该能够注册新的模块", () => {
      const registerFunc = vi.fn();
      const result = ipcGuard.safeRegisterModule("test-module", registerFunc);

      expect(result).toBe(true);
      expect(registerFunc).toHaveBeenCalled();
      expect(ipcGuard.isModuleRegistered("test-module")).toBe(true);
    });

    it("应该阻止重复注册相同的模块", () => {
      const registerFunc1 = vi.fn();
      const registerFunc2 = vi.fn();

      const result1 = ipcGuard.safeRegisterModule("test-module", registerFunc1);
      const result2 = ipcGuard.safeRegisterModule("test-module", registerFunc2);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(registerFunc1).toHaveBeenCalled();
      expect(registerFunc2).not.toHaveBeenCalled();
    });
  });

  describe("批量注册", () => {
    it("应该能够批量注册多个handlers", () => {
      const handlers = {
        "test:handler1": vi.fn(),
        "test:handler2": vi.fn(),
        "test:handler3": vi.fn(),
      };

      const result = ipcGuard.safeRegisterHandlers(handlers, "test-module");

      expect(result.registered).toBe(3);
      expect(result.skipped).toBe(0);
    });

    it("应该正确统计已注册和跳过的handlers", () => {
      // 先注册一个handler
      ipcGuard.safeRegisterHandler("test:handler1", vi.fn(), "module1");

      // 再批量注册，包含已存在的handler
      const handlers = {
        "test:handler1": vi.fn(), // 已存在，应该跳过
        "test:handler2": vi.fn(), // 新的
        "test:handler3": vi.fn(), // 新的
      };

      const result = ipcGuard.safeRegisterHandlers(handlers, "test-module");

      expect(result.registered).toBe(2);
      expect(result.skipped).toBe(1);
    });
  });

  describe("注销功能", () => {
    it("应该能够注销单个channel", () => {
      ipcGuard.safeRegisterHandler("test:channel", vi.fn(), "test-module");
      expect(ipcGuard.isChannelRegistered("test:channel")).toBe(true);

      ipcGuard.unregisterChannel("test:channel");
      expect(ipcGuard.isChannelRegistered("test:channel")).toBe(false);
    });

    it("应该能够注销整个模块", () => {
      ipcGuard.safeRegisterHandler("test:channel1", vi.fn(), "test-module");
      ipcGuard.safeRegisterHandler("test:channel2", vi.fn(), "test-module");
      ipcGuard.markModuleRegistered("test-module");

      expect(ipcGuard.isModuleRegistered("test-module")).toBe(true);
      expect(ipcGuard.isChannelRegistered("test:channel1")).toBe(true);
      expect(ipcGuard.isChannelRegistered("test:channel2")).toBe(true);

      ipcGuard.unregisterModule("test-module");

      expect(ipcGuard.isModuleRegistered("test-module")).toBe(false);
      expect(ipcGuard.isChannelRegistered("test:channel1")).toBe(false);
      expect(ipcGuard.isChannelRegistered("test:channel2")).toBe(false);
    });

    it("应该能够重置所有注册", () => {
      ipcGuard.safeRegisterHandler("test:channel1", vi.fn(), "module1");
      ipcGuard.safeRegisterHandler("test:channel2", vi.fn(), "module2");
      ipcGuard.markModuleRegistered("module1");
      ipcGuard.markModuleRegistered("module2");

      const beforeStats = ipcGuard.getStats();
      expect(beforeStats.totalChannels).toBe(2);
      expect(beforeStats.totalModules).toBe(2);

      ipcGuard.resetAll();

      const afterStats = ipcGuard.getStats();
      expect(afterStats.totalChannels).toBe(0);
      expect(afterStats.totalModules).toBe(0);
    });
  });

  describe("统计功能", () => {
    it("应该正确统计注册的channels和modules", () => {
      ipcGuard.safeRegisterHandler("test:channel1", vi.fn(), "module1");
      ipcGuard.safeRegisterHandler("test:channel2", vi.fn(), "module1");
      ipcGuard.safeRegisterHandler("test:channel3", vi.fn(), "module2");
      ipcGuard.markModuleRegistered("module1");
      ipcGuard.markModuleRegistered("module2");

      const stats = ipcGuard.getStats();

      expect(stats.totalChannels).toBe(3);
      expect(stats.totalModules).toBe(2);
      expect(stats.channels).toHaveLength(3);
      expect(stats.modules).toHaveLength(2);
    });

    it("printStats不应该抛出错误", () => {
      ipcGuard.safeRegisterHandler("test:channel", vi.fn(), "test-module");
      ipcGuard.markModuleRegistered("test-module");

      expect(() => ipcGuard.printStats()).not.toThrow();
    });
  });
});
