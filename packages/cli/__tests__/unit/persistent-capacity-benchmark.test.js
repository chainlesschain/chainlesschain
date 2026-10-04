import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDurableMemoryFixture,
  measureBackgroundAgentTier,
  measureDurableMemoryTier,
  resolvePersistentCapacityProfile,
  summarizeDurations,
  writeBackgroundAgentFixture,
} from "../../scripts/persistent-capacity-benchmark.mjs";
import { measureBackgroundPageComparison } from "../../scripts/background-capacity-comparison.mjs";
import {
  DurableJsonMemoryPort,
  normalizeState,
} from "../../src/lib/context-memory-kernel/durable-memory-port.js";

const roots = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "cc-persistent-capacity-test-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("persistent capacity benchmark", () => {
  it("measures production segmented import, restart, concurrent mutations and retained audit", async () => {
    const result = await measureDurableMemoryTier(temporaryRoot(), 12, {
      samples: 1,
      concurrency: 2,
      storage: "segmented",
    });
    expect(result).toMatchObject({
      storage: "segmented",
      reachable: true,
      observedCount: 12,
      fixture: { seededThroughProductionSnapshotImport: true },
      coldProcess: { ok: true, count: 12 },
      concurrentReads: { succeeded: 2, failed: 0 },
      concurrentUpdates: { succeeded: 2, failed: 0 },
      concurrentDeletes: { succeeded: 2, failed: 0 },
      postWriteVerification: {
        verified: true,
        actualEvents: 18,
        recordCount: 12,
        storeRevision: 18,
      },
    });
  }, 30000);
  it("keeps formal tiers and rejects diluted formal sampling", () => {
    expect(resolvePersistentCapacityProfile("formal", {})).toMatchObject({
      memoryCounts: [1_000, 10_000, 100_000],
      backgroundCounts: [1_000, 10_000],
      samples: 11,
      concurrency: 8,
      performanceThresholds: null,
    });
    expect(() =>
      resolvePersistentCapacityProfile("formal", {
        CC_PERSISTENT_CAPACITY_MEMORY_COUNTS: "1000,10000",
      }),
    ).toThrow(/must retain memory tiers/);
    expect(() =>
      resolvePersistentCapacityProfile("formal", {
        CC_PERSISTENT_CAPACITY_SAMPLES: "3",
      }),
    ).toThrow(/at least 11 samples/);
  });

  it("builds a digest-valid fixture with one audit event per memory", () => {
    const state = createDurableMemoryFixture(3);
    expect(Object.keys(state.records)).toHaveLength(3);
    expect(state.events).toHaveLength(3);
    expect(state.storeRevision).toBe(3);
    expect(normalizeState(state, "fixture.json")).toMatchObject({
      storeRevision: 3,
    });
  });

  it("computes p50/p95/p99 without presenting a performance gate", () => {
    expect(summarizeDurations([10, 2, 5, 20])).toEqual({
      samples: 4,
      minMs: 2,
      p50Ms: 5,
      p95Ms: 20,
      p99Ms: 20,
      maxMs: 20,
    });
    expect(summarizeDurations([])).toEqual({
      samples: 0,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
    });
  });

  it("keeps lock measurement observers outside the authority outcome", async () => {
    const root = temporaryRoot();
    const observations = [];
    const port = new DurableJsonMemoryPort({
      filePath: join(root, "memory", "kernel-v1.json"),
      lockObserver: (observation) => {
        observations.push(observation);
        throw new Error("telemetry sink unavailable");
      },
    });
    await expect(port.query()).resolves.toEqual([]);
    expect(observations).toEqual([
      expect.objectContaining({ locked: true, attempts: 1 }),
    ]);
    expect(observations[0].waitMs).toBeGreaterThanOrEqual(0);
  });

  it("measures the actual durable port and compares full scans with indexed pages", async () => {
    const root = temporaryRoot();
    const memory = await measureDurableMemoryTier(root, 6, {
      samples: 1,
      concurrency: 1,
    });
    expect(memory).toMatchObject({
      recordCount: 6,
      reachable: true,
      observedCount: 6,
      reachedConfiguredEventCeiling: false,
      coldProcess: { ok: true, count: 6 },
      concurrentReads: { requested: 1, succeeded: 1, failed: 0 },
      concurrentUpdates: { requested: 1, succeeded: 1, failed: 0 },
      concurrentDeletes: { requested: 1, succeeded: 1, failed: 0 },
    });
    expect(memory.query.samples).toBe(1);
    expect(memory.lockWait.samples).toBeGreaterThan(0);

    const background = await measureBackgroundAgentTier(root, 105, {
      samples: 1,
    });
    expect(background).toMatchObject({
      recordCount: 105,
      observedCount: 105,
      coldProcess: { ok: true, count: 105 },
      fullDirectoryListAndSort: { samples: 1 },
      paginationApplied: true,
      indexApplied: true,
      comparison: {
        coldBuild: {
          ok: true,
          count: 50,
          validation: { ok: true, expectedSource: "rebuilt" },
        },
        coldCached: {
          ok: true,
          count: 50,
          validation: { ok: true, expectedSource: "index" },
        },
        warmFirstPage: { samples: 1, sources: { index: 1 } },
        warmNextPage: { samples: 1, sources: { index: 1 } },
        invalidationRebuild: { samples: 1, sources: { rebuilt: 1 } },
        traversal: { exact: true, records: 105, pages: 3 },
        pathsVerified: true,
        lockWait: { applicable: false },
      },
    });
    const restored = JSON.parse(
      readFileSync(
        join(root, "background-105", "bg-capacity-00000000.json"),
        "utf8",
      ),
    );
    expect(restored).toMatchObject({ title: "capacity task 0", startedAt: 1 });
    expect(background.comparison.processPeakRssBytes).toBeGreaterThan(0);
  }, 30_000);

  it("does not attest indexed comparison when a cold worker fails", async () => {
    const directory = temporaryRoot();
    writeBackgroundAgentFixture(directory, 3);
    vi.stubEnv("CC_BACKGROUND_AGENTS_DIR", directory);
    const comparison = await measureBackgroundPageComparison({
      directory,
      recordCount: 3,
      samples: 1,
      runWorker: async () => ({
        ok: false,
        code: "PERSISTENT_CAPACITY_WORKER_TIMEOUT",
      }),
      summarizeDurations,
    });
    expect(comparison.pathsVerified).toBe(false);
    expect(comparison.coldBuild.validation.ok).toBe(false);
    expect(comparison.coldCached.validation.ok).toBe(false);
    expect(comparison.warmNextPage.samples).toBe(0);
    expect(comparison.traversal).toMatchObject({
      exact: true,
      records: 3,
      pages: 1,
    });
  });
});
