import { createHash } from "node:crypto";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { describe, expect, it, vi } from "vitest";

import {
  EvolutionWorkbenchMetricsAggregator,
  EvolutionWorkbenchMetricsOutcomeBackfiller,
  EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA,
  LEGACY_EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
  createEmptyEvolutionWorkbenchMetricsSnapshot,
  digestEvolutionWorkbenchMetricsDelta,
  digestEvolutionWorkbenchMetricsHistory,
  digestEvolutionWorkbenchMetricsRetentionBatch,
  digestEvolutionWorkbenchMetricsRetentionQuery,
  verifyEvolutionWorkbenchMetricsSnapshot,
} from "../../src/lib/evolution/evolution-workbench-metrics.js";

const {
  LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA,
  startSkillInvocation,
  settleSkillInvocation,
} = skillInvocationReceipt;
const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function redigestSnapshot(value) {
  const core = structuredClone(value);
  delete core.snapshotDigest;
  return {
    ...core,
    snapshotDigest: `sha256:${createHash("sha256")
      .update(core.schema)
      .update("\0")
      .update(canonical(core))
      .digest("hex")}`,
  };
}

function receipt(
  id,
  contentDigest,
  status = "completed",
  runId = "run:1",
  outcome = {},
) {
  const started = startSkillInvocation(
    {
      receiptId: `skill-invocation:${id}`,
      selectedSkillDigest: contentDigest,
      routerCandidates: [
        { digest: contentDigest, score: 1, reason: "exact match" },
      ],
      attributionRequired: true,
      evolutionRunId: runId,
      traceId: `trace:${id}`,
      trajectorySegmentId: `segment:${id}`,
      providerModelVersion: "provider:model-v1",
      toolSetDigest: D("tools"),
      osSandboxPermissionPolicyDigest: D("policy"),
      taskCohort: "pilot:a",
      environmentDigest: D("environment"),
    },
    {
      clock: () => "2026-09-03T00:00:00.000Z",
      randomUUID: () => id,
    },
  );
  return settleSkillInvocation(
    started,
    {
      executionStatus: status,
      graderReceipts: outcome.graderReceipts || [],
      userCorrectionRef: outcome.userCorrectionRef || null,
      tokensInput: 10,
      tokensOutput: 5,
      costUsd: 0.25,
      latencyMs: id === "2" ? 200 : 100,
    },
    { clock: () => "2026-09-03T00:01:00.000Z" },
  );
}

function legacyReceipt(value) {
  const core = { ...value };
  delete core.environmentDigest;
  delete core.receiptDigest;
  core.schema = LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA;
  return {
    ...core,
    receiptDigest: `sha256:${createHash("sha256")
      .update(`${LEGACY_SKILL_INVOCATION_RECEIPT_SCHEMA}\0${canonical(core)}`)
      .digest("hex")}`,
  };
}

function fixture(deltas, { hotReceiptLimit, retained = new Set() } = {}) {
  const state = {
    snapshot: null,
    index: 0,
    retained,
    retentionRootDigest: null,
  };
  const ports = {
    loadSnapshot: vi.fn(async () =>
      state.snapshot
        ? {
            found: true,
            authenticated: true,
            durable: true,
            snapshot: state.snapshot,
          }
        : { found: false, authenticated: true, durable: true },
    ),
    readReceiptDelta: vi.fn(async ({ fromSourceDigest }) => {
      const delta = deltas[state.index];
      const source = {
        authenticated: true,
        durable: true,
        tenantId: "tenant:a",
        evolutionRunId: "run:1",
        priorSourceDigest: fromSourceDigest,
        throughAt: `2026-09-03T0${state.index + 1}:00:00.000Z`,
        receipts: delta,
      };
      return {
        ...source,
        sourceDigest: digestEvolutionWorkbenchMetricsDelta(source),
      };
    }),
    commitSnapshot: vi.fn(async ({ expectedSnapshotDigest, snapshot }) => {
      if (
        state.snapshot &&
        state.snapshot.snapshotDigest !== expectedSnapshotDigest
      ) {
        throw new Error("CAS conflict");
      }
      state.snapshot = snapshot;
      state.index += 1;
      return {
        authenticated: true,
        durable: true,
        snapshotDigest: snapshot.snapshotDigest,
      };
    }),
    retainReceiptDigests: vi.fn(async (request) => {
      if (request.priorRetentionRootDigest !== state.retentionRootDigest) {
        throw new Error("retention CAS conflict");
      }
      for (const value of request.receiptDigests) state.retained.add(value);
      state.retentionRootDigest = D(`retention:${state.retained.size}`);
      return {
        authenticated: true,
        durable: true,
        priorRetentionRootDigest: request.priorRetentionRootDigest,
        retainedReceiptCount: state.retained.size,
        retentionRootDigest: state.retentionRootDigest,
        batchDigest: digestEvolutionWorkbenchMetricsRetentionBatch(request),
      };
    }),
    queryRetainedReceiptDigests: vi.fn(async (request) => ({
      authenticated: true,
      durable: true,
      retentionRootDigest: request.retentionRootDigest,
      queryDigest: digestEvolutionWorkbenchMetricsRetentionQuery(request),
      matches: request.receiptDigests.map((value) => state.retained.has(value)),
    })),
  };
  const open = () =>
    new EvolutionWorkbenchMetricsAggregator({
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      ...(hotReceiptLimit === undefined ? {} : { hotReceiptLimit }),
      ports,
    });
  return { state, ports, open };
}

