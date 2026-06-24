/**
 * http-optimizer 测试 —— HTTPServerOptimizer 单例的限流、响应缓存（TTL + 淘汰）、
 * 指标统计与一次完整请求流程的集成。
 *
 * 分层：
 *   - 冒烟(smoke)：模块可加载、单例形状正确、基本缓存命中。
 *   - 单元(unit)：checkRateLimit / 缓存 TTL+淘汰 / recordRequestTime / getMetrics。
 *   - 集成(integration)：限流→缓存未命中→落缓存→命中→记录→指标全链路。
 *
 * 时间相关逻辑用 vi.setSystemTime 驱动（缓存 TTL、限流滑动窗口都读 Date.now）。
 * 被测对象是 require 时创建的单例，故每个用例前清空其内部 Map / 指标 / 配置。
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const opt = require("../http-optimizer.js");

function resetState() {
  opt.responseCache.clear();
  opt.requestCounts.clear();
  opt.connections.clear();
  opt.activeConnections = 0;
  opt.batchQueue.length = 0;
  opt.resetMetrics();
  // 还原可能被用例改动的配置
  opt.config.enableCache = true;
  opt.config.cacheMaxAge = 300000;
  opt.config.rateLimit.maxRequests = 100;
  opt.config.rateLimit.windowMs = 60000;
}

beforeEach(() => {
  vi.useRealTimers();
  resetState();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("http-optimizer — smoke", () => {
  it("exports a singleton with the expected shape", () => {
    expect(opt).toBeTruthy();
    expect(typeof opt.checkRateLimit).toBe("function");
    expect(typeof opt.getCachedResponse).toBe("function");
    expect(typeof opt.cacheResponse).toBe("function");
    expect(typeof opt.getMetrics).toBe("function");
    expect(opt.config).toMatchObject({ enableCache: true });
  });

  it("basic happy path: store then read from cache", () => {
    expect(opt.getCachedResponse("k")).toBeNull();
    opt.cacheResponse("k", { body: "hello" });
    expect(opt.getCachedResponse("k")).toEqual({ body: "hello" });
  });
});

describe("http-optimizer — checkRateLimit (sliding window)", () => {
  it("allows up to maxRequests then blocks, counting rateLimitHits", () => {
    opt.config.rateLimit.maxRequests = 3;
    expect(opt.checkRateLimit("c1")).toBe(true); // 1
    expect(opt.checkRateLimit("c1")).toBe(true); // 2
    expect(opt.checkRateLimit("c1")).toBe(true); // 3
    expect(opt.checkRateLimit("c1")).toBe(false); // 4 → blocked
    expect(opt.checkRateLimit("c1")).toBe(false); // still blocked
    expect(opt.metrics.rateLimitHits).toBe(2);
  });

  it("counts each client independently", () => {
    opt.config.rateLimit.maxRequests = 1;
    expect(opt.checkRateLimit("a")).toBe(true);
    expect(opt.checkRateLimit("a")).toBe(false);
    expect(opt.checkRateLimit("b")).toBe(true); // different client unaffected
  });

  it("expires requests older than the window so the client is allowed again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    opt.config.rateLimit.maxRequests = 1;
    opt.config.rateLimit.windowMs = 60000;

    expect(opt.checkRateLimit("c")).toBe(true);
    expect(opt.checkRateLimit("c")).toBe(false); // within window

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z")); // +61s, past the window
    expect(opt.checkRateLimit("c")).toBe(true); // old request expired
  });
});

describe("http-optimizer — response cache (TTL + eviction)", () => {
  it("returns null on miss and counts a cacheHit on hit", () => {
    expect(opt.getCachedResponse("none")).toBeNull();
    expect(opt.metrics.cacheHits).toBe(0);
    opt.cacheResponse("x", { v: 1 });
    expect(opt.getCachedResponse("x")).toEqual({ v: 1 });
    expect(opt.metrics.cacheHits).toBe(1);
  });

  it("expires and evicts an entry once older than cacheMaxAge", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    opt.config.cacheMaxAge = 1000;
    opt.cacheResponse("k", { v: 2 });

    vi.setSystemTime(new Date("2026-01-01T00:00:00.999Z")); // 999ms < 1000 → fresh
    expect(opt.getCachedResponse("k")).toEqual({ v: 2 });

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z")); // exactly maxAge → expired
    expect(opt.getCachedResponse("k")).toBeNull();
    expect(opt.responseCache.has("k")).toBe(false); // evicted on read
  });

  it("does not read or write when enableCache is false", () => {
    opt.config.enableCache = false;
    opt.cacheResponse("k", { v: 3 });
    expect(opt.responseCache.has("k")).toBe(false);
    expect(opt.getCachedResponse("k")).toBeNull();
  });

  it("evicts the oldest entry when the cache exceeds 1000 entries", () => {
    for (let i = 0; i < 1001; i++) {
      opt.cacheResponse(`k${i}`, i);
    }
    expect(opt.responseCache.size).toBe(1000);
    expect(opt.responseCache.has("k0")).toBe(false); // first inserted dropped
    expect(opt.responseCache.has("k1000")).toBe(true);
  });
});

describe("http-optimizer — recordRequestTime / getMetrics", () => {
  it("tracks totals, success/failure split and the running average", () => {
    opt.recordRequestTime(100, true);
    opt.recordRequestTime(200, true);
    opt.recordRequestTime(300, false);
    expect(opt.metrics.totalRequests).toBe(3);
    expect(opt.metrics.successfulRequests).toBe(2);
    expect(opt.metrics.failedRequests).toBe(1);
    expect(opt.metrics.averageResponseTime).toBe(200); // (100+200+300)/3
  });

  it("keeps only the most recent 1000 response times", () => {
    for (let i = 0; i < 1001; i++) {
      opt.recordRequestTime(1, true);
    }
    expect(opt.metrics.responseTimes.length).toBe(1000);
  });

  it("getMetrics reports success/cache-hit rates and live sizes", () => {
    opt.recordRequestTime(50, true);
    opt.recordRequestTime(50, false);
    opt.cacheResponse("c", 1);
    const m = opt.getMetrics();
    expect(m.successRate).toBe("50.00%");
    expect(m.cacheSize).toBe(1);
    expect(m.activeConnections).toBe(0);
  });

  it("getMetrics is divide-by-zero safe with no requests", () => {
    const m = opt.getMetrics();
    expect(m.successRate).toBe("0%");
    expect(m.cacheHitRate).toBe("0%");
  });

  it("resetMetrics / clearCache wipe state", () => {
    opt.recordRequestTime(10, true);
    opt.cacheResponse("k", 1);
    opt.resetMetrics();
    opt.clearCache();
    expect(opt.metrics.totalRequests).toBe(0);
    expect(opt.responseCache.size).toBe(0);
  });
});

describe("http-optimizer — integration: full request flow", () => {
  it("rate-limit → cache miss → store → hit → record → metrics reflect it", () => {
    const client = "client-1";
    const cacheKey = "GET /api/data";

    // 1) first request: allowed, cache miss → "process" and store the response.
    expect(opt.checkRateLimit(client)).toBe(true);
    expect(opt.getCachedResponse(cacheKey)).toBeNull();
    const response = { status: 200, body: "data" };
    opt.cacheResponse(cacheKey, response);
    opt.recordRequestTime(120, true);

    // 2) second request: allowed, served from cache (no re-processing).
    expect(opt.checkRateLimit(client)).toBe(true);
    expect(opt.getCachedResponse(cacheKey)).toEqual(response);
    opt.recordRequestTime(5, true); // cache hit is faster

    const m = opt.getMetrics();
    expect(m.totalRequests).toBe(2);
    expect(m.successfulRequests).toBe(2);
    expect(m.cacheHits).toBe(1);
    expect(m.cacheHitRate).toBe("50.00%"); // 1 hit / 2 requests
    expect(m.cacheSize).toBe(1);
  });
});
