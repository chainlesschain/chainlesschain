import { createHash } from "node:crypto";

import evolutionRun from "@chainlesschain/session-core/evolution-run";
import skillInvocationReceipt from "@chainlesschain/session-core/skill-invocation-receipt";
import { describe, expect, it, vi } from "vitest";

import { buildSkillCandidateDraft } from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import { SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA } from "../../src/lib/evolution/skill-evaluated-promotion.js";
import {
  SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
  buildSkillPromotionReviewPacket,
} from "../../src/lib/evolution/skill-promotion-review.js";
import {
  EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
  EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
  buildEvolutionWorkbenchBatchPlan,
  buildEvolutionWorkbenchProjection,
  createEvolutionWorkbenchDataSource,
  filterEvolutionWorkbenchProjection,
} from "../../src/lib/evolution/evolution-workbench-projection.js";

const { EVOLUTION_RUN_EVENT_SCHEMA, projectEvolutionRun } = evolutionRun;
const { startSkillInvocation, settleSkillInvocation } = skillInvocationReceipt;
const TENANT = "tenant:workbench";
const RUN = "run:workbench";
const SKILL = "repair-unit-tests";
const NOW = "2026-09-03T08:00:00.000Z";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function D(domain, value = domain) {
  return `sha256:${createHash("sha256")
    .update(
      arguments.length === 1 ? String(value) : `${domain}\0${canonical(value)}`,
    )
    .digest("hex")}`;
}

