import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { ResourcePool } = require("../resource-pool");

describe("ResourcePool", () => {
  let pool;

  beforeEach(() => {
    pool = new ResourcePool();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await pool.disposeAll();
  });

  describe("constructor", () => {
    it("should initialize with empty collections", () => {
      expect(pool._timers.size).toBe(0);
      expect(pool._connections.size).toBe(0);
      expect(pool._resources.size).toBe(0);
      expect(pool._quotas.size).toBe(0);
    });
  });

  describe("registerTimer", () => {
    it("should register an interval timer", () => {
      pool.registerTimer("cleanup", vi.fn(), 1000);
      expect(pool._timers.has("cleanup")).toBe(true);
      expect(pool._timers.get("cleanup").type).toBe("interval");
    });

    it("should register a one-shot timeout", () => {
      pool.registerTimer("once", vi.fn(), 1000, { once: true });
      expect(pool._timers.get("once").type).toBe("timeout");
    });

    it("should return the timer name", () => {
      const name = pool.registerTimer("t", vi.fn(), 1000);
      expect(name).toBe("t");
    });

    it("should clear existing timer with same name before registering", () => {
      const cb1 = vi.fn();
      pool.registerTimer("t", cb1, 1000);
      const cb2 = vi.fn();
      pool.registerTimer("t", cb2, 2000);
      expect(pool._timers.size).toBe(1);
      expect(pool._timers.get("t").interval).toBe(2000);
    });

    it("should store module name", () => {
      pool.registerTimer("t", vi.fn(), 1000, { module: "ai" });
      expect(pool._timers.get("t").module).toBe("ai");
    });
  });

  describe("clearTimer", () => {
    it("should remove a registered timer", () => {
      pool.registerTimer("t", vi.fn(), 1000);
      const result = pool.clearTimer("t");
      expect(result).toBe(true);
      expect(pool._timers.has("t")).toBe(false);
    });

    it("should return false for unknown timer", () => {
      expect(pool.clearTimer("nope")).toBe(false);
    });
  });

  describe("connection management", () => {
    it("should register and retrieve a connection", () => {
      const conn = { query: vi.fn() };
      pool.registerConnection("db-main", conn);
      expect(pool.getConnection("db-main")).toBe(conn);
    });

    it("should return null for unknown connection", () => {
      expect(pool.getConnection("nope")).toBeNull();
    });

    it("should update lastUsed on getConnection", () => {
      const conn = { query: vi.fn() };
      pool.registerConnection("db", conn);
      const entry = pool._connections.get("db");
      const firstUsed = entry.lastUsed;
      // Slight delay to ensure different timestamp
      const originalNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(firstUsed + 1000);
      pool.getConnection("db");
      expect(pool._connections.get("db").lastUsed).toBe(firstUsed + 1000);
      vi.restoreAllMocks();
    });

    it("should release a connection and call close", () => {
      const closeSpy = vi.fn();
      pool.registerConnection("db", { close: closeSpy });
      const result = pool.releaseConnection("db");
      expect(result).toBe(true);
      expect(closeSpy).toHaveBeenCalled();
      expect(pool._connections.has("db")).toBe(false);
    });

    it("should return false when releasing unknown connection", () => {
      expect(pool.releaseConnection("nope")).toBe(false);
    });

    it("should handle close errors gracefully", () => {
      pool.registerConnection("db", {
        close: () => {
          throw new Error("close fail");
        },
      });
      expect(() => pool.releaseConnection("db")).not.toThrow();
    });
  });

  describe("resource tracking", () => {
    it("should acquire and release a resource", () => {
      const key = pool.acquireResource("worker", "w1", { pid: 123 });
      expect(key).toBe("worker:w1");
      expect(pool._resources.has(key)).toBe(true);
      pool.releaseResource(key);
      expect(pool._resources.has(key)).toBe(false);
    });

    it("should enforce resource quotas", () => {
      pool.setQuota("worker", 2);
      pool.acquireResource("worker", "w1", {});
      pool.acquireResource("worker", "w2", {});
      expect(() => pool.acquireResource("worker", "w3", {})).toThrow(
        "Resource quota exceeded",
      );
    });

    it("should allow acquisition under quota", () => {
      pool.setQuota("file", 3);
      expect(() => pool.acquireResource("file", "f1", {})).not.toThrow();
    });
  });

  describe("getUsage", () => {
    it("should return usage info for timers, connections, and resources", () => {
      pool.registerTimer("t1", vi.fn(), 1000, { module: "core" });
      pool.registerConnection("db", { close: vi.fn() }, { module: "db" });
      pool.setQuota("worker", 5);
      pool.acquireResource("worker", "w1", {});

      const usage = pool.getUsage();
      expect(usage.timers.count).toBe(1);
      expect(usage.timers.items[0].name).toBe("t1");
      expect(usage.connections.count).toBe(1);
      expect(usage.resources.count).toBe(1);
      expect(usage.resources.quotas.worker).toBe(5);
    });
  });

  describe("disposeAll", () => {
    it("should clear all timers, connections, and resources", async () => {
      const closeSpy = vi.fn();
      pool.registerTimer("t1", vi.fn(), 1000);
      pool.registerConnection("db", { close: closeSpy });
      pool.acquireResource("file", "f1", {});

      await pool.disposeAll();

      expect(pool._timers.size).toBe(0);
      expect(pool._connections.size).toBe(0);
      expect(pool._resources.size).toBe(0);
      expect(closeSpy).toHaveBeenCalled();
    });

    it("should emit pool:disposed event", async () => {
      const spy = vi.fn();
      pool.on("pool:disposed", spy);
      await pool.disposeAll();
      expect(spy).toHaveBeenCalled();
    });
  });
});
