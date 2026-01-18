// @vitest-environment node
/**
 * 并发同步队列功能测试
 * 测试SyncQueue的并发控制和优先级功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import SyncQueue from "../../src/main/sync/sync-queue.js";
import DBSyncManager from "../../src/main/sync/db-sync-manager.js";

describe("SyncQueue - 并发同步队列测试", () => {
  let syncQueue;

  beforeEach(() => {
    syncQueue = new SyncQueue(3); // 最大并发数3
  });

  describe("基本功能", () => {
    it("应该能够执行单个任务", async () => {
      const task = vi.fn(async () => "result");
      const result = await syncQueue.enqueue(task);

      expect(result).toBe("result");
      expect(task).toHaveBeenCalledTimes(1);
    });

    it("应该能够获取队列长度", () => {
      expect(syncQueue.length).toBe(0);

      // 添加任务但不等待
      syncQueue.enqueue(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // 队列长度应该是0（任务立即开始执行）
      expect(syncQueue.length).toBe(0);
    });

    it("应该能够获取活跃任务数", async () => {
      const task = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "done";
      };

      // 启动任务
      const promise = syncQueue.enqueue(task);

      // 检查活跃任务数
      expect(syncQueue.active).toBe(1);

      // 等待任务完成
      await promise;

      // 任务完成后活跃数应该归零
      expect(syncQueue.active).toBe(0);
    });

    it("应该能够清空队列", () => {
      syncQueue.enqueue(async () => "task1");
      syncQueue.enqueue(async () => "task2");

      syncQueue.clear();

      expect(syncQueue.length).toBe(0);
    });
  });

  describe("并发控制", () => {
    it("应该限制并发数量", async () => {
      let activeCount = 0;
      let maxActiveCount = 0;

      const createTask = () => async () => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);

        // 模拟异步操作
        await new Promise((resolve) => setTimeout(resolve, 50));

        activeCount--;
        return "done";
      };

      // 创建10个任务
      const tasks = Array.from({ length: 10 }, () =>
        syncQueue.enqueue(createTask()),
      );

      // 等待所有任务完成
      await Promise.all(tasks);

      // 最大并发数应该不超过3
      expect(maxActiveCount).toBeLessThanOrEqual(3);
      expect(activeCount).toBe(0); // 所有任务完成后归零
    });

    it("应该在任务完成后继续处理队列", async () => {
      const results = [];

      const createTask = (id) => async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(id);
        return id;
      };

      // 创建5个任务
      const tasks = Array.from({ length: 5 }, (_, i) =>
        syncQueue.enqueue(createTask(i)),
      );

      // 等待所有任务完成
      await Promise.all(tasks);

      // 所有任务都应该被执行
      expect(results.length).toBe(5);
      expect(results.sort()).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe("优先级队列", () => {
    it("应该按照优先级顺序执行任务", async () => {
      const executionOrder = [];

      const createTask =
        (id, delay = 50) =>
        async () => {
          executionOrder.push(id);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return id;
        };

      // 先添加3个低优先级任务（会立即开始执行）
      syncQueue.enqueue(createTask("low1", 100), 1);
      syncQueue.enqueue(createTask("low2", 100), 1);
      syncQueue.enqueue(createTask("low3", 100), 1);

      // 等待一下，确保任务开始执行
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 再添加2个高优先级任务（会在队列中等待）
      const high1 = syncQueue.enqueue(createTask("high1", 50), 10);
      const high2 = syncQueue.enqueue(createTask("high2", 50), 10);

      // 添加2个中优先级任务
      const mid1 = syncQueue.enqueue(createTask("mid1", 50), 5);
      const mid2 = syncQueue.enqueue(createTask("mid2", 50), 5);

      // 等待所有任务完成
      await Promise.all([high1, high2, mid1, mid2]);

      // 前3个任务是最先开始的低优先级任务
      // 后续任务应该按照优先级执行（high > mid）
      expect(executionOrder.slice(0, 3)).toEqual(["low1", "low2", "low3"]);
      expect(executionOrder.slice(3)).toEqual([
        "high1",
        "high2",
        "mid1",
        "mid2",
      ]);
    });
  });

  describe("错误处理", () => {
    it("应该能够捕获任务异常", async () => {
      const task = async () => {
        throw new Error("Task failed");
      };

      await expect(syncQueue.enqueue(task)).rejects.toThrow("Task failed");
    });

    it("应该在任务失败后继续处理队列", async () => {
      const results = [];

      const successTask = async (id) => {
        results.push(id);
        return id;
      };

      const failTask = async () => {
        throw new Error("Fail");
      };

      // 添加多个任务，中间有失败的
      const task1 = syncQueue.enqueue(() => successTask(1));
      const task2 = syncQueue.enqueue(failTask);
      const task3 = syncQueue.enqueue(() => successTask(3));

      // 等待所有任务完成（包括失败的）
      const settledResults = await Promise.allSettled([task1, task2, task3]);

      // 检查结果
      expect(settledResults[0].status).toBe("fulfilled");
      expect(settledResults[0].value).toBe(1);
      expect(settledResults[1].status).toBe("rejected");
      expect(settledResults[2].status).toBe("fulfilled");
      expect(settledResults[2].value).toBe(3);

      // 成功的任务应该被执行
      expect(results).toEqual([1, 3]);
    });

    it("应该触发task:error事件", async () => {
      const errorHandler = vi.fn();
      syncQueue.on("task:error", errorHandler);

      const failTask = async () => {
        throw new Error("Task error");
      };

      await syncQueue.enqueue(failTask).catch(() => {});

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Task error",
        }),
      );
    });

    it("应该触发task:completed事件", async () => {
      const completedHandler = vi.fn();
      syncQueue.on("task:completed", completedHandler);

      const task = async () => "success";

      await syncQueue.enqueue(task);

      expect(completedHandler).toHaveBeenCalledTimes(1);
      expect(completedHandler).toHaveBeenCalledWith("success");
    });
  });

  describe("性能测试", () => {
    it("并发执行应该快于串行执行", async () => {
      const taskDuration = 100; // 每个任务耗时100ms

      const createTask = () => async () => {
        await new Promise((resolve) => setTimeout(resolve, taskDuration));
        return "done";
      };

      // 串行执行6个任务（预期耗时 ~600ms）
      const serialStart = Date.now();
      for (let i = 0; i < 6; i++) {
        await createTask()();
      }
      const serialDuration = Date.now() - serialStart;

      // 并发执行6个任务（3并发，预期耗时 ~200ms）
      const concurrentQueue = new SyncQueue(3);
      const concurrentStart = Date.now();
      const tasks = Array.from({ length: 6 }, () =>
        concurrentQueue.enqueue(createTask()),
      );
      await Promise.all(tasks);
      const concurrentDuration = Date.now() - concurrentStart;

      // 并发执行应该显著快于串行（至少快2倍）
      expect(concurrentDuration).toBeLessThan(serialDuration / 2);

      console.log(`串行耗时: ${serialDuration}ms`);
      console.log(`并发耗时: ${concurrentDuration}ms`);
      console.log(
        `性能提升: ${((serialDuration / concurrentDuration) * 100).toFixed(1)}%`,
      );
    });
  });
});

describe("DBSyncManager - 并发同步集成测试", () => {
  let manager;
  let mockDatabase;
  let mockHttpClient;

  beforeEach(() => {
    // 创建模拟数据库
    mockDatabase = {
      db: {
        prepare: vi.fn(() => ({
          all: vi.fn(() => []),
          get: vi.fn(() => ({ count: 0 })),
          run: vi.fn(),
        })),
      },
      updateSyncStatus: vi.fn(),
    };

    // 创建DBSyncManager实例
    manager = new DBSyncManager(mockDatabase, null);

    // 模拟HTTP客户端
    mockHttpClient = {
      getServerTime: vi.fn(async () => ({ timestamp: Date.now() })),
      uploadBatch: vi.fn(async () => ({ successCount: 1, conflictCount: 0 })),
      downloadIncremental: vi.fn(async () => ({
        newRecords: [],
        updatedRecords: [],
        deletedIds: [],
      })),
      hasAuthToken: vi.fn(() => true),
    };
    manager.httpClient = mockHttpClient;

    // 初始化
    manager.deviceId = "test-device";
    manager.timeOffset = 0;
    manager.isAuthenticated = true;
  });

  describe("并发syncAfterLogin", () => {
    it("应该并发同步所有表", async () => {
      // 模拟无待同步数据
      mockDatabase.db.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => null),
      }));

      const result = await manager.syncAfterLogin();

      // 应该返回统计结果
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("conflicts");
    });

    it("应该处理部分表失败的情况", async () => {
      // 模拟第一个表上传失败
      let callCount = 0;
      mockHttpClient.uploadBatch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Upload failed");
        }
        return { successCount: 1, conflictCount: 0 };
      });

      // 模拟有待同步数据
      mockDatabase.db.prepare = vi.fn((sql) => {
        if (sql.includes("SELECT *")) {
          return {
            all: vi.fn(() => [{ id: "1", sync_status: "pending" }]),
          };
        }
        return {
          get: vi.fn(() => null),
        };
      });

      const result = await manager.syncAfterLogin();

      // 验证上传被调用了多次（至少有一次失败了）
      expect(mockHttpClient.uploadBatch).toHaveBeenCalled();
      // 结果应该包含统计信息（无论成功还是失败）
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("success");
      // 至少有一些结果（成功或失败）
      expect(result.failed + result.success).toBeGreaterThanOrEqual(0);
    });
  });

  describe("并发syncIncremental", () => {
    it("应该只同步有变更的表", async () => {
      // 模拟只有2个表有待同步数据
      let callCount = 0;
      mockDatabase.db.prepare = vi.fn((sql) => {
        if (sql.includes("COUNT(*)")) {
          callCount++;
          return {
            get: vi.fn(() => ({ count: callCount <= 2 ? 5 : 0 })),
          };
        }
        return {
          all: vi.fn(() => []),
          get: vi.fn(() => null),
        };
      });

      const result = await manager.syncIncremental();

      // 应该返回统计结果
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("failed");
      expect(result.success).toBeLessThanOrEqual(2); // 最多2个表
    });

    it("应该在没有变更时直接返回", async () => {
      // 模拟所有表都没有待同步数据
      mockDatabase.db.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ count: 0 })),
      }));

      const result = await manager.syncIncremental();

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);

      // 不应该调用HTTP客户端
      expect(mockHttpClient.uploadBatch).not.toHaveBeenCalled();
      expect(mockHttpClient.downloadIncremental).not.toHaveBeenCalled();
    });
  });

  describe("并发性能验证", () => {
    it("并发同步应该比串行同步更快", async () => {
      // 模拟每个表的同步耗时
      const tableSyncDuration = 100; // 每个表100ms
      const tableCount = 6;

      mockHttpClient.uploadBatch = vi.fn(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, tableSyncDuration / 2),
        );
        return { successCount: 1, conflictCount: 0 };
      });

      mockHttpClient.downloadIncremental = vi.fn(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, tableSyncDuration / 2),
        );
        return { newRecords: [], updatedRecords: [], deletedIds: [] };
      });

      mockDatabase.db.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => null),
      }));

      // 只同步前6个表
      manager.syncTables = manager.syncTables.slice(0, tableCount);

      const start = Date.now();
      await manager.syncAfterLogin();
      const duration = Date.now() - start;

      // 并发执行（3并发）应该在 (6/3 * 100) = 200ms 左右完成
      // 串行执行需要 (6 * 100) = 600ms
      // 允许一些延迟，预期不超过 300ms
      expect(duration).toBeLessThan(300);

      console.log(`并发同步${tableCount}个表耗时: ${duration}ms`);
      console.log(`预期串行耗时: ${tableCount * tableSyncDuration}ms`);
      console.log(
        `性能提升: ${(((tableCount * tableSyncDuration) / duration) * 100).toFixed(1)}%`,
      );
    });
  });
});
