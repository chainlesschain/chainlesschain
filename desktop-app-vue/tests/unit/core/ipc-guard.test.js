/**
 * IPC Guard 单元测试
 * 测试IPC注册保护机制
 */

import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { EventEmitter } from "events";

describe("IPC Guard", () => {
  let ipcGuard;
  let mockIpcMain;

  beforeEach(async () => {
    // 动态导入模块（ESM）
    const module = await import(
      "../../../src/main/ipc/ipc-guard.js?t=" + Date.now()
    );
    ipcGuard = module.default || module;

    // 创建模拟的ipcMain
    mockIpcMain = new EventEmitter();
    mockIpcMain.handle = vi.fn();
    mockIpcMain.removeHandler = vi.fn();
    mockIpcMain.removeAllListeners = vi.fn();

    // 重置所有状态
    if (ipcGuard.resetAll) {
      if (ipcGuard?.resetAll) {
        ipcGuard.resetAll();
      }
    }
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
      expect(ipcGuard.isChannelRegistered("test:channel")).to.be.true;
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
      expect(ipcGuard.isModuleRegistered("test-module")).to.be.true;
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
      expect(ipcGuard.isChannelRegistered("test:channel")).to.be.true;

      ipcGuard.unregisterChannel("test:channel");
      expect(ipcGuard.isChannelRegistered("test:channel")).to.be.false;
    });

    it("应该能够注销整个模块", () => {
      ipcGuard.safeRegisterHandler("test:channel1", vi.fn(), "test-module");
      ipcGuard.safeRegisterHandler("test:channel2", vi.fn(), "test-module");
      ipcGuard.markModuleRegistered("test-module");

      expect(ipcGuard.isModuleRegistered("test-module")).to.be.true;
      expect(ipcGuard.isChannelRegistered("test:channel1")).to.be.true;
      expect(ipcGuard.isChannelRegistered("test:channel2")).to.be.true;

      ipcGuard.unregisterModule("test-module");

      expect(ipcGuard.isModuleRegistered("test-module")).to.be.false;
      expect(ipcGuard.isChannelRegistered("test:channel1")).to.be.false;
      expect(ipcGuard.isChannelRegistered("test:channel2")).to.be.false;
    });

    it("应该能够重置所有注册", () => {
      ipcGuard.safeRegisterHandler("test:channel1", vi.fn(), "module1");
      ipcGuard.safeRegisterHandler("test:channel2", vi.fn(), "module2");
      ipcGuard.markModuleRegistered("module1");
      ipcGuard.markModuleRegistered("module2");

      const beforeStats = ipcGuard.getStats();
      expect(beforeStats.totalChannels).toBe(2);
      expect(beforeStats.totalModules).toBe(2);

      if (ipcGuard?.resetAll) {
        ipcGuard.resetAll();
      }

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
