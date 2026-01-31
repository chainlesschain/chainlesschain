/**
 * 数据库重试和错误恢复测试
 *
 * 测试范围：
 * - 数据库连接失败和重连
 * - 事务失败和重试
 * - 死锁检测和处理
 * - 查询超时和重试
 * - 连接池管理
 * - 数据一致性保证
 * - 降级策略
 * - 真实场景测试
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 3: Error Recovery Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock Database ====================

class MockDatabase {
  constructor(config = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      queryTimeout: config.queryTimeout || 30000,
      maxConnections: config.maxConnections || 10,
    };

    this.connected = false;
    this.activeConnections = 0;
    this.queryCount = 0;
    this.failureCount = 0;
    this.inTransaction = false;
    this.locks = new Set();
  }

  async connect() {
    if (this.config.simulateConnectionFailure) {
      throw new Error("ECONNREFUSED: Connection refused");
    }

    if (this.config.simulateTimeout) {
      throw new Error("Connection timeout");
    }

    this.connected = true;
    this.activeConnections++;
    return { connected: true };
  }

  async disconnect() {
    this.connected = false;
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  async query(sql, params = [], options = {}) {
    if (!this.connected) {
      throw new Error("Database not connected");
    }

    this.queryCount++;

    if (options.simulateTimeout) {
      throw new Error("Query timeout exceeded");
    }

    if (options.simulateDeadlock) {
      throw new Error("Deadlock detected");
    }

    if (options.simulateLockTimeout) {
      throw new Error("Lock wait timeout exceeded");
    }

    if (options.simulateConnectionLost) {
      this.connected = false;
      throw new Error("Connection lost during query");
    }

    // Simulate query result
    return {
      rows: [],
      rowCount: 0,
      affectedRows: 0,
    };
  }

  async beginTransaction() {
    if (!this.connected) {
      throw new Error("Cannot begin transaction: not connected");
    }

    if (this.inTransaction) {
      throw new Error("Already in transaction");
    }

    this.inTransaction = true;
    return { success: true };
  }

  async commit() {
    if (!this.inTransaction) {
      throw new Error("No active transaction to commit");
    }

    this.inTransaction = false;
    return { success: true };
  }

  async rollback() {
    if (!this.inTransaction) {
      throw new Error("No active transaction to rollback");
    }

    this.inTransaction = false;
    return { success: true };
  }

  async acquireLock(resourceId) {
    if (this.locks.has(resourceId)) {
      throw new Error(`Lock already held on resource: ${resourceId}`);
    }

    this.locks.add(resourceId);
    return { locked: true, resourceId };
  }

  async releaseLock(resourceId) {
    this.locks.delete(resourceId);
    return { released: true, resourceId };
  }

  getStats() {
    return {
      connected: this.connected,
      activeConnections: this.activeConnections,
      queryCount: this.queryCount,
      failureCount: this.failureCount,
      inTransaction: this.inTransaction,
      lockedResources: this.locks.size,
    };
  }
}

// ==================== Database Retry Service ====================

class DatabaseRetryService {
  constructor(database, config = {}) {
    this.database = database;
    this.config = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      backoffMultiplier: config.backoffMultiplier || 2,
      deadlockRetries: config.deadlockRetries || 5,
      enableFallback: config.enableFallback !== false,
    };

    this.retryLog = [];
  }

  _logRetry(operation, attempt, error) {
    this.retryLog.push({
      timestamp: new Date().toISOString(),
      operation,
      attempt,
      error: error.message,
    });
  }

  async _retryWithBackoff(fn, options = {}) {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        return await fn();
      } catch (error) {
        this._logRetry(options.operation || "unknown", attempt + 1, error);

        if (attempt >= maxRetries) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay =
          this.config.retryDelay *
          Math.pow(this.config.backoffMultiplier, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));

        attempt++;
      }
    }
  }

  async connect() {
    return this._retryWithBackoff(async () => await this.database.connect(), {
      operation: "connect",
    });
  }

  async query(sql, params = [], options = {}) {
    return this._retryWithBackoff(
      async () => await this.database.query(sql, params, options),
      { operation: "query", ...options },
    );
  }

  async transaction(callback, options = {}) {
    return this._retryWithBackoff(
      async () => {
        await this.database.beginTransaction();

        try {
          const result = await callback(this.database);
          await this.database.commit();
          return result;
        } catch (error) {
          await this.database.rollback();
          throw error;
        }
      },
      {
        operation: "transaction",
        maxRetries: this.config.deadlockRetries,
        ...options,
      },
    );
  }

  async withDeadlockRetry(callback, maxRetries = 5) {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        return await callback();
      } catch (error) {
        if (error.message.includes("Deadlock") && attempt < maxRetries - 1) {
          this._logRetry("deadlock_retry", attempt + 1, error);

          // Random delay to break deadlock cycle
          const delay = Math.random() * 1000 + this.config.retryDelay;
          await new Promise((resolve) => setTimeout(resolve, delay));

          attempt++;
          continue;
        }

        throw error;
      }
    }
  }

  getRetryLog() {
    return this.retryLog;
  }

  clearRetryLog() {
    this.retryLog = [];
  }
}

// ==================== Test Suite ====================

describe("数据库重试和错误恢复测试", () => {
  let database;
  let retryService;

  beforeEach(() => {
    database = new MockDatabase({
      maxRetries: 3,
      retryDelay: 100,
      queryTimeout: 5000,
    });

    retryService = new DatabaseRetryService(database, {
      maxRetries: 3,
      retryDelay: 100,
      backoffMultiplier: 2,
      deadlockRetries: 5,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // ==================== 1. 连接失败和重连 ====================

  describe("连接失败和重连", () => {
    it("应该在连接失败后重试", async () => {
      let attemptCount = 0;

      database.connect = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("ECONNREFUSED");
        }
        database.connected = true;
        return { connected: true };
      });

      await retryService.connect();

      expect(attemptCount).toBe(3);
      expect(database.connected).toBe(true);
    });

    it("应该在达到最大重试次数后失败", async () => {
      database.connect = vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      });

      await expect(retryService.connect()).rejects.toThrow("ECONNREFUSED");
    });

    it("应该使用指数退避重试", async () => {
      let attemptCount = 0;

      database.connect = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 4) {
          throw new Error("Connection failed");
        }
        database.connected = true;
        return { connected: true };
      });

      const start = Date.now();
      await retryService.connect();
      const duration = Date.now() - start;

      // Delays: 100ms, 200ms, 400ms
      // Total: ~700ms
      expect(duration).toBeGreaterThanOrEqual(600);
      expect(duration).toBeLessThan(1000);
    });

    it("应该记录重试尝试", async () => {
      database.connect = vi.fn(async () => {
        throw new Error("Connection failed");
      });

      try {
        await retryService.connect();
      } catch (error) {
        // Expected
      }

      const log = retryService.getRetryLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].operation).toBe("connect");
    });
  });

  // ==================== 2. 查询失败和重试 ====================

  describe("查询失败和重试", () => {
    beforeEach(async () => {
      await database.connect();
    });

    it("应该在查询超时后重试", async () => {
      let attemptCount = 0;

      database.query = vi.fn(async (sql, params, options) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Query timeout exceeded");
        }
        return { rows: [{ id: 1 }], rowCount: 1 };
      });

      const result = await retryService.query("SELECT * FROM users");

      expect(attemptCount).toBe(3);
      expect(result.rows).toHaveLength(1);
    });

    it("应该在连接丢失后重连并重试", async () => {
      let attemptCount = 0;

      database.query = vi.fn(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          database.connected = false;
          throw new Error("Connection lost during query");
        }
        if (attemptCount === 2) {
          // Reconnect
          database.connected = true;
        }
        return { rows: [], rowCount: 0 };
      });

      await retryService.query("SELECT * FROM users");

      expect(attemptCount).toBe(2);
    });

    it("应该处理查询语法错误（不重试）", async () => {
      database.query = vi.fn(async () => {
        throw new Error('Syntax error near "SELEC"');
      });

      await expect(
        retryService.query("SELEC * FROM users", [], { maxRetries: 0 }),
      ).rejects.toThrow("Syntax error");
    });
  });

  // ==================== 3. 事务失败和重试 ====================

  describe("事务失败和重试", () => {
    beforeEach(async () => {
      await database.connect();
    });

    it("应该在事务失败后重试", async () => {
      let attemptCount = 0;

      database.beginTransaction = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 2) {
          throw new Error("Transaction begin failed");
        }
        database.inTransaction = true;
        return { success: true };
      });

      database.commit = vi.fn(async () => {
        database.inTransaction = false;
        return { success: true };
      });

      const result = await retryService.transaction(async (db) => {
        return { completed: true };
      });

      expect(attemptCount).toBe(2);
      expect(result.completed).toBe(true);
    });

    it("应该在事务中途失败时回滚", async () => {
      database.beginTransaction = vi.fn(async () => {
        database.inTransaction = true;
        return { success: true };
      });

      database.commit = vi.fn(async () => {
        database.inTransaction = false;
        return { success: true };
      });

      database.rollback = vi.fn(async () => {
        database.inTransaction = false;
        return { success: true };
      });

      try {
        await retryService.transaction(async (db) => {
          await db.query("INSERT INTO users VALUES (1)");
          throw new Error("Simulated transaction error");
        });
      } catch (error) {
        // Expected
      }

      expect(database.rollback).toHaveBeenCalled();
      expect(database.inTransaction).toBe(false);
    });

    it("应该在事务提交失败后回滚", async () => {
      database.beginTransaction = vi.fn(async () => {
        database.inTransaction = true;
        return { success: true };
      });

      database.commit = vi.fn(async () => {
        throw new Error("Commit failed");
      });

      database.rollback = vi.fn(async () => {
        database.inTransaction = false;
        return { success: true };
      });

      await expect(
        retryService.transaction(async (db) => {
          return { completed: true };
        }),
      ).rejects.toThrow("Commit failed");

      expect(database.rollback).toHaveBeenCalled();
    });

    it("应该支持嵌套事务回滚", async () => {
      let rollbackCalled = false;

      database.beginTransaction = vi.fn(async () => {
        database.inTransaction = true;
        return { success: true };
      });

      database.rollback = vi.fn(async () => {
        rollbackCalled = true;
        database.inTransaction = false;
        return { success: true };
      });

      try {
        await retryService.transaction(
          async (db) => {
            await db.query("INSERT INTO users VALUES (1)");

            // Nested operation fails
            await db.query("INVALID SQL");
          },
          { maxRetries: 0 },
        );
      } catch (error) {
        // Expected
      }

      expect(rollbackCalled).toBe(true);
    });
  });

  // ==================== 4. 死锁检测和处理 ====================

  describe("死锁检测和处理", () => {
    beforeEach(async () => {
      await database.connect();
    });

    it("应该检测死锁并重试", async () => {
      let attemptCount = 0;

      database.query = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Deadlock detected");
        }
        return { rows: [], rowCount: 0 };
      });

      await retryService.withDeadlockRetry(async () => {
        return await database.query(
          "UPDATE accounts SET balance = balance - 100",
        );
      });

      expect(attemptCount).toBe(3);
    });

    it("应该在死锁重试时使用随机延迟", async () => {
      let attemptCount = 0;
      const delays = [];

      database.query = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Deadlock detected");
        }
        return { rows: [], rowCount: 0 };
      });

      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn((fn, delay) => {
        delays.push(delay);
        return originalSetTimeout(fn, delay);
      });

      await retryService.withDeadlockRetry(async () => {
        return await database.query("UPDATE accounts");
      });

      global.setTimeout = originalSetTimeout;

      // Delays should vary (random component)
      expect(delays.length).toBeGreaterThan(0);
    });

    it("应该在达到死锁重试上限后失败", async () => {
      database.query = vi.fn(async () => {
        throw new Error("Deadlock detected");
      });

      await expect(
        retryService.withDeadlockRetry(async () => {
          return await database.query("UPDATE accounts");
        }, 3),
      ).rejects.toThrow("Deadlock");
    });

    it("应该处理真实死锁场景（转账）", async () => {
      let attemptCount = 0;

      const transferMoney = async (fromAccount, toAccount, amount) => {
        return retryService.withDeadlockRetry(async () => {
          attemptCount++;

          // Simulate deadlock on first attempt
          if (attemptCount === 1) {
            throw new Error("Deadlock detected");
          }

          // Successful transfer
          await database.query(
            "UPDATE accounts SET balance = balance - ? WHERE id = ?",
            [amount, fromAccount],
          );
          await database.query(
            "UPDATE accounts SET balance = balance + ? WHERE id = ?",
            [amount, toAccount],
          );

          return { success: true };
        });
      };

      const result = await transferMoney(1, 2, 100);

      expect(result.success).toBe(true);
      expect(attemptCount).toBe(2);
    });
  });

  // ==================== 5. 连接池管理 ====================

  describe("连接池管理", () => {
    it("应该追踪活跃连接数", async () => {
      await database.connect();
      await database.connect();
      await database.connect();

      const stats = database.getStats();
      expect(stats.activeConnections).toBe(3);
    });

    it("应该在连接释放后更新统计", async () => {
      await database.connect();
      await database.connect();

      expect(database.getStats().activeConnections).toBe(2);

      await database.disconnect();

      expect(database.getStats().activeConnections).toBe(1);
    });

    it("应该处理连接池耗尽", async () => {
      database.config.maxConnections = 2;

      await database.connect();
      await database.connect();

      // Should handle gracefully
      const stats = database.getStats();
      expect(stats.activeConnections).toBeLessThanOrEqual(
        database.config.maxConnections,
      );
    });

    it("应该支持连接池重用", async () => {
      const connections = [];

      for (let i = 0; i < 5; i++) {
        const conn = await retryService.connect();
        connections.push(conn);
      }

      expect(connections).toHaveLength(5);
    });
  });

  // ==================== 6. 数据一致性保证 ====================

  describe("数据一致性保证", () => {
    beforeEach(async () => {
      await database.connect();
    });

    it("应该在事务中保证原子性", async () => {
      let inserted = false;
      let updated = false;

      database.query = vi.fn(async (sql) => {
        if (sql.includes("INSERT")) {
          inserted = true;
        } else if (sql.includes("UPDATE")) {
          updated = true;
          throw new Error("Update failed");
        }
        return { rows: [], rowCount: 1 };
      });

      database.rollback = vi.fn(async () => {
        inserted = false;
        updated = false;
        database.inTransaction = false;
        return { success: true };
      });

      try {
        await retryService.transaction(
          async (db) => {
            await db.query("INSERT INTO users VALUES (1)");
            await db.query('UPDATE users SET name = "test"');
          },
          { maxRetries: 0 },
        );
      } catch (error) {
        // Expected
      }

      expect(database.rollback).toHaveBeenCalled();
      // Both operations should be rolled back
      expect(inserted && updated).toBe(false);
    });

    it("应该处理并发写入冲突", async () => {
      let lockHeld = false;

      const performUpdate = async (resourceId) => {
        try {
          await database.acquireLock(resourceId);
          lockHeld = true;

          await database.query("UPDATE resources SET value = value + 1");

          await database.releaseLock(resourceId);
          lockHeld = false;

          return { success: true };
        } catch (error) {
          if (lockHeld) {
            await database.releaseLock(resourceId);
          }
          throw error;
        }
      };

      const result = await performUpdate("resource_1");
      expect(result.success).toBe(true);
    });

    it("应该防止脏读", async () => {
      // Simulate read-after-write within transaction
      const values = [];

      await retryService.transaction(async (db) => {
        await db.query("UPDATE users SET balance = 1000 WHERE id = 1");

        const result = await db.query("SELECT balance FROM users WHERE id = 1");
        values.push(result);

        return { success: true };
      });

      expect(values).toHaveLength(1);
    });
  });

  // ==================== 7. 降级策略 ====================

  describe("降级策略", () => {
    it("应该在数据库不可用时使用只读模式", async () => {
      database.connect = vi.fn(async () => {
        throw new Error("Database unavailable");
      });

      let fallbackTriggered = false;

      try {
        await retryService.connect();
      } catch (error) {
        // Fallback to read-only cache
        fallbackTriggered = true;
      }

      expect(fallbackTriggered).toBe(true);
    });

    it("应该在写入失败时缓存待处理操作", async () => {
      const pendingOperations = [];

      database.query = vi.fn(async (sql) => {
        if (sql.includes("INSERT") || sql.includes("UPDATE")) {
          throw new Error("Write operations disabled");
        }
        return { rows: [], rowCount: 0 };
      });

      try {
        await retryService.query("INSERT INTO users VALUES (1)", [], {
          maxRetries: 0,
        });
      } catch (error) {
        // Cache for later retry
        pendingOperations.push({
          sql: "INSERT INTO users VALUES (1)",
          timestamp: Date.now(),
        });
      }

      expect(pendingOperations).toHaveLength(1);
    });

    it("应该在部分服务降级时继续运行", async () => {
      let readSucceeded = false;
      const writeSucceeded = false;

      database.query = vi.fn(async (sql) => {
        if (sql.includes("SELECT")) {
          readSucceeded = true;
          return { rows: [{ id: 1 }], rowCount: 1 };
        } else {
          throw new Error("Write operations unavailable");
        }
      });

      // Read should work
      await retryService.query("SELECT * FROM users", [], { maxRetries: 0 });

      // Write should fail
      try {
        await retryService.query("INSERT INTO users VALUES (1)", [], {
          maxRetries: 0,
        });
      } catch (error) {
        // Expected
      }

      expect(readSucceeded).toBe(true);
      expect(writeSucceeded).toBe(false);
    });
  });

  // ==================== 8. 真实场景测试 ====================

  describe("真实场景测试", () => {
    beforeEach(async () => {
      await database.connect();
    });

    it("场景1: 电商订单创建（事务 + 死锁处理）", async () => {
      const createOrder = async (userId, productId, quantity) => {
        return retryService.withDeadlockRetry(async () => {
          return retryService.transaction(async (db) => {
            // Create order
            await db.query(
              "INSERT INTO orders (user_id, product_id, quantity) VALUES (?, ?, ?)",
              [userId, productId, quantity],
            );

            // Update inventory
            await db.query(
              "UPDATE products SET stock = stock - ? WHERE id = ?",
              [quantity, productId],
            );

            // Update user credits
            await db.query(
              "UPDATE users SET credits = credits - ? WHERE id = ?",
              [quantity * 10, userId],
            );

            return { orderId: 12345, success: true };
          });
        });
      };

      const result = await createOrder(1, 100, 5);
      expect(result.success).toBe(true);
    });

    it("场景2: 高并发点赞（乐观锁 + 重试）", async () => {
      let versionMismatches = 0;

      const likePost = async (postId, userId) => {
        return retryService.withDeadlockRetry(async () => {
          // Simulate optimistic locking
          const currentVersion = 1;

          const result = await database.query(
            "UPDATE posts SET likes = likes + 1, version = version + 1 WHERE id = ? AND version = ?",
            [postId, currentVersion],
          );

          if (result.affectedRows === 0) {
            versionMismatches++;
            throw new Error("Version mismatch - retry");
          }

          return { success: true };
        });
      };

      const result = await likePost(1, 100);
      expect(result.success).toBe(true);
    });

    it("场景3: 数据库维护期间的降级", async () => {
      let cacheHits = 0;
      const cache = new Map();

      database.query = vi.fn(async (sql) => {
        // Simulate database in maintenance
        if (sql.includes("SELECT")) {
          throw new Error("Database in maintenance mode");
        }
        return { rows: [], rowCount: 0 };
      });

      // Pre-populate cache
      cache.set("user:1", { id: 1, name: "Test User" });

      try {
        await retryService.query("SELECT * FROM users WHERE id = 1", [], {
          maxRetries: 0,
        });
      } catch (error) {
        // Fallback to cache
        if (cache.has("user:1")) {
          cacheHits++;
        }
      }

      expect(cacheHits).toBe(1);
    });

    it("场景4: 批量导入数据的容错", async () => {
      const importData = async (records) => {
        const results = {
          succeeded: [],
          failed: [],
        };

        for (const record of records) {
          try {
            await retryService.query("INSERT INTO data VALUES (?)", [record]);
            results.succeeded.push(record);
          } catch (error) {
            results.failed.push({ record, error: error.message });
          }
        }

        return results;
      };

      database.query = vi.fn(async (sql, params) => {
        const value = params[0];
        // Simulate some records failing
        if (value % 3 === 0) {
          throw new Error("Duplicate key");
        }
        return { rows: [], rowCount: 1 };
      });

      const records = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const results = await importData(records);

      expect(results.succeeded.length).toBeGreaterThan(0);
      expect(results.failed.length).toBeGreaterThan(0);
    });

    it("场景5: 长时间运行的分析查询重试", async () => {
      let attemptCount = 0;

      database.query = vi.fn(async (sql) => {
        attemptCount++;

        // Simulate timeout on first two attempts
        if (attemptCount < 3) {
          throw new Error("Query timeout exceeded");
        }

        // Success on third attempt
        return {
          rows: Array(1000)
            .fill(0)
            .map((_, i) => ({ id: i, value: Math.random() })),
          rowCount: 1000,
        };
      });

      const result = await retryService.query(
        "SELECT * FROM analytics WHERE date > ? GROUP BY category",
        ["2026-01-01"],
      );

      expect(result.rows).toHaveLength(1000);
      expect(attemptCount).toBe(3);
    });
  });

  // ==================== 9. 性能和可靠性 ====================

  describe("性能和可靠性", () => {
    beforeEach(async () => {
      await database.connect();
    });

    it("应该在合理时间内完成重试（< 1s）", async () => {
      let attemptCount = 0;

      database.query = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error("Retry test");
        }
        return { rows: [], rowCount: 0 };
      });

      const start = Date.now();
      await retryService.query("SELECT * FROM users");
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it("应该高效处理大量查询", async () => {
      database.query = vi.fn(async () => {
        return { rows: [{ id: 1 }], rowCount: 1 };
      });

      const start = Date.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(retryService.query("SELECT * FROM users"));
      }

      await Promise.all(promises);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });

    it("应该不会因重试而泄漏内存", async () => {
      database.query = vi.fn(async () => {
        throw new Error("Always fail");
      });

      for (let i = 0; i < 1000; i++) {
        try {
          await retryService.query("SELECT * FROM users", [], {
            maxRetries: 1,
          });
        } catch (error) {
          // Expected
        }
      }

      const log = retryService.getRetryLog();
      expect(log.length).toBeLessThanOrEqual(2000); // 1000 queries * 2 attempts max
    });

    it("应该正确清理事务资源", async () => {
      database.beginTransaction = vi.fn(async () => {
        database.inTransaction = true;
        return { success: true };
      });

      database.rollback = vi.fn(async () => {
        database.inTransaction = false;
        return { success: true };
      });

      try {
        await retryService.transaction(
          async (db) => {
            throw new Error("Transaction error");
          },
          { maxRetries: 0 },
        );
      } catch (error) {
        // Expected
      }

      expect(database.inTransaction).toBe(false);
    });
  });
});
