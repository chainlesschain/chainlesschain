import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDurableMemoryFixture,
  measureBackgroundAgentTier,
  measureDurableMemoryTier,
  resolvePersistentCapacityProfile,
  summarizeDurations,
} from "../../scripts/persistent-capacity-benchmark.mjs";
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
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe("persistent capacity benchmark", () => {
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

  it("measures the actual durable port and background full-scan paths", async () => {
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

    const background = await measureBackgroundAgentTier(root, 6, {
      samples: 1,
    });
    expect(background).toMatchObject({
      recordCount: 6,
      observedCount: 6,
      coldProcess: { ok: true, count: 6 },
      fullDirectoryListAndSort: { samples: 1 },
      paginationApplied: false,
      indexApplied: false,
    });
  }, 30_000);
});
