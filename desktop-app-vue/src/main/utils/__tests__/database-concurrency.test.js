/**
 * database-concurrency 测试 —— DatabaseConcurrencyController 的带重试执行
 * (executeWithRetry)、SQLite 错误分类 (_identifyErrorType)、写入队列串行化
 * (queueWrite/_processQueue) 与统计。
 *
 * 分层：smoke（构造/方法）+ unit（重试策略、错误分类、统计）+
 * integration（并发 queueWrite 串行不重叠、失败不卡队列）。
 *
 * 用 baseDelay:0 / maxDelay:0 / jitter:false 让重试瞬时完成，无需 fake timers。
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  DatabaseConcurrencyController,
  ERROR_TYPES,
} = require("../database-concurrency.js");

const makeController = () =>
  new DatabaseConcurrencyController({
    baseDelay: 0,
    maxDelay: 0,
    jitter: false,
  });

describe("database-concurrency — smoke", () => {
  it("constructs and exposes the core methods", () => {
    const c = makeController();
    expect(typeof c.executeWithRetry).toBe("function");
    expect(typeof c.queueWrite).toBe("function");
    expect(c.getStatistics().totalOperations).toBe(0);
  });
});

describe("database-concurrency — executeWithRetry", () => {
  it("returns the result on first success with no retries", async () => {
    const c = makeController();
    const op = vi.fn(async () => "ok");
    await expect(c.executeWithRetry(op)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
    expect(c.getStatistics()).toMatchObject({
      totalOperations: 1,
      successfulOperations: 1,
      totalRetries: 0,
    });
  });

  it("retries a BUSY/locked error and eventually succeeds", async () => {
    const c = makeController();
    let n = 0;
    const op = vi.fn(async () => {
      if (++n < 3) {
        throw new Error("database is locked");
      }
      return "done";
    });
    await expect(c.executeWithRetry(op, { maxRetries: 5 })).resolves.toBe(
      "done",
    );
    expect(op).toHaveBeenCalledTimes(3);
    const s = c.getStatistics();
    expect(s.successfulOperations).toBe(1);
    expect(s.retriedOperations).toBe(1);
    expect(s.totalRetries).toBe(2);
    expect(s.busyErrors).toBe(2);
  });

  it("does NOT retry a non-retryable constraint error", async () => {
    const c = makeController();
    const op = vi.fn(async () => {
      throw new Error("SQLITE_CONSTRAINT: UNIQUE failed");
    });
    await expect(c.executeWithRetry(op, { maxRetries: 5 })).rejects.toThrow(
      /CONSTRAINT/,
    );
    expect(op).toHaveBeenCalledTimes(1); // no retry
    expect(c.getStatistics()).toMatchObject({
      totalRetries: 0,
      failedOperations: 1,
      constraintViolations: 1,
    });
  });

  it("throws after exhausting maxRetries on a persistent lock", async () => {
    const c = makeController();
    const op = vi.fn(async () => {
      throw new Error("database is locked");
    });
    await expect(c.executeWithRetry(op, { maxRetries: 2 })).rejects.toThrow(
      /locked/,
    );
    expect(op).toHaveBeenCalledTimes(3); // attempts 0,1,2
    expect(c.getStatistics()).toMatchObject({
      totalRetries: 2,
      failedOperations: 1,
    });
  });

  it("emits a retry event with the error type", async () => {
    const c = makeController();
    const events = [];
    c.on("retry", (e) => events.push(e));
    let n = 0;
    await c.executeWithRetry(
      async () => {
        if (++n < 2) {
          throw new Error("SQLITE_BUSY");
        }
        return 1;
      },
      { maxRetries: 3 },
    );
    expect(events).toHaveLength(1);
    expect(events[0].errorType).toBe(ERROR_TYPES.BUSY);
  });
});

describe("database-concurrency — _identifyErrorType", () => {
  const c = makeController();
  it.each([
    [new Error("database is locked"), ERROR_TYPES.BUSY],
    [Object.assign(new Error("x"), { code: "SQLITE_BUSY" }), ERROR_TYPES.BUSY],
    [new Error("table is LOCKED"), ERROR_TYPES.LOCKED],
    [new Error("CONSTRAINT failed"), ERROR_TYPES.CONSTRAINT],
    [new Error("file is CORRUPT"), ERROR_TYPES.CORRUPT],
    [Object.assign(new Error("x"), { code: "ENOSPC" }), ERROR_TYPES.NOSPC],
    [new Error("totally unrelated"), "UNKNOWN"],
  ])("classifies %s", (err, expected) => {
    expect(c._identifyErrorType(err)).toBe(expected);
  });
});

describe("database-concurrency — queueWrite serialization (integration)", () => {
  it("runs queued writes one-at-a-time (maxConcurrentWrites=1) preserving order", async () => {
    const c = makeController(); // default maxConcurrentWrites = 1
    let active = 0;
    let maxActive = 0;
    const make = (val) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return val;
    };
    const results = await Promise.all([
      c.queueWrite(make("a")),
      c.queueWrite(make("b")),
      c.queueWrite(make("c")),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(maxActive).toBe(1); // never overlapped
  });

  it("a failing write rejects its own promise without blocking the queue", async () => {
    const c = makeController();
    const failing = c.queueWrite(
      async () => {
        throw new Error("SQLITE_CONSTRAINT");
      },
      { maxRetries: 0 },
    );
    const ok = c.queueWrite(async () => "after");
    await expect(failing).rejects.toThrow(/CONSTRAINT/);
    await expect(ok).resolves.toBe("after");
  });
});
