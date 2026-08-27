import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const PerformanceMonitor = require("../../../src/main/monitoring/performance-monitor.js");
const { HARD_PERFORMANCE_MONITOR_LIMITS, PERFORMANCE_PHASES } =
  PerformanceMonitor;

function createDatabase() {
  return {
    exec: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
    all: vi.fn().mockResolvedValue([]),
  };
}

describe("monitoring PerformanceMonitor boundaries", () => {
  it("retains detached metadata and caps samples per phase", async () => {
    const monitor = new PerformanceMonitor(null, {
      maxSamplesPerPhase: 2,
      maxMetadataBytes: 128,
      maxRetainedBytes: 4096,
    });
    const metadata = { label: "first" };

    await monitor.recordPhase("intent_recognition", 1, metadata);
    metadata.label = "changed outside";
    expect(monitor.metrics.intent_recognition[0].metadata).toEqual({
      label: "first",
    });

    await monitor.recordPhase("intent_recognition", 2, { label: "second" });
    await monitor.recordPhase("intent_recognition", 3, { label: "third" });
    expect(monitor.metrics.intent_recognition).toHaveLength(2);
    expect(
      monitor.metrics.intent_recognition.map((record) => record.metadata.label),
    ).toEqual(["second", "third"]);
    expect(monitor.getRetentionStats()).toMatchObject({
      maxSamplesPerPhase: 2,
      samplesByPhase: { intent_recognition: 2 },
    });
  });

  it("enforces a global retained-byte ceiling across phases", async () => {
    const monitor = new PerformanceMonitor(null, {
      maxSamplesPerPhase: 10,
      maxMetadataBytes: 128,
      maxRetainedBytes: 220,
    });

    await monitor.recordPhase("intent_recognition", 1, {
      value: "a".repeat(40),
    });
    await monitor.recordPhase("task_planning", 2, {
      value: "b".repeat(40),
    });

    const stats = monitor.getRetentionStats();
    expect(stats.retainedBytes).toBeLessThanOrEqual(stats.maxRetainedBytes);
    expect(
      Object.values(stats.samplesByPhase).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBeLessThanOrEqual(1);
  });

  it("rejects invalid phases, durations, identifiers, and metadata", async () => {
    const monitor = new PerformanceMonitor(null, {
      maxMetadataBytes: 32,
      maxIdentifierChars: 4,
      maxTimeRangeMs: 100,
    });

    await expect(monitor.recordPhase("unknown", 1)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "performance_phase",
    });
    await expect(monitor.recordPhase("llm_calls", 101)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "performance_duration",
    });
    await expect(
      monitor.recordPhase("llm_calls", 1, {}, null, "abcde"),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "performance_identifier",
    });
    await expect(
      monitor.recordPhase("llm_calls", 1, { value: "x".repeat(40) }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "performance_metadata",
      limit: { maxMetadataBytes: 32 },
    });

    const cyclic = {};
    cyclic.self = cyclic;
    await expect(
      monitor.recordPhase("llm_calls", 1, cyclic),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "performance_metadata",
    });
    expect(monitor.getRetentionStats().retainedBytes).toBe(0);
  });

  it("keeps every production AI pipeline phase in the bounded registry", async () => {
    const monitor = new PerformanceMonitor(null, { maxSamplesPerPhase: 1 });

    for (const phase of PERFORMANCE_PHASES) {
      await monitor.recordPhase(phase, 1, { phase });
    }

    expect(Object.keys(monitor.metrics).sort()).toEqual(
      [...PERFORMANCE_PHASES].sort(),
    );
    expect(
      Object.values(monitor.getRetentionStats().samplesByPhase).every(
        (count) => count <= 1,
      ),
    ).toBe(true);
  });

  it("clamps hostile configuration at immutable hard limits", () => {
    const monitor = new PerformanceMonitor(null, {
      maxSamplesPerPhase: Number.MAX_SAFE_INTEGER,
      maxMetadataBytes: Number.MAX_SAFE_INTEGER,
      maxRetainedBytes: Number.MAX_SAFE_INTEGER,
      maxExportRows: Number.MAX_SAFE_INTEGER,
    });

    expect(monitor.limits).toMatchObject({
      maxSamplesPerPhase: HARD_PERFORMANCE_MONITOR_LIMITS.maxSamplesPerPhase,
      maxMetadataBytes: HARD_PERFORMANCE_MONITOR_LIMITS.maxMetadataBytes,
      maxRetainedBytes: HARD_PERFORMANCE_MONITOR_LIMITS.maxRetainedBytes,
      maxExportRows: HARD_PERFORMANCE_MONITOR_LIMITS.maxExportRows,
    });
  });

  it("persists the detached bounded metadata representation", async () => {
    const database = createDatabase();
    const monitor = new PerformanceMonitor(database, { maxMetadataBytes: 64 });
    const metadata = { ok: true };

    await monitor.recordPhase(
      "tool_execution",
      12,
      metadata,
      "user",
      "session",
    );
    metadata.ok = false;

    const insertCall = database.run.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO performance_metrics"),
    );
    expect(insertCall[1]).toEqual([
      "tool_execution",
      12,
      '{"ok":true}',
      expect.any(Number),
      "user",
      "session",
    ]);
  });

  it("caps database report, bottleneck, session, and export reads", async () => {
    const database = createDatabase();
    const rows = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      phase: "llm_calls",
      duration: index + 1,
      metadata: index === 0 ? "x".repeat(100) : '{"ok":true}',
      created_at: index === 0 ? "invalid" : Date.now(),
      user_id: "user",
      session_id: "sess",
    }));
    database.all.mockResolvedValue(rows);
    const monitor = new PerformanceMonitor(database, {
      maxMetadataBytes: 32,
      maxIdentifierChars: 8,
      maxReportRowsPerPhase: 2,
      maxBottleneckRows: 2,
      maxSessionRows: 2,
      maxExportRows: 2,
    });

    await expect(
      monitor.generatePhaseReport("llm_calls", 0),
    ).resolves.toMatchObject({ count: 2 });
    const bottlenecks = await monitor.findBottlenecks(1, Infinity);
    expect(bottlenecks).toHaveLength(2);
    expect(bottlenecks[0].metadata).toEqual({});
    const session = await monitor.getSessionPerformance("sess");
    expect(session.recordCount).toBe(2);
    const exported = await monitor.exportData(Infinity);
    expect(exported).toHaveLength(2);
    expect(exported[0]).toMatchObject({ metadata: {}, created_at: null });

    for (const [sql, params] of database.all.mock.calls) {
      expect(sql).toContain("LIMIT ?");
      expect(params.at(-1)).toBe(2);
    }
  });

  it("clears retained byte accounting together with phase arrays", async () => {
    const monitor = new PerformanceMonitor(null);
    await monitor.recordPhase("rag_retrieval", 5, { hits: 2 });
    expect(monitor.getRetentionStats().retainedBytes).toBeGreaterThan(0);

    monitor.clearMemoryMetrics();
    expect(monitor.getRetentionStats().retainedBytes).toBe(0);
    expect(
      Object.values(monitor.getRetentionStats().samplesByPhase).every(
        (count) => count === 0,
      ),
    ).toBe(true);
  });
});
