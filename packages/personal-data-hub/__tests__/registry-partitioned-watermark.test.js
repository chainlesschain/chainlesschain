"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AdapterRegistry } = require("../lib/registry");
const { XimalayaAdapter } = require("../lib/adapters/audio-ximalaya");
const { generateKeyHex } = require("../lib/key-providers");
const { MockAdapter } = require("../lib/mock-adapter");
const {
  parsePartitionedWatermark,
  serializePartitionedWatermark,
} = require("../lib/partitioned-watermark");
const { LocalVault } = require("../lib/vault");

let tmpDir;
let vault;

function freshVault() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-partitioned-"));
  vault = new LocalVault({
    path: path.join(tmpDir, "vault.db"),
    key: generateKeyHex(),
    skipAudit: true,
  });
  vault.open();
}

afterEach(() => {
  if (vault) {
    vault.close();
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

class PartitionedAdapter extends MockAdapter {
  constructor({ name = "partitioned-source", runs = [] } = {}) {
    super({ name, count: 0 });
    this.watermarkStrategy = "partitioned";
    this.watermarkStreams = ["play", "favorite"];
    this.watermarkRequiresCompleteScan = true;
    this.watermarkLookbackMs = 0;
    this.runs = [...runs];
    this.seenWatermarks = [];
    this.seenPageBudgets = [];
  }

  targetWatermarkKeys(opts = {}) {
    if (opts.inputPath) return [];
    const include = opts.include || {};
    return this.watermarkStreams.filter((key) => include[key] !== false);
  }

  async *sync(opts = {}) {
    this.seenWatermarks.push(opts.sinceWatermarks);
    this.seenPageBudgets.push(opts.maxPagesByWatermarkKey);
    const run = this.runs.shift() || {};
    for (const [key, value] of run.updates || []) {
      opts.updateWatermark(key, value);
    }
    for (const [index, record] of (run.records || []).entries()) {
      const raw = {
        adapter: this.name,
        originalId: `${this.name}:${record.key || "snapshot"}:${record.at}:${index}`,
        capturedAt: record.at,
        payload: {
          variant: 0,
          index,
          text: `${record.key || "snapshot"} ${record.at}`,
        },
      };
      if (!run.snapshot) {
        raw.watermarkKey = record.key;
        raw.watermarkAt = record.at;
      }
      yield raw;
    }
    for (const key of run.complete || []) {
      opts.markWatermarkComplete(key);
    }
    if (run.error) throw new Error(run.error);
  }
}

describe("AdapterRegistry partitioned watermarks", () => {
  it("keeps independent stream cursors so a newer play cannot hide an older favourite", async () => {
    freshVault();
    const newerPlay = Date.now() - 60_000;
    const olderFavorite = newerPlay - 3_600_000;
    const adapter = new PartitionedAdapter({
      runs: [
        {
          records: [{ key: "play", at: newerPlay }],
          complete: ["play"],
        },
        {
          records: [{ key: "favorite", at: olderFavorite }],
          complete: ["favorite"],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const playReport = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
    });
    const favoriteReport = await registry.syncAdapter(adapter.name, {
      include: { play: false },
    });

    expect(playReport.committedWatermarkKeys).toEqual(["play"]);
    expect(favoriteReport.committedWatermarkKeys).toEqual(["favorite"]);
    expect(adapter.seenWatermarks).toEqual([{}, {}]);
    expect(parsePartitionedWatermark(favoriteReport.watermark)).toEqual({
      favorite: String(olderFavorite),
      play: String(newerPlay),
    });
    expect(vault.stats().rawEvents).toBe(2);
  });

  it("prevents the reproduced Ximalaya include-toggle data-loss sequence", async () => {
    freshVault();
    const newerPlay = Date.now() - 60_000;
    const olderFavorite = newerPlay - 3_600_000;
    let phase = "play";
    const adapter = new XimalayaAdapter({
      account: { userId: "partitioned-user", cookies: "token=ok" },
      fetchFn: async ({ url, query }) => {
        if (query.page > 1) return { list: [] };
        if (phase === "play" && url.includes("/history")) {
          return {
            list: [
              {
                trackId: "new-play",
                title: "newer play",
                startedAt: newerPlay,
              },
            ],
          };
        }
        if (phase === "favorite" && url.includes("/favorite")) {
          return {
            list: [
              {
                trackId: "older-favorite",
                title: "older favorite",
                startedAt: olderFavorite,
              },
            ],
          };
        }
        return { list: [] };
      },
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const first = await registry.syncAdapter(adapter.name, {
      include: { favorite: false, subscribe: false },
    });
    phase = "favorite";
    const second = await registry.syncAdapter(adapter.name, {
      include: { play: false, subscribe: false },
    });

    expect(first.committedWatermarkKeys).toEqual(["play"]);
    expect(second.rawCount).toBe(1);
    expect(second.committedWatermarkKeys).toEqual(["favorite"]);
    expect(parsePartitionedWatermark(second.watermark)).toEqual({
      favorite: String(olderFavorite),
      play: String(newerPlay),
    });
    expect(vault.stats().rawEvents).toBe(2);
  });

  it("commits only completed streams and preserves deferred stream state", async () => {
    freshVault();
    const previous = serializePartitionedWatermark({
      favorite: "200",
      play: "100",
    });
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        {
          records: [
            { key: "play", at: 300 },
            { key: "favorite", at: 400 },
          ],
          complete: ["play"],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, { maxPages: 1 });

    expect(report).toMatchObject({
      status: "ok",
      checkpointCommitted: true,
      watermarkDeferred: true,
      committedWatermarkKeys: ["play"],
      deferredWatermarkKeys: ["favorite"],
    });
    expect(parsePartitionedWatermark(report.watermark)).toEqual({
      favorite: "200",
      play: "300",
    });
  });

  it("does not commit any stream when iteration or ingestion fails", async () => {
    freshVault();
    const previous = serializePartitionedWatermark({
      favorite: "200",
      play: "100",
    });
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        {
          records: [{ key: "play", at: 300 }],
          complete: ["play", "favorite"],
          error: "connection dropped",
        },
      ],
    });
    const registry = new AdapterRegistry({ vault, syncMaxRetries: 0 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("error");
    expect(report.checkpointCommitted).toBe(false);
    expect(report.watermark).toBe(previous);
    expect(vault.getWatermark(adapter.name).watermark).toBe(previous);
  });

  it("overlays a per-key replay override without deleting unselected cursors", async () => {
    freshVault();
    const previous = serializePartitionedWatermark({
      favorite: "200",
      play: "100",
    });
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        {
          records: [{ key: "play", at: 150 }],
          complete: ["play"],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
      sinceWatermarks: { play: 50 },
    });

    expect(adapter.seenWatermarks).toEqual([{ play: "50" }]);
    expect(parsePartitionedWatermark(report.watermark)).toEqual({
      favorite: "200",
      play: "150",
    });
  });

  it("never regresses a stream when an adapter publishes an older candidate", async () => {
    freshVault();
    const previous = serializePartitionedWatermark({
      favorite: "200",
      play: "100",
    });
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        {
          updates: [["play", 50]],
          complete: ["play"],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
    });

    expect(parsePartitionedWatermark(report.watermark)).toEqual({
      favorite: "200",
      play: "100",
    });
  });

  it("replays a legacy scalar and migrates it only after a successful live boundary", async () => {
    freshVault();
    vault.setWatermark("partitioned-source", "", {
      watermark: "9999999999999",
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        {
          records: [{ key: "play", at: 100 }],
          complete: ["play"],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
    });

    expect(adapter.seenWatermarks).toEqual([{}]);
    expect(parsePartitionedWatermark(report.watermark)).toEqual({
      play: "100",
    });
  });

  it("preserves a legacy scalar byte-for-byte while every target is deferred", async () => {
    freshVault();
    const legacy = "9999999999999";
    vault.setWatermark("partitioned-source", "", {
      watermark: legacy,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [{ complete: [] }],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
      maxPages: 1,
    });

    expect(report).toMatchObject({
      watermark: legacy,
      checkpointCommitted: false,
      committedWatermarkKeys: [],
      deferredWatermarkKeys: ["play"],
    });
    expect(vault.getWatermark(adapter.name).watermark).toBe(legacy);
  });

  it("does not let a snapshot import read or advance live stream cursors", async () => {
    freshVault();
    const previous = serializePartitionedWatermark({
      favorite: "200",
      play: "100",
    });
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: 3_456_789,
      lastStatus: "error",
      lastError: "prior live partitioned failure",
    });
    const checkpointBeforeImport = vault.getWatermark("partitioned-source", "");
    const adapter = new PartitionedAdapter({
      runs: [
        {
          snapshot: true,
          records: [{ at: 9_999 }],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: path.join(tmpDir, "snapshot.json"),
    });

    expect(adapter.seenWatermarks).toEqual([{}]);
    expect(report).toMatchObject({
      status: "ok",
      watermark: previous,
      checkpointCommitted: false,
      committedWatermarkKeys: [],
      deferredWatermarkKeys: [],
    });
    expect(vault.getWatermark(adapter.name, "")).toEqual(
      checkpointBeforeImport,
    );
  });

  it("preserves a corrupt legacy aggregate byte-for-byte during a snapshot import", async () => {
    freshVault();
    const previous = "legacy-or-corrupt::partitioned::cursor";
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        {
          snapshot: true,
          records: [{ at: 9_999 }],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name, {
      inputPath: path.join(tmpDir, "snapshot.json"),
    });

    expect(adapter.seenWatermarks).toEqual([{}]);
    expect(report).toMatchObject({
      watermark: previous,
      collectionSinceWatermark: null,
      checkpointCommitted: false,
      committedWatermarkKeys: [],
      deferredWatermarkKeys: [],
    });
    expect(vault.getWatermark(adapter.name).watermark).toBe(previous);
  });

  it("keeps adaptive page budgets isolated by stream", async () => {
    freshVault();
    const adapter = new PartitionedAdapter({
      runs: [
        { complete: [] },
        { complete: ["play"] },
        { complete: ["favorite"] },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const favoriteDeferred = await registry.syncAdapter(adapter.name, {
      include: { play: false },
    });
    const playComplete = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
    });
    const favoriteComplete = await registry.syncAdapter(adapter.name, {
      include: { play: false },
    });

    expect(favoriteDeferred).toMatchObject({
      pageBudget: 10,
      nextPageBudget: 20,
      deferredWatermarkKeys: ["favorite"],
    });
    expect(playComplete).toMatchObject({
      pageBudget: 10,
      committedWatermarkKeys: ["play"],
    });
    expect(favoriteComplete).toMatchObject({
      pageBudget: 20,
      committedWatermarkKeys: ["favorite"],
    });
    expect(adapter.seenPageBudgets).toEqual([
      { favorite: 10 },
      { play: 10 },
      { favorite: 20 },
    ]);
    expect(
      vault.getSyncScanState(
        adapter.name,
        registry._partitionedScanStateScope("", "favorite"),
      ),
    ).toBeNull();
  });

  it("preserves future or repaired values until that exact stream completes", async () => {
    freshVault();
    const future = Date.now() + 86_400_000;
    const previous = serializePartitionedWatermark({
      favorite: future,
      play: 100,
    });
    vault.setWatermark("partitioned-source", "", {
      watermark: previous,
      lastSyncedAt: Date.now(),
      lastStatus: "ok",
      lastError: null,
    });
    const adapter = new PartitionedAdapter({
      runs: [
        { complete: ["play"] },
        { complete: [] },
        { complete: ["favorite"] },
      ],
    });
    const registry = new AdapterRegistry({ vault });
    registry.register(adapter);

    const unselected = await registry.syncAdapter(adapter.name, {
      include: { favorite: false },
    });
    const deferred = await registry.syncAdapter(adapter.name, {
      include: { play: false },
      maxPages: 1,
    });
    const repaired = await registry.syncAdapter(adapter.name, {
      include: { play: false },
      maxPages: 1,
    });

    expect(parsePartitionedWatermark(unselected.watermark).favorite).toBe(
      String(future),
    );
    expect(parsePartitionedWatermark(deferred.watermark).favorite).toBe(
      String(future),
    );
    expect(parsePartitionedWatermark(repaired.watermark)).toEqual({
      play: "100",
    });
  });

  it("fails the sync when a selected stream yields an unpartitioned raw", async () => {
    freshVault();
    const adapter = new PartitionedAdapter({
      runs: [
        {
          snapshot: true,
          records: [{ at: 100 }],
        },
      ],
    });
    const registry = new AdapterRegistry({ vault, syncMaxRetries: 0 });
    registry.register(adapter);

    const report = await registry.syncAdapter(adapter.name);

    expect(report.status).toBe("error");
    expect(report.error).toContain(
      "partitioned raw envelopes require watermarkKey and watermarkAt",
    );
    expect(report.checkpointCommitted).toBe(false);
  });
});
