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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-watermark-"));
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
    } catch (_err) {}
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

class WatermarkAdapter extends MockAdapter {
  constructor({
    name,
    strategy,
    runs,
    requiresCompleteScan = false,
    defaultScope,
    lookbackMs = 0,
  }) {
    super({ name, count: 0 });
    this.watermarkStrategy = strategy;
    this.watermarkRequiresCompleteScan = requiresCompleteScan;
    this.watermarkLookbackMs = lookbackMs;
    if (defaultScope) this.defaultScope = defaultScope;
    this.runs = [...runs];
    this.seenWatermarks = [];
    this.seenScopes = [];
  }

  async *sync(opts = {}) {
    this.seenWatermarks.push(opts.sinceWatermark);
    this.seenScopes.push(opts.scope);
    const run = this.runs.shift() || {};
    if (run.update !== undefined) opts.updateWatermark(run.update);
    for (const [index, capturedAt] of (run.timestamps || []).entries()) {
      yield {
        adapter: this.name,
        originalId: `${this.name}-${capturedAt}`,
        capturedAt,
        payload: {
          variant: 0,
          index,
          text: `event ${index}`,
        },
      };
    }
    if (run.complete) opts.markWatermarkComplete();
    if (run.error) throw new Error(run.error);
  }
}

class AdaptivePageAdapter extends MockAdapter {
  constructor({
    name = "adaptive-page-source",
    requiredPages,
    capturedAt = Date.now() - 60_000,
  }) {
    super({ name, count: 0 });
    this.watermarkStrategy = "max-captured-at";
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 0;
    this.requiredPages = requiredPages;
    this.capturedAt = capturedAt;
    this.seenPageBudgets = [];
  }

  async *sync(opts = {}) {
    this.seenPageBudgets.push(opts.maxPages);
    const pages = Math.min(opts.maxPages, this.requiredPages);
    for (let index = 0; index < pages; index += 1) {
      yield {
        adapter: this.name,
        originalId: `${this.name}-page-${index}`,
        capturedAt: this.capturedAt - index,
        payload: {
          variant: 0,
          index,
          text: `page ${index}`,
        },
      };
    }
    if (opts.maxPages >= this.requiredPages) {
      opts.markWatermarkComplete();
    }
  }
}

