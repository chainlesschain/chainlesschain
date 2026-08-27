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

import {
  HARD_REQUEST_BATCHER_LIMITS,
  RequestBatcher,
} from "@/utils/request-batcher";

class StubBatcher extends RequestBatcher {
  apiCalls: Array<{ endpoint: string; params: any }> = [];
  batchCalls: Array<{ endpoint: string; batchParams: any[] }> = [];
  responder: (endpoint: string, params: any) => any = () => ({ ok: true });
  batchResponder: (endpoint: string, batchParams: any[]) => Promise<any[]> = (
    _endpoint,
    batchParams,
  ) => Promise.resolve(batchParams.map((p, idx) => ({ idx, p })));

  protected async executeAPI(endpoint: string, params: any): Promise<any> {
    this.apiCalls.push({ endpoint, params });
    return this.responder(endpoint, params);
  }
  protected async executeBatchAPI(
    endpoint: string,
    batchParams: any[],
  ): Promise<any[]> {
    this.batchCalls.push({ endpoint, batchParams });
    return this.batchResponder(endpoint, batchParams);
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

  it("evicts least-recent cache entries and detaches cached values", async () => {
    const b = make({ maxCacheEntries: 2 });
    b.responder = (_endpoint, params) => ({ value: params.value });
    const first = await b.request(
      "/a",
      { value: "a" },
      { enableBatching: false },
    );
    first.value = "mutated";
    await b.request("/b", { value: "b" }, { enableBatching: false });
    expect(
      await b.request("/a", { value: "a" }, { enableBatching: false }),
    ).toEqual({ value: "a" });
    await b.request("/c", { value: "c" }, { enableBatching: false });

    expect(b.getStats().cacheSize).toBe(2);
    await b.request("/b", { value: "b" }, { enableBatching: false });
    expect(b.apiCalls).toHaveLength(4);
    expect(b.getStats().cacheBytes).toBeGreaterThan(0);
  });

  it("does not retain an oversized cache entry", async () => {
    const b = make({ maxCacheEntryBytes: 64, maxCacheBytes: 128 });
    b.responder = () => ({ payload: "x".repeat(256) });
    await b.request("/large", {}, { enableBatching: false });
    expect(b.getStats().cacheSize).toBe(0);
    expect(b.getStats().cacheBytes).toBe(0);
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

  it("bounds executing batches and releases the next ready batch", async () => {
    const b = make({
      maxBatchSize: 1,
      maxConcurrentBatches: 1,
      batchWindow: 60_000,
    });
    const resolvers: Array<(value: any[]) => void> = [];
    b.batchResponder = (_endpoint, batchParams) =>
      new Promise((resolve) => {
        resolvers.push(() =>
          resolve(batchParams.map((params, idx) => ({ idx, p: params }))),
        );
      });

    const first = b.request("/first", { value: 1 });
    const second = b.request("/second", { value: 2 });
    expect(b.getStats()).toMatchObject({ activeBatches: 1, pendingBatches: 1 });

    resolvers.shift()?.([]);
    await first;
    await vi.waitFor(() => expect(b.batchCalls).toHaveLength(2));
    expect(b.getStats().activeBatches).toBe(1);
    resolvers.shift()?.([]);
    await second;
    expect(b.getStats()).toMatchObject({ activeBatches: 0, pendingBatches: 0 });
  });
});

describe("request-batcher — admission bounds", () => {
  it("clamps caller limits to hard ceilings", () => {
    const b = make(
      Object.fromEntries(
        Object.keys(HARD_REQUEST_BATCHER_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );
    const options = (
      b as unknown as {
        options: Record<string, number>;
      }
    ).options;
    for (const [key, value] of Object.entries(HARD_REQUEST_BATCHER_LIMITS)) {
      expect(options[key]).toBe(value);
    }
  });

  it("rejects oversized and circular request payloads before retention", async () => {
    const b = make({ maxRequestBytes: 64 });
    await expect(
      b.request("/large", { payload: "x".repeat(256) }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "request_payload",
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(b.request("/circular", circular)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "request_payload",
    });
  });

  it("bounds pending endpoint dimensions and cancels waiters on destroy", async () => {
    const b = make({ maxPendingBatches: 2, batchWindow: 60_000 });
    const first = b.request("/one", { value: 1 });
    const second = b.request("/two", { value: 2 });
    await expect(b.request("/three", { value: 3 })).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "request_batches",
    });
    const firstCanceled = expect(first).rejects.toMatchObject({
      code: "CANCELED",
    });
    const secondCanceled = expect(second).rejects.toMatchObject({
      code: "CANCELED",
    });
    b.destroy();
    await firstCanceled;
    await secondCanceled;
    await expect(b.request("/after-destroy")).rejects.toMatchObject({
      code: "CANCELED",
    });
  });

  it("bounds immediate in-flight requests", async () => {
    const b = make({ maxInflightRequests: 1 });
    let release: (value: unknown) => void = () => {};
    b.responder = () => new Promise((resolve) => (release = resolve));
    const first = b.request("/one", { value: 1 }, { enableBatching: false });
    await expect(
      b.request("/two", { value: 2 }, { enableBatching: false }),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "request_inflight",
    });
    release({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
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
