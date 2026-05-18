import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { SharedCacheManager } = require("../shared-cache");

describe("SharedCacheManager", () => {
  let cache;

  beforeEach(() => {
    cache = new SharedCacheManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cache.destroy();
  });

  describe("constructor", () => {
    it("should initialize with empty state", () => {
      expect(cache._namespaces.size).toBe(0);
      expect(cache._stats).toEqual({ hits: 0, misses: 0, evictions: 0 });
      expect(cache._cleanupInterval).toBeNull();
    });
  });

  describe("initialize", () => {
    it("should start cleanup interval", () => {
      cache.initialize();
      expect(cache._cleanupInterval).not.toBeNull();
    });

    it("should not create duplicate interval on double init", () => {
      cache.initialize();
      const first = cache._cleanupInterval;
      cache.initialize();
      expect(cache._cleanupInterval).toBe(first);
    });
  });

  describe("createNamespace", () => {
    it("should create a namespace with default options", () => {
      const ns = cache.createNamespace("test");
      expect(ns.name).toBe("test");
      expect(ns.maxSize).toBe(1000);
      expect(ns.defaultTTL).toBe(300000);
      expect(ns.entries.size).toBe(0);
    });

    it("should create namespace with custom options", () => {
      const ns = cache.createNamespace("small", {
        maxSize: 5,
        defaultTTL: 1000,
      });
      expect(ns.maxSize).toBe(5);
      expect(ns.defaultTTL).toBe(1000);
    });

    it("should return existing namespace if already created", () => {
      const ns1 = cache.createNamespace("dup");
      const ns2 = cache.createNamespace("dup");
      expect(ns1).toBe(ns2);
    });
  });

  describe("set / get", () => {
    it("should store and retrieve a value", () => {
      cache.createNamespace("ns");
      cache.set("ns", "key1", "value1");
      expect(cache.get("ns", "key1")).toBe("value1");
    });

    it("should auto-create namespace on set if missing", () => {
      cache.set("auto", "k", "v");
      expect(cache.get("auto", "k")).toBe("v");
    });

    it("should return undefined for missing key", () => {
      cache.createNamespace("ns");
      expect(cache.get("ns", "missing")).toBeUndefined();
    });

    it("should return undefined for missing namespace", () => {
      expect(cache.get("nope", "k")).toBeUndefined();
    });

    it("should respect TTL and expire entries", () => {
      cache.createNamespace("ns");
      // Set with very short TTL
      const originalNow = Date.now;
      let now = 1000;
      vi.spyOn(Date, "now").mockImplementation(() => now);

      cache.set("ns", "k", "v", 100);
      expect(cache.get("ns", "k")).toBe("v");

      now = 1200; // After TTL
      expect(cache.get("ns", "k")).toBeUndefined();

      vi.restoreAllMocks();
    });

    it("should track hits and misses in stats", () => {
      cache.createNamespace("ns");
      cache.set("ns", "k", "v");
      cache.get("ns", "k"); // hit
      cache.get("ns", "missing"); // miss
      expect(cache._stats.hits).toBe(1);
      expect(cache._stats.misses).toBe(1);
    });

    it("should update LRU order on get", () => {
      cache.createNamespace("ns");
      cache.set("ns", "a", 1);
      cache.set("ns", "b", 2);
      cache.get("ns", "a"); // Move 'a' to end
      const ns = cache._namespaces.get("ns");
      expect(ns.order[ns.order.length - 1]).toBe("a");
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entry when at capacity", () => {
      cache.createNamespace("tiny", { maxSize: 2 });
      cache.set("tiny", "a", 1);
      cache.set("tiny", "b", 2);
      cache.set("tiny", "c", 3); // Should evict 'a'
      expect(cache.get("tiny", "a")).toBeUndefined();
      expect(cache.get("tiny", "c")).toBe(3);
    });

    it("should emit cache:eviction event", () => {
      const spy = vi.fn();
      cache.on("cache:eviction", spy);
      cache.createNamespace("tiny", { maxSize: 1 });
      cache.set("tiny", "a", 1);
      cache.set("tiny", "b", 2);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: "tiny", key: "a" }),
      );
    });

    it("should increment eviction stats", () => {
      cache.createNamespace("tiny", { maxSize: 1 });
      cache.set("tiny", "a", 1);
      cache.set("tiny", "b", 2);
      expect(cache._stats.evictions).toBe(1);
    });
  });

  describe("has", () => {
    it("should return true for existing non-expired key", () => {
      cache.createNamespace("ns");
      cache.set("ns", "k", "v");
      expect(cache.has("ns", "k")).toBe(true);
    });

    it("should return false for missing key", () => {
      cache.createNamespace("ns");
      expect(cache.has("ns", "nope")).toBe(false);
    });
  });

  describe("delete", () => {
    it("should remove an entry", () => {
      cache.createNamespace("ns");
      cache.set("ns", "k", "v");
      const result = cache.delete("ns", "k");
      expect(result).toBe(true);
      expect(cache.get("ns", "k")).toBeUndefined();
    });

    it("should return false for missing namespace", () => {
      expect(cache.delete("nope", "k")).toBe(false);
    });
  });

  describe("clearNamespace", () => {
    it("should clear all entries in a namespace", () => {
      cache.createNamespace("ns");
      cache.set("ns", "a", 1);
      cache.set("ns", "b", 2);
      cache.clearNamespace("ns");
      expect(cache.get("ns", "a")).toBeUndefined();
      const ns = cache._namespaces.get("ns");
      expect(ns.entries.size).toBe(0);
      expect(ns.order).toEqual([]);
    });

    it("should be a no-op for missing namespace", () => {
      expect(() => cache.clearNamespace("nope")).not.toThrow();
    });
  });

  describe("getStats", () => {
    it("should return global and per-namespace stats", () => {
      cache.createNamespace("ns", { maxSize: 10 });
      cache.set("ns", "k", "v");
      const stats = cache.getStats();
      expect(stats.global).toBeDefined();
      expect(stats.namespaces.ns).toBeDefined();
      expect(stats.namespaces.ns.size).toBe(1);
      expect(stats.namespaces.ns.maxSize).toBe(10);
      expect(stats.namespaces.ns.sets).toBe(1);
    });
  });

  describe("destroy", () => {
    it("should clear interval and namespaces", () => {
      cache.initialize();
      cache.createNamespace("ns");
      cache.destroy();
      expect(cache._cleanupInterval).toBeNull();
      expect(cache._namespaces.size).toBe(0);
    });
  });
});
