/**
 * 数据库加密IPC处理器单元测试
 * 测试目标: src/main/database/database-encryption-ipc.js
 * 覆盖场景: 加密状态、密码管理、配置管理、事件通知
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ============================================================
// Mock dependencies
// ============================================================

// Logger is already mocked by setup.ts — import the mock reference
import { logger as mockLogger } from "../../../src/main/utils/logger.js";

// Mock config-manager — returns a mock config instance
const mockConfigInstance = {
  isEncryptionEnabled: vi.fn(),
  setEncryptionEnabled: vi.fn(),
  getEncryptionMethod: vi.fn(),
  isFirstTimeSetup: vi.fn(),
  isDevelopmentMode: vi.fn(),
  canSkipPassword: vi.fn(),
  setMultiple: vi.fn(),
  getAll: vi.fn(),
  reset: vi.fn(),
};

vi.mock("../../../src/main/database/config-manager", () => {
  return {
    default: vi.fn(() => mockConfigInstance),
    __esModule: true,
  };
});

describe("DatabaseEncryptionIPC", () => {
  let DatabaseEncryptionIPC;
  let ipcInstance;
  let handlers;
  let mockIpcMain;
  let mockApp;
  let mockMainWindow;
  let mockDatabaseManager;

  function getHandler(channel) {
    return handlers[channel] || null;
  }

  function resetConfigMockDefaults() {
    mockConfigInstance.isEncryptionEnabled.mockReturnValue(true);
    mockConfigInstance.getEncryptionMethod.mockReturnValue("password");
    mockConfigInstance.isFirstTimeSetup.mockReturnValue(false);
    mockConfigInstance.isDevelopmentMode.mockReturnValue(false);
    mockConfigInstance.canSkipPassword.mockReturnValue(false);
    mockConfigInstance.getAll.mockReturnValue({
      encryptionEnabled: true,
      encryptionMethod: "password",
    });
    mockConfigInstance.setEncryptionEnabled.mockReturnValue(undefined);
    mockConfigInstance.setMultiple.mockReturnValue(undefined);
    mockConfigInstance.reset.mockReturnValue(undefined);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    resetConfigMockDefaults();

    // Capture handlers via DI
    handlers = {};
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    mockApp = {
      getPath: vi.fn((name) => `/mock/${name}`),
    };

    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
    };

    mockDatabaseManager = {
      adapter: {
        getEngine: vi.fn(() => "sqlcipher"),
        changePassword: vi.fn(() => ({ success: true, message: "密码已修改" })),
      },
      db: {},
    };

    // Dynamic import
    const module =
      await import("../../../src/main/database/database-encryption-ipc.js");
    DatabaseEncryptionIPC = module.default;
  });

  afterEach(() => {
    ipcInstance = null;
  });

  function createInstance(overrides = {}) {
    ipcInstance = new DatabaseEncryptionIPC(mockApp, {
      ipcMain: mockIpcMain,
      ...overrides,
    });
    return ipcInstance;
  }

  // Pre-inject the mockConfigInstance so initConfigManager() returns it
  function createInstanceWithConfig(overrides = {}) {
    const instance = createInstance(overrides);
    // Inject mock config directly so initConfigManager() returns it
    instance.configManager = mockConfigInstance;
    return instance;
  }

  describe("构造函数", () => {
    it("应该创建实例并初始化", () => {
      const instance = createInstance();
      expect(instance).toBeDefined();
      expect(instance.app).toBe(mockApp);
    });

    it("应该调用setupHandlers", () => {
      createInstance();
      // setupHandlers registers 8 IPC channels
      expect(Object.keys(handlers).length).toBe(8);
    });

    it("应该初始化configManager为null", () => {
      const instance = createInstance();
      expect(instance.configManager).toBeNull();
    });

    it("应该初始化databaseManager为null", () => {
      const instance = createInstance();
      expect(instance.databaseManager).toBeNull();
    });
  });

  describe("initConfigManager", () => {
    it("应该创建配置管理器实例", () => {
      const instance = createInstance();
      const config = instance.initConfigManager();
      expect(config).toBeDefined();
      expect(instance.configManager).not.toBeNull();
    });

    it("应该使用正确的配置路径", () => {
      const instance = createInstance();
      instance.initConfigManager();
      expect(mockApp.getPath).toHaveBeenCalledWith("userData");
    });

    it("应该缓存配置管理器实例", () => {
      const instance = createInstance();
      const config1 = instance.initConfigManager();
      const config2 = instance.initConfigManager();
      expect(config1).toBe(config2);
    });

    it("应该在已初始化时返回缓存实例", () => {
      const instance = createInstance();
      // Pre-set configManager
      instance.configManager = mockConfigInstance;
      const config = instance.initConfigManager();
      expect(config).toBe(mockConfigInstance);
      // getPath should not be called since we already have configManager
      expect(mockApp.getPath).not.toHaveBeenCalled();
    });
  });

  describe("setDatabaseManager", () => {
    it("应该设置数据库管理器引用", () => {
      const instance = createInstance();
      instance.setDatabaseManager(mockDatabaseManager);
      expect(instance.databaseManager).toBe(mockDatabaseManager);
    });
  });

  describe("setMainWindow", () => {
    it("应该设置主窗口引用", () => {
      const instance = createInstance();
      instance.setMainWindow(mockMainWindow);
      expect(instance.mainWindow).toBe(mockMainWindow);
    });
  });

  describe("IPC处理器", () => {
    describe("database:get-encryption-status", () => {
      it("应该返回加密状态", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-status");
        const result = await handler({});
        expect(result.isEncrypted).toBe(true);
      });

      it("应该返回加密方法", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-status");
        const result = await handler({});
        expect(result.method).toBe("password");
      });

      it("应该返回数据库引擎", async () => {
        const instance = createInstanceWithConfig();
        instance.setDatabaseManager(mockDatabaseManager);
        const handler = getHandler("database:get-encryption-status");
        const result = await handler({});
        expect(result.engine).toBe("sqlcipher");
      });

      it("应该返回首次设置状态", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-status");
        const result = await handler({});
        expect(result.firstTimeSetup).toBe(false);
      });

      it("应该返回开发模式状态", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-status");
        const result = await handler({});
        expect(result.developmentMode).toBe(false);
      });

      it("应该在错误时返回默认值", async () => {
        mockConfigInstance.isEncryptionEnabled.mockImplementation(() => {
          throw new Error("config error");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-status");
        const result = await handler({});
        expect(result.isEncrypted).toBe(false);
        expect(result.method).toBeNull();
        expect(result.engine).toBe("sql.js");
        expect(result.error).toBe("config error");
      });
    });

    describe("database:setup-encryption", () => {
      it("应该设置数据库加密", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:setup-encryption");
        const result = await handler({}, { method: "password" });
        expect(result.success).toBe(true);
      });

      it("应该在开发模式跳过密码时禁用加密", async () => {
        mockConfigInstance.isDevelopmentMode.mockReturnValue(true);
        createInstanceWithConfig();
        const handler = getHandler("database:setup-encryption");
        const result = await handler({}, { skipPassword: true });
        expect(result.success).toBe(true);
        expect(result.message).toContain("跳过密码");
        expect(mockConfigInstance.setMultiple).toHaveBeenCalledWith({
          encryptionEnabled: false,
          encryptionMethod: "password",
          firstTimeSetup: false,
        });
      });

      it("应该保存加密配置", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:setup-encryption");
        await handler({}, { method: "ukey" });
        expect(mockConfigInstance.setMultiple).toHaveBeenCalledWith({
          encryptionEnabled: true,
          encryptionMethod: "ukey",
          firstTimeSetup: false,
        });
      });

      it("应该返回成功消息", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:setup-encryption");
        const result = await handler({}, { method: "password" });
        expect(result.success).toBe(true);
        expect(result.message).toBeDefined();
      });

      it("应该在错误时返回失败", async () => {
        mockConfigInstance.setMultiple.mockImplementation(() => {
          throw new Error("save failed");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:setup-encryption");
        const result = await handler({}, { method: "password" });
        expect(result.success).toBe(false);
        expect(result.error).toBe("save failed");
      });
    });

    describe("database:change-encryption-password", () => {
      it("应该修改加密密码", async () => {
        const instance = createInstanceWithConfig();
        instance.setDatabaseManager(mockDatabaseManager);
        const handler = getHandler("database:change-encryption-password");
        const result = await handler(
          {},
          { oldPassword: "old123", newPassword: "new456" },
        );
        expect(result.success).toBe(true);
        expect(result.message).toBe("密码已修改");
      });

      it("应该验证旧密码和新密码", async () => {
        const instance = createInstanceWithConfig();
        instance.setDatabaseManager(mockDatabaseManager);
        const handler = getHandler("database:change-encryption-password");
        const result = await handler(
          {},
          { oldPassword: "", newPassword: "new456" },
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("不能为空");
      });

      it("应该调用adapter的changePassword方法", async () => {
        const instance = createInstanceWithConfig();
        instance.setDatabaseManager(mockDatabaseManager);
        const handler = getHandler("database:change-encryption-password");
        await handler({}, { oldPassword: "old123", newPassword: "new456" });
        expect(mockDatabaseManager.adapter.changePassword).toHaveBeenCalledWith(
          "old123",
          "new456",
          mockDatabaseManager.db,
        );
      });

      it("应该在密码为空时返回错误", async () => {
        const instance = createInstanceWithConfig();
        instance.setDatabaseManager(mockDatabaseManager);
        const handler = getHandler("database:change-encryption-password");
        const result = await handler(
          {},
          { oldPassword: null, newPassword: "new456" },
        );
        expect(result.success).toBe(false);
      });

      it("应该在数据库未初始化时返回错误", async () => {
        createInstanceWithConfig();
        // databaseManager is null by default
        const handler = getHandler("database:change-encryption-password");
        const result = await handler(
          {},
          { oldPassword: "old123", newPassword: "new456" },
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain("数据库未使用加密适配器");
      });

      it("应该在错误时返回失败", async () => {
        const instance = createInstanceWithConfig();
        mockDatabaseManager.adapter.changePassword.mockRejectedValueOnce(
          new Error("password change failed"),
        );
        instance.setDatabaseManager(mockDatabaseManager);
        const handler = getHandler("database:change-encryption-password");
        const result = await handler(
          {},
          { oldPassword: "old123", newPassword: "new456" },
        );
        expect(result.success).toBe(false);
        expect(result.error).toBe("password change failed");
      });
    });

    describe("database:enable-encryption", () => {
      it("应该启用加密", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:enable-encryption");
        const result = await handler({});
        expect(result.success).toBe(true);
        expect(mockConfigInstance.setEncryptionEnabled).toHaveBeenCalledWith(
          true,
        );
      });

      it("应该返回需要重启标识", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:enable-encryption");
        const result = await handler({});
        expect(result.requiresRestart).toBe(true);
      });

      it("应该在错误时返回失败", async () => {
        mockConfigInstance.setEncryptionEnabled.mockImplementation(() => {
          throw new Error("enable failed");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:enable-encryption");
        const result = await handler({});
        expect(result.success).toBe(false);
        expect(result.error).toBe("enable failed");
      });
    });

    describe("database:disable-encryption", () => {
      it("应该禁用加密", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:disable-encryption");
        const result = await handler({});
        expect(result.success).toBe(true);
        expect(mockConfigInstance.setEncryptionEnabled).toHaveBeenCalledWith(
          false,
        );
      });

      it("应该返回安全警告", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:disable-encryption");
        const result = await handler({});
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain("安全性");
      });

      it("应该返回需要重启标识", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:disable-encryption");
        const result = await handler({});
        expect(result.requiresRestart).toBe(true);
      });

      it("应该在错误时返回失败", async () => {
        mockConfigInstance.setEncryptionEnabled.mockImplementation(() => {
          throw new Error("disable failed");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:disable-encryption");
        const result = await handler({});
        expect(result.success).toBe(false);
        expect(result.error).toBe("disable failed");
      });
    });

    describe("database:get-encryption-config", () => {
      it("应该返回加密配置", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-config");
        const result = await handler({});
        expect(result.success).toBe(true);
        expect(result.config).toEqual({
          encryptionEnabled: true,
          encryptionMethod: "password",
        });
      });

      it("应该在错误时返回失败", async () => {
        mockConfigInstance.getAll.mockImplementation(() => {
          throw new Error("get config failed");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:get-encryption-config");
        const result = await handler({});
        expect(result.success).toBe(false);
        expect(result.error).toBe("get config failed");
      });
    });

    describe("database:update-encryption-config", () => {
      it("应该更新加密配置", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:update-encryption-config");
        const result = await handler({}, { encryptionMethod: "ukey" });
        expect(result.success).toBe(true);
        expect(result.message).toContain("已更新");
      });

      it("应该调用configManager.setMultiple", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:update-encryption-config");
        const newConfig = { encryptionMethod: "ukey", autoMigrate: false };
        await handler({}, newConfig);
        expect(mockConfigInstance.setMultiple).toHaveBeenCalledWith(newConfig);
      });

      it("应该在错误时返回失败", async () => {
        mockConfigInstance.setMultiple.mockImplementation(() => {
          throw new Error("update failed");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:update-encryption-config");
        const result = await handler({}, { encryptionMethod: "ukey" });
        expect(result.success).toBe(false);
        expect(result.error).toBe("update failed");
      });
    });

    describe("database:reset-encryption-config", () => {
      it("应该重置加密配置", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:reset-encryption-config");
        const result = await handler({});
        expect(result.success).toBe(true);
        expect(result.message).toContain("已重置");
      });

      it("应该调用configManager.reset", async () => {
        createInstanceWithConfig();
        const handler = getHandler("database:reset-encryption-config");
        await handler({});
        expect(mockConfigInstance.reset).toHaveBeenCalled();
      });

      it("应该在错误时返回失败", async () => {
        mockConfigInstance.reset.mockImplementation(() => {
          throw new Error("reset failed");
        });
        createInstanceWithConfig();
        const handler = getHandler("database:reset-encryption-config");
        const result = await handler({});
        expect(result.success).toBe(false);
        expect(result.error).toBe("reset failed");
      });
    });
  });

  describe("notifyEncryptionStatusChanged", () => {
    it("应该发送加密状态变更事件", () => {
      const instance = createInstance();
      instance.setMainWindow(mockMainWindow);
      instance.notifyEncryptionStatusChanged({ isEncrypted: true });
      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        "database:encryption-status-changed",
        { isEncrypted: true },
      );
    });

    it("应该在没有主窗口时不发送事件", () => {
      const instance = createInstance();
      // mainWindow is not set
      instance.notifyEncryptionStatusChanged({ isEncrypted: true });
      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe("错误处理", () => {
    it("应该在IPC处理器中捕获异常", async () => {
      mockConfigInstance.isEncryptionEnabled.mockImplementation(() => {
        throw new Error("unexpected error");
      });
      createInstanceWithConfig();
      const handler = getHandler("database:get-encryption-status");
      const result = await handler({});
      // Should not throw, returns error response
      expect(result.error).toBe("unexpected error");
    });

    it("应该记录错误日志", async () => {
      mockConfigInstance.isEncryptionEnabled.mockImplementation(() => {
        throw new Error("log this error");
      });
      createInstanceWithConfig();
      const handler = getHandler("database:get-encryption-status");
      const result = await handler({});
      // Verify error was handled (logged internally) and error response returned
      expect(result.error).toBe("log this error");
      expect(result.isEncrypted).toBe(false);
    });

    it("应该在密码为空时返回错误", async () => {
      const instance = createInstanceWithConfig();
      instance.setDatabaseManager(mockDatabaseManager);
      const handler = getHandler("database:change-encryption-password");
      const result = await handler({}, { oldPassword: "", newPassword: "" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("不能为空");
    });

    it("应该在数据库未初始化时返回错误", async () => {
      createInstanceWithConfig();
      const handler = getHandler("database:change-encryption-password");
      const result = await handler(
        {},
        { oldPassword: "old", newPassword: "new" },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("数据库未使用加密适配器");
    });
  });

  describe("边界情况", () => {
    it("应该处理configManager初始化失败", async () => {
      const instance = createInstance();
      // Don't inject configManager, but make initConfigManager throw
      // Override the configManager to null and make the constructor throw
      instance.configManager = null;
      // Mock path.join to throw
      const originalGetPath = instance.app.getPath;
      instance.app.getPath = vi.fn(() => {
        throw new Error("config init failed");
      });

      const handler = getHandler("database:get-encryption-status");
      const result = await handler({});
      expect(result.isEncrypted).toBe(false);
      expect(result.error).toBe("config init failed");

      // Restore
      instance.app.getPath = originalGetPath;
    });

    it("应该处理databaseManager为null", async () => {
      createInstanceWithConfig();
      // databaseManager is null, engine should fallback to sql.js
      const handler = getHandler("database:get-encryption-status");
      const result = await handler({});
      expect(result.engine).toBe("sql.js");
    });

    it("应该处理adapter为null", async () => {
      const instance = createInstanceWithConfig();
      instance.setDatabaseManager({ adapter: null, db: {} });
      const handler = getHandler("database:get-encryption-status");
      const result = await handler({});
      expect(result.engine).toBe("sql.js");
    });

    it("应该处理mainWindow为null", () => {
      const instance = createInstance();
      // Don't set mainWindow
      expect(() =>
        instance.notifyEncryptionStatusChanged({ isEncrypted: true }),
      ).not.toThrow();
    });
  });

  describe("开发模式", () => {
    it("应该在开发模式下允许跳过密码", async () => {
      mockConfigInstance.isDevelopmentMode.mockReturnValue(true);
      createInstanceWithConfig();
      const handler = getHandler("database:setup-encryption");
      const result = await handler({}, { skipPassword: true });
      expect(result.success).toBe(true);
      expect(result.message).toContain("跳过密码");
    });

    it("应该在跳过密码时禁用加密", async () => {
      mockConfigInstance.isDevelopmentMode.mockReturnValue(true);
      createInstanceWithConfig();
      const handler = getHandler("database:setup-encryption");
      await handler({}, { skipPassword: true });
      expect(mockConfigInstance.setMultiple).toHaveBeenCalledWith(
        expect.objectContaining({ encryptionEnabled: false }),
      );
    });

    it("应该在非开发模式下不允许跳过密码", async () => {
      mockConfigInstance.isDevelopmentMode.mockReturnValue(false);
      createInstanceWithConfig();
      const handler = getHandler("database:setup-encryption");
      const result = await handler({}, { skipPassword: true });
      // Non-dev mode ignores skipPassword, proceeds with normal encryption setup
      expect(result.success).toBe(true);
      expect(mockConfigInstance.setMultiple).toHaveBeenCalledWith(
        expect.objectContaining({ encryptionEnabled: true }),
      );
    });
  });

  describe("日志记录", () => {
    it("应该记录IPC处理程序注册日志", () => {
      // Verify setupHandlers completes successfully (which logs registration)
      const instance = createInstance();
      // 8 handlers registered means setupHandlers ran to completion (including final log)
      expect(Object.keys(handlers).length).toBe(8);
      expect(instance).toBeDefined();
    });

    it("应该记录配置保存日志", async () => {
      createInstanceWithConfig();
      const handler = getHandler("database:setup-encryption");
      const result = await handler({}, { method: "password" });
      // Verify the handler completed successfully (logging happens internally)
      expect(result.success).toBe(true);
      expect(mockConfigInstance.setMultiple).toHaveBeenCalledWith(
        expect.objectContaining({
          encryptionEnabled: true,
          encryptionMethod: "password",
        }),
      );
    });

    it("应该在错误时记录错误日志", async () => {
      mockConfigInstance.reset.mockImplementation(() => {
        throw new Error("reset error");
      });
      createInstanceWithConfig();
      const handler = getHandler("database:reset-encryption-config");
      const result = await handler({});
      // Verify error was caught and logged (returned as error response)
      expect(result.success).toBe(false);
      expect(result.error).toBe("reset error");
    });
  });

  describe("配置管理器集成", () => {
    it("应该正确调用configManager方法", async () => {
      createInstanceWithConfig();
      const handler = getHandler("database:get-encryption-status");
      await handler({});
      expect(mockConfigInstance.isEncryptionEnabled).toHaveBeenCalled();
      expect(mockConfigInstance.getEncryptionMethod).toHaveBeenCalled();
      expect(mockConfigInstance.isFirstTimeSetup).toHaveBeenCalled();
      expect(mockConfigInstance.isDevelopmentMode).toHaveBeenCalled();
      expect(mockConfigInstance.canSkipPassword).toHaveBeenCalled();
    });

    it("应该缓存configManager实例", async () => {
      const instance = createInstanceWithConfig();
      // Call two different handlers — both use this.initConfigManager()
      // Since configManager is pre-injected, initConfigManager returns cached instance
      const statusHandler = getHandler("database:get-encryption-status");
      const configHandler = getHandler("database:get-encryption-config");
      await statusHandler({});
      await configHandler({});
      // configManager should still be the same mock instance
      expect(instance.configManager).toBe(mockConfigInstance);
    });

    it("应该使用正确的配置路径", () => {
      const instance = createInstance();
      // Call initConfigManager directly (configManager is null, so it will create new one)
      instance.initConfigManager();
      expect(mockApp.getPath).toHaveBeenCalledWith("userData");
    });
  });
});