describe("AdapterRegistry watermark strategies", () => {
  it("uses max capturedAt and preserves it across an empty successful sync", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "timestamp-source",
      strategy: "max-captured-at",
      runs: [
        {
          timestamps: [1_700_000_003_000, 1_700_000_001_000, 1_700_000_003_000],
        },
        { timestamps: [] },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name);
    const second = await registry.syncAdapter(adapter.name);

    expect(first.watermark).toBe("1700000003000");
    expect(second.watermark).toBe("1700000003000");
    expect(adapter.seenWatermarks).toEqual([undefined, "1700000003000"]);
    expect(vault.getWatermark(adapter.name).watermark).toBe("1700000003000");
  });

  it("round-trips an opaque explicit cursor through a new registry instance", async () => {
    freshVault();
    const cursor = 'imap-v2:{"INBOX":{"uidValidity":"42","lastUid":108}}';
    const firstAdapter = new WatermarkAdapter({
      name: "opaque-source",
      strategy: "explicit",
      runs: [{ update: cursor, timestamps: [1_700_000_000_000] }],
    });
    const firstRegistry = new AdapterRegistry({ vault });
    firstRegistry.register(firstAdapter);
    expect((await firstRegistry.syncAdapter(firstAdapter.name)).watermark).toBe(
      cursor,
    );

    const restartedAdapter = new WatermarkAdapter({
      name: "opaque-source",
      strategy: "explicit",
      runs: [{ timestamps: [] }],
    });
    const restartedRegistry = new AdapterRegistry({ vault });
    restartedRegistry.register(restartedAdapter);
    const report = await restartedRegistry.syncAdapter(restartedAdapter.name);

    expect(restartedAdapter.seenWatermarks).toEqual([cursor]);
    expect(report.watermark).toBe(cursor);
  });

  it("does not commit an explicit cursor from a failed sync", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "failing-cursor-source",
      strategy: "explicit",
      runs: [
        {
          update: "unsafe:99",
          timestamps: [1_700_000_000_000],
          error: "connection dropped",
        },
      ],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "safe:10",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("error");
    expect(vault.getWatermark(adapter.name).watermark).toBe("safe:10");
    expect(vault.getWatermark(adapter.name).last_status).toBe("error");
  });

  it.each([
    {
      strategy: "count",
      previous: "10",
      update: undefined,
      expected: "12",
    },
    {
      strategy: "max-captured-at",
      previous: "500",
      update: undefined,
      expected: "2000",
    },
    {
      strategy: "explicit",
      previous: "cursor-safe",
      update: "cursor-next",
      expected: "cursor-next",
    },
  ])(
    "blocks the $strategy checkpoint until every raw record is archived",
    async ({ strategy, previous, update, expected }) => {
      freshVault();
      const adapter = new WatermarkAdapter({
        name: `archive-${strategy}`,
        strategy,
        runs: [
          { update, timestamps: [1_000, 2_000] },
          { update, timestamps: [1_000, 2_000] },
        ],
      });
      vault.setWatermark(adapter.name, "", {
        watermark: previous,
        lastSyncedAt: Date.now(),
        lastStatus: "ok",
        lastError: null,
      });
      const registry = new AdapterRegistry({ vault });
      registry.register(adapter);

      const putRawEvent = vault.putRawEvent.bind(vault);
      let failArchive = true;
      vault.putRawEvent = (record) => {
        if (failArchive && record.originalId.endsWith("-2000")) {
          throw new Error("simulated raw archive write failure");
        }
        return putRawEvent(record);
      };

      const failed = await registry.syncAdapter(adapter.name);

      expect(failed.status).toBe("error");
      expect(failed.error).toContain("raw archive incomplete");
      expect(failed.rawCount).toBe(2);
      expect(failed.archivedRawCount).toBe(1);
      expect(failed.archiveFailureCount).toBe(1);
      expect(failed.checkpointCommitted).toBe(false);
      expect(failed.watermark).toBe(previous);
      expect(vault.getWatermark(adapter.name).watermark).toBe(previous);
      expect(vault.getWatermark(adapter.name).last_status).toBe("error");
      expect(vault.stats().rawEvents).toBe(1);
      expect(vault.stats().events).toBe(0);

      failArchive = false;
      const recovered = await registry.syncAdapter(adapter.name);

      expect(recovered.status).toBe("ok");
      expect(recovered.archivedRawCount).toBe(2);
      expect(recovered.archiveFailureCount).toBe(0);
      expect(recovered.checkpointCommitted).toBe(true);
      expect(recovered.watermark).toBe(expected);
      expect(vault.getWatermark(adapter.name).watermark).toBe(expected);
      expect(vault.stats().rawEvents).toBe(2);
      expect(vault.stats().events).toBe(2);
    },
  );

  it("rejects a malformed raw envelope before an explicit cursor can commit", async () => {
    freshVault();
    class MalformedEnvelopeAdapter extends WatermarkAdapter {
      async *sync(opts = {}) {
        opts.updateWatermark("cursor-unsafe");
        yield null;
      }
    }
    const adapter = new MalformedEnvelopeAdapter({
      name: "malformed-envelope-source",
      strategy: "explicit",
      runs: [],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "cursor-safe",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("error");
    expect(report.archiveFailureCount).toBe(1);
    expect(report.archivedRawCount).toBe(0);
    expect(report.checkpointCommitted).toBe(false);
    expect(report.watermark).toBe("cursor-safe");
    expect(vault.getWatermark(adapter.name).watermark).toBe("cursor-safe");
  });

  it("defers a high-water mark until a paginated scan is complete", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "bounded-timestamp-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      runs: [
        { timestamps: [5_000, 4_000] },
        { timestamps: [5_000, 4_000, 3_000, 2_000], complete: true },
      ],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "1000",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const partial = await registry.syncAdapter(adapter.name);
    expect(partial.watermarkDeferred).toBe(true);
    expect(partial.watermark).toBe("1000");
    expect(vault.getWatermark(adapter.name).watermark).toBe("1000");

    const complete = await registry.syncAdapter(adapter.name);
    expect(complete.watermarkDeferred).toBe(false);
    expect(complete.watermark).toBe("5000");
    expect(adapter.seenWatermarks).toEqual(["1000", "1000"]);
    expect(vault.stats().rawEvents).toBe(4);
  });

  it("expands a deferred page budget across registry restarts and clears it on completion", async () => {
    freshVault();
    const capturedAt = Date.now() - 60_000;

    const firstAdapter = new AdaptivePageAdapter({
      requiredPages: 25,
      capturedAt,
    });
    const firstRegistry = new AdapterRegistry({ vault });
    firstRegistry.register(firstAdapter);
    const first = await firstRegistry.syncAdapter(firstAdapter.name);

    expect(first).toMatchObject({
      watermarkDeferred: true,
      watermark: null,
      pageBudget: 10,
      nextPageBudget: 20,
      scanDeferredCount: 1,
    });
    expect(vault.getSyncScanState(firstAdapter.name)).toMatchObject({
      page_budget: 20,
      deferred_count: 1,
    });

    const secondAdapter = new AdaptivePageAdapter({
      requiredPages: 25,
      capturedAt,
    });
    const secondRegistry = new AdapterRegistry({ vault });
    secondRegistry.register(secondAdapter);
    const second = await secondRegistry.syncAdapter(secondAdapter.name);

    expect(second).toMatchObject({
      watermarkDeferred: true,
      watermark: null,
      pageBudget: 20,
      nextPageBudget: 40,
      scanDeferredCount: 2,
    });

    const finalAdapter = new AdaptivePageAdapter({
      requiredPages: 25,
      capturedAt,
    });
    const finalRegistry = new AdapterRegistry({ vault });
    finalRegistry.register(finalAdapter);
    const final = await finalRegistry.syncAdapter(finalAdapter.name);

    expect(final).toMatchObject({
      watermarkDeferred: false,
      watermark: String(capturedAt),
      pageBudget: 40,
      nextPageBudget: null,
      scanDeferredCount: 2,
    });
    expect(vault.getSyncScanState(finalAdapter.name)).toBeNull();
    expect(vault.stats().rawEvents).toBe(25);
    expect(firstAdapter.seenPageBudgets).toEqual([10]);
    expect(secondAdapter.seenPageBudgets).toEqual([20]);
    expect(finalAdapter.seenPageBudgets).toEqual([40]);
  });

  it("replays a configured lookback window without regressing the checkpoint", async () => {
    freshVault();
    const highWatermark = Date.now() - 60_000;
    const lateArrival = highWatermark - 30 * 60_000;
    const lookbackMs = 24 * 60 * 60_000;
    const adapter = new WatermarkAdapter({
      name: "late-arrival-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      lookbackMs,
      runs: [
        { timestamps: [highWatermark], complete: true },
        { timestamps: [lateArrival], complete: true },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name);
    const second = await registry.syncAdapter(adapter.name);

    expect(first.watermark).toBe(String(highWatermark));
    expect(adapter.seenWatermarks).toEqual([
      undefined,
      highWatermark - lookbackMs,
    ]);
    expect(second.collectionSinceWatermark).toBe(
      String(highWatermark - lookbackMs),
    );
    expect(second.watermarkLookbackMs).toBe(lookbackMs);
    expect(second.watermark).toBe(String(highWatermark));
    expect(vault.stats().rawEvents).toBe(2);
  });

  it("surfaces an incomplete empty page instead of reporting a full sync", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "empty-bounded-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      runs: [{ timestamps: [] }],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("ok");
    expect(report.rawCount).toBe(0);
    expect(report.watermark).toBe(null);
    expect(report.watermarkDeferred).toBe(true);
    expect(report.checkpointCommitted).toBe(true);
  });

  it("repairs stored future watermarks and never commits a future candidate", async () => {
    freshVault();
    const syncStartedAt = Date.now();
    const future = syncStartedAt + 365 * 24 * 60 * 60 * 1000;
    const adapter = new WatermarkAdapter({
      name: "future-timestamp-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      runs: [{ timestamps: [future], complete: true }],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: String(future),
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(adapter.seenWatermarks).toEqual([undefined]);
    expect(Number(report.watermark)).toBeGreaterThanOrEqual(syncStartedAt);
    expect(Number(report.watermark)).toBeLessThan(future);
    expect(Number(report.watermark)).toBeLessThanOrEqual(Date.now());
    expect(report.checkpointCommitted).toBe(true);
  });

  it("does not require an online-page handshake for explicit file imports", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "snapshot-timestamp-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      runs: [{ timestamps: [8_000, 7_000] }],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "fixture-snapshot.json",
    });

    expect(report.watermarkDeferred).toBe(false);
    expect(report.watermark).toBe("8000");
  });

  it("keeps cursors isolated while an account-backed adapter switches accounts", async () => {
    freshVault();
    const accountA = new WatermarkAdapter({
      name: "account-source",
      strategy: "explicit",
      defaultScope: "account:account-source:aaaa",
      runs: [{ update: "cursor-a", timestamps: [1_000] }],
    });
    const firstRegistry = new AdapterRegistry({ vault });
    firstRegistry.register(accountA);
    await firstRegistry.syncAdapter(accountA.name);

    const accountB = new WatermarkAdapter({
      name: "account-source",
      strategy: "explicit",
      defaultScope: "account:account-source:bbbb",
      runs: [{ update: "cursor-b", timestamps: [2_000] }],
    });
    const secondRegistry = new AdapterRegistry({ vault });
    secondRegistry.register(accountB);
    await secondRegistry.syncAdapter(accountB.name);
    vault.setWatermark(accountA.name, "", {
      watermark: "legacy-shared-cursor",
      lastSyncedAt: Date.now(),
      lastStatus: "error",
      lastError: "legacy shared status must stay isolated",
    });

    const switchedBackToA = new WatermarkAdapter({
      name: "account-source",
      strategy: "explicit",
      defaultScope: "account:account-source:aaaa",
      runs: [{ timestamps: [] }],
    });
    const thirdRegistry = new AdapterRegistry({ vault });
    thirdRegistry.register(switchedBackToA);
    const resumed = await thirdRegistry.syncAdapter(switchedBackToA.name);
    const [readiness] = await thirdRegistry.readiness();

    expect(accountA.seenWatermarks).toEqual([undefined]);
    expect(accountB.seenWatermarks).toEqual([undefined]);
    expect(switchedBackToA.seenWatermarks).toEqual(["cursor-a"]);
    expect(switchedBackToA.seenScopes).toEqual(["account:account-source:aaaa"]);
    expect(resumed.watermark).toBe("cursor-a");
    expect(readiness.lastStatus).toBe("ok");
    expect(readiness.lastError).toBeNull();
    expect(
      vault.getWatermark(accountA.name, accountA.defaultScope).watermark,
    ).toBe("cursor-a");
    expect(
      vault.getWatermark(accountB.name, accountB.defaultScope).watermark,
    ).toBe("cursor-b");
  });

  it("lets an explicit sync scope override an adapter default scope", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "scoped-source",
      strategy: "explicit",
      defaultScope: "account:scoped-source:default",
      runs: [{ update: "manual-cursor", timestamps: [1_000] }],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    await registry.syncAdapter(adapter.name, { scope: "manual-scope" });

    expect(adapter.seenScopes).toEqual(["manual-scope"]);
    expect(vault.getWatermark(adapter.name, "manual-scope").watermark).toBe(
      "manual-cursor",
    );
    expect(vault.getWatermark(adapter.name, adapter.defaultScope)).toBeNull();
  });

  it("isolates raw archives and normalized entities when account IDs collide", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "colliding-account-source",
      strategy: "explicit",
      runs: [
        { timestamps: [1_700_000_000_000] },
        { timestamps: [1_700_000_000_000] },
        { timestamps: [1_700_000_000_000] },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);
    const scopeA = "account:colliding-account-source:aaaaaaaa";
    const scopeB = "account:colliding-account-source:bbbbbbbb";

    const firstA = await registry.syncAdapter(adapter.name, { scope: scopeA });
    await registry.syncAdapter(adapter.name, { scope: scopeB });
    const repeatedA = await registry.syncAdapter(adapter.name, {
      scope: scopeA,
    });

    expect(firstA.scope).toBe(scopeA);
    expect(repeatedA.scope).toBe(scopeA);
    expect(vault.stats().rawEvents).toBe(2);
    expect(vault.stats().events).toBe(2);
    expect(
      vault.queryRawEvents({ adapter: adapter.name, scope: scopeA }),
    ).toHaveLength(1);
    expect(
      vault.queryRawEvents({ adapter: adapter.name, scope: scopeB }),
    ).toHaveLength(1);

    const events = vault.queryEvents({
      adapter: adapter.name,
      limit: 10,
    });
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
    expect(new Set(events.map((event) => event.source.scope))).toEqual(
      new Set([scopeA, scopeB]),
    );
    expect(events.every((event) => event.source.originalId)).toBe(true);
  });

  it("isolates cursors by the account embedded in each JSON snapshot", async () => {
    freshVault();
    const accountAPath = path.join(tmpDir, "account-a.json");
    const accountBPath = path.join(tmpDir, "account-b.json");
    fs.writeFileSync(
      accountAPath,
      JSON.stringify({ account: { userId: "snapshot-user-a" } }),
    );
    fs.writeFileSync(
      accountBPath,
      JSON.stringify({ account: { userId: "snapshot-user-b" } }),
    );
    const adapter = new WatermarkAdapter({
      name: "snapshot-account-source",
      strategy: "explicit",
      defaultScope: "account:snapshot-account-source:live",
      runs: [
        { update: "cursor-a", timestamps: [1_000] },
        { update: "cursor-b", timestamps: [2_000] },
        { timestamps: [] },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    await registry.syncAdapter(adapter.name, { inputPath: accountAPath });
    await registry.syncAdapter(adapter.name, { inputPath: accountBPath });
    const resumedA = await registry.syncAdapter(adapter.name, {
      inputPath: accountAPath,
    });

    expect(adapter.seenWatermarks).toEqual([undefined, undefined, "cursor-a"]);
    expect(adapter.seenScopes[0]).not.toBe(adapter.seenScopes[1]);
    expect(adapter.seenScopes[0]).toMatch(
      /^account:snapshot-account-source:[a-f0-9]{32}$/u,
    );
    expect(resumedA.watermark).toBe("cursor-a");
    expect(JSON.stringify(adapter.seenScopes)).not.toContain("snapshot-user");
    expect(vault.getWatermark(adapter.name, adapter.defaultScope)).toBeNull();
  });

  it("does not attribute an unscoped snapshot to the live account", async () => {
    freshVault();
    const inputPath = path.join(tmpDir, "unscoped.json");
    fs.writeFileSync(inputPath, JSON.stringify({ records: [] }));
    const adapter = new WatermarkAdapter({
      name: "unscoped-snapshot-source",
      strategy: "explicit",
      defaultScope: "account:unscoped-snapshot-source:live",
      runs: [{ update: "snapshot-cursor", timestamps: [] }],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    await registry.syncAdapter(adapter.name, { inputPath });

    expect(adapter.seenScopes).toEqual([""]);
    expect(vault.getWatermark(adapter.name, "").watermark).toBe(
      "snapshot-cursor",
    );
    expect(vault.getWatermark(adapter.name, adapter.defaultScope)).toBeNull();
  });
});
