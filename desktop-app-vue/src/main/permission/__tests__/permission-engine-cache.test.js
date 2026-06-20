import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { PermissionEngine } = require("../permission-engine.js");

describe("PermissionEngine permission cache", () => {
  let engine;

  beforeEach(() => {
    engine = new PermissionEngine({}); // db unused by the cache helpers
  });

  it("returns a fresh cached value", () => {
    engine._setCache("k1", true);
    expect(engine._getFromCache("k1")).toBe(true);
  });

  it("returns undefined for an expired entry AND deletes it (no stale leak)", () => {
    engine.permissionCache.set("k2", {
      value: true,
      timestamp: Date.now() - (engine.cacheTimeout + 5_000),
    });
    expect(engine.permissionCache.size).toBe(1);

    expect(engine._getFromCache("k2")).toBeUndefined();
    expect(engine.permissionCache.has("k2")).toBe(false); // stale entry evicted on read
  });

  it("returns undefined for a missing key without creating an entry", () => {
    expect(engine._getFromCache("missing")).toBeUndefined();
    expect(engine.permissionCache.size).toBe(0);
  });

  it("caps the cache at maxCacheEntries, evicting the oldest", () => {
    engine.maxCacheEntries = 3;
    engine._setCache("a", 1);
    engine._setCache("b", 1);
    engine._setCache("c", 1);
    engine._setCache("d", 1); // over cap → evict oldest ("a")

    expect(engine.permissionCache.size).toBe(3);
    expect(engine.permissionCache.has("a")).toBe(false); // oldest evicted
    expect(engine.permissionCache.has("d")).toBe(true); // newest kept
  });

  it("updating an existing key does not evict another entry", () => {
    engine.maxCacheEntries = 2;
    engine._setCache("x", 1);
    engine._setCache("y", 1);
    engine._setCache("x", 2); // update, not a new key → no eviction

    expect(engine.permissionCache.size).toBe(2);
    expect(engine.permissionCache.has("x")).toBe(true);
    expect(engine.permissionCache.has("y")).toBe(true);
    expect(engine._getFromCache("x")).toBe(2);
  });
});
