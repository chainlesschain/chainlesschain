import { createHash } from "node:crypto";

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
  SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
  buildSkillPromotionReviewEnvelope,
  buildSkillPromotionReviewPacket,
  createSkillPromotionReviewProvider,
} from "../../src/lib/evolution/skill-promotion-review.js";

const TENANT_ID = "tenant:review";
const NOW = "2026-09-02T10:00:00.000Z";

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value = domain) {
  const payload =
    arguments.length === 1
      ? String(value)
      : `${domain}\0${canonicalJson(value)}`;
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

function candidateFixture() {
  const dependencyLock = buildSkillDependencyLock({
    tenantId: TENANT_ID,
    lock: { generation: 1, packages: { vitest: "4.1.10" } },
  });
  const runtimeManifest = buildSkillRuntimeManifest({
    tenantId: TENANT_ID,
    runtimes: [
      {
        runtimeId: "cli",
        descriptor: {
          platform: "linux-x64",
          runtime: "node-22.12.0",
          sandboxPolicyDigest: digest("sandbox"),
        },
      },
    ],
  });
  const cells = [
    {
      cellId: "cli-linux-x64",
      runtimeId: "cli",
      targetEnvironmentRef: "environment:cli-linux-x64",
      environmentDigest: digest("environment"),
    },
  ];
  const targetMatrix = buildSkillTargetMatrix({
    tenantId: TENANT_ID,
    dependencyLock,
    runtimeManifest,
    cells,
  });
  return buildSkillCandidateDraft(
    {
      tenantId: TENANT_ID,
      skillName: "repair-unit-tests",
      parentDigest: null,
      sourceEvidenceRefs: [
        { ref: "recording://runs/review-1", digest: digest("evidence") },
      ],
      derivationMode: "record-replay",
      wikiRevision: null,
      proposerModel: null,
      requestedCapabilities: ["workspace.read", "workspace.write"],
      evalRunId: null,
      content: "---\nname: repair-unit-tests\n---\n\nRun focused tests.\n",
      dependencyLock,
      runtimeManifest,
      targetMatrix,
    },
    {
      expectedEnvironmentBindings: cells,
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
  );
}

function matrixBinding(candidate) {
  return {
    schema: SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA,
    tenantId: TENANT_ID,
    skillName: candidate.skillName,
    candidateId: candidate.candidateId,
    candidateContentDigest: candidate.contentDigest,
    expectedActiveContentDigest: `sha256:${createHash("sha256")
      .update("chainlesschain.skill-active/empty/v1\0", "utf8")
      .digest("hex")}`,
    expectedActiveRevision: 0,
    matrixEvalId: "matrix-eval:review-1",
    matrixReceiptDigest: digest("matrix-receipt"),
    decisionCommitmentDigest: digest("matrix-decision"),
    expiresAt: "2026-09-02T10:10:00.000Z",
    receiptResolution: {
      authorityId: "authority:matrix",
      resolverDescriptorDigest: digest("matrix-resolver"),
      resolverRevision: 1,
      resolvedAt: NOW,
    },
  };
}

function emptyState(candidate) {
  return {
    tenantId: TENANT_ID,
    skillName: candidate.skillName,
    revision: 0,
    activeReleaseDigest: null,
  };
}

function decisionFor(packet, overrides = {}) {
  const core = {
    schema: SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
    tenantId: TENANT_ID,
    skillName: packet.skillName,
    candidateId: packet.candidateId,
    packetDigest: packet.packetDigest,
    decision: "approved",
    automated: false,
    reviewerIds: ["human:alice", "human:bob"],
    quorum: 2,
    reason: "Reviewed evidence, diff, permissions, evaluation, and runtimes.",
    decidedAt: NOW,
    expiresAt: "2026-09-02T10:10:00.000Z",
    ...overrides,
  };
  return {
    ...core,
    receiptDigest: digest(
      "chainlesschain.skill-promotion-review-decision/v1",
      core,
    ),
    signature: "signed-human-review-decision-value-0001",
  };
}

function providerHarness(candidate, decisionOverrides = {}) {
  const packet = buildSkillPromotionReviewPacket({
    candidate,
    activeRelease: null,
    matrixBinding: matrixBinding(candidate),
    state: emptyState(candidate),
  });
  const decision = decisionFor(packet, decisionOverrides);
  const resolver = vi.fn(async (request) => ({
    schema: SKILL_PROMOTION_REVIEW_RESOLUTION_SCHEMA,
    authorityId: "authority:human-review",
    handlerArtifactDigest: digest("human-review-handler"),
    revision: 4,
    tenantId: TENANT_ID,
    receiptDigest: request.receiptDigest,
    decision,
    resolvedAt: NOW,
  }));
  const verifier = vi.fn(async () => true);
  const provider = createSkillPromotionReviewProvider({
    tenantId: TENANT_ID,
    authorityId: "authority:human-review",
    handlerArtifactDigest: digest("human-review-handler"),
    revision: 4,
    decisionResolver: { resolve: resolver },
    decisionVerifier: { verify: verifier },
    now: () => Date.parse(NOW),
  });
  return { decision, packet, provider, resolver, verifier };
}

describe("Skill promotion human review", () => {
  it("builds the complete minimum reviewer packet and requires two humans for write expansion", () => {
    const candidate = candidateFixture();
    const packet = buildSkillPromotionReviewPacket({
      candidate,
      activeRelease: null,
      matrixBinding: matrixBinding(candidate),
      state: emptyState(candidate),
    });

    expect(packet.evidenceSummary).toEqual(candidate.sourceEvidenceRefs);
    expect(packet.candidateDiff).toContain(
      `+++ candidate/${candidate.contentDigest}`,
    );
    expect(packet.capabilityDiff).toMatchObject({
      baseline: [],
      requested: ["workspace.read", "workspace.write"],
      added: ["workspace.read", "workspace.write"],
      highRiskAdded: ["workspace.write"],
      requiredHumanQuorum: 2,
    });
    expect(packet.evaluation.matrixReceiptDigest).toBe(
      matrixBinding(candidate).matrixReceiptDigest,
    );
    expect(packet.targetRuntimes).toEqual(["cli"]);
    expect(packet.packetDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(packet)).toBe(true);
  });

  it("resolves the exact policy envelope and authenticates an approval binding", async () => {
    const candidate = candidateFixture();
    const harness = providerHarness(candidate);
    const policyReceipt = buildSkillPromotionReviewEnvelope(
      harness.decision.receiptDigest,
    );
    const binding = await harness.provider.verify({
      candidate,
      activeRelease: null,
      matrixBinding: matrixBinding(candidate),
      state: emptyState(candidate),
      authorization: { request: { receipts: { policyReceipt } } },
    });

    expect(binding).toMatchObject({
      candidateId: candidate.candidateId,
      packetDigest: harness.packet.packetDigest,
      reviewReceiptDigest: harness.decision.receiptDigest,
      reviewerIds: ["human:alice", "human:bob"],
      quorum: 2,
    });
    expect(harness.resolver).toHaveBeenCalledOnce();
    expect(harness.verifier).toHaveBeenCalledOnce();
  });

  it.each([
    ["automated", { automated: true }],
    ["rejected", { decision: "rejected" }],
    ["below quorum", { reviewerIds: ["human:alice"], quorum: 1 }],
    ["candidate substitution", { candidateId: digest("other-candidate") }],
  ])("fails closed for %s review decisions", async (_label, overrides) => {
    const candidate = candidateFixture();
    const harness = providerHarness(candidate, overrides);
    await expect(
      harness.provider.verify({
        candidate,
        activeRelease: null,
        matrixBinding: matrixBinding(candidate),
        state: emptyState(candidate),
        authorization: {
          request: {
            receipts: {
              policyReceipt: buildSkillPromotionReviewEnvelope(
                harness.decision.receiptDigest,
              ),
            },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "SKILL_PROMOTION_REVIEW_REJECTED" });
    expect(harness.verifier).not.toHaveBeenCalled();
  });
});
