import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { EvolutionWorkbenchBatchExecutor } from "../../src/lib/evolution/evolution-workbench-batch-executor.js";
import {
  EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
  EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
} from "../../src/lib/evolution/evolution-workbench-projection.js";
import { SKILL_PROMOTION_REVIEW_PACKET_SCHEMA } from "../../src/lib/evolution/skill-promotion-review.js";

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

function fixture() {
  const packetCore = {
    schema: SKILL_PROMOTION_REVIEW_PACKET_SCHEMA,
    tenantId: "tenant:a",
    skillName: "repair-tests",
    candidateId: D("candidate"),
    candidateContentDigest: D("content"),
    parentContentDigest: D("parent"),
    baselineReleaseDigest: null,
    evidenceSummary: [],
    candidateDiff: "diff",
    candidateDiffDigest: D("diff"),
    capabilityDiff: { capabilityDiffDigest: D("capabilities") },
    contentRisk: { detected: false, contentRiskDigest: D("risk") },
    evaluation: { matrixReceiptDigest: D("matrix") },
    targetRuntimes: ["cli"],
    expectedActiveRevision: 0,
    requiredHumanQuorum: 1,
  };
  const packet = {
    ...packetCore,
    packetDigest: D(SKILL_PROMOTION_REVIEW_PACKET_SCHEMA, packetCore),
  };
  const projectionCore = {
    schema: EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
    tenantId: "tenant:a",
    runId: "run:1",
    skillName: "repair-tests",
    candidates: [
      {
        packetDigest: packet.packetDigest,
        candidateId: packet.candidateId,
        status: "pending",
      },
    ],
  };
  const projection = {
    ...projectionCore,
    projectionDigest: D(EVOLUTION_WORKBENCH_PROJECTION_SCHEMA, projectionCore),
  };
  const planCore = {
    schema: EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
    tenantId: "tenant:a",
    runId: "run:1",
    skillName: "repair-tests",
    sourceProjectionDigest: projection.projectionDigest,
    packetDigests: [packet.packetDigest],
    decision: "approve",
    reason: "Reviewed exact packet.",
    requestedBy: "human:alice",
  };
  const plan = {
    ...planCore,
    planDigest: D(EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA, planCore),
  };
  const ports = {
    loadProjection: vi.fn(async () => projection),
    resolvePacket: vi.fn(async () => packet),
    requestHumanDecision: vi.fn(async (request) => ({
      tenantId: "tenant:a",
      packetDigest: packet.packetDigest,
      candidateId: packet.candidateId,
      decision: "approved",
      automated: false,
      reason: plan.reason,
      requestDigest: request.requestDigest,
      receiptDigest: D("decision"),
      signature: "signed-human-decision-value-1234567890",
    })),
    retainDecision: vi.fn(async ({ decision }) => ({
      persisted: true,
      receiptDigest: decision.receiptDigest,
    })),
    commitExecutionItem: vi.fn(async ({ item }) => ({
      authenticated: true,
      durable: true,
      itemDigest: item.itemDigest,
    })),
  };
  return {
    executor: new EvolutionWorkbenchBatchExecutor({
      tenantId: "tenant:a",
      ports,
    }),
    packet,
    plan,
    ports,
    projection,
  };
}

describe("Evolution Workbench batch executor", () => {
  it("obtains and retains one human-signed decision per packet", async () => {
    const h = fixture();
    const result = await h.executor.execute(h.plan);
    expect(result.items).toHaveLength(1);
    expect(h.ports.requestHumanDecision).toHaveBeenCalledOnce();
    expect(h.ports.retainDecision).toHaveBeenCalledOnce();
    expect(h.ports.commitExecutionItem).toHaveBeenCalledOnce();
  });

  it("rejects a stale source projection", async () => {
    const h = fixture();
    h.ports.loadProjection.mockResolvedValueOnce({
      ...h.projection,
      projectionDigest: D("other"),
    });
    await expect(h.executor.execute(h.plan)).rejects.toThrow("verified");
  });

  it("rejects a source projection whose packet is no longer pending", async () => {
    const h = fixture();
    const core = {
      ...h.projection,
      candidates: [{ ...h.projection.candidates[0], status: "approved" }],
    };
    delete core.projectionDigest;
    h.ports.loadProjection.mockResolvedValueOnce({
      ...core,
      projectionDigest: D(EVOLUTION_WORKBENCH_PROJECTION_SCHEMA, core),
    });
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "source projection changed",
    );
  });

  it("rejects automated or substituted decisions", async () => {
    const h = fixture();
    h.ports.requestHumanDecision.mockResolvedValueOnce({
      tenantId: "tenant:a",
      packetDigest: h.packet.packetDigest,
      candidateId: h.packet.candidateId,
      decision: "approved",
      automated: true,
      reason: h.plan.reason,
      requestDigest: D("wrong"),
      receiptDigest: D("decision"),
      signature: "signed-human-decision-value-1234567890",
    });
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "not exactly bound",
    );
  });

  it("fails closed when decision retention is not durable", async () => {
    const h = fixture();
    h.ports.retainDecision.mockResolvedValueOnce({ persisted: false });
    await expect(h.executor.execute(h.plan)).rejects.toThrow(
      "not durably retained",
    );
  });

  it("fails closed when the per-item execution journal is not durable", async () => {
    const h = fixture();
    h.ports.commitExecutionItem.mockResolvedValueOnce({ durable: false });
    await expect(h.executor.execute(h.plan)).rejects.toThrow("not committed");
  });
});
