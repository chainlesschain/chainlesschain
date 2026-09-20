import { afterEach, describe, expect, it, vi } from "vitest";

const { createLlmIpcPrivacy } = require("../llm-ipc-privacy");
const {
  CACHE_CHANNELS,
  registerResponseCacheIPC,
  setResponseCacheInstance,
} = require("../response-cache-ipc");

function harness() {
  const handlers = new Map();
  return {
    handlers,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    ipcGuard: {
      isModuleRegistered: vi.fn(() => false),
      markModuleRegistered: vi.fn(),
      unmarkModuleRegistered: vi.fn(),
    },
  };
}

function privacy() {
  return createLlmIpcPrivacy("response-cache", {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });
}

function stats() {
  return {
    runtime: {
      hits: 8,
      misses: 2,
      sets: 4,
      evictions: 1,
      expirations: 3,
      hitRate: "private-derived-value",
    },
    database: {
      totalEntries: 7,
      expiredEntries: 2,
      totalHits: 12,
      totalTokensSaved: 900,
      avgHitsPerEntry: "1.71",
      privatePath: "C:/private/cache",
    },
    config: {
      maxSize: 1_000,
      ttlDays: 7,
      autoCleanup: true,
      secret: "private-config",
    },
  };
}

function cache(overrides = {}) {
  return {
    ttl: 7 * 24 * 60 * 60 * 1_000,
    maxSize: 1_000,
    enableAutoCleanup: true,
    cleanupInterval: 60 * 60 * 1_000,
    getStats: vi.fn(async () => stats()),
    getStatsByProvider: vi.fn(async () => [
      {
        provider: "openai",
        entries: 4,
        hits: 6,
        tokensSaved: 800,
        secret: "private-provider-data",
      },
    ]),
    clear: vi.fn(async () => 7),
    clearExpired: vi.fn(async () => 2),
    get: vi.fn(async () => ({
      hit: true,
      response: { secret: "private-response" },
      cacheAge: 500,
      tokensSaved: 42,
    })),
    _startAutoCleanup: vi.fn(),
    stopAutoCleanup: vi.fn(),
    ...overrides,
  };
}

function register(responseCache, overrides = {}) {
  const setup = harness();
  const authorize = overrides.authorize || vi.fn(async () => true);
  registerResponseCacheIPC({
    ...setup,
    responseCache,
    coreAuthorization: { authorize },
    privacy: privacy(),
  });
  return { ...setup, authorize };
}