function history(snapshot, receipts, overrides = {}) {
  const sorted = [...receipts].sort((left, right) =>
    left.receiptDigest.localeCompare(right.receiptDigest),
  );
  const value = {
    schema: EVOLUTION_WORKBENCH_METRICS_HISTORY_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: snapshot.tenantId,
    evolutionRunId: snapshot.evolutionRunId,
    skillName: snapshot.skillName,
    snapshotDigest: snapshot.snapshotDigest,
    sourceDigest: snapshot.sourceDigest,
    throughAt: snapshot.throughAt,
    receipts: sorted,
    ...overrides,
  };
  return {
    ...value,
    historyDigest: digestEvolutionWorkbenchMetricsHistory(value),
  };
}

describe("Evolution Workbench long-term metrics", () => {
  it("requires an exact structurally consistent snapshot", () => {
    const descriptor = {
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
    };
    const empty = createEmptyEvolutionWorkbenchMetricsSnapshot(
      descriptor.tenantId,
      descriptor.evolutionRunId,
      descriptor.skillName,
    );
    expect(verifyEvolutionWorkbenchMetricsSnapshot(empty, descriptor)).toEqual(
      empty,
    );
    const legacy = structuredClone(empty);
    legacy.schema = LEGACY_EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA;
    delete legacy.excludedReceiptCount;
    delete legacy.receiptCompatibilityPolicy;
    delete legacy.retainedReceiptCount;
    delete legacy.retentionRootDigest;
    delete legacy.outcomeHistoryComplete;
    expect(
      verifyEvolutionWorkbenchMetricsSnapshot(
        redigestSnapshot(legacy),
        descriptor,
      ),
    ).toMatchObject({ revision: 0, receiptDigests: [] });
    expect(() =>
      verifyEvolutionWorkbenchMetricsSnapshot(
        redigestSnapshot({ ...empty, injectedClaim: true }),
        descriptor,
      ),
    ).toThrow(/snapshot is invalid/u);
    const missingPolicy = structuredClone(empty);
    delete missingPolicy.receiptCompatibilityPolicy;
    expect(() =>
      verifyEvolutionWorkbenchMetricsSnapshot(
        redigestSnapshot(missingPolicy),
        descriptor,
      ),
    ).toThrow(/snapshot is invalid/u);

    const h = fixture([[receipt("strict", D("content:a"))]]);
    return h
      .open()
      .aggregate()
      .then((snapshot) => {
        const fractional = structuredClone(snapshot);
        fractional.versions[0].receiptCount = 0.5;
        fractional.versions[0].completed = 0.5;
        expect(() =>
          verifyEvolutionWorkbenchMetricsSnapshot(
            redigestSnapshot(fractional),
            descriptor,
          ),
        ).toThrow(/receiptCount is invalid/u);

        const inconsistent = structuredClone(snapshot);
        inconsistent.receiptDigests = [];
        expect(() =>
          verifyEvolutionWorkbenchMetricsSnapshot(
            redigestSnapshot(inconsistent),
            descriptor,
          ),
        ).toThrow(/retention total is invalid/u);

        const excludedMismatch = structuredClone(snapshot);
        excludedMismatch.excludedReceiptCount = 1;
        expect(() =>
          verifyEvolutionWorkbenchMetricsSnapshot(
            redigestSnapshot(excludedMismatch),
            descriptor,
          ),
        ).toThrow(/retention total is invalid/u);

        const forgedGenesis = structuredClone(snapshot);
        forgedGenesis.revision = 0;
        forgedGenesis.priorSnapshotDigest = null;
        forgedGenesis.sourceDigest = null;
        forgedGenesis.throughAt = null;
        expect(() =>
          verifyEvolutionWorkbenchMetricsSnapshot(
            redigestSnapshot(forgedGenesis),
            descriptor,
          ),
        ).toThrow(/genesis snapshot is invalid/u);
      });
  });

  it("persists deterministic per-version outcomes, tokens, cost and latency", async () => {
    const content = D("content:a");
    const h = fixture([
      [
        receipt("1", content, "completed", "run:1", {
          graderReceipts: [D("grader:1")],
        }),
        receipt("2", content, "failed", "run:1", {
          userCorrectionRef: "correction:2",
        }),
      ],
    ]);
    const snapshot = await h.open().aggregate();
    expect(snapshot.versions).toEqual([
      {
        contentDigest: content,
        receiptCount: 2,
        completed: 1,
        failed: 1,
        blocked: 0,
        outcomeReceiptCount: 2,
        outcomeCompleted: 1,
        userCorrectionCount: 1,
        tokensInput: 20,
        tokensOutput: 10,
        costUsd: 0.5,
        latencyMs: 300,
        maxLatencyMs: 200,
      },
    ]);
    expect(snapshot.snapshotDigest).toMatch(/^sha256:/u);
    expect(snapshot.outcomeHistoryComplete).toBe(true);
  });

  it("requires authenticated compatibility backfill before extending a v1 snapshot", async () => {
    const content = D("content:legacy");
    const historicalReceipt = receipt("legacy", content);
    const h = fixture([[historicalReceipt]]);
    const first = await h.open().aggregate();
    const legacy = structuredClone(first);
    legacy.schema = LEGACY_EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA;
    delete legacy.excludedReceiptCount;
    delete legacy.receiptCompatibilityPolicy;
    delete legacy.outcomeHistoryComplete;
    for (const version of legacy.versions) {
      delete version.outcomeReceiptCount;
      delete version.outcomeCompleted;
      delete version.userCorrectionCount;
    }
    const legacySnapshot = redigestSnapshot(legacy);
    h.state.snapshot = legacySnapshot;

    await expect(h.open().aggregate()).rejects.toMatchObject({
      code: "CC_WORKBENCH_METRICS_COMPATIBILITY_BACKFILL_REQUIRED",
    });
    expect(h.ports.readReceiptDelta).toHaveBeenCalledTimes(1);

    const backfiller = new EvolutionWorkbenchMetricsOutcomeBackfiller({
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      ports: {
        ...h.ports,
        readReceiptHistory: async () =>
          history(h.state.snapshot, [historicalReceipt]),
      },
    });
    const migrated = await backfiller.backfill();
    expect(migrated.snapshot).toMatchObject({
      schema: "chainlesschain.evolution-workbench-metrics-snapshot/v2",
      outcomeHistoryComplete: true,
      excludedReceiptCount: 0,
      receiptCompatibilityPolicy: "environment-bound-v2",
      versions: [
        {
          receiptCount: 1,
          outcomeReceiptCount: 0,
          outcomeCompleted: 0,
          userCorrectionCount: 0,
        },
      ],
    });
  });

  it("migrates mixed v1/v2 history without promoting the legacy sample", async () => {
    const content = D("content:mixed-history");
    const current = receipt("mixed-current", content, "completed", "run:1", {
      graderReceipts: [D("grader:mixed-current")],
    });
    const historical = legacyReceipt(
      receipt("mixed-legacy", content, "completed", "run:1", {
        graderReceipts: [D("grader:mixed-legacy")],
      }),
    );
    const receiptDigests = [
      current.receiptDigest,
      historical.receiptDigest,
    ].sort();
    const legacyCore = {
      schema: LEGACY_EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA,
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      revision: 1,
      priorSnapshotDigest: D("legacy-parent"),
      sourceDigest: D("legacy-source"),
      throughAt: "2026-09-03T01:00:00.000Z",
      retainedReceiptCount: 0,
      retentionRootDigest: null,
      outcomeHistoryComplete: true,
      receiptDigests,
      versions: [
        {
          contentDigest: content,
          receiptCount: 2,
          completed: 2,
          failed: 0,
          blocked: 0,
          outcomeReceiptCount: 2,
          outcomeCompleted: 2,
          userCorrectionCount: 0,
          tokensInput: 20,
          tokensOutput: 10,
          costUsd: 0.5,
          latencyMs: 200,
          maxLatencyMs: 100,
        },
      ],
    };
    const legacySnapshot = redigestSnapshot(legacyCore);
    const h = fixture([]);
    h.state.snapshot = legacySnapshot;
    const backfiller = new EvolutionWorkbenchMetricsOutcomeBackfiller({
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      ports: {
        ...h.ports,
        readReceiptHistory: async () =>
          history(legacySnapshot, [historical, current]),
      },
    });

    const migrated = await backfiller.backfill();
    expect(migrated.snapshot).toMatchObject({
      schema: "chainlesschain.evolution-workbench-metrics-snapshot/v2",
      priorSnapshotDigest: legacySnapshot.snapshotDigest,
      excludedReceiptCount: 1,
      receiptCompatibilityPolicy: "environment-bound-v2",
      receiptDigests,
      versions: [
        {
          receiptCount: 1,
          completed: 1,
          outcomeReceiptCount: 1,
          outcomeCompleted: 1,
          tokensInput: 10,
          tokensOutput: 5,
          costUsd: 0.25,
          latencyMs: 100,
        },
      ],
    });
    expect(
      verifyEvolutionWorkbenchMetricsSnapshot(migrated.snapshot, {
        tenantId: "tenant:a",
        evolutionRunId: "run:1",
        skillName: "repair-tests",
      }),
    ).toEqual(migrated.snapshot);
  });

  it("backfills complete historical outcomes and converges idempotently", async () => {
    const content = D("content:backfill");
    const oldReceipt = receipt("old", content);
    const gradedReceipt = receipt("graded", content, "completed", "run:1", {
      graderReceipts: [D("grader:graded")],
      userCorrectionRef: "correction:graded",
    });
    const h = fixture([[oldReceipt], [gradedReceipt]]);
    await h.open().aggregate();
    const second = await h.open().aggregate();
    const legacy = structuredClone(second);
    legacy.schema = LEGACY_EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA;
    delete legacy.excludedReceiptCount;
    delete legacy.receiptCompatibilityPolicy;
    delete legacy.outcomeHistoryComplete;
    for (const version of legacy.versions) {
      delete version.outcomeReceiptCount;
      delete version.outcomeCompleted;
      delete version.userCorrectionCount;
    }
    const legacySnapshot = redigestSnapshot(legacy);
    h.state.snapshot = legacySnapshot;

    const readReceiptHistory = vi.fn(async () =>
      history(h.state.snapshot, [oldReceipt, gradedReceipt]),
    );
    const backfiller = new EvolutionWorkbenchMetricsOutcomeBackfiller({
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      ports: { ...h.ports, readReceiptHistory },
    });
    const reconciled = await backfiller.backfill();
    expect(reconciled).toMatchObject({
      status: "reconciled",
      receiptCount: 2,
      snapshot: {
        revision: 3,
        priorSnapshotDigest: legacySnapshot.snapshotDigest,
        outcomeHistoryComplete: true,
        excludedReceiptCount: 0,
        versions: [
          {
            receiptCount: 2,
            outcomeReceiptCount: 1,
            outcomeCompleted: 1,
            userCorrectionCount: 1,
          },
        ],
      },
    });
    await expect(backfiller.backfill()).resolves.toMatchObject({
      status: "already-complete",
      snapshot: { snapshotDigest: reconciled.snapshot.snapshotDigest },
    });
    expect(readReceiptHistory).toHaveBeenCalledTimes(1);
  });

  it("rejects an authenticated history that cannot reconcile legacy totals", async () => {
    const content = D("content:backfill-mismatch");
    const original = receipt("original", content);
    const next = receipt("next", content);
    const h = fixture([[original], [next]]);
    await h.open().aggregate();
    const second = await h.open().aggregate();
    const legacy = structuredClone(second);
    legacy.schema = LEGACY_EVOLUTION_WORKBENCH_METRICS_SNAPSHOT_SCHEMA;
    delete legacy.excludedReceiptCount;
    delete legacy.receiptCompatibilityPolicy;
    delete legacy.outcomeHistoryComplete;
    for (const version of legacy.versions) {
      delete version.outcomeReceiptCount;
      delete version.outcomeCompleted;
      delete version.userCorrectionCount;
    }
    h.state.snapshot = redigestSnapshot(legacy);
    const substituted = receipt("substituted", content, "failed");
    const backfiller = new EvolutionWorkbenchMetricsOutcomeBackfiller({
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      ports: {
        ...h.ports,
        readReceiptHistory: async () =>
          history(h.state.snapshot, [substituted, next]),
      },
    });
    await expect(backfiller.backfill()).rejects.toThrow(
      /history is incomplete|does not reconcile/u,
    );
    expect(h.ports.commitSnapshot).toHaveBeenCalledTimes(2);
  });

  it("continues from a durable snapshot through a new aggregator instance", async () => {
    const content = D("content:a");
    const h = fixture([
      [receipt("1", content)],
      [receipt("2", content, "blocked")],
    ]);
    const first = await h.open().aggregate();
    const second = await h.open().aggregate();
    expect(second.priorSnapshotDigest).toBe(first.snapshotDigest);
    expect(second.versions[0]).toMatchObject({
      receiptCount: 2,
      completed: 1,
      blocked: 1,
    });
  });

  it("rejects receipt replay across durable snapshots", async () => {
    const value = receipt("1", D("content:a"));
    const h = fixture([[value], [value]]);
    await h.open().aggregate();
    await expect(h.open().aggregate()).rejects.toThrow("replayed a receipt");
    expect(h.state.index).toBe(1);
  });

  it("compacts hot receipt digests into durable retention and still rejects replay", async () => {
    const content = D("content:a");
    const firstReceipt = receipt("1", content);
    const h = fixture(
      [
        [firstReceipt, receipt("2", content)],
        [receipt("3", content)],
        [firstReceipt],
      ],
      { hotReceiptLimit: 2 },
    );
    const first = await h.open().aggregate();
    expect(first).toMatchObject({ retainedReceiptCount: 0 });
    expect(first.receiptDigests).toHaveLength(2);
    const compacted = await h.open().aggregate();
    expect(compacted).toMatchObject({
      retainedReceiptCount: 2,
      retentionRootDigest: h.state.retentionRootDigest,
    });
    expect(compacted.receiptDigests).toEqual([
      h.state.snapshot.receiptDigests[0],
    ]);
    await expect(h.open().aggregate()).rejects.toThrow(
      "replayed a retained receipt",
    );
    expect(h.state.index).toBe(2);
  });

  it("rejects a hot replay before attempting compaction", async () => {
    const value = receipt("hot-replay", D("content:a"));
    const h = fixture([[value], [value]], { hotReceiptLimit: 1 });
    await h.open().aggregate();
    await expect(h.open().aggregate()).rejects.toThrow("replayed a receipt");
    expect(h.ports.retainReceiptDigests).not.toHaveBeenCalled();
  });

  it("rejects receipts from another EvolutionRun", async () => {
    const h = fixture([
      [receipt("1", D("content:a"), "completed", "run:other")],
    ]);
    await expect(h.open().aggregate()).rejects.toThrow("exact attribution");
    expect(h.ports.commitSnapshot).not.toHaveBeenCalled();
  });

  it("retains readable v1 receipts for replay defense but excludes their metrics", async () => {
    const historical = legacyReceipt(receipt("v1", D("content:a")));
    const h = fixture([[historical]]);

    await expect(h.open().aggregate()).resolves.toMatchObject({
      excludedReceiptCount: 1,
      receiptCompatibilityPolicy: "environment-bound-v2",
      receiptDigests: [historical.receiptDigest],
      versions: [],
    });
    expect(h.ports.commitSnapshot).toHaveBeenCalledOnce();
  });

  it("rejects receipt substitution behind a copied source digest", async () => {
    const content = D("content:a");
    const h = fixture([[receipt("1", content)]]);
    const original = await h.ports.readReceiptDelta({
      fromSourceDigest: null,
    });
    h.ports.readReceiptDelta.mockResolvedValueOnce({
      ...original,
      receipts: [receipt("2", content)],
    });
    await expect(h.open().aggregate()).rejects.toThrow(
      "delta content or window is invalid",
    );
    expect(h.ports.commitSnapshot).not.toHaveBeenCalled();
  });

  it("fails closed when snapshot persistence is not durable", async () => {
    const h = fixture([[receipt("1", D("content:a"))]]);
    h.ports.commitSnapshot.mockResolvedValueOnce({
      authenticated: true,
      durable: false,
    });
    await expect(h.open().aggregate()).rejects.toThrow("not durably committed");
  });
});
