import { createHash } from "node:crypto";

import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { describe, expect, it, vi } from "vitest";

import {
  EvolutionWorkbenchMetricsAggregator,
  digestEvolutionWorkbenchMetricsDelta,
} from "../../src/lib/evolution/evolution-workbench-metrics.js";

const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;
const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function receipt(id, contentDigest, status = "completed", runId = "run:1") {
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
      tokensInput: 10,
      tokensOutput: 5,
      costUsd: 0.25,
      latencyMs: id === "2" ? 200 : 100,
    },
    { clock: () => "2026-09-03T00:01:00.000Z" },
  );
}

function fixture(deltas) {
  const state = { snapshot: null, index: 0 };
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
  };
  const open = () =>
    new EvolutionWorkbenchMetricsAggregator({
      tenantId: "tenant:a",
      evolutionRunId: "run:1",
      skillName: "repair-tests",
      ports,
    });
  return { state, ports, open };
}

describe("Evolution Workbench long-term metrics", () => {
  it("persists deterministic per-version outcomes, tokens, cost and latency", async () => {
    const content = D("content:a");
    const h = fixture([
      [receipt("1", content), receipt("2", content, "failed")],
    ]);
    const snapshot = await h.open().aggregate();
    expect(snapshot.versions).toEqual([
      {
        contentDigest: content,
        receiptCount: 2,
        completed: 1,
        failed: 1,
        blocked: 0,
        tokensInput: 20,
        tokensOutput: 10,
        costUsd: 0.5,
        latencyMs: 300,
        maxLatencyMs: 200,
      },
    ]);
    expect(snapshot.snapshotDigest).toMatch(/^sha256:/u);
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