describe("response cache IPC authorization and privacy", () => {
  afterEach(() => {
    setResponseCacheInstance(null);
  });

  it("authorizes every channel before cache access", async () => {
    const responseCache = cache();
    const authorize = vi.fn(async () => {
      throw new Error("private-policy-reason");
    });
    const { handlers } = register(responseCache, { authorize });

    expect(handlers.size).toBe(CACHE_CHANNELS.length);
    expect(new Set(handlers.keys())).toEqual(new Set(CACHE_CHANNELS));
    await expect(handlers.get("cache:get-stats")({})).rejects.toMatchObject({
      code: "CC_LLM_IPC_UNAUTHORIZED",
      component: "response-cache",
      operation: "response-cache-get-stats",
    });
    expect(responseCache.getStats).not.toHaveBeenCalled();
  });

  it("projects statistics, provider rows, trends and health", async () => {
    const { handlers } = register(cache());

    const aggregate = await handlers.get("cache:get-stats")({});
    expect(aggregate.stats).toEqual({
      runtime: { hits: 8, misses: 2, sets: 4, evictions: 1, expirations: 3 },
      database: {
        totalEntries: 7,
        expiredEntries: 2,
        totalHits: 12,
        totalTokensSaved: 900,
        avgHitsPerEntry: 1.71,
      },
      config: { maxSize: 1_000, ttlDays: 7, autoCleanup: true },
    });
    expect(JSON.stringify(aggregate)).not.toContain("private");

    await expect(
      handlers.get("cache:get-stats-by-provider")({}),
    ).resolves.toEqual({
      success: true,
      providers: [
        { provider: "openai", entries: 4, hits: 6, tokensSaved: 800 },
      ],
    });
    await expect(handlers.get("cache:get-hit-rate-trend")({})).resolves.toEqual(
      expect.objectContaining({
        hitRate: { current: 80, hits: 8, misses: 2, totalRequests: 10 },
      }),
    );
    await expect(handlers.get("cache:warmup-status")({})).resolves.toEqual({
      success: true,
      status: {
        totalEntries: 7,
        healthyEntries: 5,
        expiredEntries: 2,
        healthPercent: (5 / 7) * 100,
        recommendation: "monitor",
      },
    });
  });

  it("normalizes configuration and returns fixed control receipts", async () => {
    const responseCache = cache();
    const { handlers } = register(responseCache);

    await expect(handlers.get("cache:get-config")({})).resolves.toEqual({
      success: true,
      config: {
        ttl: 604_800_000,
        ttlDays: 7,
        maxSize: 1_000,
        enableAutoCleanup: true,
        cleanupInterval: 3_600_000,
        cleanupIntervalMinutes: 60,
      },
    });
    const updated = await handlers.get("cache:set-config")(
      {},
      {
        enableAutoCleanup: false,
        ttlDays: 30,
        maxSize: 2_000,
      },
    );
    expect(updated.config).toEqual(
      expect.objectContaining({
        ttlDays: 30,
        maxSize: 2_000,
        enableAutoCleanup: false,
      }),
    );
    expect(responseCache.stopAutoCleanup).toHaveBeenCalledTimes(1);

    await expect(handlers.get("cache:clear-all")({})).resolves.toEqual({
      success: true,
      deletedCount: 7,
    });
    await expect(handlers.get("cache:clear-expired")({})).resolves.toEqual({
      success: true,
      deletedCount: 2,
    });
    await expect(handlers.get("cache:start-auto-cleanup")({})).resolves.toEqual(
      { success: true, active: true },
    );
    await expect(handlers.get("cache:stop-auto-cleanup")({})).resolves.toEqual({
      success: true,
      active: false,
    });
  });

  it("bounds cache checks and never returns cached response content", async () => {
    const responseCache = cache();
    const { handlers } = register(responseCache);
    const result = await handlers.get("cache:check")(
      {},
      {
        provider: "openai",
        model: "gpt-5",
        messages: [
          { role: "system", content: "Be concise" },
          { role: "user", content: "Hello" },
        ],
      },
    );

    expect(responseCache.get).toHaveBeenCalledWith("openai", "gpt-5", [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Hello" },
    ]);
    expect(result).toEqual({
      success: true,
      cached: true,
      cacheAge: 500,
      tokensSaved: 42,
    });
    expect(JSON.stringify(result)).not.toContain("private-response");
  });

  it("rejects identity fields, unknown config and hostile message arrays", async () => {
    const responseCache = cache();
    const { handlers } = register(responseCache);
    const getter = vi.fn(() => ({ role: "user", content: "private" }));
    const messages = [];
    Object.defineProperty(messages, 0, { enumerable: true, get: getter });
    messages.length = 1;

    for (const input of [
      { ttlDays: 7, userId: "did:key:forged" },
      new Proxy({ ttlDays: 7 }, {}),
      { ttlDays: 0 },
    ]) {
      await expect(
        handlers.get("cache:set-config")({}, input),
      ).resolves.toMatchObject({
        code: "CC_LLM_RESPONSE_CACHE_OPERATION_FAILED",
      });
    }
    await expect(
      handlers.get("cache:check")(
        {},
        {
          provider: "openai",
          model: "gpt-5",
          messages,
        },
      ),
    ).resolves.toMatchObject({
      code: "CC_LLM_RESPONSE_CACHE_OPERATION_FAILED",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(responseCache.get).not.toHaveBeenCalled();
  });

  it("uses fixed unavailable and cache failure results", async () => {
    const unavailable = register(null);
    await expect(
      unavailable.handlers.get("cache:get-stats")({}),
    ).resolves.toEqual({
      success: false,
      error: "Response cache unavailable",
      code: "CC_LLM_RESPONSE_CACHE_UNAVAILABLE",
    });

    const failed = register(
      cache({
        getStats: vi.fn(async () => {
          throw new Error("private-sqlite-path");
        }),
      }),
    );
    const result = await failed.handlers.get("cache:get-stats")({});
    expect(result).toEqual({
      success: false,
      error: "Response cache operation failed",
      code: "CC_LLM_RESPONSE_CACHE_OPERATION_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain("private-sqlite-path");
  });
});
