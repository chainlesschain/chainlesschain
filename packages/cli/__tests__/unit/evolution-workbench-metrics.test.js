import { createHash } from "node:crypto";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { describe, expect, it, vi } from "vitest";

import {
  EvolutionWorkbenchMetricsAggregator,
  createEmptyEvolutionWorkbenchMetricsSnapshot,
  digestEvolutionWorkbenchMetricsDelta,
  digestEvolutionWorkbenchMetricsRetentionBatch,
  digestEvolutionWorkbenchMetricsRetentionQuery,
  verifyEvolutionWorkbenchMetricsSnapshot,
} from "../../src/lib/evolution/evolution-workbench-metrics.js";

const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;
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
      .update("chainlesschain.evolution-workbench-metrics-snapshot/v1")
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

  it("migrates legacy counts without claiming complete outcome history", async () => {
    const content = D("content:legacy");
    const h = fixture([
      [receipt("legacy", content)],
      [
        receipt("graded", content, "completed", "run:1", {
          graderReceipts: [D("grader:graded")],
        }),
      ],
    ]);
    const first = await h.open().aggregate();
    const legacy = structuredClone(first);
    delete legacy.outcomeHistoryComplete;
    for (const version of legacy.versions) {
      delete version.outcomeReceiptCount;
      delete version.outcomeCompleted;
      delete version.userCorrectionCount;
    }
    h.state.snapshot = redigestSnapshot(legacy);

    const migrated = await h.open().aggregate();
    expect(migrated).toMatchObject({
      outcomeHistoryComplete: false,
      versions: [
        {
          receiptCount: 2,
          outcomeReceiptCount: 1,
          outcomeCompleted: 1,
          userCorrectionCount: 0,
        },
      ],
    });
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
