import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { EVOLUTION_WORKBENCH_PROJECTION_SCHEMA } from "../../src/lib/evolution/evolution-workbench-projection.js";
import {
  EvolutionWorkbenchRollbackExecutor,
  buildEvolutionWorkbenchRollbackPlan,
  compareEvolutionWorkbenchVersions,
} from "../../src/lib/evolution/evolution-workbench-version-control.js";

const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const D = (domain, value = domain) =>
  `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;

function candidate(name, active) {
  return {
    packetDigest: D(`packet:${name}`),
    candidateId: D(`candidate:${name}`),
    candidateContentDigest: D(`content:${name}`),
    status: "approved",
    decision: { decision: "approved" },
    why: { parentContentDigest: D(`parent:${name}`) },
    changes: {
      candidateDiffDigest: D(`diff:${name}`),
      capabilities: { added: name === "new" ? ["network"] : [] },
      contentRisk: { detected: false, contentRiskDigest: D(`risk:${name}`) },
    },
    validation: {
      matrixReceiptDigest: D(`matrix:${name}`),
      targetRuntimes: ["cli"],
    },
    actualUsage: {
      active,
      receiptCount: active ? 10 : 20,
      completed: active ? 8 : 20,
      failedOrBlocked: active ? 2 : 0,
      totalCostUsd: active ? 2 : 1,
    },
  };
}

function fixture() {
  const current = candidate("new", true);
  const previous = candidate("previous", false);
  const core = {
    schema: EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
    tenantId: "tenant:a",
    runId: "run:1",
    skillName: "repair-tests",
    observedAt: "2026-09-04T00:00:00.000Z",
    run: {
      status: "running",
      projectionDigest: D("run-projection"),
      eventRoot: D("event-root"),
      eventCount: 0,
      wikiRevision: 0,
      wikiRevisionDigest: D("wiki-revision"),
      activeReleaseId: D("active-release"),
      lastKnownGoodReleaseId: D("last-known-good-release"),
    },
    summary: {
      candidateCount: 2,
      pendingReviewCount: 0,
      approvedCount: 2,
      rejectedCount: 0,
      transitionCount: 0,
      invocationCount: 30,
      conflictCount: 0,
    },
    candidates: [current, previous],
    timeline: [],
    conflicts: [],
    pilot: null,
  };
  const projection = {
    ...core,
    projectionDigest: D(EVOLUTION_WORKBENCH_PROJECTION_SCHEMA, core),
  };
  const input = {
    fromPacketDigest: current.packetDigest,
    toPacketDigest: previous.packetDigest,
    expectedActiveStateDigest: D("active-state"),
    requestedBy: "human:alice",
    reason: "Regression observed in canary metrics.",
  };
  const plan = buildEvolutionWorkbenchRollbackPlan(projection, input);
  const ports = {
    loadProjection: vi.fn(async () => projection),
    authorizeHumanRollback: vi.fn(async ({ plan: value }) => ({
      authenticated: true,
      durable: true,
      automated: false,
      planDigest: value.planDigest,
      receiptDigest: D("authorization"),
    })),
    applyRollback: vi.fn(async (request) => ({
      authenticated: true,
      durable: true,
      requestDigest: request.requestDigest,
      receiptDigest: D("transition"),
    })),
    readActiveState: vi.fn(async () => ({
      authenticated: true,
      contentDigest: previous.candidateContentDigest,
      stateDigest: D("rolled-back-state"),
    })),
    commitRollback: vi.fn(async ({ receipt }) => ({
      authenticated: true,
      durable: true,
      receiptDigest: receipt.receiptDigest,
    })),
  };
  return {
    current,
    previous,
    projection,
    plan,
    ports,
    executor: new EvolutionWorkbenchRollbackExecutor({
      tenantId: "tenant:a",
      ports,
    }),
  };
}

describe("Evolution Workbench version control", () => {
  it("builds a digest-bound comparison with evidence, permissions, Eval and usage", () => {
    const h = fixture();
    const comparison = compareEvolutionWorkbenchVersions(h.projection, {
      leftPacketDigest: h.current.packetDigest,
      rightPacketDigest: h.previous.packetDigest,
    });
    expect(comparison.left).toMatchObject({
      contentDigest: h.current.candidateContentDigest,
      capabilities: { added: ["network"] },
      actualUsage: { active: true },
    });
    expect(comparison.right.matrixReceiptDigest).toBe(D("matrix:previous"));
  });

  it("executes only an approved target with exact human authorization and readback", async () => {
    const h = fixture();
    const receipt = await h.executor.execute(h.plan);
    expect(receipt.activeContentDigest).toBe(h.previous.candidateContentDigest);
    expect(h.ports.authorizeHumanRollback).toHaveBeenCalledOnce();
    expect(h.ports.applyRollback).toHaveBeenCalledOnce();
    expect(h.ports.commitRollback).toHaveBeenCalledOnce();
  });

  it("rejects an unapproved rollback target", () => {
    const h = fixture();
    h.previous.status = "pending";
    h.previous.decision = null;
    const core = { ...h.projection };
    delete core.projectionDigest;
    expect(() =>
      buildEvolutionWorkbenchRollbackPlan(
        {
          ...core,
          projectionDigest: D(EVOLUTION_WORKBENCH_PROJECTION_SCHEMA, core),
        },
        {
          fromPacketDigest: h.current.packetDigest,
          toPacketDigest: h.previous.packetDigest,
          expectedActiveStateDigest: D("active-state"),
          requestedBy: "human:alice",
          reason: "not approved",
        },
      ),
    ).toThrow("lacks human approval");
  });

  it("rejects automated rollback authorization", async () => {
    const h = fixture();
    h.ports.authorizeHumanRollback.mockResolvedValueOnce({
      authenticated: true,
      durable: true,
      automated: true,
      planDigest: h.plan.planDigest,
      receiptDigest: D("authorization"),
    });
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "lacks exact human authorization",
    );
  });

  it("fails closed on active-state drift after transition", async () => {
    const h = fixture();
    h.ports.readActiveState.mockResolvedValueOnce({
      authenticated: true,
      contentDigest: h.current.candidateContentDigest,
      stateDigest: D("drifted"),
    });
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "readback differs",
    );
  });

  it("fails closed when the final rollback receipt is not durable", async () => {
    const h = fixture();
    h.ports.commitRollback.mockResolvedValueOnce({ durable: false });
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "not durably committed",
    );
  });
});
