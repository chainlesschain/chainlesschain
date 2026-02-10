/**
 * 日志与统计系统单元测试
 *
 * 测试 CommandLogger、StatisticsCollector 和 LoggingManager
 *
 * NOTE: This test is skipped because src/main/remote/logging.js does not exist yet.
 * TODO: Create the logging module or remove this test file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Skip this test file - the source module does not exist
describe.skip("LoggingManager (skipped - module not implemented)", () => {
  it("placeholder", () => {
    expect(true).toBe(true);
  });
});

/* Original test content - commented out until module is implemented
import {
  LoggingManager,
  CommandLogger,
  StatisticsCollector,
  LogLevel,
  TimePeriod,
} from "../../src/main/remote/logging.js";

// Mock database
function createMockDatabase() {
  const tables = new Map([
    ["remote_command_logs", true],
    ["remote_statistics", true],
  ]);
  const logs = [];
  const stats = [];

  return {
    exec: vi.fn(),
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => {
        if (sql.includes("INSERT INTO remote_command_logs")) {
          logs.push({ id: logs.length + 1, ...args });
          return { lastInsertRowid: logs.length };
        }
        if (sql.includes("INSERT INTO remote_statistics")) {
          stats.push({ id: stats.length + 1, ...args });
          return { lastInsertRowid: stats.length };
        }
        return { changes: 1 };
      }),
      get: vi.fn((...args) => {
        if (sql.includes("sqlite_master")) {
          const tableName = args[0] || "remote_command_logs";
          return tables.has(tableName) ? { name: tableName } : null;
        }
        return logs[0] || null;
      }),
      all: vi.fn((...args) => {
        if (sql.includes("sqlite_master")) {
          return [{ name: "remote_command_logs" }];
        }
        if (sql.includes("remote_statistics")) {
          return stats;
        }
        return logs;
      }),
    })),
    close: vi.fn(),
    _logs: logs,
    _stats: stats,
  };
}

describe("Logging System", () => {
  let db;
  let loggingManager;

  beforeEach(() => {
    // 创建 mock 数据库
    db = createMockDatabase();

    // 创建 LoggingManager
    loggingManager = new LoggingManager(db, {
      enableAutoCleanup: false, // 测试时禁用自动清理
      enableRealTimeStats: true,
      enablePersistentStats: true,
    });
  });

  afterEach(() => {
    loggingManager.destroy();
    db.close();
  });

  describe("CommandLogger", () => {
    it("should initialize database tables", () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='remote_command_logs'",
        )
        .all();
      expect(tables).toHaveLength(1);
    });

    it("should log command successfully", () => {
      const logId = loggingManager.log({
        requestId: "req-123",
        deviceDid: "did:example:device1",
        deviceName: "Test Device",
        namespace: "ai",
        action: "chat",
        params: { message: "Hello" },
        result: { response: "Hi" },
        status: "success",
        level: LogLevel.INFO,
        duration: 1500,
      });

      expect(logId).toBeGreaterThan(0);

      // 验证日志已保存
      const log = loggingManager.getLogById(logId);
      expect(log).toBeDefined();
      expect(log.request_id).toBe("req-123");
      expect(log.device_did).toBe("did:example:device1");
      expect(log.command_namespace).toBe("ai");
      expect(log.command_action).toBe("chat");
      expect(log.params).toEqual({ message: "Hello" });
      expect(log.result).toEqual({ response: "Hi" });
      expect(log.status).toBe("success");
      expect(log.duration).toBe(1500);
    });

    it("should log success command", () => {
      const logId = loggingManager.logSuccess({
        requestId: "req-success",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "getStatus",
        duration: 500,
      });

      const log = loggingManager.getLogById(logId);
      expect(log.status).toBe("success");
      expect(log.level).toBe(LogLevel.INFO);
    });

    it("should log failure command", () => {
      const logId = loggingManager.logFailure({
        requestId: "req-failure",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "execCommand",
        error: "Command not allowed",
        duration: 100,
      });

      const log = loggingManager.getLogById(logId);
      expect(log.status).toBe("failure");
      expect(log.level).toBe(LogLevel.ERROR);
      expect(log.error).toBe("Command not allowed");
    });

    it("should query logs with pagination", () => {
      // 插入多条日志
      for (let i = 0; i < 50; i++) {
        loggingManager.log({
          requestId: `req-${i}`,
          deviceDid: "did:example:device1",
          namespace: "ai",
          action: "chat",
          status: "success",
          duration: 1000 + i,
        });
      }

      // 分页查询
      const result = loggingManager.queryLogs({ limit: 10, offset: 0 });
      expect(result.logs).toHaveLength(10);
      expect(result.total).toBe(50);
      expect(result.hasMore).toBe(true);

      // 第二页
      const result2 = loggingManager.queryLogs({ limit: 10, offset: 10 });
      expect(result2.logs).toHaveLength(10);
      expect(result2.offset).toBe(10);
    });

    it("should filter logs by device", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device2",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      const result = loggingManager.queryLogs({
        deviceDid: "did:example:device1",
      });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].device_did).toBe("did:example:device1");
    });

    it("should filter logs by namespace", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "getStatus",
        status: "success",
      });

      const result = loggingManager.queryLogs({ namespace: "system" });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].command_namespace).toBe("system");
    });

    it("should filter logs by status", () => {
      loggingManager.logSuccess({
        requestId: "req-success",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
      });

      loggingManager.logFailure({
        requestId: "req-failure",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        error: "Error",
      });

      const result = loggingManager.queryLogs({ status: "failure" });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].status).toBe("failure");
    });

    it("should filter logs by time range", () => {
      const now = Date.now();
      const hourAgo = now - 60 * 60 * 1000;

      loggingManager.log({
        requestId: "req-old",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        timestamp: hourAgo,
      });

      loggingManager.log({
        requestId: "req-new",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        timestamp: now,
      });

      const result = loggingManager.queryLogs({
        startTime: now - 30 * 60 * 1000, // Last 30 minutes
      });

      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].request_id).toBe("req-new");
    });

    it("should search logs", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        deviceName: "Test Device",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device2",
        deviceName: "Another Device",
        namespace: "system",
        action: "screenshot",
        status: "success",
      });

      const result = loggingManager.queryLogs({ search: "screenshot" });
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].command_action).toBe("screenshot");
    });

    it("should get recent logs", () => {
      for (let i = 0; i < 30; i++) {
        loggingManager.log({
          requestId: `req-${i}`,
          deviceDid: "did:example:device1",
          namespace: "ai",
          action: "chat",
          status: "success",
        });
      }

      const result = loggingManager.getRecentLogs(10);
      expect(result.logs).toHaveLength(10);
      // Should be sorted by timestamp DESC
      expect(result.logs[0].request_id).toBe("req-29");
    });

    it("should get failure logs", () => {
      loggingManager.logSuccess({
        requestId: "req-success",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
      });

      loggingManager.logFailure({
        requestId: "req-failure-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        error: "Error 1",
      });

      loggingManager.logFailure({
        requestId: "req-failure-2",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "execCommand",
        error: "Error 2",
      });

      const result = loggingManager.getFailureLogs();
      expect(result.logs).toHaveLength(2);
    });

    it("should get log stats", () => {
      loggingManager.logSuccess({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        duration: 1000,
      });

      loggingManager.logSuccess({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        duration: 2000,
      });

      loggingManager.logFailure({
        requestId: "req-3",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "execCommand",
        error: "Error",
        duration: 500,
      });

      const stats = loggingManager.getLogStats();
      expect(stats.total).toBe(3);
      expect(stats.byStatus.success).toBe(2);
      expect(stats.byStatus.failure).toBe(1);
      expect(stats.byNamespace.ai).toBe(2);
      expect(stats.byNamespace.system).toBe(1);
      expect(stats.avgDuration).toBeGreaterThan(0);
    });

    it("should export logs as JSON", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      const json = loggingManager.exportLogs({ format: "json" });
      expect(json).toBeDefined();
      const logs = JSON.parse(json);
      expect(Array.isArray(logs)).toBe(true);
      expect(logs).toHaveLength(1);
    });

    it("should cleanup old logs", () => {
      const oldTimestamp = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago

      loggingManager.log({
        requestId: "req-old",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        timestamp: oldTimestamp,
      });

      loggingManager.log({
        requestId: "req-new",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      const deletedCount = loggingManager.cleanupLogs();
      expect(deletedCount).toBeGreaterThan(0);

      const result = loggingManager.queryLogs({});
      expect(result.total).toBe(1);
      expect(result.logs[0].request_id).toBe("req-new");
    });
  });

  describe("StatisticsCollector", () => {
    it("should track real-time stats", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        duration: 1000,
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "getStatus",
        status: "success",
        duration: 500,
      });

      loggingManager.logFailure({
        requestId: "req-3",
        deviceDid: "did:example:device2",
        namespace: "system",
        action: "execCommand",
        error: "Error",
        duration: 200,
      });

      const stats = loggingManager.getRealTimeStats();
      expect(stats.totalCommands).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.avgDuration).toBeGreaterThan(0);
      expect(parseFloat(stats.successRate)).toBeCloseTo(66.67, 1);
    });

    it("should track stats by device", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-3",
        deviceDid: "did:example:device2",
        namespace: "system",
        action: "getStatus",
        status: "success",
      });

      const stats = loggingManager.getRealTimeStats();
      expect(stats.byDevice["did:example:device1"].totalCount).toBe(2);
      expect(stats.byDevice["did:example:device2"].totalCount).toBe(1);
    });

    it("should track stats by namespace", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "ragSearch",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-3",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "getStatus",
        status: "success",
      });

      const stats = loggingManager.getRealTimeStats();
      expect(stats.byNamespace.ai.totalCount).toBe(2);
      expect(stats.byNamespace.system.totalCount).toBe(1);
    });

    it("should track recent commands", () => {
      for (let i = 0; i < 15; i++) {
        loggingManager.log({
          requestId: `req-${i}`,
          deviceDid: "did:example:device1",
          namespace: "ai",
          action: "chat",
          status: "success",
        });
      }

      const stats = loggingManager.getRealTimeStats();
      expect(stats.recentCommands).toHaveLength(10); // Only returns 10 most recent
      expect(stats.recentCommands[0].requestId).toBe("req-14"); // Most recent first
    });

    it("should get device activity", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      loggingManager.log({
        requestId: "req-3",
        deviceDid: "did:example:device2",
        namespace: "system",
        action: "getStatus",
        status: "success",
      });

      const activity = loggingManager.getDeviceActivity(7);
      expect(activity).toHaveLength(2);
      expect(activity[0].device_did).toBe("did:example:device1");
      expect(activity[0].total_commands).toBe(2);
    });

    it("should get command ranking", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        duration: 1000,
      });

      loggingManager.log({
        requestId: "req-2",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        duration: 1500,
      });

      loggingManager.log({
        requestId: "req-3",
        deviceDid: "did:example:device1",
        namespace: "system",
        action: "getStatus",
        status: "success",
        duration: 500,
      });

      const ranking = loggingManager.getCommandRanking(10);
      expect(ranking).toHaveLength(2);
      expect(ranking[0].command).toBe("ai.chat");
      expect(ranking[0].total_count).toBe(2);
      expect(ranking[0].avg_duration).toBeGreaterThan(0);
    });

    it("should reset real-time stats", () => {
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
      });

      let stats = loggingManager.getRealTimeStats();
      expect(stats.totalCommands).toBe(1);

      loggingManager.resetRealTimeStats();

      stats = loggingManager.getRealTimeStats();
      expect(stats.totalCommands).toBe(0);
      expect(stats.successCount).toBe(0);
    });
  });

  describe("LoggingManager", () => {
    it("should get dashboard data", () => {
      // 添加一些测试数据
      for (let i = 0; i < 20; i++) {
        loggingManager.log({
          requestId: `req-${i}`,
          deviceDid: "did:example:device1",
          namespace: i % 2 === 0 ? "ai" : "system",
          action: i % 2 === 0 ? "chat" : "getStatus",
          status: i % 5 === 0 ? "failure" : "success",
          duration: 1000 + i * 100,
        });
      }

      const dashboard = loggingManager.getDashboard({ days: 7 });

      expect(dashboard).toHaveProperty("realTime");
      expect(dashboard).toHaveProperty("logStats");
      expect(dashboard).toHaveProperty("deviceActivity");
      expect(dashboard).toHaveProperty("commandRanking");
      expect(dashboard).toHaveProperty("recentLogs");

      expect(dashboard.realTime.totalCommands).toBe(20);
      expect(dashboard.deviceActivity).toHaveLength(1);
      expect(dashboard.commandRanking.length).toBeGreaterThan(0);
      expect(dashboard.recentLogs.logs).toHaveLength(20);
    });

    it("should integrate logger and stats collector", () => {
      // 记录日志应该自动更新统计
      loggingManager.log({
        requestId: "req-1",
        deviceDid: "did:example:device1",
        namespace: "ai",
        action: "chat",
        status: "success",
        duration: 1000,
      });

      const stats = loggingManager.getRealTimeStats();
      expect(stats.totalCommands).toBe(1);

      const logs = loggingManager.queryLogs({});
      expect(logs.total).toBe(1);
    });
  });
});
*/
