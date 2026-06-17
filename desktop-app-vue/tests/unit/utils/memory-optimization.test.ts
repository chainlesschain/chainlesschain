/**
 * memory-optimization 测试 — src/renderer/utils/memory-optimization.ts
 *
 * Pure data structures: ObjectPool (acquire/release/reset/validate/maxSize/
 * stats/clear/drain) and WeakReferenceManager (named weak map/set memoization).
 * logger mocked.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  ObjectPool,
  WeakReferenceManager,
  arrayPool,
} from "@/utils/memory-optimization";

function counterFactory() {
  let id = 0;
  return () => ({ id: id++ });
}

// initialSize:0 falls back to `|| 10` in the ctor, so to get a genuinely empty
// pool we construct then drain() the pre-filled available objects.
function emptyPool(opts: any = {}) {
  const p = new ObjectPool(counterFactory(), { initialSize: 0, ...opts });
  p.drain();
  return p;
}

describe("memory-optimization — ObjectPool", () => {
  it("pre-fills, acquires (reuse + create-on-exhaust) and tracks stats", () => {
    const pool = new ObjectPool(counterFactory(), { initialSize: 2 });
    expect(pool.getStats()).toMatchObject({ available: 2, inUse: 0, total: 2 });
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.getStats()).toMatchObject({ available: 0, inUse: 2 });
    const c = pool.acquire(); // pool exhausted → factory makes a new one
    expect(c).toBeDefined();
    expect(pool.getStats().inUse).toBe(3);
    void a;
    void b;
  });

  it("release returns objects to the pool; reuse hands the same instance back", () => {
    const pool = emptyPool();
    const obj = pool.acquire();
    expect(pool.release(obj)).toBe(true);
    expect(pool.getStats().available).toBe(1);
    expect(pool.acquire()).toBe(obj); // reused
  });

  it("rejects releasing an object that did not come from the pool", () => {
    const pool = emptyPool();
    expect(pool.release({ id: 999 })).toBe(false);
  });

  it("runs resetFn on release and honors validateFn rejection", () => {
    const resetFn = vi.fn();
    const reset = emptyPool({ resetFn });
    const o = reset.acquire();
    reset.release(o);
    expect(resetFn).toHaveBeenCalledWith(o);

    const validated = emptyPool({ validateFn: () => false });
    const v = validated.acquire();
    expect(validated.release(v)).toBe(false); // failed validation → discarded
    expect(validated.getStats().available).toBe(0);
  });

  it("discards releases beyond maxSize; clear and drain empty the pool", () => {
    const pool = emptyPool({ maxSize: 1 });
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.release(a)).toBe(true); // available 1
    expect(pool.release(b)).toBe(false); // at maxSize → discarded
    expect(pool.drain()).toBe(1); // returns the count drained
    expect(pool.getStats().available).toBe(0);
    pool.acquire();
    pool.clear();
    expect(pool.getStats()).toMatchObject({ available: 0, inUse: 0, total: 0 });
  });

  it("exposes the arrayPool singleton", () => {
    expect(typeof arrayPool.acquire).toBe("function");
    const arr = arrayPool.acquire();
    expect(Array.isArray(arr)).toBe(true);
    arrayPool.release(arr);
  });
});

describe("memory-optimization — WeakReferenceManager", () => {
  it("memoizes named weak maps/sets and clear resets them", () => {
    const mgr = new WeakReferenceManager();
    const wm = mgr.getWeakMap<object, number>("cache");
    expect(mgr.getWeakMap("cache")).toBe(wm); // same name → same instance
    const key = {};
    wm.set(key, 7);
    expect(wm.get(key)).toBe(7);

    const ws = mgr.getWeakSet("seen");
    expect(mgr.getWeakSet("seen")).toBe(ws);

    mgr.clear();
    expect(mgr.getWeakMap("cache")).not.toBe(wm); // fresh after clear
  });
});
