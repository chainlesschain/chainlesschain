"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { MockAdapter } = require("../lib/mock-adapter");
const { LocalFilesAdapter } = require("../lib/adapters/local-files");
const { WechatAdapter } = require("../lib/adapters/wechat");
const { TencentMeetingAdapter } = require("../lib/adapters/meeting-tencent");

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
    } catch {
      // Best-effort test cleanup.
    }
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
    fileCheckpointMode,
  }) {
    super({ name, count: 0 });
    this.watermarkStrategy = strategy;
    this.watermarkRequiresCompleteScan = requiresCompleteScan;
    this.watermarkLookbackMs = lookbackMs;
    if (fileCheckpointMode) this.fileCheckpointMode = fileCheckpointMode;
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
      const raw = {
        adapter: this.name,
        originalId: `${this.name}-${capturedAt}`,
        capturedAt,
        payload: {
          variant: 0,
          index,
          text: `event ${index}`,
        },
      };
      if (
        Array.isArray(run.watermarkAts) &&
        Object.prototype.hasOwnProperty.call(run.watermarkAts, index)
      ) {
        raw.watermarkAt = run.watermarkAts[index];
      }
      yield raw;
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

  it("uses an explicit watermarkAt while keeping capturedAt as an archive timestamp", async () => {
    freshVault();
    const collectedAt = Date.now();
    const adapter = new WatermarkAdapter({
      name: "source-time-watermark",
      strategy: "max-captured-at",
      runs: [
        { timestamps: [collectedAt], watermarkAts: [null] },
        { timestamps: [collectedAt + 1], watermarkAts: [2_000] },
        { timestamps: [3_000] },
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

    const ignoredFallback = await registry.syncAdapter(adapter.name);
    const explicitSourceTime = await registry.syncAdapter(adapter.name);
    const legacyCapturedAt = await registry.syncAdapter(adapter.name);

    expect(ignoredFallback.watermark).toBe("1000");
    expect(explicitSourceTime.watermark).toBe("2000");
    expect(legacyCapturedAt.watermark).toBe("3000");
    expect(adapter.seenWatermarks).toEqual(["1000", "1000", "2000"]);
  });

  it("round-trips an opaque explicit cursor through a new registry instance", async () => {
    freshVault();
    const cursor = 'imap-v2:{"INBOX":{"uidValidity":"42","lastUid":108}}';
    const cursorSummary = {
      format: "explicit",
      byteLength: Buffer.byteLength(cursor, "utf8"),
      hmacSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    };
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
    const telemetry = [];
    const restartedRegistry = new AdapterRegistry({
      vault,
      onSyncEvent: (event) => telemetry.push(event),
    });
    restartedRegistry.register(restartedAdapter);
    const report = await restartedRegistry.syncAdapter(restartedAdapter.name);

    expect(restartedAdapter.seenWatermarks).toEqual([cursor]);
    expect(report.watermark).toBe(cursor);
    const startEvent = telemetry.find((event) => event.kind === "sync.start");
    const okEvent = telemetry.find((event) => event.kind === "sync.ok");
    expect(startEvent).toMatchObject({
      sinceWatermark: cursorSummary,
      checkpointWatermark: cursorSummary,
    });
    expect(okEvent).toMatchObject({
      watermark: cursorSummary,
      collectionSinceWatermark: cursorSummary,
    });
    const auditDetails = JSON.parse(
      vault.queryAudit({ action: "adapter.sync.ok", limit: 1 })[0].details,
    );
    expect(auditDetails).toMatchObject({
      watermark: cursorSummary,
      collectionSinceWatermark: cursorSummary,
    });
  });

  it("summarizes numeric explicit cursor overrides in sync telemetry", async () => {
    freshVault();
    const telemetry = [];
    const adapter = new WatermarkAdapter({
      name: "numeric-explicit-source",
      strategy: "explicit",
      runs: [{ timestamps: [] }],
    });
    const registry = new AdapterRegistry({
      vault,
      onSyncEvent: (event) => telemetry.push(event),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      sinceWatermark: 42,
    });

    expect(report.watermark).toBe("42");
    expect(adapter.seenWatermarks).toEqual([42]);
    expect(
      telemetry.find((event) => event.kind === "sync.start"),
    ).toMatchObject({
      sinceWatermark: {
        format: "explicit",
        byteLength: 2,
        hmacSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      checkpointWatermark: {
        format: "explicit",
        byteLength: 2,
        hmacSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
  });

  it("summarizes a near-4MiB explicit cursor only in audit and sync telemetry", async () => {
    freshVault();
    const cursor = `git-v1:${"x".repeat(4 * 1024 * 1024 - 128)}`;
    const expectedSummary = {
      format: "explicit",
      byteLength: Buffer.byteLength(cursor, "utf8"),
      hmacSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    };
    const adapter = new WatermarkAdapter({
      name: "large-opaque-source",
      strategy: "explicit",
      runs: [{ update: cursor, timestamps: [] }],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: cursor,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const telemetry = [];
    const registry = new AdapterRegistry({
      vault,
      onSyncEvent: (event) => telemetry.push(event),
    });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(adapter.seenWatermarks).toEqual([cursor]);
    expect(report.watermark).toBe(cursor);
    expect(report.collectionSinceWatermark).toBe(cursor);
    expect(vault.getWatermark(adapter.name).watermark).toBe(cursor);

    const startEvent = telemetry.find((event) => event.kind === "sync.start");
    const okEvent = telemetry.find((event) => event.kind === "sync.ok");
    expect(startEvent).toMatchObject({
      sinceWatermark: expectedSummary,
      checkpointWatermark: expectedSummary,
    });
    expect(okEvent).toMatchObject({
      watermark: expectedSummary,
      collectionSinceWatermark: expectedSummary,
    });

    const auditDetails = JSON.parse(
      vault.queryAudit({ action: "adapter.sync.ok", limit: 1 })[0].details,
    );
    expect(auditDetails).toMatchObject({
      watermark: expectedSummary,
      collectionSinceWatermark: expectedSummary,
    });

    for (const payload of [startEvent, okEvent, auditDetails]) {
      const serialized = JSON.stringify(payload);
      expect(serialized.length).toBeLessThan(2_048);
      expect(serialized).not.toContain("x".repeat(2_048));
    }
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

  it("defers an explicit cursor until a paginated scan is complete", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "bounded-explicit-source",
      strategy: "explicit",
      requiresCompleteScan: true,
      runs: [
        {
          update: 'cursor-v1:{"page":1}',
          timestamps: [5_000, 4_000],
        },
        {
          update: 'cursor-v1:{"page":2}',
          timestamps: [5_000, 4_000, 3_000],
          complete: true,
        },
      ],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: 'cursor-v1:{"page":0}',
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const partial = await registry.syncAdapter(adapter.name);
    expect(partial.watermarkDeferred).toBe(true);
    expect(partial.watermark).toBe('cursor-v1:{"page":0}');
    expect(partial.pageBudget).toBe(10);
    expect(partial.nextPageBudget).toBe(20);
    expect(vault.getWatermark(adapter.name).watermark).toBe(
      'cursor-v1:{"page":0}',
    );

    const complete = await registry.syncAdapter(adapter.name);
    expect(complete.watermarkDeferred).toBe(false);
    expect(complete.watermark).toBe('cursor-v1:{"page":2}');
    expect(complete.pageBudget).toBe(20);
    expect(vault.getSyncScanState(adapter.name)).toBeNull();
    expect(adapter.seenWatermarks).toEqual([
      'cursor-v1:{"page":0}',
      'cursor-v1:{"page":0}',
    ]);
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

  it("expands a real local-files metadata scan without advancing a partial watermark", async () => {
    freshVault();
    const sourceRoot = path.join(tmpDir, "local-files-source");
    fs.mkdirSync(sourceRoot);
    const mtimes = [
      Date.now() - 180_000,
      Date.now() - 120_000,
      Date.now() - 60_000,
    ];
    for (let index = 0; index < mtimes.length; index += 1) {
      const filePath = path.join(sourceRoot, `${index}.txt`);
      fs.writeFileSync(filePath, String(index), "utf8");
      fs.utimesSync(filePath, mtimes[index] / 1000, mtimes[index] / 1000);
    }
    const adapter = new LocalFilesAdapter({ roots: [sourceRoot] });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name, { pageSize: 1 });
    expect(first).toMatchObject({
      watermarkDeferred: true,
      watermark: null,
      pageBudget: 1,
      nextPageBudget: 2,
      rawCount: 1,
    });

    const second = await registry.syncAdapter(adapter.name, { pageSize: 1 });
    expect(second).toMatchObject({
      watermarkDeferred: true,
      watermark: null,
      pageBudget: 2,
      nextPageBudget: 4,
      rawCount: 2,
    });

    const complete = await registry.syncAdapter(adapter.name, { pageSize: 1 });
    expect(complete).toMatchObject({
      watermarkDeferred: false,
      pageBudget: 4,
      nextPageBudget: null,
      rawCount: 3,
    });
    expect(Number(complete.watermark)).toBeGreaterThanOrEqual(mtimes[2] - 5);
    expect(vault.getSyncScanState(adapter.name, complete.scope)).toBeNull();
    expect(vault.stats().rawEvents).toBe(3);
    const archived = vault.queryRawEvents({
      adapter: adapter.name,
      scope: complete.scope,
    });
    expect(
      archived.every(
        (row) =>
          !Object.prototype.hasOwnProperty.call(row.payload, "path") &&
          !Object.prototype.hasOwnProperty.call(row.payload, "root"),
      ),
    ).toBe(true);
    expect(JSON.stringify(archived)).not.toContain(path.basename(sourceRoot));
  });

  it("does not expand local-files page budgets for unreadable scan failures", async () => {
    freshVault();
    const sourceRoot = path.join(tmpDir, "local-files-unreadable");
    fs.mkdirSync(sourceRoot);
    const seenRecordLimits = [];
    const adapter = new LocalFilesAdapter({
      roots: [sourceRoot],
      scanRoots: (_roots, opts) => {
        seenRecordLimits.push(opts.maxRecords);
        return {
          complete: false,
          issues: ["READ_FAILED", "ROOT_INCOMPLETE"],
          records: [],
        };
      },
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name);
    const second = await registry.syncAdapter(adapter.name);

    expect(first).toMatchObject({
      status: "error",
      pageBudget: 1,
      nextPageBudget: null,
      checkpointCommitted: false,
    });
    expect(second).toMatchObject({
      status: "error",
      pageBudget: 1,
      nextPageBudget: null,
      checkpointCommitted: false,
    });
    expect(first.error).toContain("READ_FAILED");
    expect(second.error).toContain("READ_FAILED");
    expect(seenRecordLimits).toEqual([5000, 5000]);
    expect(vault.getSyncScanState(adapter.name, first.scope)).toBeNull();
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
    const second = await registry.syncAdapter(adapter.name, {
      sinceWatermarks: { unrelatedAdapterOption: "1" },
    });

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
    expect(report.checkpointCommitted).toBe(false);
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

  it("preserves the exact durable checkpoint and scan state for file imports", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "snapshot-timestamp-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      runs: [{ timestamps: [8_000, 7_000] }],
    });
    const durableCheckpoint = {
      watermark: "0000006000",
      lastSyncedAt: 1_234_567,
      lastStatus: "error",
      lastError: "prior live-source failure",
    };
    vault.setWatermark(adapter.name, "", durableCheckpoint);
    const checkpointBeforeImport = vault.getWatermark(adapter.name, "");
    vault.setSyncScanState(adapter.name, "", {
      pageBudget: 40,
      deferredCount: 2,
      updatedAt: Date.now(),
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "fixture-snapshot.json",
    });

    expect(report.watermarkDeferred).toBe(false);
    expect(report.watermark).toBe("0000006000");
    expect(report.collectionSinceWatermark).toBe(null);
    expect(report.checkpointCommitted).toBe(false);
    expect(adapter.seenWatermarks).toEqual([undefined]);
    expect(vault.getWatermark(adapter.name, "")).toEqual(
      checkpointBeforeImport,
    );
    expect(vault.getSyncScanState(adapter.name, "")).toMatchObject({
      page_budget: 40,
      deferred_count: 2,
    });
  });

  it("uses a caller override only as the file import collection cursor", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "snapshot-explicit-source",
      strategy: "explicit",
      requiresCompleteScan: true,
      runs: [
        {
          update: "candidate-from-snapshot",
          timestamps: [8_000],
          complete: true,
        },
      ],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "durable-live-cursor",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "fixture-snapshot.json",
      sinceWatermark: "manual-replay-cursor",
    });

    expect(adapter.seenWatermarks).toEqual(["manual-replay-cursor"]);
    expect(report.collectionSinceWatermark).toBe("manual-replay-cursor");
    expect(report.watermark).toBe("durable-live-cursor");
    expect(report.checkpointCommitted).toBe(false);
    expect(vault.getWatermark(adapter.name).watermark).toBe(
      "durable-live-cursor",
    );
  });

  it("discards a future file-import override without reading or replacing the durable checkpoint", async () => {
    freshVault();
    const futureOverride = Date.now() + 86_400_000;
    const adapter = new WatermarkAdapter({
      name: "snapshot-future-override-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      runs: [{ timestamps: [8_000], complete: true }],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "0000006000",
      lastSyncedAt: 7_654_321,
      lastStatus: "error",
      lastError: "live source remains failed",
    });
    const checkpointBeforeImport = vault.getWatermark(adapter.name, "");
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "fixture-snapshot.json",
      sinceWatermark: futureOverride,
    });

    expect(report).toMatchObject({
      status: "ok",
      rawCount: 1,
      watermark: "0000006000",
      collectionSinceWatermark: null,
      checkpointCommitted: false,
    });
    expect(adapter.seenWatermarks).toEqual([undefined]);
    expect(vault.getWatermark(adapter.name, "")).toEqual(
      checkpointBeforeImport,
    );
  });

  it("does not mutate checkpoint metadata when a preserved file import fails", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "failed-snapshot-source",
      strategy: "explicit",
      runs: [
        {
          update: "snapshot-candidate",
          timestamps: [8_000],
          error: "snapshot ingest failed",
        },
      ],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "durable-live-cursor",
      lastSyncedAt: 2_345_678,
      lastStatus: "rate_limited",
      lastError: "prior live rate limit",
    });
    const checkpointBeforeImport = vault.getWatermark(adapter.name, "");
    const registry = new AdapterRegistry({ vault, syncMaxRetries: 0 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "fixture-snapshot.json",
    });

    expect(report).toMatchObject({
      status: "error",
      watermark: "durable-live-cursor",
      checkpointCommitted: false,
    });
    expect(vault.getWatermark(adapter.name, "")).toEqual(
      checkpointBeforeImport,
    );
  });

  it.each([
    {
      label: "successful",
      run: { update: "snapshot-candidate", timestamps: [8_000] },
      status: "ok",
    },
    {
      label: "failed",
      run: { error: "snapshot failed", timestamps: [] },
      status: "error",
    },
  ])(
    "does not create a checkpoint row for a $label preserved file import",
    async ({ run, status }) => {
      freshVault();
      const adapter = new WatermarkAdapter({
        name: `no-row-${status}-snapshot-source`,
        strategy: "explicit",
        runs: [run],
      });
      const registry = new AdapterRegistry({ vault, syncMaxRetries: 0 });
      registry.register(adapter);

      const report = await registry.syncAdapter(adapter.name, {
        inputPath: "fixture-snapshot.json",
      });

      expect(report).toMatchObject({
        status,
        watermark: null,
        checkpointCommitted: false,
      });
      expect(vault.getWatermark(adapter.name, "")).toBeNull();
    },
  );

  it("requires the normal complete-scan handshake for shared file checkpoints", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "continuing-file-source",
      strategy: "max-captured-at",
      requiresCompleteScan: true,
      fileCheckpointMode: () => "shared",
      runs: [{ timestamps: [8_000] }, { timestamps: [9_000], complete: true }],
    });
    vault.setWatermark(adapter.name, "", {
      watermark: "6000",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const deferred = await registry.syncAdapter(adapter.name, {
      inputPath: "continuing.sqlite",
      maxPages: 1,
    });
    const committed = await registry.syncAdapter(adapter.name, {
      inputPath: "continuing.sqlite",
      maxPages: 1,
    });

    expect(adapter.seenWatermarks).toEqual(["6000", "6000"]);
    expect(deferred).toMatchObject({
      watermark: "6000",
      watermarkDeferred: true,
    });
    expect(committed).toMatchObject({
      watermark: "9000",
      watermarkDeferred: false,
      checkpointCommitted: true,
    });
    expect(vault.getWatermark(adapter.name).watermark).toBe("9000");
  });

  it("uses the WeChat account scope for a shared inputPath checkpoint", async () => {
    freshVault();
    const adapter = new WechatAdapter({
      account: { uin: "wx-account-a" },
    });
    const seen = [];
    adapter.healthCheck = async () => ({ ok: true, lastChecked: Date.now() });
    adapter.sync = async function* sync(opts = {}) {
      seen.push({
        scope: opts.scope,
        sinceWatermark: opts.sinceWatermark,
      });
      opts.updateWatermark("live-cursor-next");
      yield* [];
    };
    vault.setWatermark(adapter.name, adapter.defaultScope, {
      watermark: "live-cursor",
      lastSyncedAt: 1_000,
      lastStatus: "ok",
      lastError: null,
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "EnMicroMsg.db",
    });

    expect(report.scope).toBe(adapter.defaultScope);
    expect(seen).toEqual([
      {
        scope: adapter.defaultScope,
        sinceWatermark: "live-cursor",
      },
    ]);
    expect(
      vault.getWatermark(adapter.name, adapter.defaultScope).watermark,
    ).toBe("live-cursor-next");
    expect(vault.getWatermark(adapter.name, "")).toBeNull();
  });

  it("isolates shared Tencent Meeting inputPath checkpoints by source path", async () => {
    freshVault();
    const adapter = new TencentMeetingAdapter({
      defaultRoot: () => null,
    });
    const originalResolveDefaultScope =
      adapter.resolveDefaultScope.bind(adapter);
    let resolveDefaultScopeCalls = 0;
    adapter.resolveDefaultScope = (opts = {}) => {
      resolveDefaultScopeCalls += 1;
      return originalResolveDefaultScope(opts);
    };
    adapter.healthCheck = async () => ({ ok: true, lastChecked: Date.now() });
    const updates = ["5000", "9000", "6000"];
    const seen = [];
    adapter.sync = async function* sync(opts = {}) {
      seen.push({
        scope: opts.scope,
        sinceWatermark: opts.sinceWatermark,
      });
      opts.updateWatermark(updates.shift());
      opts.markWatermarkComplete();
      yield* [];
    };
    const sourceA = path.join(tmpDir, "meeting-a", "wemeetapp.db");
    const sourceB = path.join(tmpDir, "meeting-b", "wemeetapp.db");
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const firstA = await registry.syncAdapter(adapter.name, {
      inputPath: sourceA,
    });
    const firstB = await registry.syncAdapter(adapter.name, {
      inputPath: sourceB,
    });
    const resumedA = await registry.syncAdapter(adapter.name, {
      inputPath: sourceA,
    });

    expect(firstA.scope).not.toBe(firstB.scope);
    expect(resumedA.scope).toBe(firstA.scope);
    expect(resolveDefaultScopeCalls).toBe(3);
    expect(seen).toEqual([
      { scope: firstA.scope, sinceWatermark: undefined },
      { scope: firstB.scope, sinceWatermark: undefined },
      { scope: firstA.scope, sinceWatermark: 4_000 },
    ]);
    expect(vault.getWatermark(adapter.name, firstA.scope).watermark).toBe(
      "6000",
    );
    expect(vault.getWatermark(adapter.name, firstB.scope).watermark).toBe(
      "9000",
    );
    expect(vault.getWatermark(adapter.name, "")).toBeNull();
  });

  it("rejects an invalid dynamic file checkpoint mode", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "invalid-file-checkpoint-source",
      strategy: "explicit",
      fileCheckpointMode: () => "replace",
      runs: [{ timestamps: [] }],
    });
    const registry = new AdapterRegistry({ vault, syncMaxRetries: 0 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: "snapshot.json",
    });

    expect(report.status).toBe("error");
    expect(report.error).toContain(
      "fileCheckpointMode() must return one of preserve|shared",
    );
    expect(report.checkpointCommitted).toBe(false);
    expect(vault.getWatermark(adapter.name, "")).toBeNull();
  });

  it("reports a thrown file checkpoint mode hook as a normal sync error", async () => {
    freshVault();
    const adapter = new WatermarkAdapter({
      name: "throwing-file-checkpoint-source",
      strategy: "explicit",
      fileCheckpointMode: () => {
        throw new Error("checkpoint mode resolution failed");
      },
      runs: [{ timestamps: [] }],
    });
    const registry = new AdapterRegistry({ vault, syncMaxRetries: 0 });
    registry.register(adapter);

    await expect(
      registry.syncAdapter(adapter.name, {
        inputPath: "snapshot.json",
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: "checkpoint mode resolution failed",
      checkpointCommitted: false,
      scope: "",
    });
    expect(vault.getWatermark(adapter.name, "")).toBeNull();
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

    expect(adapter.seenWatermarks).toEqual([undefined, undefined, undefined]);
    expect(adapter.seenScopes[0]).not.toBe(adapter.seenScopes[1]);
    expect(adapter.seenScopes[0]).toMatch(
      /^account:snapshot-account-source:[a-f0-9]{32}$/u,
    );
    expect(resumedA.watermark).toBe(null);
    expect(resumedA.checkpointCommitted).toBe(false);
    expect(JSON.stringify(adapter.seenScopes)).not.toContain("snapshot-user");
    expect(vault.getWatermark(adapter.name, adapter.defaultScope)).toBeNull();
  });

  it("does not bypass the snapshot byte limit while resolving account scope", async () => {
    freshVault();
    const inputPath = path.join(tmpDir, "oversized-scope.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({ account: { userId: "must-not-be-read-unbounded" } }),
    );
    const adapter = new WatermarkAdapter({
      name: "bounded-snapshot-scope-source",
      strategy: "explicit",
      defaultScope: "account:bounded-snapshot-scope-source:live",
      runs: [{ timestamps: [] }],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath,
      maxSnapshotBytes: 8,
    });

    expect(report.scope).toBe("");
    expect(adapter.seenScopes).toEqual([""]);
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

    const report = await registry.syncAdapter(adapter.name, { inputPath });

    expect(adapter.seenScopes).toEqual([""]);
    expect(report.checkpointCommitted).toBe(false);
    expect(report.watermark).toBe(null);
    expect(vault.getWatermark(adapter.name, "")).toBeNull();
    expect(vault.getWatermark(adapter.name, adapter.defaultScope)).toBeNull();
  });
});
