"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { MockAdapter } = require("../lib/mock-adapter");

let tmpDir;
let vault;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-sync-retry-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch (_error) {}
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function raw(adapter, index) {
  return {
    adapter,
    originalId: `${adapter}-raw-${index}`,
    capturedAt: 1_700_000_000_000 + index,
    payload: {
      variant: 0,
      index,
      text: `retry event ${index}`,
    },
  };
}

class FlakySyncAdapter extends MockAdapter {
  constructor({
    name = "flaky-sync",
    failures = 0,
    errorCode = "ECONNRESET",
    rateLimits = {},
  } = {}) {
    super({ name, count: 0 });
    this.failures = failures;
    this.errorCode = errorCode;
    this.rateLimits = rateLimits;
    this.attempts = 0;
  }

  async *sync() {
    this.attempts += 1;
    yield raw(this.name, 1);
    if (this.attempts <= this.failures) {
      const error = new Error(`${this.errorCode}: transient source failure`);
      error.code = this.errorCode;
      throw error;
    }
    yield raw(this.name, 2);
  }
}

class PagedSyncAdapter extends MockAdapter {
  constructor({
    name = "paged-sync",
    pages = 3,
    failFirstAttempt = false,
    rateLimits = { perMinute: 6, perDay: 20 },
    now = Date.now,
  } = {}) {
    super({ name, count: 0 });
    this.pages = pages;
    this.failFirstAttempt = failFirstAttempt;
    this.rateLimits = rateLimits;
    this.now = now;
    this.attempts = 0;
    this.requestTimes = [];
  }

  async *sync(opts = {}) {
    this.attempts += 1;
    for (let page = 1; page <= this.pages; page += 1) {
      await opts.beforeSourceRequest({ operation: "orders", page });
      this.requestTimes.push(this.now());
      yield raw(this.name, page);
      if (this.failFirstAttempt && this.attempts === 1 && page === 1) {
        const error = new Error("temporary page failure");
        error.code = "ECONNRESET";
        throw error;
      }
    }
  }
}

