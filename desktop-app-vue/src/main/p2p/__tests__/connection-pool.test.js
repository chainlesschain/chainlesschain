/**
 * connection-pool 单元测试 —— Connection 状态/健康/错误阈值，ConnectionPool 复用、
 * 新建(含超时)、不健康重建、池满抛错、释放、关闭、LRU 驱逐、统计命中率。
 *
 * 用 fake timers 驱动 createConnection 的超时 setTimeout，并避免遗留真实定时器。
 */

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  ConnectionPool,
  ConnectionState,
  Connection,
} = require("../connection-pool.js");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Connection", () => {
  it("markActive activates, bumps usage; markIdle idles", () => {
    const c = new Connection("p", {});
    c.markActive();
    expect(c.state).toBe(ConnectionState.ACTIVE);
    expect(c.usageCount).toBe(1);
    expect(c.isIdle()).toBe(false);
    c.markIdle();
    expect(c.isIdle()).toBe(true);
  });

  it("recordError trips to ERROR + unhealthy at 3", () => {
    const c = new Connection("p", {});
    expect(c.isHealthy()).toBe(true);
    c.recordError();
    c.recordError();
    expect(c.isHealthy()).toBe(true); // 2 errors still ok
    c.recordError(); // 3rd
    expect(c.state).toBe(ConnectionState.ERROR);
    expect(c.isHealthy()).toBe(false);
    c.resetErrors();
    expect(c.errorCount).toBe(0);
  });

  it("isTimedOut compares idle time against the threshold", () => {
    const c = new Connection("p", {});
    expect(c.isTimedOut(1000)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(c.isTimedOut(1000)).toBe(true);
  });
});

const addIdle = (pool, peerId, conn) => {
  const c = new Connection(peerId, conn || { close: vi.fn() });
  c.markActive();
  c.markIdle();
  pool.connections.set(peerId, c);
  pool.idleConnections.add(peerId);
  return c;
};

describe("ConnectionPool.acquireConnection", () => {
  it("reuses a healthy idle connection (cache hit)", async () => {
    const pool = new ConnectionPool();
    const underlying = { id: "sock" };
    addIdle(pool, "p1", underlying);
    const got = await pool.acquireConnection("p1", () => {
      throw new Error("should not create");
    });
    expect(got).toBe(underlying);
    expect(pool.stats.totalHits).toBe(1);
    expect(pool.activeConnections.has("p1")).toBe(true);
    expect(pool.idleConnections.has("p1")).toBe(false);
  });

  it("creates a new connection on a miss", async () => {
    const pool = new ConnectionPool();
    const underlying = { id: "new" };
    const got = await pool.acquireConnection("p1", async () => underlying);
    expect(got).toBe(underlying);
    expect(pool.stats.totalMisses).toBe(1);
    expect(pool.stats.totalCreated).toBe(1);
    expect(pool.activeConnections.has("p1")).toBe(true);
  });

  it("rebuilds an unhealthy existing connection", async () => {
    const pool = new ConnectionPool();
    const old = addIdle(pool, "p1", { close: vi.fn() });
    old.errorCount = 3;
    old.state = ConnectionState.ERROR; // unhealthy
    const fresh = { id: "fresh" };
    const got = await pool.acquireConnection("p1", async () => fresh);
    expect(got).toBe(fresh);
    expect(pool.stats.totalCreated).toBe(1);
  });

  it("throws when the pool is full and nothing idle can be evicted", async () => {
    const pool = new ConnectionPool({ maxConnections: 1 });
    // one ACTIVE connection (not evictable)
    const c = new Connection("a", { close: vi.fn() });
    c.markActive();
    pool.connections.set("a", c);
    pool.activeConnections.add("a");
    await expect(
      pool.acquireConnection("b", async () => ({})),
    ).rejects.toThrow(/连接池已满/);
  });

  it("clears the timeout timer once a connection wins the race (no leak)", async () => {
    const pool = new ConnectionPool({ connectionTimeout: 30000 });
    expect(vi.getTimerCount()).toBe(0);
    await pool.acquireConnection("fast", async () => ({ id: "fast" }));
    // 若超时定时器未被清除，这里会残留 1 个挂起的定时器
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout timer when connection creation fails (no leak)", async () => {
    const pool = new ConnectionPool({ connectionTimeout: 30000 });
    await expect(
      pool.acquireConnection("boom", async () => {
        throw new Error("connect failed");
      }),
    ).rejects.toThrow(/connect failed/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects when connection creation times out", async () => {
    const pool = new ConnectionPool({ connectionTimeout: 5000 });
    const p = pool.acquireConnection("slow", () => new Promise(() => {}));
    const assertion = expect(p).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(pool.stats.totalErrors).toBeGreaterThan(0);
  });
});

describe("ConnectionPool release/close/evict", () => {
  it("releaseConnection moves active -> idle", async () => {
    const pool = new ConnectionPool();
    await pool.acquireConnection("p1", async () => ({ close: vi.fn() }));
    pool.releaseConnection("p1");
    expect(pool.idleConnections.has("p1")).toBe(true);
    expect(pool.activeConnections.has("p1")).toBe(false);
  });

  it("closeConnection closes the socket and removes it", async () => {
    const pool = new ConnectionPool();
    const close = vi.fn().mockResolvedValue();
    addIdle(pool, "p1", { close });
    await pool.closeConnection("p1");
    expect(close).toHaveBeenCalled();
    expect(pool.connections.has("p1")).toBe(false);
    expect(pool.stats.totalClosed).toBe(1);
  });

  it("evictIdleConnections drops the least-recently-active first", async () => {
    const pool = new ConnectionPool();
    const oldC = addIdle(pool, "old", { close: vi.fn() });
    oldC.lastActivity = 1000;
    const newC = addIdle(pool, "new", { close: vi.fn() });
    newC.lastActivity = 9000;
    const n = await pool.evictIdleConnections(1);
    expect(n).toBe(1);
    expect(pool.connections.has("old")).toBe(false); // oldest evicted
    expect(pool.connections.has("new")).toBe(true);
  });

  it("closeAll closes every connection", async () => {
    const pool = new ConnectionPool();
    addIdle(pool, "p1", { close: vi.fn() });
    addIdle(pool, "p2", { close: vi.fn() });
    await pool.closeAll();
    expect(pool.connections.size).toBe(0);
  });
});

describe("ConnectionPool.getStats", () => {
  it("computes hit rate from hits and misses", async () => {
    const pool = new ConnectionPool();
    addIdle(pool, "p1", { id: "s" });
    await pool.acquireConnection("p1", () => {}); // hit
    await pool.acquireConnection("p2", async () => ({})); // miss
    const stats = pool.getStats();
    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBe("50.00%");
  });
});
