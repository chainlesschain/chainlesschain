/**
 * request-batcher 测试 — src/renderer/utils/request-batcher.ts
 *
 * RequestBatcher exposes protected executeAPI/executeBatchAPI seams, so a
 * StubBatcher subclass captures calls and returns controlled data — letting us
 * drive cache / deduplication / batching / error paths without real fetch.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { RequestBatcher } from "@/utils/request-batcher";

class StubBatcher extends RequestBatcher {
  apiCalls: Array<{ endpoint: string; params: any }> = [];
  batchCalls: Array<{ endpoint: string; batchParams: any[] }> = [];
  responder: (endpoint: string, params: any) => any = () => ({ ok: true });

  protected async executeAPI(endpoint: string, params: any): Promise<any> {
    this.apiCalls.push({ endpoint, params });
    return this.responder(endpoint, params);
  }
  protected async executeBatchAPI(
    endpoint: string,
    batchParams: any[],
  ): Promise<any[]> {
    this.batchCalls.push({ endpoint, batchParams });
    return batchParams.map((p, idx) => ({ idx, p }));
  }
}

let created: StubBatcher[] = [];
function make(
  opts?: ConstructorParameters<typeof RequestBatcher>[0],
): StubBatcher {
  const b = new StubBatcher(opts);
  created.push(b);
  return b;
}
afterEach(() => {
  created.forEach((b) => b.destroy());
  created = [];
});

describe("request-batcher — caching", () => {
  it("serves the second identical request from cache", async () => {
    const b = make();
    await b.request("/c", { a: 1 }, { enableBatching: false });
    const r2 = await b.request("/c", { a: 1 }, { enableBatching: false });
    expect(r2).toEqual({ ok: true });
    expect(b.apiCalls).toHaveLength(1); // second hit cache, no API call
    expect(b.getStats().cachedRequests).toBe(1);
  });

  it("skipCache bypasses the cache", async () => {
    const b = make();
    await b.request("/c", { a: 1 }, { enableBatching: false });
    await b.request("/c", { a: 1 }, { enableBatching: false, skipCache: true });
    expect(b.apiCalls).toHaveLength(2);
  });
});

describe("request-batcher — deduplication", () => {
  it("collapses concurrent identical in-flight requests into one API call", async () => {
    const b = make();
    let resolveFn: (v: any) => void = () => {};
    b.responder = () => new Promise((r) => (resolveFn = r));
    const p1 = b.request("/e", { a: 1 }, { enableBatching: false });
    const p2 = b.request("/e", { a: 1 }, { enableBatching: false });
    resolveFn({ v: 1 });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ v: 1 });
    expect(r2).toEqual({ v: 1 });
    expect(b.apiCalls).toHaveLength(1);
    expect(b.getStats().deduplicatedRequests).toBe(1);
  });
});

describe("request-batcher — batching", () => {
  it("merges requests to the same endpoint into one batch call", async () => {
    const b = make({ maxBatchSize: 2 });
    const p1 = b.request("/e", { a: 1 });
    const p2 = b.request("/e", { a: 2 }); // hits maxBatchSize → flushes now
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(b.batchCalls).toHaveLength(1);
    expect(b.batchCalls[0].batchParams).toEqual([{ a: 1 }, { a: 2 }]);
    expect(r1).toEqual({ idx: 0, p: { a: 1 } });
    expect(r2).toEqual({ idx: 1, p: { a: 2 } });
    expect(b.getStats().batchedRequests).toBe(2);
  });

  it("flushes a partial batch after the batch window via the timer", async () => {
    vi.useFakeTimers();
    try {
      const b = make({ maxBatchSize: 10, batchWindow: 50 });
      const p = b.request("/e", { a: 1 });
      await vi.advanceTimersByTimeAsync(60);
      const r = await p;
      expect(r).toEqual({ idx: 0, p: { a: 1 } });
      expect(b.batchCalls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("request-batcher — errors + stats + cleanup", () => {
  it("counts failures and rejects on API error", async () => {
    const b = make();
    b.responder = () => {
      throw new Error("boom");
    };
    await expect(
      b.request("/e", { a: 1 }, { enableBatching: false }),
    ).rejects.toThrow("boom");
    expect(b.getStats().failedRequests).toBe(1);
  });

  it("getStats reports computed rates + sizes; clearCache empties the cache", async () => {
    const b = make();
    await b.request("/c", { a: 1 }, { enableBatching: false });
    const s = b.getStats();
    expect(s.totalRequests).toBe(1);
    expect(s.cacheSize).toBe(1);
    expect(s.batchRate).toMatch(/%$/);
    expect(s.cacheHitRate).toMatch(/%$/);
    b.clearCache();
    expect(b.getStats().cacheSize).toBe(0);
  });
});