function packetFixture() {
  const dependencyLock = buildSkillDependencyLock({
    tenantId: TENANT,
    lock: { generation: 1, packages: { vitest: "4.1.10" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: TENANT,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: D("sandbox"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-linux-x64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-x64",
      environmentDigest: D("environment"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: TENANT,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  const candidate = buildSkillCandidateDraft(
    {
      tenantId: TENANT,
      skillName: SKILL,
      parentDigest: null,
      sourceEvidenceRefs: [
        { ref: "recording://runs/workbench", digest: D("evidence") },
      ],
      derivationMode: "record-replay",
      wikiRevision: null,
      proposerModel: null,
      requestedCapabilities: ["workspace.read", "workspace.write"],
      evalRunId: null,
      content: `---\nname: ${SKILL}\n---\n\nRun focused tests.\n`,
      dependencyLock,
      runtimeManifest,
      targetMatrix,
    },
    {
      expectedEnvironmentBindings: cells,
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
  );
  const matrixBinding = {
    schema: SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA,
    tenantId: TENANT,
    skillName: SKILL,
    candidateId: candidate.candidateId,
    candidateContentDigest: candidate.contentDigest,
    expectedActiveContentDigest: `sha256:${createHash("sha256")
      .update("chainlesschain.skill-active/empty/v1\0", "utf8")
      .digest("hex")}`,
    expectedActiveRevision: 0,
    matrixEvalId: "matrix-eval:workbench",
    matrixReceiptDigest: D("matrix-receipt"),
    decisionCommitmentDigest: D("matrix-decision"),
    expiresAt: "2026-09-03T08:10:00.000Z",
    receiptResolution: {
      authorityId: "authority:matrix",
      resolverDescriptorDigest: D("matrix-resolver"),
      resolverRevision: 1,
      resolvedAt: NOW,
    },
  };
  const packet = buildSkillPromotionReviewPacket({
    candidate,
    matrixBinding,
    state: {
      tenantId: TENANT,
      skillName: SKILL,
      revision: 0,
      activeReleaseDigest: null,
    },
  });
  return { candidate, packet };
}

function decisionFor(packet, decision = "approved") {
  const core = {
    schema: SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
    tenantId: TENANT,
    skillName: SKILL,
    candidateId: packet.candidateId,
    packetDigest: packet.packetDigest,
    decision,
    automated: false,
    reviewerIds:
      decision === "approved" ? ["human:alice", "human:bob"] : ["human:alice"],
    quorum: decision === "approved" ? 2 : 1,
    reason: `${decision} after inspecting evidence, diff and target matrix.`,
    decidedAt: NOW,
    expiresAt: "2026-09-03T08:10:00.000Z",
    acknowledgedContentRiskDigest:
      decision === "approved" && packet.contentRisk.detected
        ? packet.contentRisk.contentRiskDigest
        : null,
  };
  return {
    ...core,
    receiptDigest: D("chainlesschain.skill-promotion-review-decision/v1", core),
    signature: "signed-human-review-decision-value-0001",
  };
}

function runFixture(candidate) {
  const make = (sequence, type, subjectId, payloadDigest, data = {}) => ({
    schema: EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: TENANT,
    runId: RUN,
    eventId: `event:${sequence}`,
    sequence,
    type,
    subjectId,
    payloadDigest,
    artifactRef: subjectId ? `artifact://${subjectId}` : null,
    keyRef: null,
    data,
  });
  const events = [
    make(1, "run-started", null, D("run-started")),
    make(2, "raw-event-referenced", "raw:1", D("raw")),
    make(3, "wiki-revision-recorded", "wiki:1", D("wiki")),
    make(
      4,
      "skill-candidate-recorded",
      candidate.candidateId,
      candidate.contentDigest,
    ),
    make(5, "eval-recorded", "eval:1", D("matrix-receipt"), {
      runtime: "node-22.12.0",
      platform: "linux-x64",
    }),
  ];
  return {
    events,
    projection: projectEvolutionRun(events, { tenantId: TENANT, runId: RUN }),
  };
}

function invocation(candidate) {
  const started = startSkillInvocation(
    {
      receiptId: "receipt:workbench",
      evolutionRunId: RUN,
      traceId: "trace:workbench",
      trajectorySegmentId: "segment:1",
      providerModelVersion: "model:v1",
      toolSetDigest: D("tools"),
      osSandboxPermissionPolicyDigest: D("sandbox-policy"),
      taskCohort: "pilot:workbench",
      selectedSkillDigest: candidate.contentDigest,
      routerCandidates: [
        {
          digest: candidate.contentDigest,
          score: 1,
          reason: "exact task match",
        },
      ],
      attributionRequired: true,
    },
    { clock: () => NOW, randomUUID: () => "unused" },
  );
  return settleSkillInvocation(
    started,
    {
      executionStatus: "completed",
      graderReceipts: [D("grader")],
      tokensInput: 10,
      tokensOutput: 20,
      costUsd: 0.03,
      latencyMs: 50,
    },
    { clock: () => "2026-09-03T08:00:01.000Z" },
  );
}

function sourceFixture({ status = "approved", transitions = [] } = {}) {
  const { candidate, packet } = packetFixture();
  const decision = status === "pending" ? null : decisionFor(packet, status);
  const run = runFixture(candidate);
  const source = createEvolutionWorkbenchDataSource({
    tenantId: TENANT,
    runId: RUN,
    skillName: SKILL,
    runAdapter: { load: vi.fn(() => structuredClone(run)) },
    reviewAdapter: {
      listReviews: vi.fn(async () => [{ packet, decision, status }]),
    },
    transitionAdapter: { list: vi.fn(() => structuredClone(transitions)) },
    invocationReceiptSource: { list: vi.fn(() => [invocation(candidate)]) },
    pilotSource: {
      view: vi.fn(() => ({
        descriptorDigest: D("pilot-descriptor"),
        stage: "shadow",
        revision: 3,
        killSwitch: false,
        reconciliationRequired: false,
        candidateDigest: candidate.candidateId,
        reviewPacketDigest: packet.packetDigest,
        cohort: { id: "cohort:workbench", maxSubjects: 10, canaryPercent: 10 },
      })),
    },
  });
  return { source, candidate, packet, run };
}

describe("Evolution Workbench projection", () => {
  it("joins authenticated run, review, transition, invocation and pilot sources", async () => {
    const { source, candidate, packet } = sourceFixture();
    const projection = await buildEvolutionWorkbenchProjection(source, {
      observedAt: NOW,
    });
    expect(projection).toMatchObject({
      schema: EVOLUTION_WORKBENCH_PROJECTION_SCHEMA,
      tenantId: TENANT,
      runId: RUN,
      skillName: SKILL,
      summary: {
        candidateCount: 1,
        approvedCount: 1,
        invocationCount: 1,
      },
      pilot: { stage: "shadow" },
    });
    expect(projection.candidates[0]).toMatchObject({
      candidateId: candidate.candidateId,
      packetDigest: packet.packetDigest,
      decision: { decision: "approved" },
      why: { evidence: [{ ref: "recording://runs/workbench" }] },
      validation: { targetRuntimes: ["cli"] },
      actualUsage: {
        receiptCount: 1,
        completed: 1,
        totalCostUsd: 0.03,
        sessionPins: [{ selectedSkillDigests: [candidate.contentDigest] }],
      },
    });
    expect(projection.timeline.map(({ phase }) => phase)).toEqual(
      expect.arrayContaining([
        "raw-event-referenced",
        "wiki-revision-recorded",
        "skill-candidate-recorded",
        "eval-recorded",
        "approval-requested",
        "approved",
      ]),
    );
    expect(projection.projectionDigest).toMatch(/^sha256:/u);
  });

  it("provides bounded search and status filtering without changing authority data", async () => {
    const { source } = sourceFixture();
    const projection = await buildEvolutionWorkbenchProjection(source, {
      observedAt: NOW,
    });
    expect(
      filterEvolutionWorkbenchProjection(projection, {
        query: "workspace.write",
        status: "approved",
        limit: 10,
      }),
    ).toMatchObject({
      total: 1,
      hasMore: false,
      governance: {
        runStatus: "running",
        activeReleaseId: null,
        lastKnownGoodReleaseId: null,
        conflictCount: 1,
        pilot: {
          stage: "shadow",
          revision: 3,
          killSwitch: false,
          reconciliationRequired: false,
        },
      },
    });
    expect(
      filterEvolutionWorkbenchProjection(projection, {
        query: "missing",
        limit: 10,
      }).total,
    ).toBe(0);
    expect(() =>
      filterEvolutionWorkbenchProjection(projection, { limit: 501 }),
    ).toThrow("pagination");
  });

  it("creates a digest-bound batch governance plan only for pending packets", async () => {
    const { source, packet } = sourceFixture({ status: "pending" });
    const projection = await buildEvolutionWorkbenchProjection(source, {
      observedAt: NOW,
    });
    const plan = buildEvolutionWorkbenchBatchPlan(projection, {
      packetDigests: [packet.packetDigest],
      decision: "approve",
      reason: "Reviewed as one bounded low-risk cohort.",
      requestedBy: "human:alice",
    });
    expect(plan).toMatchObject({
      schema: EVOLUTION_WORKBENCH_BATCH_PLAN_SCHEMA,
      sourceProjectionDigest: projection.projectionDigest,
      packetDigests: [packet.packetDigest],
      decision: "approve",
    });
    expect(plan.planDigest).toMatch(/^sha256:/u);
    const approved = await buildEvolutionWorkbenchProjection(
      sourceFixture().source,
      { observedAt: NOW },
    );
    expect(() =>
      buildEvolutionWorkbenchBatchPlan(approved, {
        packetDigests: [packet.packetDigest],
        decision: "approve",
        reason: "stale selection",
        requestedBy: "human:alice",
      }),
    ).toThrow("only pending");
  });

  it("rejects unbranded callers and a run projection that differs from its events", async () => {
    await expect(
      buildEvolutionWorkbenchProjection({ load: async () => ({}) }),
    ).rejects.toThrow("branded");
    const { candidate, packet } = packetFixture();
    const run = runFixture(candidate);
    const source = createEvolutionWorkbenchDataSource({
      tenantId: TENANT,
      runId: RUN,
      skillName: SKILL,
      runAdapter: {
        load: () => ({
          ...run,
          projection: { ...run.projection, status: "completed" },
        }),
      },
      reviewAdapter: {
        listReviews: async () => [
          { packet, decision: null, status: "pending" },
        ],
      },
      transitionAdapter: { list: () => [] },
    });
    await expect(buildEvolutionWorkbenchProjection(source)).rejects.toThrow(
      "differs from its events",
    );
  });

  it("fails closed on a substituted invocation receipt", async () => {
    const { candidate, packet } = packetFixture();
    const receipt = invocation(candidate);
    const source = createEvolutionWorkbenchDataSource({
      tenantId: TENANT,
      runId: RUN,
      skillName: SKILL,
      runAdapter: { load: () => runFixture(candidate) },
      reviewAdapter: {
        listReviews: async () => [
          { packet, decision: null, status: "pending" },
        ],
      },
      transitionAdapter: { list: () => [] },
      invocationReceiptSource: {
        list: () => [{ ...receipt, executionStatus: "failed" }],
      },
    });
    await expect(buildEvolutionWorkbenchProjection(source)).rejects.toThrow(
      "receipt digest is invalid",
    );
  });

  it("fails closed when pilot safety state is incomplete", async () => {
    const { candidate, packet } = packetFixture();
    const source = createEvolutionWorkbenchDataSource({
      tenantId: TENANT,
      runId: RUN,
      skillName: SKILL,
      runAdapter: { load: () => runFixture(candidate) },
      reviewAdapter: {
        listReviews: () => [{ packet, decision: null, status: "pending" }],
      },
      transitionAdapter: { list: () => [] },
      pilotSource: {
        view: () => ({
          descriptorDigest: D("pilot-descriptor"),
          candidateDigest: candidate.candidateId,
          reviewPacketDigest: packet.packetDigest,
          stage: "canary",
          revision: 4,
          reconciliationRequired: false,
          cohort: { id: "cohort:workbench" },
        }),
      },
    });
    await expect(buildEvolutionWorkbenchProjection(source)).rejects.toThrow(
      "pilot source result is invalid",
    );
  });

  it("explains content risk, expired review and pending transition conflicts", async () => {
    const { candidate } = packetFixture();
    const transition = {
      request: {
        tenantId: TENANT,
        skillName: SKILL,
        candidateId: candidate.candidateId,
        requestId: "transition:1",
        requestDigest: D("transition-request"),
        effectiveAt: NOW,
        receipts: {},
      },
      requestEventSequence: 8,
      attempts: [],
      status: "pending",
      settlement: null,
    };
    const fixture = sourceFixture({
      status: "pending",
      transitions: [transition],
    });
    const projection = await buildEvolutionWorkbenchProjection(fixture.source, {
      observedAt: NOW,
    });
    expect(projection.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "pending-transition" }),
      ]),
    );
  });

  it("rejects cross-Skill transition authority output", async () => {
    const fixture = sourceFixture({
      transitions: [
        {
          request: {
            tenantId: TENANT,
            skillName: "other-skill",
            candidateId: D("candidate"),
            requestId: "transition:bad",
            requestDigest: D("transition-bad"),
            effectiveAt: NOW,
          },
          requestEventSequence: 1,
          attempts: [],
          status: "pending",
          settlement: null,
        },
      ],
    });
    await expect(
      buildEvolutionWorkbenchProjection(fixture.source),
    ).rejects.toThrow("crossed or contradicted");
  });
});
