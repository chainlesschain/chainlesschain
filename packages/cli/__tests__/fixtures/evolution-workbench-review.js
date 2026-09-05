import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import evolutionRun from "@chainlesschain/session-core/evolution-run";
import { buildSkillCandidateDraft } from "../../src/lib/evolution/skill-candidate-registry.js";
import {
  buildSkillDependencyLock,
  buildSkillRuntimeManifest,
  buildSkillTargetMatrix,
} from "../../src/lib/evolution/skill-execution-manifest.js";
import { SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA } from "../../src/lib/evolution/skill-evaluated-promotion.js";
import {
  buildSkillPromotionReviewPacket,
  SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
} from "../../src/lib/evolution/skill-promotion-review.js";
import {
  EVOLUTION_WORKBENCH_HUMAN_DECISION_SCHEMA,
  buildWorkbenchBatchItemRequest,
} from "../../src/lib/evolution/evolution-workbench-review-protocol.js";
import {
  createEvolutionWorkbenchDataSource,
  buildEvolutionWorkbenchBatchPlan,
} from "../../src/lib/evolution/evolution-workbench-projection.js";
import { EvolutionWorkbenchReviewLedgerAdapter } from "../../src/lib/evolution/evolution-workbench-review-ledger-adapter.js";
import { SkillPromotionReviewLedgerAdapter } from "../../src/lib/evolution/skill-promotion-review-ledger-adapter.js";
import { EvolutionRunLedgerAdapter } from "../../src/lib/evolution/evolution-run-ledger-adapter.js";
import { pruningDigest } from "../../src/lib/evolution/governed-wiki-pruning-journal.js";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";

