/**
 * 数据库IPC处理器单元测试
 * 测试目标: src/main/database/database-ipc.js
 * 覆盖场景: 知识库CRUD、标签管理、统计、备份恢复、路径切换
 *
 * 使用依赖注入模式验证 IPC handlers（同 llm-ipc.test.js 模式）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("database-ipc", () => {
  let handlers;
  let mockDatabase;
  let mockRagManager;
  let mockAppConfig;
  let mockGetAppConfig;
  let mockIpcMain;
  let mockIpcGuard;
  let registerDatabaseIPC;

  /**
   * Helper: extract registered IPC handler by channel name
   */
  function getHandler(channel) {
    return handlers[channel] || null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // Create mock ipcMain that captures handlers (same pattern as llm-ipc.test.js)
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // Mock ipcGuard
    mockIpcGuard = {
      isModuleRegistered: vi.fn().mockReturnValue(false),
      markModuleRegistered: vi.fn(),
    };

    // Mock database
    mockDatabase = {
      getKnowledgeItems: vi.fn(() => [{ id: 1, title: "test" }]),
      getKnowledgeItemById: vi.fn((id) => ({ id, title: "test" })),
      addKnowledgeItem: vi.fn((item) => ({ id: 1, ...item })),
      updateKnowledgeItem: vi.fn((id, updates) => ({ id, ...updates })),
      deleteKnowledgeItem: vi.fn(() => true),
      searchKnowledge: vi.fn(() => [{ id: 1, title: "search result" }]),
      getAllTags: vi.fn(() => [{ id: 1, name: "tag1" }]),
      createTag: vi.fn((name, color) => ({ id: 1, name, color })),
      getKnowledgeTags: vi.fn(() => [{ id: 1, name: "tag1" }]),
      getStatistics: vi.fn(() => ({ total: 10, today: 2, byType: {} })),
      getDatabaseStats: vi.fn(() => ({ size: 1024, tables: 5 })),
      getDatabasePath: vi.fn(() => "/test/db.sqlite"),
      getCurrentDatabasePath: vi.fn(() => "/test/current.db"),
      switchDatabase: vi.fn(),
      backup: vi.fn(),
    };

    // Mock RAG manager
    mockRagManager = {
      addToIndex: vi.fn(),
      updateIndex: vi.fn(),
      removeFromIndex: vi.fn(),
    };

    // Mock app config
    mockAppConfig = {
      createDatabaseBackup: vi.fn(() => "/backup/db-backup.sqlite"),
      listBackups: vi.fn(() => ["/backup1.db", "/backup2.db"]),
      restoreFromBackup: vi.fn(),
      getDatabasePath: vi.fn(() => "/config/db.sqlite"),
      getDefaultDatabasePath: vi.fn(() => "/default/db.sqlite"),
      databaseExists: vi.fn(() => true),
      get: vi.fn((key) => {
        if (key === "database.autoBackup") {
          return true;
        }
        if (key === "database.maxBackups") {
          return 5;
        }
        return null;
      }),
      setDatabasePath: vi.fn(),
      migrateDatabaseTo: vi.fn(),
    };

    mockGetAppConfig = vi.fn(() => mockAppConfig);

    // Dynamic import
    const module = await import("../../../src/main/database/database-ipc.js");
    registerDatabaseIPC = module.registerDatabaseIPC;
  });

  /**
   * Helper: register with standard deps including injected mocks
   */
  function registerWithDeps(overrides = {}) {
    return registerDatabaseIPC({
      database: mockDatabase,
      ragManager: mockRagManager,
      getAppConfig: mockGetAppConfig,
      ipcMain: mockIpcMain,
      ipcGuard: mockIpcGuard,
      ...overrides,
    });
  }

  describe("registerDatabaseIPC", () => {
    it("应该注册所有IPC处理器", () => {
      registerWithDeps();

      const channelCount = Object.keys(handlers).length;
      expect(channelCount).toBeGreaterThanOrEqual(10);
    });

    it("应该在已注册时跳过", () => {
      mockIpcGuard.isModuleRegistered.mockReturnValue(true);

      registerWithDeps();

      expect(Object.keys(handlers).length).toBe(0);
    });

    it("应该标记模块为已注册", () => {
      registerWithDeps();

      expect(mockIpcGuard.markModuleRegistered).toHaveBeenCalledWith(
        "database-ipc",
      );
    });

    it("应该接受依赖参数", () => {
      expect(() => registerWithDeps()).not.toThrow();
    });

    it("应该支持不传ragManager", () => {
      expect(() => registerWithDeps({ ragManager: undefined })).not.toThrow();
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("知识库CRUD操作", () => {
    describe("db:get-knowledge-items", () => {
      it("应该返回知识库项列表", async () => {
        registerWithDeps();
        const handler = getHandler("db:get-knowledge-items");

        const result = await handler({}, 10, 0);

        expect(result).toEqual([{ id: 1, title: "test" }]);
        expect(mockDatabase.getKnowledgeItems).toHaveBeenCalledWith(10, 0);
      });

      it("应该支持分页参数", async () => {
        registerWithDeps();
        const handler = getHandler("db:get-knowledge-items");

        await handler({}, 20, 40);

        expect(mockDatabase.getKnowledgeItems).toHaveBeenCalledWith(20, 40);
      });

      it("应该在数据库未初始化时返回空数组", async () => {
        registerWithDeps({ database: null });
        const handler = getHandler("db:get-knowledge-items");

        const result = await handler({}, 10, 0);

        expect(result).toEqual([]);
      });

      it("应该在错误时返回空数组", async () => {
        mockDatabase.getKnowledgeItems.mockImplementation(() => {
          throw new Error("DB error");
        });
        registerWithDeps();
        const handler = getHandler("db:get-knowledge-items");

        const result = await handler({}, 10, 0);

        expect(result).toEqual([]);
      });
    });

    describe("db:get-knowledge-item-by-id", () => {
      it("应该根据ID返回知识库项", async () => {
        registerWithDeps();
        const handler = getHandler("db:get-knowledge-item-by-id");

        const result = await handler({}, 1);

        expect(result).toEqual({ id: 1, title: "test" });
        expect(mockDatabase.getKnowledgeItemById).toHaveBeenCalledWith(1);
      });

      it("应该在找不到时返回null", async () => {
        mockDatabase.getKnowledgeItemById.mockReturnValue(null);
        registerWithDeps();
        const handler = getHandler("db:get-knowledge-item-by-id");

        const result = await handler({}, 999);

        expect(result).toBeNull();
      });

      it("应该在错误时返回null", async () => {
        mockDatabase.getKnowledgeItemById.mockImplementation(() => {
          throw new Error("DB error");
        });
        registerWithDeps();
        const handler = getHandler("db:get-knowledge-item-by-id");

        const result = await handler({}, 1);

        expect(result).toBeNull();
      });
    });

    describe("db:add-knowledge-item", () => {
      it("应该添加知识库项", async () => {
        registerWithDeps();
        const handler = getHandler("db:add-knowledge-item");
        const newItem = { title: "new item", content: "test content" };

        const result = await handler({}, newItem);

        expect(result).toEqual({ id: 1, ...newItem });
        expect(mockDatabase.addKnowledgeItem).toHaveBeenCalledWith(newItem);
      });

      it("应该同步到RAG索引", async () => {
        registerWithDeps();
        const handler = getHandler("db:add-knowledge-item");
        const newItem = { title: "new item", content: "test content" };

        await handler({}, newItem);

        expect(mockRagManager.addToIndex).toHaveBeenCalledWith({
          id: 1,
          ...newItem,
        });
      });

      it("应该在没有ragManager时只添加数据库", async () => {
        registerWithDeps({ ragManager: null });
        const handler = getHandler("db:add-knowledge-item");
        const newItem = { title: "new item" };

        const result = await handler({}, newItem);

        expect(result).toEqual({ id: 1, ...newItem });
      });

      it("应该在错误时抛出异常", async () => {
        mockDatabase.addKnowledgeItem.mockImplementation(() => {
          throw new Error("Insert failed");
        });
        registerWithDeps();
        const handler = getHandler("db:add-knowledge-item");

        await expect(handler({}, { title: "test" })).rejects.toThrow(
          "Insert failed",
        );
      });
    });

    describe("db:update-knowledge-item", () => {
      it("应该更新知识库项", async () => {
        registerWithDeps();
        const handler = getHandler("db:update-knowledge-item");

        const result = await handler({}, 1, { title: "updated" });

        expect(result).toEqual({ id: 1, title: "updated" });
        expect(mockDatabase.updateKnowledgeItem).toHaveBeenCalledWith(1, {
          title: "updated",
        });
      });

      it("应该同步更新RAG索引", async () => {
        registerWithDeps();
        const handler = getHandler("db:update-knowledge-item");

        await handler({}, 1, { title: "updated" });

        expect(mockRagManager.updateIndex).toHaveBeenCalledWith({
          id: 1,
          title: "updated",
        });
      });

      it("应该在错误时抛出异常", async () => {
        mockDatabase.updateKnowledgeItem.mockImplementation(() => {
          throw new Error("Update failed");
        });
        registerWithDeps();
        const handler = getHandler("db:update-knowledge-item");

        await expect(handler({}, 1, { title: "test" })).rejects.toThrow(
          "Update failed",
        );
      });
    });

    describe("db:delete-knowledge-item", () => {
      it("应该删除知识库项", async () => {
        registerWithDeps();
        const handler = getHandler("db:delete-knowledge-item");

        const result = await handler({}, 1);

        expect(result).toBe(true);
        expect(mockDatabase.deleteKnowledgeItem).toHaveBeenCalledWith(1);
      });

      it("应该从RAG索引移除", async () => {
        registerWithDeps();
        const handler = getHandler("db:delete-knowledge-item");

        await handler({}, 1);

        expect(mockRagManager.removeFromIndex).toHaveBeenCalledWith(1);
      });

      it("应该在错误时返回false", async () => {
        mockDatabase.deleteKnowledgeItem.mockImplementation(() => {
          throw new Error("Delete failed");
        });
        registerWithDeps();
        const handler = getHandler("db:delete-knowledge-item");

        const result = await handler({}, 1);

        expect(result).toBe(false);
      });
    });

    describe("db:search-knowledge-items", () => {
      it("应该搜索知识库项", async () => {
        registerWithDeps();
        const handler = getHandler("db:search-knowledge-items");

        const result = await handler({}, "test query");

        expect(result).toEqual([{ id: 1, title: "search result" }]);
        expect(mockDatabase.searchKnowledge).toHaveBeenCalledWith("test query");
      });

      it("应该在错误时返回空数组", async () => {
        mockDatabase.searchKnowledge.mockImplementation(() => {
          throw new Error("Search failed");
        });
        registerWithDeps();
        const handler = getHandler("db:search-knowledge-items");

        const result = await handler({}, "test");

        expect(result).toEqual([]);
      });
    });
  });

  describe("标签管理", () => {
    describe("db:get-all-tags", () => {
      it("应该返回所有标签", async () => {
        registerWithDeps();
        const result = await getHandler("db:get-all-tags")({});
        expect(result).toEqual([{ id: 1, name: "tag1" }]);
      });

      it("应该在错误时返回空数组", async () => {
        mockDatabase.getAllTags.mockImplementation(() => {
          throw new Error("Tag error");
        });
        registerWithDeps();
        const result = await getHandler("db:get-all-tags")({});
        expect(result).toEqual([]);
      });
    });

    describe("db:create-tag", () => {
      it("应该创建新标签", async () => {
        registerWithDeps();
        const result = await getHandler("db:create-tag")(
          {},
          "newtag",
          "#ff0000",
        );
        expect(result).toEqual({ id: 1, name: "newtag", color: "#ff0000" });
        expect(mockDatabase.createTag).toHaveBeenCalledWith(
          "newtag",
          "#ff0000",
        );
      });

      it("应该在错误时抛出异常", async () => {
        mockDatabase.createTag.mockImplementation(() => {
          throw new Error("Create tag failed");
        });
        registerWithDeps();
        await expect(
          getHandler("db:create-tag")({}, "tag", "#000"),
        ).rejects.toThrow("Create tag failed");
      });
    });

    describe("db:get-knowledge-tags", () => {
      it("应该返回知识库项的标签", async () => {
        registerWithDeps();
        const result = await getHandler("db:get-knowledge-tags")({}, 1);
        expect(result).toEqual([{ id: 1, name: "tag1" }]);
        expect(mockDatabase.getKnowledgeTags).toHaveBeenCalledWith(1);
      });

      it("应该在错误时返回空数组", async () => {
        mockDatabase.getKnowledgeTags.mockImplementation(() => {
          throw new Error("Tag error");
        });
        registerWithDeps();
        const result = await getHandler("db:get-knowledge-tags")({}, 1);
        expect(result).toEqual([]);
      });
    });
  });

  describe("统计信息", () => {
    describe("db:get-statistics", () => {
      it("应该返回统计数据", async () => {
        registerWithDeps();
        const result = await getHandler("db:get-statistics")({});
        expect(result).toEqual({ total: 10, today: 2, byType: {} });
      });

      it("应该在错误时返回默认统计", async () => {
        mockDatabase.getStatistics.mockImplementation(() => {
          throw new Error("Stats error");
        });
        registerWithDeps();
        const result = await getHandler("db:get-statistics")({});
        expect(result).toEqual({ total: 0, today: 0, byType: {} });
      });
    });

    describe("database:get-stats", () => {
      it("应该返回数据库详细统计", async () => {
        registerWithDeps();
        const result = await getHandler("database:get-stats")({});
        expect(result).toEqual({ size: 1024, tables: 5 });
      });

      it("应该在数据库未初始化时返回错误", async () => {
        registerWithDeps({ database: null });
        const result = await getHandler("database:get-stats")({});
        expect(result).toEqual({ error: "数据库未初始化" });
      });

      it("应该在错误时返回错误信息", async () => {
        mockDatabase.getDatabaseStats.mockImplementation(() => {
          throw new Error("Stats failed");
        });
        registerWithDeps();
        const result = await getHandler("database:get-stats")({});
        expect(result).toEqual({ error: "Stats failed" });
      });
    });
  });

  describe("数据库路径与切换", () => {
    describe("db:get-path", () => {
      it("应该返回数据库路径", async () => {
        registerWithDeps();
        const result = await getHandler("db:get-path")({});
        expect(result).toBe("/test/db.sqlite");
      });

      it("应该在数据库未初始化时返回null", async () => {
        registerWithDeps({ database: null });
        const result = await getHandler("db:get-path")({});
        expect(result).toBeNull();
      });
    });

    describe("db:get-current-path", () => {
      it("应该返回当前数据库路径", async () => {
        registerWithDeps();
        const result = await getHandler("db:get-current-path")({});
        expect(result).toBe("/test/current.db");
      });

      it("应该在错误时返回null", async () => {
        mockDatabase.getCurrentDatabasePath.mockImplementation(() => {
          throw new Error("Path error");
        });
        registerWithDeps();
        const result = await getHandler("db:get-current-path")({});
        expect(result).toBeNull();
      });
    });

    describe("db:get-context-path", () => {
      it("应该返回指定上下文的数据库路径", async () => {
        registerWithDeps();
        const result = await getHandler("db:get-context-path")({}, "context-1");
        expect(result).toBe("/test/db.sqlite");
        expect(mockDatabase.getDatabasePath).toHaveBeenCalledWith("context-1");
      });

      it("应该在数据库未初始化时返回null", async () => {
        registerWithDeps({ database: null });
        const result = await getHandler("db:get-context-path")({}, "context-1");
        expect(result).toBeNull();
      });

      it("应该在错误时返回null", async () => {
        mockDatabase.getDatabasePath.mockImplementation(() => {
          throw new Error("Path error");
        });
        registerWithDeps();
        const result = await getHandler("db:get-context-path")({}, "context-1");
        expect(result).toBeNull();
      });
    });

    describe("db:switch-database", () => {
      it("应该切换数据库", async () => {
        registerWithDeps();
        const result = await getHandler("db:switch-database")(
          {},
          "context-1",
          {},
        );
        expect(result).toEqual({ success: true, path: "/test/db.sqlite" });
        expect(mockDatabase.switchDatabase).toHaveBeenCalled();
      });

      it("应该在数据库未初始化时抛出错误", async () => {
        registerWithDeps({ database: null });
        await expect(
          getHandler("db:switch-database")({}, "context-1"),
        ).rejects.toThrow("数据库管理器未初始化");
      });

      it("应该支持选项参数", async () => {
        registerWithDeps();
        const options = { createIfNotExists: true };
        await getHandler("db:switch-database")({}, "context-1", options);
        expect(mockDatabase.switchDatabase).toHaveBeenCalledWith(
          "/test/db.sqlite",
          options,
        );
      });

      it("应该在错误时抛出异常", async () => {
        mockDatabase.switchDatabase.mockRejectedValue(
          new Error("Switch failed"),
        );
        registerWithDeps();
        await expect(
          getHandler("db:switch-database")({}, "context-1"),
        ).rejects.toThrow("Switch failed");
      });
    });
  });

  describe("备份与恢复", () => {
    describe("db:backup", () => {
      it("应该备份数据库到指定路径", async () => {
        registerWithDeps();
        const result = await getHandler("db:backup")({}, "/backup/path.db");
        expect(result).toBe(true);
        expect(mockDatabase.backup).toHaveBeenCalledWith("/backup/path.db");
      });

      it("应该在错误时返回false", async () => {
        mockDatabase.backup.mockRejectedValue(new Error("Backup failed"));
        registerWithDeps();
        const result = await getHandler("db:backup")({}, "/backup/path.db");
        expect(result).toBe(false);
      });
    });

    describe("database:create-backup", () => {
      it("应该创建自动备份", async () => {
        registerWithDeps();
        await getHandler("database:create-backup")({});
        expect(mockGetAppConfig).toHaveBeenCalled();
        expect(mockAppConfig.createDatabaseBackup).toHaveBeenCalled();
      });

      it("应该返回备份路径", async () => {
        registerWithDeps();
        const result = await getHandler("database:create-backup")({});
        expect(result).toBe("/backup/db-backup.sqlite");
      });

      it("应该在错误时抛出异常", async () => {
        mockAppConfig.createDatabaseBackup.mockImplementation(() => {
          throw new Error("Backup create failed");
        });
        registerWithDeps();
        await expect(getHandler("database:create-backup")({})).rejects.toThrow(
          "Backup create failed",
        );
      });
    });

    describe("database:list-backups", () => {
      it("应该列出所有备份", async () => {
        registerWithDeps();
        const result = await getHandler("database:list-backups")({});
        expect(result).toEqual(["/backup1.db", "/backup2.db"]);
      });

      it("应该在错误时抛出异常", async () => {
        mockAppConfig.listBackups.mockImplementation(() => {
          throw new Error("List failed");
        });
        registerWithDeps();
        await expect(getHandler("database:list-backups")({})).rejects.toThrow(
          "List failed",
        );
      });
    });

    describe("database:restore-backup", () => {
      it("应该从备份恢复数据库", async () => {
        registerWithDeps();
        await getHandler("database:restore-backup")({}, "/backup/restore.db");
        expect(mockAppConfig.restoreFromBackup).toHaveBeenCalledWith(
          "/backup/restore.db",
        );
      });

      it("应该返回需要重启的标识", async () => {
        registerWithDeps();
        const result = await getHandler("database:restore-backup")(
          {},
          "/backup/restore.db",
        );
        expect(result).toEqual({ success: true, needsRestart: true });
      });

      it("应该在错误时抛出异常", async () => {
        mockAppConfig.restoreFromBackup.mockImplementation(() => {
          throw new Error("Restore failed");
        });
        registerWithDeps();
        await expect(
          getHandler("database:restore-backup")({}, "/backup/restore.db"),
        ).rejects.toThrow("Restore failed");
      });
    });
  });

  describe("数据库配置", () => {
    describe("database:get-config", () => {
      it("应该返回数据库配置", async () => {
        registerWithDeps();
        const result = await getHandler("database:get-config")({});
        expect(result).toBeDefined();
        expect(result.path).toBe("/config/db.sqlite");
      });

      it("应该包含路径、备份配置等信息", async () => {
        registerWithDeps();
        const result = await getHandler("database:get-config")({});
        expect(result.path).toBe("/config/db.sqlite");
        expect(result.defaultPath).toBe("/default/db.sqlite");
        expect(result.exists).toBe(true);
        expect(result.autoBackup).toBe(true);
        expect(result.maxBackups).toBe(5);
      });

      it("应该在错误时抛出异常", async () => {
        mockGetAppConfig.mockImplementation(() => {
          throw new Error("Config error");
        });
        registerWithDeps();
        await expect(getHandler("database:get-config")({})).rejects.toThrow(
          "Config error",
        );
      });
    });

    describe("database:set-path", () => {
      it("应该设置数据库路径", async () => {
        registerWithDeps();
        const result = await getHandler("database:set-path")(
          {},
          "/new/path.db",
        );
        expect(result).toBe(true);
        expect(mockAppConfig.setDatabasePath).toHaveBeenCalledWith(
          "/new/path.db",
        );
      });

      it("应该在错误时抛出异常", async () => {
        mockAppConfig.setDatabasePath.mockImplementation(() => {
          throw new Error("Set path failed");
        });
        registerWithDeps();
        await expect(
          getHandler("database:set-path")({}, "/bad/path"),
        ).rejects.toThrow("Set path failed");
      });
    });

    describe("database:migrate", () => {
      it("应该迁移数据库到新路径", async () => {
        registerWithDeps();
        const result = await getHandler("database:migrate")({}, "/new/path.db");
        expect(result.success).toBe(true);
        expect(mockAppConfig.migrateDatabaseTo).toHaveBeenCalledWith(
          "/new/path.db",
        );
      });

      it("应该先创建备份", async () => {
        registerWithDeps();
        await getHandler("database:migrate")({}, "/new/path.db");
        expect(mockAppConfig.createDatabaseBackup).toHaveBeenCalled();
      });

      it("应该返回新路径和备份路径", async () => {
        registerWithDeps();
        const result = await getHandler("database:migrate")({}, "/new/path.db");
        expect(result).toEqual({
          success: true,
          newPath: "/new/path.db",
          backupPath: "/backup/db-backup.sqlite",
        });
      });

      it("应该在错误时抛出异常", async () => {
        mockAppConfig.migrateDatabaseTo.mockRejectedValue(
          new Error("Migrate failed"),
        );
        registerWithDeps();
        await expect(
          getHandler("database:migrate")({}, "/new/path.db"),
        ).rejects.toThrow("Migrate failed");
      });
    });
  });

  describe("错误处理", () => {
    it("应该处理null database", async () => {
      registerWithDeps({ database: null });
      const result = await getHandler("db:get-knowledge-items")({}, 10, 0);
      expect(result).toEqual([]);
    });

    it("应该处理undefined database", async () => {
      registerWithDeps({ database: undefined });
      const result = await getHandler("db:get-knowledge-items")({}, 10, 0);
      expect(result).toEqual([]);
    });

    it("应该在IPC处理器中捕获异常", async () => {
      mockDatabase.getKnowledgeItems.mockImplementation(() => {
        throw new Error("Unexpected error");
      });
      registerWithDeps();
      const result = await getHandler("db:get-knowledge-items")({}, 10, 0);
      expect(result).toEqual([]);
    });
  });

  describe("边界情况", () => {
    it("应该处理空依赖对象", () => {
      expect(() => {
        registerDatabaseIPC({
          database: undefined,
          getAppConfig: () => ({}),
          ipcMain: mockIpcMain,
          ipcGuard: mockIpcGuard,
        });
      }).not.toThrow();
    });

    it("应该处理database方法不存在", async () => {
      const emptyDb = {};
      registerWithDeps({ database: emptyDb });
      const result = await getHandler("db:get-knowledge-items")({}, 10, 0);
      expect(result).toEqual([]);
    });

    it("应该处理ragManager为null", async () => {
      registerWithDeps({ ragManager: null });
      const result = await getHandler("db:add-knowledge-item")(
        {},
        { title: "test" },
      );
      expect(result).toEqual({ id: 1, title: "test" });
    });
  });

  describe("模块注册防护", () => {
    it("应该使用ipcGuard防止重复注册", () => {
      mockIpcGuard.isModuleRegistered.mockReturnValue(true);
      registerWithDeps();
      expect(mockIpcGuard.isModuleRegistered).toHaveBeenCalledWith(
        "database-ipc",
      );
      expect(Object.keys(handlers).length).toBe(0);
    });

    it("应该在注册成功后标记模块", () => {
      registerWithDeps();
      expect(mockIpcGuard.markModuleRegistered).toHaveBeenCalledWith(
        "database-ipc",
      );
    });
  });
});
