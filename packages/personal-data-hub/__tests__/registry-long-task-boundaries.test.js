"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AdapterRegistry } = require("../lib/registry");
const { generateKeyHex } = require("../lib/key-providers");
const { MockAdapter } = require("../lib/mock-adapter");
const { LocalVault } = require("../lib/vault");

let tmpDir;
let vault;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-reg-long-task-"));
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
    } catch {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function raw(adapter, index, capturedAt = 1_700_000_000_000 + index) {
  return {
    adapter,
    originalId: `${adapter}-raw-${index}`,
    capturedAt,
    payload: {
      variant: 0,
      index,
      text: `long task event ${index}`,
    },
  };
}

class BoundaryAdapter extends MockAdapter {
  constructor({
    name,
    strategy = "count",
    requiresCompleteScan = false,
    sync,
  }) {
    super({ name, count: 0 });
    this.watermarkStrategy = strategy;
    this.watermarkRequiresCompleteScan = requiresCompleteScan;
    this._sync = sync;
    this.attempts = 0;
    this.healthChecks = 0;
  }

  async healthCheck() {
    this.healthChecks += 1;
    return { ok: true };
  }

  sync(options = {}) {
    this.attempts += 1;
    return this._sync(options);
  }
}

describe("AdapterRegistry long-task cancellation boundaries", () => {
  it("honors an already-aborted signal before health check or sync attempt", async () => {
    freshVault();
    const controller = new AbortController();
    controller.abort(new Error("cancelled before attempt"));
    const adapter = new BoundaryAdapter({
      name: "abort-before-attempt",
      sync: async function* sync() {
        yield raw("abort-before-attempt", 1);
      },
    });
    adapter.isRetryableSyncError = () => true;
    const registry = new AdapterRegistry({
      vault,
      syncMaxRetries: 3,
      sleep: async () => {},
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      signal: controller.signal,
    });

    expect(report).toMatchObject({
      status: "error",
      error: "cancelled before attempt",
      rawCount: 0,
      checkpointCommitted: false,
      attemptCount: 1,
      retryCount: 0,
    });
    expect(adapter.healthChecks).toBe(0);
    expect(adapter.attempts).toBe(0);
  });

  it("interrupts retry backoff and does not begin another attempt", async () => {
    freshVault();
    const controller = new AbortController();
    let notifySleepStarted;
    const sleepStarted = new Promise((resolve) => {
      notifySleepStarted = resolve;
    });
    const adapter = new BoundaryAdapter({
      name: "abort-retry-backoff",
      sync: async function* sync() {
        yield* [];
        const error = new Error("temporary network failure");
        error.code = "ECONNRESET";
        throw error;
      },
    });
    const registry = new AdapterRegistry({
      vault,
      syncMaxRetries: 3,
      syncRetryBaseDelayMs: 10,
      sleep: async () => {
        notifySleepStarted();
        return new Promise(() => {});
      },
    });
    registry.register(adapter);

    const running = registry.syncAdapter(adapter.name, {
      signal: controller.signal,
    });
    await sleepStarted;
    controller.abort(new Error("cancelled during backoff"));
    const report = await running;

    expect(report).toMatchObject({
      status: "error",
      error: "cancelled during backoff",
      checkpointCommitted: false,
      attemptCount: 1,
      retryCount: 0,
      retryExhausted: false,
      retryAfterMs: null,
    });
    expect(adapter.attempts).toBe(1);
  });

  it("checks cancellation after a batch flush and before checkpoint commit", async () => {
    freshVault();
    const controller = new AbortController();
    const adapter = new BoundaryAdapter({
      name: "abort-after-flush",
      strategy: "explicit",
      sync: async function* sync(options) {
        options.updateWatermark("cursor-next");
        yield raw("abort-after-flush", 1);
      },
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "cursor-safe",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const putBatch = vault.putBatch.bind(vault);
    vault.putBatch = (batch) => {
      const result = putBatch(batch);
      controller.abort(new Error("cancelled after flush"));
      return result;
    };
    const registry = new AdapterRegistry({ vault, batchSize: 1 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      signal: controller.signal,
    });

    expect(report).toMatchObject({
      status: "error",
      error: "cancelled after flush",
      rawCount: 1,
      archivedRawCount: 1,
      watermark: "cursor-safe",
      checkpointCommitted: false,
      retryCount: 0,
    });
    expect(vault.getWatermark(adapter.name).watermark).toBe("cursor-safe");
  });
});

describe("AdapterRegistry registry-level event limits", () => {
  it("enforces the tighter of limit/maxEvents and defers an unsafe watermark", async () => {
    freshVault();
    let yielded = 0;
    let seenLimits;
    const adapter = new BoundaryAdapter({
      name: "hard-event-limit",
      strategy: "max-captured-at",
      sync: async function* sync(options) {
        seenLimits = {
          limit: options.limit,
          maxEvents: options.maxEvents,
        };
        for (let index = 1; index <= 5; index += 1) {
          yielded += 1;
          yield raw("hard-event-limit", index, 1_000 + index);
        }
      },
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "1000",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault, batchSize: 10 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      limit: 2,
      maxEvents: 4,
    });

    expect(report).toMatchObject({
      status: "ok",
      rawCount: 2,
      archivedRawCount: 2,
      watermark: "1000",
      watermarkDeferred: true,
      checkpointCommitted: false,
    });
    expect(seenLimits).toEqual({ limit: 2, maxEvents: 2 });
    expect(yielded).toBe(2);
    expect(vault.stats().rawEvents).toBe(2);
    expect(vault.getWatermark(adapter.name).watermark).toBe("1000");
  });

  it("commits an exact explicit continuation at the hard limit", async () => {
    freshVault();
    const adapter = new BoundaryAdapter({
      name: "hard-limit-explicit-cursor",
      strategy: "explicit",
      requiresCompleteScan: true,
      sync: async function* sync(options) {
        for (let index = 1; index <= 5; index += 1) {
          options.updateWatermark(`cursor-${index}`);
          yield raw("hard-limit-explicit-cursor", index);
        }
      },
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "cursor-0",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault, batchSize: 10 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, { maxEvents: 2 });

    expect(report).toMatchObject({
      status: "ok",
      rawCount: 2,
      archivedRawCount: 2,
      watermark: "cursor-2",
      watermarkDeferred: false,
      checkpointCommitted: true,
    });
    expect(vault.getWatermark(adapter.name).watermark).toBe("cursor-2");
  });
});

describe("AdapterRegistry terminal audit isolation", () => {
  it("keeps a successful result when adapter.sync.ok audit throws", async () => {
    freshVault();
    const adapter = new MockAdapter({
      name: "success-audit-failure",
      count: 1,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);
    vault.audit = (action) => {
      if (action === "adapter.sync.ok") throw new Error("audit unavailable");
    };

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "ok",
      rawCount: 1,
      checkpointCommitted: true,
      watermark: "1",
    });
  });

  it("keeps the original error result when adapter.sync.error audit throws", async () => {
    freshVault();
    const adapter = new BoundaryAdapter({
      name: "error-audit-failure",
      sync: async function* sync() {
        yield* [];
        const error = new Error("source rejected input");
        error.code = "INVALID_INPUT";
        throw error;
      },
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);
    vault.audit = (action) => {
      if (action === "adapter.sync.error") throw new Error("audit unavailable");
    };

    const report = await registry.syncAdapter(adapter.name);

    expect(report).toMatchObject({
      status: "error",
      error: "source rejected input",
      checkpointCommitted: false,
      attemptCount: 1,
      retryCount: 0,
    });
    expect(adapter.attempts).toBe(1);
  });
});