export const NOW = Date.parse("2026-09-05T00:00:00.000Z");
export const TENANT = "tenant:workbench-review";
export const RUN = "run:workbench-review";
export const SKILL = "repair-unit-tests";
export const D = (text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
// Deterministic TEST-ONLY keys let an independent process reopen the fixture.
function testKey(label) {
  const seed = createHash("sha256")
    .update(`test-only-workbench-${label}`)
    .digest();
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}
const decisionKey = testKey("canonical-review");
const responseKey = testKey("request-binding");
const signature = (key, digest) =>
  sign(null, Buffer.from(digest), key).toString("base64url");
export const verifyDecision = ({ decision }) =>
  verify(
    null,
    Buffer.from(decision.receiptDigest),
    createPublicKey(decisionKey),
    Buffer.from(decision.signature, "base64url"),
  );
export const verifyHuman = ({ response }) =>
  verify(
    null,
    Buffer.from(response.responseDigest),
    createPublicKey(responseKey),
    Buffer.from(response.signature, "base64url"),
  );

export function packetFixture(content = "Run focused tests.") {
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
        { ref: "recording://runs/workbench-review", digest: D("evidence") },
      ],
      derivationMode: "record-replay",
      wikiRevision: null,
      proposerModel: null,
      requestedCapabilities: ["workspace.read", "workspace.write"],
      evalRunId: null,
      content: `---\nname: ${SKILL}\n---\n\n${content}\n`,
      dependencyLock,
      runtimeManifest,
      targetMatrix,
    },
    {
      expectedEnvironmentBindings: cells,
      expectedTargetMatrixRoot: targetMatrix.targetMatrixRoot,
    },
  );
  // Review data fixture only: this does not claim a live model/Eval run.
  const matrixBinding = {
    schema: SKILL_EVALUATED_PROMOTION_BINDING_SCHEMA,
    tenantId: TENANT,
    skillName: SKILL,
    candidateId: candidate.candidateId,
    candidateContentDigest: candidate.contentDigest,
    expectedActiveContentDigest: D("chainlesschain.skill-active/empty/v1\0"),
    expectedActiveRevision: 0,
    matrixEvalId: "matrix-eval:workbench-review",
    matrixReceiptDigest: D("matrix-receipt"),
    decisionCommitmentDigest: D("matrix-decision"),
    expiresAt: new Date(NOW + 600_000).toISOString(),
    receiptResolution: {
      authorityId: "authority:matrix",
      resolverDescriptorDigest: D("matrix-resolver"),
      resolverRevision: 1,
      resolvedAt: new Date(NOW).toISOString(),
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
export function decisionFor(packet, overrides = {}, now = NOW) {
  const core = {
    schema: SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
    tenantId: packet.tenantId,
    skillName: packet.skillName,
    candidateId: packet.candidateId,
    packetDigest: packet.packetDigest,
    decision: "approved",
    automated: false,
    reviewerIds: ["human:alice", "human:bob"],
    quorum: 2,
    reason: "Reviewed exact packet.",
    decidedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    acknowledgedContentRiskDigest: packet.contentRisk.detected
      ? packet.contentRisk.contentRiskDigest
      : null,
    ...overrides,
  };
  const receiptDigest = pruningDigest(
    SKILL_PROMOTION_REVIEW_DECISION_SCHEMA,
    core,
  );
  return {
    ...core,
    receiptDigest,
    signature: signature(decisionKey, receiptDigest),
  };
}
export function responseFor(packet, request, overrides = {}, now = NOW) {
  const core = {
    schema: EVOLUTION_WORKBENCH_HUMAN_DECISION_SCHEMA,
    tenantId: request.tenantId,
    requestDigest: request.requestDigest,
    decision: decisionFor(
      packet,
      {
        decision: request.decision === "approve" ? "approved" : "rejected",
        reason: request.reason,
        acknowledgedContentRiskDigest:
          request.decision === "approve" && packet.contentRisk.detected
            ? packet.contentRisk.contentRiskDigest
            : null,
      },
      now,
    ),
    ...overrides,
  };
  const responseDigest = pruningDigest(
    EVOLUTION_WORKBENCH_HUMAN_DECISION_SCHEMA,
    core,
  );
  return {
    ...core,
    responseDigest,
    signature: signature(responseKey, responseDigest),
  };
}
export function runEvents(candidate) {
  const event = (sequence, type, subjectId, payloadDigest) => ({
    schema: evolutionRun.EVOLUTION_RUN_EVENT_SCHEMA,
    tenantId: TENANT,
    runId: RUN,
    eventId: `event:${sequence}`,
    sequence,
    type,
    subjectId,
    payloadDigest,
    artifactRef: subjectId ? `artifact://${subjectId}` : null,
    keyRef: null,
    data: {},
  });
  return [
    event(1, "run-started", null, D("start")),
    event(
      2,
      "skill-candidate-recorded",
      candidate.candidateId,
      candidate.contentDigest,
    ),
  ];
}

export function openWorkbenchReviewStore(root, options = {}) {
  const store = openEvolutionDurableStore(root, {
    tenantId: TENANT,
    streamId: "workbench-reviews",
  });
  const now = options.now ?? (() => NOW);
  const descriptor = {
    ...store.descriptor,
    runId: RUN,
    skillName: SKILL,
    authorityId: "authority:workbench-review",
    revision: 1,
    handlerArtifactDigest: D("workbench-test-handler"),
  };
  const shared = {
    descriptor,
    artifactPorts: store.artifactPorts,
    ledger: store.backend.ledger,
    ledgerArtifactResolver: store.resolver,
    now,
  };
  const decisionVerifier = { verify: options.verifyDecision ?? verifyDecision };
  const reviewAdapter = new SkillPromotionReviewLedgerAdapter({
    ...shared,
    decisionVerifier,
  });
  const runAdapter = new EvolutionRunLedgerAdapter(shared);
  // No Registry transition effects are seeded by this REVIEW-only fixture.
  const projectionSource = createEvolutionWorkbenchDataSource({
    tenantId: TENANT,
    runId: RUN,
    skillName: SKILL,
    runAdapter,
    reviewAdapter,
    transitionAdapter: { list: async () => [] },
  });
  const { packet, candidate } = packetFixture();
  const asks = [];
  const adapter = new EvolutionWorkbenchReviewLedgerAdapter({
    ...shared,
    projectionSource,
    decisionVerifier,
    humanDecisionProvider: {
      request:
        options.request ??
        (async (request) => {
          asks.push(request);
          const actual = await reviewAdapter.readReview(request.packetDigest);
          return responseFor(actual.packet, request, {}, Number(now()));
        }),
    },
    humanDecisionVerifier: { verify: options.verifyHuman ?? verifyHuman },
  });
  return {
    ...store,
    descriptor,
    shared,
    adapter,
    reviewAdapter,
    runAdapter,
    packet,
    candidate,
    asks,
    projectionSource,
    async seed(count = 1) {
      for (const event of runEvents(candidate)) runAdapter.appendEvent(event);
      await reviewAdapter.submitPacket(packet);
      const packets = [packet];
      for (let index = 1; index < count; index++) {
        const next = packetFixture(`Run focused tests, candidate ${index}.`);
        runAdapter.appendEvent({
          ...runEvents(next.candidate)[1],
          sequence: index + 2,
          eventId: `event:${index + 2}`,
        });
        await reviewAdapter.submitPacket(next.packet);
        packets.push(next.packet);
      }
      const projection = await adapter.loadCurrentProjection();
      await adapter.retainProjection({ tenantId: TENANT, projection });
      const plan = buildEvolutionWorkbenchBatchPlan(projection, {
        packetDigests: packets.map((value) => value.packetDigest),
        decision: "approve",
        reason: "Reviewed exact packet.",
        requestedBy: "human:alice",
      });
      return {
        projection,
        plan,
        packets,
        request: buildWorkbenchBatchItemRequest(plan, packet),
      };
    },
  };
}
