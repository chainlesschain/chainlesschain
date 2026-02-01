/**
 * CommandHistoryHandler 单元测试
 */

import { vi } from 'vitest';
const CommandHistoryHandler = require("../../../src/main/remote/handlers/command-history-handler");

describe("CommandHistoryHandler", () => {
  let handler;
  let mockDatabase;

  beforeEach(() => {
    // Mock Database
    mockDatabase = {
      exec: vi.fn(),
      run: vi.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
      get: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue([]),
    };

    handler = new CommandHistoryHandler(mockDatabase, {
      enableAutoCleanup: false, // 禁用自动清理以便测试
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (handler.cleanupTimer) {
      handler.stopAutoCleanup();
    }
  });

  describe("initialization", () => {
    it("应该初始化数据库表", () => {
      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS command_history"),
      );

      expect(mockDatabase.exec).toHaveBeenCalledWith(
        expect.stringContaining("CREATE INDEX"),
      );
    });
  });

  describe("recordCommand", () => {
    it("应该成功记录命令执行", async () => {
      const commandData = {
        requestId: "req-001",
        method: "ai.chat",
        params: { message: "Hello" },
        context: { did: "did:example:123", channel: "p2p" },
        result: { response: "Hi there" },
        error: null,
        duration: 150,
        timestamp: Date.now(),
      };

      await handler.recordCommand(commandData);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO command_history"),
        expect.arrayContaining([
          "req-001",
          "ai.chat",
          JSON.stringify({ message: "Hello" }),
          "did:example:123",
          "p2p",
          JSON.stringify({ response: "Hi there" }),
          null,
          150,
          "success",
          expect.any(Number),
        ]),
      );
    });

    it("应该记录失败的命令", async () => {
      const commandData = {
        requestId: "req-002",
        method: "file.read",
        params: { path: "/test" },
        context: { did: "did:example:123", channel: "p2p" },
        result: null,
        error: { code: -32001, message: "File not found" },
        duration: 50,
        timestamp: Date.now(),
      };

      await handler.recordCommand(commandData);

      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO command_history"),
        expect.arrayContaining([
          "req-002",
          "file.read",
          expect.any(String),
          "did:example:123",
          "p2p",
          null,
          JSON.stringify({ code: -32001, message: "File not found" }),
          50,
          "failed",
          expect.any(Number),
        ]),
      );
    });
  });

  describe("getHistory", () => {
    it("应该成功获取命令历史", async () => {
      const params = { limit: 50, offset: 0 };
      const context = {};

      const mockHistory = [
        {
          id: 1,
          request_id: "req-001",
          method: "ai.chat",
          params: '{"message":"Hello"}',
          result: '{"response":"Hi"}',
          error: null,
          status: "success",
        },
      ];

      mockDatabase.all.mockResolvedValue(mockHistory);

      const result = await handler.getHistory(params, context);

      expect(result.history).toHaveLength(1);
      expect(result.history[0].params).toEqual({ message: "Hello" });
      expect(result.history[0].result).toEqual({ response: "Hi" });
      expect(result.total).toBe(1);
    });

    it("应该支持按状态筛选", async () => {
      const params = { status: "failed", limit: 50, offset: 0 };
      const context = {};

      mockDatabase.all.mockResolvedValue([]);

      await handler.getHistory(params, context);

      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = ?"),
        expect.arrayContaining(["failed", 50, 0]),
      );
    });
  });

  describe("getById", () => {
    it("应该成功获取指定命令", async () => {
      const params = { id: 1 };
      const context = {};

      const mockCommand = {
        id: 1,
        request_id: "req-001",
        method: "ai.chat",
        params: "{}",
        result: "{}",
        error: null,
      };

      mockDatabase.get.mockResolvedValue(mockCommand);

      const result = await handler.getById(params, context);

      expect(result.id).toBe(1);
      expect(result.params).toEqual({});
    });

    it("命令不存在时应该抛出错误", async () => {
      const params = { id: 999 };
      const context = {};

      mockDatabase.get.mockResolvedValue(null);

      await expect(handler.getById(params, context)).rejects.toThrow(
        "Command not found",
      );
    });
  });

  describe("searchHistory", () => {
    it("应该成功搜索命令历史", async () => {
      const params = { query: "ai.chat", limit: 50 };
      const context = {};

      const mockResults = [
        {
          id: 1,
          method: "ai.chat",
          params: "{}",
          result: "{}",
          error: null,
        },
      ];

      mockDatabase.all.mockResolvedValue(mockResults);

      const result = await handler.searchHistory(params, context);

      expect(result.results).toHaveLength(1);
      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining(
          "WHERE method LIKE ? OR params LIKE ? OR device_did LIKE ?",
        ),
        ["%ai.chat%", "%ai.chat%", "%ai.chat%", 50],
      );
    });
  });

  describe("getStats", () => {
    it("应该成功获取统计信息", async () => {
      const params = { days: 7 };
      const context = {};

      mockDatabase.get
        .mockResolvedValueOnce({ total: 100 })
        .mockResolvedValueOnce({ count: 90 })
        .mockResolvedValueOnce({ count: 10 });

      mockDatabase.all
        .mockResolvedValueOnce([
          { method: "ai.chat", count: 50, avg_duration: 200 },
        ])
        .mockResolvedValueOnce([{ device_did: "did:example:123", count: 100 }])
        .mockResolvedValueOnce([{ hour: "2026-02-01 10:00", count: 10 }]);

      const result = await handler.getStats(params, context);

      expect(result.summary.total).toBe(100);
      expect(result.summary.success).toBe(90);
      expect(result.summary.failed).toBe(10);
      expect(result.summary.successRate).toBe("90.00%");
      expect(result.byMethod).toHaveLength(1);
      expect(result.byDevice).toHaveLength(1);
      expect(result.byTime).toHaveLength(1);
    });
  });

  describe("exportHistory", () => {
    it("应该导出为 JSON 格式", async () => {
      const params = { format: "json" };
      const context = {};

      const mockHistory = [
        {
          id: 1,
          request_id: "req-001",
          method: "ai.chat",
          params: "{}",
          result: "{}",
          error: null,
        },
      ];

      mockDatabase.all.mockResolvedValue(mockHistory);

      const result = await handler.exportHistory(params, context);

      expect(result.format).toBe("json");
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("应该导出为 CSV 格式", async () => {
      const params = { format: "csv" };
      const context = {};

      const mockHistory = [
        {
          id: 1,
          request_id: "req-001",
          method: "ai.chat",
          device_did: "did:example:123",
          channel: "p2p",
          status: "success",
          duration: 150,
          created_at: Date.now(),
        },
      ];

      mockDatabase.all.mockResolvedValue(mockHistory);

      const result = await handler.exportHistory(params, context);

      expect(result.format).toBe("csv");
      expect(result.data).toContain("ID,Request ID,Method");
      expect(result.data).toContain("ai.chat");
    });

    it("应该支持时间范围筛选", async () => {
      const params = {
        format: "json",
        startTime: Date.now() - 86400000,
        endTime: Date.now(),
      };

      const context = {};

      mockDatabase.all.mockResolvedValue([]);

      await handler.exportHistory(params, context);

      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining("created_at >= ?"),
        expect.any(Array),
      );
    });
  });

  describe("clearHistory", () => {
    it("应该成功清除历史", async () => {
      const params = { beforeTime: Date.now() - 86400000 };
      const context = {};

      mockDatabase.run.mockResolvedValue({ changes: 50 });

      const result = await handler.clearHistory(params, context);

      expect(result.deleted).toBe(50);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM command_history"),
        expect.any(Array),
      );
    });
  });

  describe("getByDevice", () => {
    it("应该成功按设备获取历史", async () => {
      const params = { deviceDid: "did:example:123", limit: 50, offset: 0 };
      const context = {};

      const mockHistory = [
        {
          id: 1,
          device_did: "did:example:123",
          method: "ai.chat",
          params: "{}",
          result: "{}",
          error: null,
        },
      ];

      mockDatabase.all.mockResolvedValue(mockHistory);

      const result = await handler.getByDevice(params, context);

      expect(result.deviceDid).toBe("did:example:123");
      expect(result.history).toHaveLength(1);
    });
  });

  describe("getByTimeRange", () => {
    it("应该成功按时间范围获取历史", async () => {
      const startTime = Date.now() - 86400000;
      const endTime = Date.now();

      const params = { startTime, endTime, limit: 100 };
      const context = {};

      mockDatabase.all.mockResolvedValue([]);

      const result = await handler.getByTimeRange(params, context);

      expect(result.startTime).toBe(startTime);
      expect(result.endTime).toBe(endTime);
      expect(mockDatabase.all).toHaveBeenCalledWith(
        expect.stringContaining("created_at >= ? AND created_at <= ?"),
        [startTime, endTime, 100],
      );
    });
  });

  describe("autoCleanup", () => {
    it("应该启动自动清理", () => {
      const handlerWithCleanup = new CommandHistoryHandler(mockDatabase, {
        enableAutoCleanup: true,
        cleanupInterval: 1000,
      });

      expect(handlerWithCleanup.cleanupTimer).toBeDefined();

      handlerWithCleanup.stopAutoCleanup();
    });

    it("应该清理过期历史", async () => {
      mockDatabase.run.mockResolvedValue({ changes: 10 });

      const deleted = await handler.cleanupOldHistory();

      expect(deleted).toBe(10);
      expect(mockDatabase.run).toHaveBeenCalledWith(
        "DELETE FROM command_history WHERE created_at < ?",
        expect.any(Array),
      );
    });
  });

  describe("handle", () => {
    it("应该正确路由到 getHistory", async () => {
      const params = { limit: 10 };
      const context = {};

      mockDatabase.all.mockResolvedValue([]);

      const result = await handler.handle("getHistory", params, context);

      expect(result.history).toBeDefined();
    });

    it("未知动作应该抛出错误", async () => {
      await expect(handler.handle("unknownAction", {}, {})).rejects.toThrow(
        "Unknown action: unknownAction",
      );
    });
  });
});