describe("AdapterRegistry transient retry policy", () => {
  it("replays a partial transient attempt with exponential backoff and commits once complete", async () => {
    freshVault();
    const sleeps = [];
    const events = [];
    const adapter = new FlakySyncAdapter({
      failures: 2,
      rateLimits: { perMinute: 10, perDay: 20 },
    });
    const registry = new AdapterRegistry({
      vault,
      batchSize: 1,
      syncMaxRetries: 3,
      syncRetryBaseDelayMs: 100,
      syncRetryMaxDelayMs: 1_000,
      sleep: async (ms) => sleeps.push(ms),
      onSyncEvent: (event) => events.push(event),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "ok",
      rawCount: 2,
      archivedRawCount: 2,
      checkpointCommitted: true,
      attemptCount: 3,
      retryCount: 2,
      totalRetryDelayMs: 300,
      retryExhausted: false,
      rateLimitRemainingMinute: 7,
      rateLimitRemainingDay: 17,
    });
    expect(adapter.attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
    expect(vault.stats().rawEvents).toBe(2);
    expect(vault.getWatermark(adapter.name)).toMatchObject({
      watermark: "2",
      last_status: "ok",
    });
    expect(events.filter((event) => event.kind === "sync.retry")).toHaveLength(
      2,
    );
    expect(events.filter((event) => event.kind === "sync.error")).toHaveLength(
      0,
    );
    expect(events.filter((event) => event.kind === "sync.ok")).toHaveLength(1);
    expect(
      vault.queryAudit({ action: "adapter.sync.retry_scheduled" }),
    ).toHaveLength(2);
  });

  it("stops after the configured retry budget and never advances the checkpoint", async () => {
    freshVault();
    const sleeps = [];
    const events = [];
    const adapter = new FlakySyncAdapter({ failures: 99 });
    const registry = new AdapterRegistry({
      vault,
      batchSize: 1,
      syncMaxRetries: 2,
      syncRetryBaseDelayMs: 10,
      syncRetryMaxDelayMs: 100,
      sleep: async (ms) => sleeps.push(ms),
      onSyncEvent: (event) => events.push(event),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "error",
      checkpointCommitted: false,
      watermark: null,
      attemptCount: 3,
      retryCount: 2,
      totalRetryDelayMs: 30,
      retryExhausted: true,
    });
    expect(adapter.attempts).toBe(3);
    expect(sleeps).toEqual([10, 20]);
    expect(vault.getWatermark(adapter.name)).toMatchObject({
      watermark: null,
      last_status: "error",
    });
    expect(events.filter((event) => event.kind === "sync.error")).toHaveLength(
      1,
    );
    expect(
      vault.queryAudit({ action: "adapter.sync.retry_exhausted" }),
    ).toHaveLength(1);
  });

  it("does not retry authentication or other non-transient failures", async () => {
    freshVault();
    const sleeps = [];
    const adapter = new FlakySyncAdapter({
      failures: 1,
      errorCode: "AUTH_FAILED",
    });
    const registry = new AdapterRegistry({
      vault,
      sleep: async (ms) => sleeps.push(ms),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "error",
      attemptCount: 1,
      retryCount: 0,
      retryExhausted: false,
    });
    expect(adapter.attempts).toBe(1);
    expect(sleeps).toEqual([]);
  });
});

describe("AdapterRegistry persistent rate limits", () => {
  it("blocks a second registry before source access and recovers at the next window", async () => {
    freshVault();
    let now = Date.UTC(2026, 6, 24, 1, 2, 3);
    const adapter = new FlakySyncAdapter({
      name: "limited-source",
      rateLimits: { perMinute: 1, perDay: 10 },
    });
    const firstEvents = [];
    const firstRegistry = new AdapterRegistry({
      vault,
      now: () => now,
      onSyncEvent: (event) => firstEvents.push(event),
    });
    firstRegistry.register(adapter);

    const first = await firstRegistry.syncAdapter(adapter.name);
    expect(first).toMatchObject({
      status: "ok",
      rateLimitRemainingMinute: 0,
      rateLimitRemainingDay: 9,
    });
    expect(adapter.attempts).toBe(1);

    const secondEvents = [];
    const secondRegistry = new AdapterRegistry({
      vault,
      now: () => now,
      onSyncEvent: (event) => secondEvents.push(event),
    });
    secondRegistry.register(adapter);
    const blocked = await secondRegistry.syncAdapter(adapter.name);

    expect(blocked).toMatchObject({
      status: "rate_limited",
      checkpointCommitted: false,
      watermark: "2",
      rateLimitReason: "per_minute",
      rateLimitRemainingMinute: 0,
      rateLimitRemainingDay: 9,
      attemptCount: 1,
      retryCount: 0,
    });
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(adapter.attempts).toBe(1);
    expect(
      secondEvents.filter((event) => event.kind === "sync.rate_limited"),
    ).toHaveLength(1);
    expect(vault.getWatermark(adapter.name)).toMatchObject({
      watermark: "2",
      last_status: "rate_limited",
    });

    now = Math.floor(now / 60_000) * 60_000 + 60_000;
    const thirdRegistry = new AdapterRegistry({ vault, now: () => now });
    thirdRegistry.register(adapter);
    const recovered = await thirdRegistry.syncAdapter(adapter.name);
    expect(recovered.status).toBe("ok");
    expect(recovered.watermark).toBe("4");
    expect(adapter.attempts).toBe(2);
  });
});

describe("AdapterRegistry source-request pacing", () => {
  it("spaces page requests, persists the request window, and reports wait metrics", async () => {
    freshVault();
    let now = Date.UTC(2026, 6, 24, 1, 2, 3);
    const sleeps = [];
    const events = [];
    const adapter = new PagedSyncAdapter({ now: () => now });
    const registry = new AdapterRegistry({
      vault,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      onSyncEvent: (event) => events.push(event),
    });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name, {
      scope: "account:a",
    });

    expect(first).toMatchObject({
      status: "ok",
      checkpointCommitted: true,
      sourceRequestCount: 3,
      sourceRequestThrottleMs: 20_000,
      sourceRequestRateLimitRemainingMinute: 3,
      sourceRequestRateLimitRemainingDay: 17,
    });
    expect(sleeps).toEqual([10_000, 10_000]);
    expect(adapter.requestTimes).toEqual([
      Date.UTC(2026, 6, 24, 1, 2, 3),
      Date.UTC(2026, 6, 24, 1, 2, 13),
      Date.UTC(2026, 6, 24, 1, 2, 23),
    ]);
    expect(
      events.filter((event) => event.kind === "sync.request_throttled"),
    ).toHaveLength(2);
    expect(
      vault.getSourceRequestRateLimitState(adapter.name, "account:a"),
    ).toMatchObject({
      minute_count: 3,
      day_count: 3,
      last_acquired_at: now,
    });

    const secondSleeps = [];
    const secondRegistry = new AdapterRegistry({
      vault,
      now: () => now,
      sleep: async (ms) => {
        secondSleeps.push(ms);
        now += ms;
      },
    });
    secondRegistry.register(adapter);
    const second = await secondRegistry.syncAdapter(adapter.name, {
      scope: "account:a",
    });

    expect(second.status).toBe("ok");
    expect(second.sourceRequestCount).toBe(3);
    expect(secondSleeps[0]).toBe(10_000);
    expect(vault.stats().sourceRequestRateLimitStates).toBe(1);
  });

  it("preserves request pacing across transient sync retries", async () => {
    freshVault();
    let now = Date.UTC(2026, 6, 24, 3, 0, 0);
    const sleeps = [];
    const adapter = new PagedSyncAdapter({
      pages: 2,
      failFirstAttempt: true,
      rateLimits: { perMinute: 60, perDay: 10 },
      now: () => now,
    });
    const registry = new AdapterRegistry({
      vault,
      now: () => now,
      syncRetryBaseDelayMs: 100,
      syncRetryMaxDelayMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "ok",
      attemptCount: 2,
      retryCount: 1,
      totalRetryDelayMs: 100,
      sourceRequestCount: 3,
      sourceRequestThrottleMs: 1_900,
    });
    expect(sleeps).toEqual([100, 900, 1_000]);
    expect(adapter.requestTimes).toEqual([
      Date.UTC(2026, 6, 24, 3, 0, 0),
      Date.UTC(2026, 6, 24, 3, 0, 1),
      Date.UTC(2026, 6, 24, 3, 0, 2),
    ]);
  });

  it("stops at the daily request quota without committing a partial checkpoint", async () => {
    freshVault();
    const events = [];
    const adapter = new PagedSyncAdapter({
      pages: 2,
      rateLimits: { perDay: 1 },
    });
    const registry = new AdapterRegistry({
      vault,
      batchSize: 1,
      onSyncEvent: (event) => events.push(event),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "rate_limited",
      rateLimitReason: "request_per_day",
      checkpointCommitted: false,
      watermark: null,
      attemptCount: 1,
      retryCount: 0,
      sourceRequestCount: 1,
      sourceRequestRateLimitRemainingDay: 0,
    });
    expect(report.retryAfterMs).toBeGreaterThan(0);
    expect(vault.stats().rawEvents).toBe(1);
    expect(vault.getWatermark(adapter.name)).toMatchObject({
      watermark: null,
      last_status: "rate_limited",
    });
    expect(
      events.filter(
        (event) =>
          event.kind === "sync.rate_limited" &&
          event.phase === "source_request",
      ),
    ).toHaveLength(1);
    expect(events.filter((event) => event.kind === "sync.retry")).toHaveLength(
      0,
    );
  });

  it("cancels an in-flight throttle wait without issuing the next request", async () => {
    freshVault();
    const controller = new AbortController();
    let throttledResolve;
    const throttled = new Promise((resolve) => {
      throttledResolve = resolve;
    });
    const adapter = new PagedSyncAdapter({
      pages: 2,
      rateLimits: { perMinute: 60, perDay: 10 },
    });
    const registry = new AdapterRegistry({
      vault,
      sleep: async () => new Promise(() => {}),
      onSyncEvent: (event) => {
        if (event.kind === "sync.request_throttled") throttledResolve();
      },
    });
    registry.register(adapter);

    const running = registry.syncAdapter(adapter.name, {
      signal: controller.signal,
    });
    await throttled;
    controller.abort(new Error("user cancelled"));
    const report = await running;

    expect(report).toMatchObject({
      status: "error",
      error: "user cancelled",
      checkpointCommitted: false,
      attemptCount: 1,
      retryCount: 0,
      sourceRequestCount: 1,
    });
    expect(adapter.requestTimes).toHaveLength(1);
  });
});
